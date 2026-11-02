// 이 파일이 하는 일: 첫 설정·로그인·로그아웃·세션 조회·비밀번호 변경 API를 둔다(backend.md §3.1, FR-001·002).
// GET /api/session · POST /api/setup · POST /api/auth/login · POST /api/auth/logout · POST /api/auth/password · GET /api/auth/me
// 성공 응답은 { data }, 실패는 { error: { code, message(한국어), fields? } }다. 로그인 성공·실패·잠금, 첫 설정, 로그아웃, 비밀번호 변경은 감사 로그에 남긴다.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, lockedError, validationError } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { loadDemo } from '../modules/admin/demo-service.ts';
import { changePasswordSchema, loginSchema, setupSchema, SESSION_COOKIE, type LoginResult, type SessionInfo } from '../../shared/schemas/auth.ts';
import { isRole } from '../../shared/roles.ts';
import { parseInput } from '../security/validate.ts';
import { hashPassword, verifyDummy, verifyPassword } from './password.ts';
import { createSession, deleteSession, deleteUserSessions, toMe, type AuthUser } from './sessions.ts';
import { clearFailures, IpFailureCounter, lockedRemainingSec, recordFailure } from './login-limit.ts';
import { auditCtx, currentUser, SESSION_COOKIE_OPTIONS } from './guard.ts';

interface UserRow {
  id: number;
  username: string;
  name: string;
  role: string;
  job_type: string;
  password_hash: string;
  must_change_pw: number;
  active: number;
}

/** DB 줄 → AuthUser */
function rowToUser(row: UserRow): AuthUser {
  if (!isRole(row.role)) throw new Error(`알 수 없는 역할: ${row.role}`);
  return { id: row.id, username: row.username, name: row.name, role: row.role, jobType: row.job_type, mustChangePw: row.must_change_pw === 1 };
}

/** 사용자 수 */
export function countUsers(app: FastifyInstance): number {
  return app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
}

/** settings 한 키의 JSON 값을 읽는다(없거나 깨졌으면 null) */
function readSetting(app: FastifyInstance, key: string): Record<string, unknown> | null {
  const row = app.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return null;
  try {
    const v: unknown = JSON.parse(row.value);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** settings 한 키에 값을 합쳐 저장한다(있던 다른 항목은 남긴다) */
function mergeSetting(app: FastifyInstance, key: string, patch: Record<string, unknown>): void {
  const value = JSON.stringify({ ...(readSetting(app, key) ?? {}), ...patch });
  app.db.run(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, value, app.clock.now().toISOString()],
  );
}

/** 새 세션을 만들고 쿠키를 붙인다 */
function startSession(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply, user: AuthUser): LoginResult {
  const s = createSession(app.db, app.clock, user.id, req.ip);
  reply.setCookie(SESSION_COOKIE, s.token, SESSION_COOKIE_OPTIONS);
  return { user: toMe(user), csrfToken: s.csrfToken };
}

/** 인증 API를 등록한다(buildApp이 /api 앞붙임 없이 그대로 부른다) */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  const ipFailures = new IpFailureCounter(app.clock);

  // 화면이 처음 열릴 때 부른다: 첫 설정이 필요한지, 로그인했는지, CSRF 토큰
  app.get('/api/session', async (req): Promise<{ data: SessionInfo }> => {
    const clinic = readSetting(app, 'clinic');
    const demo = readSetting(app, 'demo');
    return {
      data: {
        setupRequired: countUsers(app) === 0,
        user: req.auth ? toMe(req.auth.user) : null,
        csrfToken: req.auth?.csrfToken ?? null,
        clinicName: typeof clinic?.name === 'string' ? clinic.name : null,
        demoMode: demo?.loaded === true,
      },
    };
  });

  // 첫 설정: 사용자가 0명일 때만 관리자 계정을 만든다(FR-001)
  app.post('/api/setup', async (req, reply) => {
    if (countUsers(app) > 0) throw new AppError('SETUP_DONE');
    const input = parseInput(setupSchema, req.body);
    const hash = await hashPassword(input.password);
    const now = app.clock.now().toISOString();
    // 해시를 만드는 동안 다른 요청이 먼저 끝났을 수 있으니 트랜잭션 안에서 다시 센다
    const userId = app.db.tx(() => {
      if (countUsers(app) > 0) throw new AppError('SETUP_DONE');
      const r = app.db.run(
        "INSERT INTO users (username, name, role, job_type, password_hash, must_change_pw, active, created_at, updated_at) VALUES (?, ?, 'admin', 'other', ?, 0, 1, ?, ?)",
        [input.username, input.name, hash, now, now],
      );
      mergeSetting(app, 'clinic', { name: input.clinicName });
      return r.lastInsertRowid;
    });
    const user: AuthUser = { id: userId, username: input.username, name: input.name, role: 'admin', jobType: 'other', mustChangePw: false };
    const ctx = { ...auditCtx(req), user: { id: user.id, username: user.username } };
    audit(ctx, 'setup.complete', 'user', user.id, { withDemo: input.withDemo });
    // 데모 데이터 넣기는 관리 화면의 "데모 데이터 넣기"와 같은 함수를 쓴다(모든 모듈 seed + settings.demo.loaded + 감사 로그 demo.load)
    if (input.withDemo) await loadDemo(app.db, app.clock, ctx);
    const data = startSession(app, req, reply, user);
    return reply.code(201).send({ data });
  });

  // 로그인: 틀리면 어느 쪽이 틀렸는지 밝히지 않는다. 5번 연속 틀리면 15분 잠금(FR-002 AC1·AC2)
  app.post('/api/auth/login', async (req, reply) => {
    const input = parseInput(loginSchema, req.body);
    const username = input.username;
    const ctx = auditCtx(req);

    const ipWait = ipFailures.blockedSec(req.ip);
    if (ipWait > 0) throw lockedError(ipWait);
    const wait = lockedRemainingSec(app.db, app.clock, username);
    if (wait > 0) {
      audit(ctx, 'auth.login_blocked', 'user', username, { reason: 'locked', retryAfterSec: wait });
      throw lockedError(wait);
    }

    const row = app.db.get<UserRow>(
      'SELECT id, username, name, role, job_type, password_hash, must_change_pw, active FROM users WHERE username = ?',
      [username],
    );
    const ok = row ? await verifyPassword(input.password, row.password_hash) : await verifyDummy(input.password);
    // 비활성 사용자는 비밀번호가 맞아도 로그인할 수 없다(FR-003 AC2). 안내는 틀린 경우와 같게 한다
    if (!row || !ok || row.active !== 1) {
      ipFailures.record(req.ip);
      const f = recordFailure(app.db, app.clock, username);
      audit(ctx, 'auth.login_failed', 'user', row?.id ?? username, { failedCount: f.failedCount, inactive: !!row && ok && row.active !== 1 });
      if (f.locked) {
        audit(ctx, 'auth.locked', 'user', row?.id ?? username, { failedCount: f.failedCount, lockedMinutes: 15 });
        throw lockedError(f.retryAfterSec);
      }
      throw new AppError('INVALID_LOGIN');
    }

    clearFailures(app.db, username);
    const user = rowToUser(row);
    audit({ ...ctx, user: { id: user.id, username: user.username } }, 'auth.login', 'user', user.id, null);
    return reply.send({ data: startSession(app, req, reply, user) });
  });

  // 로그아웃: 이 세션을 지우고 쿠키도 지운다. 이후 같은 쿠키로 요청하면 401(FR-002 AC4)
  app.post('/api/auth/logout', async (req, reply) => {
    const user = currentUser(req);
    if (req.auth) deleteSession(app.db, req.auth.sessionId);
    audit(auditCtx(req), 'auth.logout', 'user', user.id, null);
    reply.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return reply.code(204).send();
  });

  // 본인 비밀번호 변경: 현재 비밀번호가 맞을 때만(FR-002 AC6). 바꾸면 다른 기기의 세션은 끊는다
  app.post('/api/auth/password', async (req, reply) => {
    const user = currentUser(req);
    const input = parseInput(changePasswordSchema, req.body);
    const row = app.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    if (!row || !(await verifyPassword(input.current, row.password_hash))) {
      throw validationError({ current: '현재 비밀번호가 맞지 않습니다.' });
    }
    const hash = await hashPassword(input.next);
    app.db.tx(() => {
      app.db.run('UPDATE users SET password_hash = ?, must_change_pw = 0, updated_at = ? WHERE id = ?', [hash, app.clock.now().toISOString(), user.id]);
      deleteUserSessions(app.db, user.id, req.auth?.sessionId);
    });
    audit(auditCtx(req), 'auth.password_changed', 'user', user.id, { wasTemporary: user.mustChangePw });
    return reply.code(204).send();
  });

  // 지금 로그인한 사용자(로그인이 필요한 가장 작은 API — 화면의 세션 확인과 시험에 쓴다)
  app.get('/api/auth/me', async (req) => ({ data: toMe(currentUser(req)) }));
}

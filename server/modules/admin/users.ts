// 이 파일이 하는 일: 직원 계정 API(backend.md §3.2, FR-003 AC2·AC3, FR-004)를 둔다.
// GET /api/users(M 조회) · POST /api/users(A 추가) · PATCH /api/users/:id(A 수정·비활성화) · POST /api/users/:id/reset-password(A 비밀번호 초기화)
// 마지막으로 남은 사용 중 admin은 끄거나 역할을 낮출 수 없다(409 LAST_ADMIN). 비활성화·비밀번호 초기화를 하면 그 직원의 열린 세션을 모두 끊는다.
// 추가·초기화 때 임시 비밀번호를 만들어 응답으로 한 번만 돌려주고, 직원은 다음 로그인 때 비밀번호를 바꿔야 한다(must_change_pw=1).
import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import { audit } from '../../lib/audit.ts';
import { hashPassword } from '../../auth/password.ts';
import { deleteUserSessions } from '../../auth/sessions.ts';
import { auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { isRole } from '../../../shared/roles.ts';
import { JOB_TYPES, type JobType } from '../../../shared/enums.ts';
import {
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  type CreatedUser,
  type PageResult,
  type TempPasswordResult,
  type UserRow,
} from '../../../shared/schemas/admin.ts';
import type { Db } from '../../db/index.ts';

/** DB users 줄 */
interface DbUser {
  id: number;
  username: string;
  name: string;
  role: string;
  job_type: string;
  hired_on: string | null;
  active: number;
  must_change_pw: number;
  created_at: string;
  updated_at: string;
}

const USER_COLS = 'id, username, name, role, job_type, hired_on, active, must_change_pw, created_at, updated_at';

/** DB 줄 → 화면에 보내는 UserRow(비밀번호 해시는 절대 싣지 않는다) */
export function toUserRow(u: DbUser): UserRow {
  if (!isRole(u.role)) throw new Error(`알 수 없는 역할: ${u.role}`);
  const jobType = (JOB_TYPES as readonly string[]).includes(u.job_type) ? (u.job_type as JobType) : 'other';
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    jobType,
    hiredOn: u.hired_on,
    active: u.active === 1,
    mustChangePw: u.must_change_pw === 1,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

/** 임시 비밀번호에 쓰는 글자(헷갈리는 0·O·1·l·I는 뺐다) */
const TEMP_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** 읽어 주기 쉬운 임시 비밀번호를 만든다(예: "Tmp-k7Qm-x3Rp", 영문·숫자 8자 + 구분 기호) */
export function makeTempPassword(): string {
  const pick = (n: number) => Array.from({ length: n }, () => TEMP_CHARS[randomInt(TEMP_CHARS.length)]).join('');
  return `Tmp-${pick(4)}-${pick(4)}`;
}

/** id로 직원 한 명을 찾는다(없으면 404) */
function getUser(db: Db, id: number): DbUser {
  const u = db.get<DbUser>(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [id]);
  if (!u) throw new AppError('NOT_FOUND', { message: '찾는 직원이 없습니다. 목록을 새로 고쳐 주세요.' });
  return u;
}

/** 지금 사용 중인 admin 수 */
export function countActiveAdmins(db: Db): number {
  return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1")?.n ?? 0;
}

/** 목록 조건 */
const listQuerySchema = z.object({
  q: z.string().trim().max(50, { error: '검색어는 50자까지 적을 수 있어요.' }).optional(),
  status: z.enum(['active', 'inactive', 'all'], { error: '상태 조건을 확인해 주세요.' }).optional().default('all'),
  page: z.coerce.number().int().min(1, { error: '쪽 번호를 확인해 주세요.' }).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200, { error: '한 번에 200줄까지 볼 수 있어요.' }).optional().default(200),
});

const idParam = z.object({ id: z.coerce.number({ error: '직원 번호를 확인해 주세요.' }).int().positive({ error: '직원 번호를 확인해 주세요.' }) });

/** 직원 목록을 읽는다(사용 중 먼저, 역할 높은 순, 이름 가나다순) */
export function listUsers(db: Db, q: z.infer<typeof listQuerySchema>): PageResult<UserRow> {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q.q) {
    where.push('(name LIKE ? ESCAPE \'\\\' OR username LIKE ? ESCAPE \'\\\')');
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  if (q.status === 'active') where.push('active = 1');
  if (q.status === 'inactive') where.push('active = 0');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM users ${w}`, params)?.n ?? 0;
  const rows = db.all<DbUser>(
    `SELECT ${USER_COLS} FROM users ${w}
      ORDER BY active DESC, CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, name, id
      LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize],
  );
  return { data: rows.map(toUserRow), total };
}

/** 직원 계정 API를 등록한다(routes.ts가 '/api' 앞붙임으로 부른다) */
export async function usersRoutes(app: FastifyInstance): Promise<void> {
  // 목록: 원장·실장이 본다(근무표·연차 승인에 필요). 고치기는 admin만
  app.get('/users', async (req) => listUsers(app.db, parseInput(listQuerySchema, req.query)));

  // 직원 추가: 이름·아이디·역할·직무·입사일만 받는다(FR-004 AC1). 임시 비밀번호를 만들어 한 번만 돌려준다
  app.post('/users', async (req, reply) => {
    const input = parseInput(createUserSchema, req.body);
    const tempPassword = input.tempPassword ?? makeTempPassword();
    const hash = await hashPassword(tempPassword);
    const now = app.clock.now().toISOString();
    const id = app.db.tx(() => {
      const dup = app.db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', [input.username]);
      if (dup) {
        throw new AppError('CONFLICT', {
          message: '이미 쓰고 있는 아이디예요. 다른 아이디를 정해 주세요.',
          fields: { username: '이미 쓰고 있는 아이디예요. 다른 아이디를 정해 주세요.' },
        });
      }
      return app.db.run(
        'INSERT INTO users (username, name, role, job_type, hired_on, password_hash, must_change_pw, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)',
        [input.username, input.name, input.role, input.jobType, input.hiredOn, hash, now, now],
      ).lastInsertRowid;
    });
    const row = toUserRow(getUser(app.db, id));
    audit(auditCtx(req), 'user.create', 'user', id, { username: row.username, role: row.role, jobType: row.jobType, hiredOn: row.hiredOn });
    const data: CreatedUser = { ...row, tempPassword };
    return reply.code(201).send({ data });
  });

  // 직원 수정·비활성화·다시 사용. 마지막 admin은 끄거나 역할을 낮출 수 없다(FR-003 AC3)
  app.patch('/users/:id', async (req) => {
    const { id } = parseInput(idParam, req.params);
    const input = parseInput(updateUserSchema, req.body);
    const now = app.clock.now().toISOString();
    const { before, after } = app.db.tx(() => {
      const b = getUser(app.db, id);
      const nextRole = input.role ?? b.role;
      const nextActive = input.active ?? b.active === 1;
      const losesAdmin = b.role === 'admin' && b.active === 1 && (nextRole !== 'admin' || !nextActive);
      if (losesAdmin && countActiveAdmins(app.db) <= 1) throw new AppError('LAST_ADMIN');
      const sets: string[] = [];
      const params: Array<string | number | null> = [];
      const put = (col: string, v: string | number | null) => {
        sets.push(`${col} = ?`);
        params.push(v);
      };
      if (input.name !== undefined) put('name', input.name);
      if (input.role !== undefined) put('role', input.role);
      if (input.jobType !== undefined) put('job_type', input.jobType);
      if (input.hiredOn !== undefined) put('hired_on', input.hiredOn);
      if (input.active !== undefined) put('active', input.active ? 1 : 0);
      put('updated_at', now);
      params.push(id);
      app.db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
      // 비활성화하면 열린 세션을 모두 끊는다(FR-003 AC2). 다음 요청부터 401
      if (b.active === 1 && !nextActive) deleteUserSessions(app.db, id);
      return { before: toUserRow(b), after: toUserRow(getUser(app.db, id)) };
    });

    // 감사 기록: 바뀐 항목만 "전 → 후"로 남긴다(FR-004 AC3)
    const ctx = auditCtx(req);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ['name', 'role', 'jobType', 'hiredOn'] as const) {
      if (before[k] !== after[k]) changes[k] = { from: before[k], to: after[k] };
    }
    if (Object.keys(changes).length > 0) audit(ctx, 'user.update', 'user', id, { username: after.username, changes });
    if (before.active !== after.active) audit(ctx, after.active ? 'user.activate' : 'user.deactivate', 'user', id, { username: after.username });
    return { data: after };
  });

  // 비밀번호 초기화: 임시 비밀번호로 바꾸고, 다음 로그인 때 바꾸게 하며, 열린 세션을 끊는다(FR-004 AC2)
  app.post('/users/:id/reset-password', async (req) => {
    const { id } = parseInput(idParam, req.params);
    const input = parseInput(resetPasswordSchema, req.body);
    const me = currentUser(req);
    const target = getUser(app.db, id);
    if (target.id === me.id) {
      throw new AppError('CONFLICT', { message: '본인 비밀번호는 오른쪽 위 메뉴의 "비밀번호 바꾸기"에서 바꿔 주세요.' });
    }
    const tempPassword = input.tempPassword ?? makeTempPassword();
    const hash = await hashPassword(tempPassword);
    app.db.tx(() => {
      app.db.run('UPDATE users SET password_hash = ?, must_change_pw = 1, updated_at = ? WHERE id = ?', [hash, app.clock.now().toISOString(), id]);
      deleteUserSessions(app.db, id);
    });
    audit(auditCtx(req), 'user.reset_password', 'user', id, { username: target.username });
    const data: TempPasswordResult = { tempPassword };
    return { data };
  });
}

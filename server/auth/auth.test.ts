// 이 파일이 하는 일: 첫 설정·로그인·잠금·세션 만료·CSRF·로그아웃·비밀번호 변경·평문 비밀번호 없음을 실제 라우트와 DB로 확인한다
// (phase-01-task-03 AC1·AC2·AC3·AC4·AC7, FR-001·002·003 AC2). 시간은 manualClock으로 옮기고, 요청은 fastify.inject로 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.ts';
import { HOUR_MS, manualClock, MINUTE_MS, type ManualClock } from '../lib/clock.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';
import { hashPassword } from './password.ts';
import { deleteUserSessions } from './sessions.ts';

const START = '2026-11-02T09:00:00+09:00';
const ADMIN_PW = 'Haneul-Admin-Pw-7781';

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

/** 임시 데이터 폴더로 서버를 만든다(DB는 서버가 직접 열고 닫는다) */
async function makeApp(clock: ManualClock = manualClock(START)) {
  tmp = makeTmpDir('dentalax-auth-');
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return { app, clock, dataDir: tmp };
}

/** 응답의 Set-Cookie에서 sid 쿠키 값을 꺼낸다 */
function sidCookie(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === 'sid');
  if (!c) throw new Error('sid 쿠키가 없어요');
  return `sid=${c.value}`;
}

const setupBody = { clinicName: '하늘숲치과', name: '김원장', username: 'admin01', password: ADMIN_PW, withDemo: false };

/** 첫 설정을 하고 쿠키·CSRF 토큰을 돌려준다 */
async function doSetup(a: FastifyInstance) {
  const res = await a.inject({ method: 'POST', url: '/api/setup', payload: setupBody });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ data: { user: { id: number; role: string }; csrfToken: string } }>();
  return { cookie: sidCookie(res), csrf: body.data.csrfToken, user: body.data.user };
}

/** 직원 계정을 실제 해시로 DB에 넣는다 */
async function addUser(a: FastifyInstance, username: string, password: string, role = 'staff', mustChangePw = 0) {
  const now = a.clock.now().toISOString();
  return a.db.run(
    'INSERT INTO users (username, name, role, job_type, password_hash, must_change_pw, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [username, '이직원', role, 'desk', await hashPassword(password), mustChangePw, now, now],
  ).lastInsertRowid;
}

function login(a: FastifyInstance, username: string, password: string) {
  return a.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
}

describe('첫 설정 POST /api/setup', () => {
  test('phase-01-task-03 AC1: 사용자 0명이면 admin을 만들고, 그 뒤 같은 요청은 409 SETUP_DONE이며 사용자 수가 늘지 않는다', async () => {
    const { app: a } = await makeApp();
    const before = await a.inject({ method: 'GET', url: '/api/session' });
    expect(before.json()).toMatchObject({ data: { setupRequired: true, user: null, csrfToken: null } });

    const first = await a.inject({ method: 'POST', url: '/api/setup', payload: setupBody });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ data: { user: { username: 'admin01', name: '김원장', role: 'admin', mustChangePw: false }, csrfToken: expect.any(String) } });
    const setCookie = String(first.headers['set-cookie']);
    expect(setCookie).toMatch(/sid=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n).toBe(1);
    expect(a.db.get<{ role: string }>('SELECT role FROM users')?.role).toBe('admin');

    // 같은 요청을 다시 보내면 409, 다른 아이디로 보내도 409
    const again = await a.inject({ method: 'POST', url: '/api/setup', payload: setupBody });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'SETUP_DONE', message: '이미 첫 설정이 끝났습니다. 로그인해 주세요.' } });
    const other = await a.inject({ method: 'POST', url: '/api/setup', payload: { ...setupBody, username: 'hacker99' } });
    expect(other.statusCode).toBe(409);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n).toBe(1);

    // 설정 뒤 세션 조회: 로그인 상태, 병원 이름, 감사 로그
    const session = await a.inject({ method: 'GET', url: '/api/session', headers: { cookie: sidCookie(first) } });
    expect(session.json()).toMatchObject({ data: { setupRequired: false, user: { username: 'admin01' }, clinicName: '하늘숲치과', demoMode: false } });
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'setup.complete'")?.n).toBe(1);
  });

  test('phase-01-task-03 AC1: 입력이 틀리면 400 VALIDATION과 항목별 한국어 이유를 돌려주고 계정을 만들지 않는다', async () => {
    const { app: a } = await makeApp();
    const res = await a.inject({ method: 'POST', url: '/api/setup', payload: { clinicName: '', name: '김원장', username: 'ab', password: 'short' } });
    expect(res.statusCode).toBe(400);
    const err = res.json<{ error: { code: string; message: string; fields: Record<string, string> } }>().error;
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toBe('입력값을 확인해 주세요.');
    expect(err.fields).toMatchObject({
      clinicName: '병원 이름을 적어 주세요.',
      username: '아이디는 영문과 숫자로 4~20자로 적어 주세요.',
      password: '비밀번호는 8자 이상으로 적어 주세요.',
    });
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n).toBe(0);
  });

  test('phase-01-task-03 AC1: 동시에 두 번 보내도 admin은 한 명만 생긴다(트랜잭션 안에서 다시 확인)', async () => {
    const { app: a } = await makeApp();
    const [x, y] = await Promise.all([
      a.inject({ method: 'POST', url: '/api/setup', payload: setupBody }),
      a.inject({ method: 'POST', url: '/api/setup', payload: { ...setupBody, username: 'admin02' } }),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([201, 409]);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n).toBe(1);
  });

  test('phase-01-task-03 AC1: withDemo를 고르면 데모 데이터를 넣고 세션 조회의 demoMode가 true다', async () => {
    const { app: a } = await makeApp();
    const res = await a.inject({ method: 'POST', url: '/api/setup', payload: { ...setupBody, withDemo: true } });
    expect(res.statusCode).toBe(201);
    const s = await a.inject({ method: 'GET', url: '/api/session' });
    expect(s.json()).toMatchObject({ data: { demoMode: true } });
  });
});

describe('로그인 잠금', () => {
  test('phase-01-task-03 AC2: 틀린 비밀번호 5회 후 6번째는 맞는 비밀번호여도 423 LOCKED, 주입 시계로 15분 뒤에는 로그인된다; 감사 로그에 잠금이 남는다', async () => {
    const { app: a, clock } = await makeApp();
    await doSetup(a);
    await addUser(a, 'staff01', 'Staff-Pw-1234');

    for (let i = 1; i <= 4; i++) {
      const r = await login(a, 'staff01', `wrong-${i}`);
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ error: { code: 'INVALID_LOGIN', message: '아이디 또는 비밀번호가 맞지 않습니다.' } });
    }
    const fifth = await login(a, 'staff01', 'wrong-5');
    expect(fifth.statusCode).toBe(423);
    expect(fifth.json()).toMatchObject({ error: { code: 'LOCKED', retryAfterSec: 900 } });

    const sixth = await login(a, 'staff01', 'Staff-Pw-1234');
    expect(sixth.statusCode).toBe(423);
    const locked = sixth.json<{ error: { code: string; message: string; retryAfterSec: number } }>().error;
    expect(locked.code).toBe('LOCKED');
    expect(locked.message).toContain('15분');
    expect(locked.message).toMatch(/약 \d+분 뒤/);

    // 14분 59초 뒤에도 아직 잠김
    clock.advance(15 * MINUTE_MS - 1000);
    expect((await login(a, 'staff01', 'Staff-Pw-1234')).statusCode).toBe(423);
    // 15분이 지나면 로그인된다
    clock.advance(1000);
    const ok = await login(a, 'staff01', 'Staff-Pw-1234');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ data: { user: { username: 'staff01', role: 'staff' }, csrfToken: expect.any(String) } });

    const actions = a.db.all<{ action: string; target_id: string }>('SELECT action, target_id FROM audit_log ORDER BY id').map((r) => r.action);
    expect(actions.filter((x) => x === 'auth.login_failed')).toHaveLength(5);
    expect(actions).toContain('auth.locked');
    expect(actions.at(-1)).toBe('auth.login');
    // 로그인에 성공하면 실패 기록이 지워진다
    expect(a.db.get('SELECT * FROM login_attempts WHERE username = ?', ['staff01'])).toBeUndefined();
  });

  test('phase-01-task-03 AC2: 없는 아이디도 같은 문구로 거절하고 똑같이 잠근다(아이디가 있는지 알 수 없게)', async () => {
    const { app: a } = await makeApp();
    await doSetup(a);
    const r = await login(a, 'nobody', 'whatever1');
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: { code: 'INVALID_LOGIN', message: '아이디 또는 비밀번호가 맞지 않습니다.' } });
    for (let i = 0; i < 4; i++) await login(a, 'nobody', 'whatever1');
    expect((await login(a, 'nobody', 'whatever1')).statusCode).toBe(423);
  });

  test('phase-01-task-03 AC2: 실패 횟수는 15분 창 안에서만 이어진다(오래된 실패는 다시 센다)', async () => {
    const { app: a, clock } = await makeApp();
    await doSetup(a);
    await addUser(a, 'staff02', 'Staff-Pw-1234');
    for (let i = 0; i < 4; i++) await login(a, 'staff02', 'nope-nope');
    clock.advance(16 * MINUTE_MS);
    // 창이 지나 1번째 실패로 다시 센다 → 401(잠기지 않음)
    expect((await login(a, 'staff02', 'nope-nope')).statusCode).toBe(401);
    expect((await login(a, 'staff02', 'Staff-Pw-1234')).statusCode).toBe(200);
  });

  test('phase-01-task-03 AC2(FR-003 AC2): 비활성 사용자는 비밀번호가 맞아도 로그인할 수 없고, 남은 세션은 다음 요청에서 401이다', async () => {
    const { app: a } = await makeApp();
    await doSetup(a);
    const id = await addUser(a, 'staff03', 'Staff-Pw-1234');
    const ok = await login(a, 'staff03', 'Staff-Pw-1234');
    const cookie = sidCookie(ok);
    a.db.run('UPDATE users SET active = 0 WHERE id = ?', [id]);
    const me = await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [id])?.n).toBe(0);
    const again = await login(a, 'staff03', 'Staff-Pw-1234');
    expect(again.statusCode).toBe(401);
    expect(again.json()).toMatchObject({ error: { code: 'INVALID_LOGIN' } });
    // 관리 화면(01-05)이 비활성화할 때 부르는 함수도 세션을 지운다
    a.db.run('UPDATE users SET active = 1 WHERE id = ?', [id]);
    const s2 = sidCookie(await login(a, 'staff03', 'Staff-Pw-1234'));
    expect(deleteUserSessions(a.db, id)).toBe(1);
    expect((await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: s2 } })).statusCode).toBe(401);
  });
});

describe('세션 만료(8시간 슬라이딩)', () => {
  test('phase-01-task-03 AC3: 마지막 요청 8시간 1분 뒤 요청은 401이고, 8시간 전 요청은 성공하며 만료가 연장된다', async () => {
    const { app: a, clock } = await makeApp();
    const { cookie } = await doSetup(a);
    const expiresOf = () => a.db.get<{ expires_at: string }>('SELECT expires_at FROM sessions')?.expires_at;
    expect(expiresOf()).toBe(new Date(clock.now().getTime() + 8 * HOUR_MS).toISOString());

    // 7시간 59분 뒤(8시간 전): 성공하고 만료가 "지금+8시간"으로 늘어난다
    clock.advance(8 * HOUR_MS - MINUTE_MS);
    const mid = await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(mid.statusCode).toBe(200);
    expect(mid.json()).toMatchObject({ data: { username: 'admin01' } });
    expect(expiresOf()).toBe(new Date(clock.now().getTime() + 8 * HOUR_MS).toISOString());

    // 또 7시간 59분 뒤: 처음 로그인에서 15시간 58분이 지났지만 마지막 요청 기준이라 아직 성공
    clock.advance(8 * HOUR_MS - MINUTE_MS);
    expect((await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);

    // 마지막 요청에서 8시간 1분 뒤: 401, 세션 줄도 지워진다
    clock.advance(8 * HOUR_MS + MINUTE_MS);
    const late = await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(late.statusCode).toBe(401);
    expect(late.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: '다시 로그인해 주세요.' } });
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')?.n).toBe(0);
    // 세션 조회는 공개 API라 200이지만 로그인 안 된 상태로 알려 준다
    const s = await a.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    expect(s.json()).toMatchObject({ data: { user: null, csrfToken: null } });
  });

  test('phase-01-task-03 AC3: 정확히 8시간이 지나면 만료다(경계)', async () => {
    const { app: a, clock } = await makeApp();
    const { cookie } = await doSetup(a);
    clock.advance(8 * HOUR_MS);
    expect((await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('CSRF·로그아웃', () => {
  test('phase-01-task-03 AC4: CSRF 헤더 없는 POST는 403 CSRF, 로그아웃 후 이전 쿠키로 요청하면 401이다', async () => {
    const { app: a } = await makeApp();
    const { cookie, csrf } = await doSetup(a);

    const noHeader = await a.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json()).toEqual({ error: { code: 'CSRF', message: '보안 확인에 실패했습니다. 화면을 새로 고쳐 주세요.' } });
    const wrong = await a.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': `${csrf}x` } });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ error: { code: 'CSRF' } });
    // 토큰이 맞아도 다른 사이트에서 온 요청(Origin 불일치)은 거부
    const cross = await a.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': csrf, origin: 'http://evil.example', host: 'localhost:8090' } });
    expect(cross.statusCode).toBe(403);
    expect(cross.json()).toMatchObject({ error: { code: 'CSRF' } });
    // 거부된 요청은 세션을 지우지 않았다
    expect((await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);

    const out = await a.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': csrf, origin: 'http://localhost:8090', host: 'localhost:8090' } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/sid=;/);
    const after = await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    const afterPost = await a.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': csrf } });
    expect(afterPost.statusCode).toBe(401);
    const actions = a.db.all<{ action: string }>('SELECT action FROM audit_log').map((r) => r.action);
    expect(actions).toContain('auth.logout');
  });

  test('phase-01-task-03 AC4: 로그인 요청도 다른 사이트에서 오면 403 CSRF다', async () => {
    const { app: a } = await makeApp();
    await doSetup(a);
    const r = await a.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'http://evil.example', host: 'localhost:8090' }, payload: { username: 'admin01', password: ADMIN_PW } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: { code: 'CSRF' } });
    const s = await a.inject({ method: 'POST', url: '/api/auth/login', headers: { 'sec-fetch-site': 'cross-site' }, payload: { username: 'admin01', password: ADMIN_PW } });
    expect(s.statusCode).toBe(403);
  });
});

describe('비밀번호 변경·임시 비밀번호', () => {
  test('phase-01-task-03 범위(FR-002 AC6): 현재 비밀번호가 맞을 때만 바뀌고, 다른 기기 세션은 끊긴다', async () => {
    const { app: a } = await makeApp();
    await addUser(a, 'staff04', 'Old-Pass-1234');
    const s1 = login(a, 'staff04', 'Old-Pass-1234');
    const s2 = login(a, 'staff04', 'Old-Pass-1234');
    const [r1, r2] = await Promise.all([s1, s2]);
    const me = { cookie: sidCookie(r1), 'x-csrf-token': r1.json<{ data: { csrfToken: string } }>().data.csrfToken };

    const bad = await a.inject({ method: 'POST', url: '/api/auth/password', headers: me, payload: { current: 'not-it-123', next: 'New-Pass-5678' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'VALIDATION', fields: { current: '현재 비밀번호가 맞지 않습니다.' } } });

    const good = await a.inject({ method: 'POST', url: '/api/auth/password', headers: me, payload: { current: 'Old-Pass-1234', next: 'New-Pass-5678' } });
    expect(good.statusCode).toBe(204);
    expect((await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: me.cookie } })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sidCookie(r2) } })).statusCode).toBe(401);
    expect((await login(a, 'staff04', 'Old-Pass-1234')).statusCode).toBe(401);
    expect((await login(a, 'staff04', 'New-Pass-5678')).statusCode).toBe(200);
  });

  test('phase-01-task-03 범위(must_change_pw): 임시 비밀번호 사용자는 비밀번호 변경 전까지 다른 API가 403 PASSWORD_CHANGE_REQUIRED다', async () => {
    const { app: a } = await makeApp();
    await addUser(a, 'staff05', 'Temp-Pass-0001', 'staff', 1);
    const r = await login(a, 'staff05', 'Temp-Pass-0001');
    expect(r.json()).toMatchObject({ data: { user: { mustChangePw: true } } });
    const headers = { cookie: sidCookie(r), 'x-csrf-token': r.json<{ data: { csrfToken: string } }>().data.csrfToken };
    const blocked = await a.inject({ method: 'GET', url: '/api/auth/me', headers });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: { code: 'PASSWORD_CHANGE_REQUIRED', message: '새 비밀번호로 바꾼 뒤 이용할 수 있습니다.' } });
    // 세션 조회와 비밀번호 변경은 된다
    expect((await a.inject({ method: 'GET', url: '/api/session', headers })).statusCode).toBe(200);
    const ch = await a.inject({ method: 'POST', url: '/api/auth/password', headers, payload: { current: 'Temp-Pass-0001', next: 'Mine-Pass-0002' } });
    expect(ch.statusCode).toBe(204);
    const me = await a.inject({ method: 'GET', url: '/api/auth/me', headers });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ data: { mustChangePw: false } });
  });
});

describe('평문 비밀번호 없음', () => {
  test('phase-01-task-03 AC7: DB 어디에도 평문 비밀번호가 없다(사용한 비밀번호 문자열로 DB 파일 바이트 검색)', async () => {
    const { app: a, dataDir } = await makeApp();
    const { cookie, csrf } = await doSetup(a);
    await login(a, 'admin01', 'Typo-Secret-Pw-4455'); // 틀린 비밀번호도 저장되면 안 된다
    await login(a, 'admin01', ADMIN_PW);
    const ch = await a.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie, 'x-csrf-token': csrf }, payload: { current: ADMIN_PW, next: 'Changed-Pw-9900' } });
    expect(ch.statusCode).toBe(204);
    const hash = a.db.get<{ password_hash: string }>('SELECT password_hash FROM users')?.password_hash ?? '';
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);

    // 열린 상태의 DB·WAL 파일과, 닫은 뒤(체크포인트 후) 파일을 모두 검사한다
    const scan = () => {
      const files = fs.readdirSync(dataDir).filter((f) => f.startsWith('app.db'));
      expect(files).toContain('app.db');
      for (const f of files) {
        const bytes = fs.readFileSync(path.join(dataDir, f));
        for (const pw of [ADMIN_PW, 'Typo-Secret-Pw-4455', 'Changed-Pw-9900']) {
          expect(bytes.includes(Buffer.from(pw, 'utf8')), `${f}에 "${pw}"가 들어 있어요`).toBe(false);
          expect(bytes.includes(Buffer.from(pw, 'utf16le')), `${f}에 "${pw}"(UTF-16)가 들어 있어요`).toBe(false);
        }
      }
      return files.length;
    };
    expect(scan()).toBeGreaterThan(0);
    await a.close();
    app = null;
    expect(scan()).toBeGreaterThan(0);
  });
});

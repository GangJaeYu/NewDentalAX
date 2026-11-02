// 이 파일이 하는 일: 직원 계정·병원 기본 정보·활동 기록 API를 실제 라우트와 DB로 확인한다(phase-01-task-05 AC1~AC6, FR-003 AC2·AC3, FR-004, FR-005, FR-042 AC1).
// 요청은 fastify.inject로 보내고, 시간은 manualClock으로 고정한다. 로그아웃·만료 때 지우는 쿠키가 발급 쿠키와 같은 SameSite=Strict인지도 본다(01-03 검증 참고 사항).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../app.ts';
import { DAY_MS, HOUR_MS, manualClock, type ManualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { hashPassword } from '../../auth/password.ts';
import { createSession } from '../../auth/sessions.ts';
import { createUserSchema, defaultClinic } from '../../../shared/schemas/admin.ts';
import { csvCell, auditCsv } from './audit.ts';
import { makeTempPassword } from './users.ts';

const START = '2026-11-02T09:00:00+09:00';
const ADMIN_PW = 'Admin-Pass-0501';

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

/** 임시 데이터 폴더로 서버를 만들고, 비밀번호로 로그인할 수 있는 admin을 하나 넣는다 */
async function makeApp(clock: ManualClock = manualClock(START)) {
  tmp = makeTmpDir('dentalax-admin-');
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  const admin = loginAs(app, 'admin', { username: 'boss01', passwordHash: await hashPassword(ADMIN_PW) });
  return { a: app, clock, admin };
}

/** 응답의 sid 쿠키 */
function sidCookie(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === 'sid');
  if (!c) throw new Error('sid 쿠키가 없어요');
  return `sid=${c.value}`;
}

/** 로그인해서 쿠키·CSRF를 받는다 */
async function login(a: FastifyInstance, username: string, password: string) {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  return { res, cookie: res.statusCode === 200 ? sidCookie(res) : '', csrf: res.statusCode === 200 ? res.json<{ data: { csrfToken: string } }>().data.csrfToken : '' };
}

/** admin으로 직원을 추가한다 */
async function addStaff(a: FastifyInstance, admin: TestLogin, body: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: '/api/users', headers: admin.writeHeaders, payload: body });
}

const patch = (a: FastifyInstance, who: TestLogin, id: number, payload: unknown) =>
  a.inject({ method: 'PATCH', url: `/api/users/${id}`, headers: who.writeHeaders, payload: payload as Record<string, unknown> });

const userRow = (a: FastifyInstance, id: number) => a.db.get<{ role: string; active: number; must_change_pw: number; name: string }>('SELECT role, active, must_change_pw, name FROM users WHERE id = ?', [id]);

describe('직원 추가와 임시 비밀번호', () => {
  test('phase-01-task-05 AC1: 추가한 직원은 임시 비밀번호로 로그인하면 비밀번호 변경이 강제되고, 바꾼 뒤에는 다른 API를 쓸 수 있다', async () => {
    const { a, admin } = await makeApp();
    const res = await addStaff(a, admin, { name: '이수진', username: 'sujin01', role: 'staff', jobType: 'hygienist', hiredOn: '2026-03-02' });
    expect(res.statusCode).toBe(201);
    const created = res.json<{ data: { id: number; tempPassword: string; mustChangePw: boolean; active: boolean; jobType: string; hiredOn: string } }>().data;
    expect(created).toMatchObject({ mustChangePw: true, active: true, jobType: 'hygienist', hiredOn: '2026-03-02' });
    expect(created.tempPassword).toMatch(/^Tmp-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    expect(JSON.stringify(res.json())).not.toMatch(/password_hash|scrypt\$/);

    const first = await login(a, 'sujin01', created.tempPassword);
    expect(first.res.statusCode).toBe(200);
    expect(first.res.json()).toMatchObject({ data: { user: { username: 'sujin01', mustChangePw: true } } });
    const blocked = await a.inject({ method: 'GET', url: '/api/settings/clinic', headers: { cookie: first.cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: { code: 'PASSWORD_CHANGE_REQUIRED' } });

    const changed = await a.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: first.cookie, 'x-csrf-token': first.csrf },
      payload: { current: created.tempPassword, next: 'Sujin-New-Pass-9' },
    });
    expect(changed.statusCode).toBe(204);
    const ok = await a.inject({ method: 'GET', url: '/api/settings/clinic', headers: { cookie: first.cookie } });
    expect(ok.statusCode).toBe(200);
    expect(userRow(a, created.id)?.must_change_pw).toBe(0);
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user.create' AND target_id = ?", [String(created.id)])?.n).toBe(1);
  });

  test('phase-01-task-05 AC1: 비밀번호를 초기화하면 다음 로그인 때 다시 바꿔야 하고, 열린 세션은 끊기며, 감사 로그에 남는다', async () => {
    const { a, admin } = await makeApp();
    const staff = loginAs(a, 'staff', { username: 'staff77', passwordHash: await hashPassword('Old-Staff-Pass-1') });
    const r = await a.inject({ method: 'POST', url: `/api/users/${staff.userId}/reset-password`, headers: admin.writeHeaders, payload: {} });
    expect(r.statusCode).toBe(200);
    const { tempPassword } = r.json<{ data: { tempPassword: string } }>().data;
    expect((await a.inject({ method: 'GET', url: '/api/auth/me', headers: staff.headers })).statusCode).toBe(401);
    expect((await login(a, 'staff77', 'Old-Staff-Pass-1')).res.statusCode).toBe(401);
    const again = await login(a, 'staff77', tempPassword);
    expect(again.res.json()).toMatchObject({ data: { user: { mustChangePw: true } } });
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user.reset_password'")?.n).toBe(1);
    // 감사 기록에 임시 비밀번호가 들어가지 않는다
    expect(JSON.stringify(a.db.all('SELECT detail FROM audit_log'))).not.toContain(tempPassword);
    // 본인 비밀번호는 여기서 초기화하지 않는다
    const self = await a.inject({ method: 'POST', url: `/api/users/${admin.userId}/reset-password`, headers: admin.writeHeaders, payload: {} });
    expect(self.statusCode).toBe(409);
  });

  test('phase-01-task-05 AC2: 직원 추가는 이름·아이디·역할·직무·입사일만 받는다(연락처·주소 같은 항목을 보내면 400, 저장되지 않음)', async () => {
    const { a, admin } = await makeApp();
    expect(Object.keys(createUserSchema.shape).sort()).toEqual(['hiredOn', 'jobType', 'name', 'role', 'tempPassword', 'username']);
    for (const extra of [{ phone: '010-1234-5678' }, { address: '서울시' }, { birth: '1990-01-01' }, { email: 'a@b.c' }]) {
      const res = await addStaff(a, admin, { name: '박민지', username: 'minji01', role: 'staff', jobType: 'desk', ...extra });
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
    }
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE username = 'minji01'")?.n).toBe(0);
    const cols = a.db.all<{ name: string }>('PRAGMA table_info(users)').map((c) => c.name);
    expect(cols.sort()).toEqual(['active', 'created_at', 'hired_on', 'id', 'job_type', 'must_change_pw', 'name', 'password_hash', 'role', 'updated_at', 'username']);
    // 형식이 틀리면 항목별 한국어 이유
    const bad = await addStaff(a, admin, { name: '', username: 'a!', role: 'boss', jobType: 'x', hiredOn: '2026-02-30' });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json<{ error: { fields: Record<string, string> } }>().error.fields).sort()).toEqual(['hiredOn', 'jobType', 'name', 'role', 'username']);
    // 같은 아이디는 409
    expect((await addStaff(a, admin, { name: '박민지', username: 'minji01', role: 'staff', jobType: 'desk' })).statusCode).toBe(201);
    const dup = await addStaff(a, admin, { name: '박민지2', username: 'MINJI01', role: 'staff', jobType: 'desk' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ error: { code: 'CONFLICT', fields: { username: expect.any(String) } } });
  });

  test('phase-01-task-05 AC2: 직원 추가·수정·초기화는 admin만, 목록은 실장도 볼 수 있고 직원은 403이다', async () => {
    const { a } = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    expect((await a.inject({ method: 'GET', url: '/api/users', headers: manager.headers })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: '/api/users', headers: staff.headers })).statusCode).toBe(403);
    expect((await addStaff(a, manager, { name: '김', username: 'kim0001', role: 'staff', jobType: 'desk' })).statusCode).toBe(403);
    expect((await patch(a, manager, staff.userId, { name: '바꿈' })).statusCode).toBe(403);
    expect((await a.inject({ method: 'POST', url: `/api/users/${staff.userId}/reset-password`, headers: manager.writeHeaders, payload: {} })).statusCode).toBe(403);
  });
});

describe('마지막 admin 보호와 비활성화', () => {
  test('phase-01-task-05 AC3: 마지막 admin을 비활성화하거나 강등하면 409 LAST_ADMIN이고 상태가 바뀌지 않는다', async () => {
    const { a, admin } = await makeApp();
    for (const body of [{ active: false }, { role: 'manager' }, { role: 'staff', active: false }]) {
      const res = await patch(a, admin, admin.userId, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(409);
      expect(res.json()).toEqual({ error: { code: 'LAST_ADMIN', message: '마지막 관리자 계정은 바꾸거나 끌 수 없습니다. 다른 관리자를 먼저 만들어 주세요.' } });
      expect(userRow(a, admin.userId)).toMatchObject({ role: 'admin', active: 1 });
    }
    // 비활성 admin은 수에 넣지 않는다
    const off = loginAs(a, 'admin');
    a.db.run('UPDATE users SET active = 0 WHERE id = ?', [off.userId]);
    expect((await patch(a, admin, admin.userId, { role: 'manager' })).statusCode).toBe(409);
    // 다른 admin이 있으면 바꿀 수 있다
    const second = loginAs(a, 'admin');
    const ok = await patch(a, second, admin.userId, { role: 'manager' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ data: { role: 'manager', active: true } });
    expect((await patch(a, second, second.userId, { active: false })).statusCode).toBe(409);
    // 이름 같은 다른 항목은 마지막 admin이라도 바꿀 수 있다
    expect((await patch(a, second, second.userId, { name: '새 이름' })).statusCode).toBe(200);
  });

  test('phase-01-task-05 AC4: 비활성화한 직원의 열린 세션은 다음 요청에서 401이고, 로그인도 안 되며, 다시 켜면 로그인된다', async () => {
    const { a, admin } = await makeApp();
    const created = (await addStaff(a, admin, { name: '최유리', username: 'yuri0001', role: 'staff', jobType: 'assistant' })).json<{ data: { id: number; tempPassword: string } }>().data;
    const s = await login(a, 'yuri0001', created.tempPassword);
    await a.inject({ method: 'POST', url: '/api/auth/password', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf }, payload: { current: created.tempPassword, next: 'Yuri-Pass-0001' } });
    expect((await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: s.cookie } })).statusCode).toBe(200);

    const off = await patch(a, admin, created.id, { active: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ data: { active: false } });
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', [created.id])?.n).toBe(0);
    const after = await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: s.cookie } });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: '다시 로그인해 주세요.' } });
    expect((await login(a, 'yuri0001', 'Yuri-Pass-0001')).res.statusCode).toBe(401);

    expect((await patch(a, admin, created.id, { active: true })).statusCode).toBe(200);
    expect((await login(a, 'yuri0001', 'Yuri-Pass-0001')).res.statusCode).toBe(200);
    const actions = a.db.all<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'user.%' ORDER BY id").map((r) => r.action);
    expect(actions).toEqual(['user.create', 'user.deactivate', 'user.activate']);
  });

  test('phase-01-task-05 AC4: 정보 수정은 바뀐 항목만 감사 로그에 남기고, 목록은 검색·상태로 거른다', async () => {
    const { a, admin } = await makeApp();
    const id = (await addStaff(a, admin, { name: '정하늘', username: 'sky00001', role: 'staff', jobType: 'desk' })).json<{ data: { id: number } }>().data.id;
    const res = await patch(a, admin, id, { name: '정하늘', role: 'manager', hiredOn: '2025-12-01' });
    expect(res.json()).toMatchObject({ data: { role: 'manager', hiredOn: '2025-12-01' } });
    const detail = JSON.parse(a.db.get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'user.update'")?.detail ?? '{}') as { changes: Record<string, unknown> };
    expect(Object.keys(detail.changes).sort()).toEqual(['hiredOn', 'role']);
    expect((await patch(a, admin, id, { username: 'other' })).statusCode).toBe(400);
    expect((await patch(a, admin, id, {})).statusCode).toBe(400);
    expect((await patch(a, admin, 9999, { name: '없음' })).statusCode).toBe(404);

    await patch(a, admin, id, { active: false });
    const list = async (qs: string) => (await a.inject({ method: 'GET', url: `/api/users${qs}`, headers: admin.headers })).json<{ data: Array<{ username: string }>; total: number }>();
    expect((await list('?status=inactive')).data.map((u) => u.username)).toEqual(['sky00001']);
    expect((await list('?status=active')).data.map((u) => u.username)).toEqual(['boss01']);
    expect((await list('?q=하늘')).total).toBe(1);
    expect((await list('?q=%25')).total).toBe(0);
  });
});

describe('활동 기록', () => {
  test('phase-01-task-05 AC5: 기간·사용자·행동으로 거르고, 최근 것부터 보여 준다', async () => {
    const clock = manualClock('2026-10-30T10:00:00+09:00');
    const { a, admin } = await makeApp(clock);
    const staff = loginAs(a, 'staff', { username: 'stf00001', passwordHash: await hashPassword('Staff-Pass-0001') });
    await login(a, 'stf00001', 'Staff-Pass-0001'); // 10-30 로그인
    clock.advance(DAY_MS);
    await login(a, 'stf00001', 'wrong-pass'); // 10-31 로그인 실패
    clock.advance(DAY_MS + 15 * HOUR_MS); // 11-02 01:00 KST
    // admin 세션은 8시간이 지나 끝났으니 새 세션을 연다(로그인 기록을 남기지 않게 직접 만든다)
    const fresh = createSession(a.db, clock, admin.userId, '127.0.0.1');
    const adminNow: TestLogin = { ...admin, cookie: `sid=${fresh.token}`, csrf: fresh.csrfToken, headers: { cookie: `sid=${fresh.token}` }, writeHeaders: { cookie: `sid=${fresh.token}`, 'x-csrf-token': fresh.csrfToken } };
    await patch(a, adminNow, staff.userId, { jobType: 'desk' });

    const get = async (qs: string) => {
      const r = await a.inject({ method: 'GET', url: `/api/audit${qs}`, headers: adminNow.headers });
      expect(r.statusCode, qs).toBe(200);
      return r.json<{ data: Array<{ action: string; actionLabel: string; username: string | null; at: string }>; total: number }>();
    };
    const all = await get('');
    expect(all.data.map((e) => e.action)).toEqual(['user.update', 'auth.login_failed', 'auth.login']);
    expect(all.data[0]).toMatchObject({ actionLabel: '직원 정보 수정', username: 'boss01' });
    expect((await get('?from=2026-10-31&to=2026-10-31')).data.map((e) => e.action)).toEqual(['auth.login_failed']);
    expect((await get('?from=2026-11-02')).data.map((e) => e.action)).toEqual(['user.update']);
    expect((await get(`?userId=${staff.userId}`)).data.map((e) => e.action)).toEqual(['auth.login']);
    expect((await get('?action=auth.')).total).toBe(2);
    expect((await get('?action=auth.login')).total).toBe(1);
    expect((await get('?pageSize=1&page=2')).data.map((e) => e.action)).toEqual(['auth.login_failed']);
    const bad = await a.inject({ method: 'GET', url: '/api/audit?from=2026-11-05&to=2026-11-01', headers: adminNow.headers });
    expect(bad.statusCode).toBe(400);
  });

  test('phase-01-task-05 AC5: CSV는 UTF-8 BOM으로 시작하는 엑셀 형식이고, 실장·직원은 403이며, 고치기·지우기 API는 없다', async () => {
    const { a, admin } = await makeApp();
    await addStaff(a, admin, { name: '한글,이름"따옴표', username: 'csv00001', role: 'staff', jobType: 'desk' });
    const r = await a.inject({ method: 'GET', url: '/api/audit?format=csv&action=user.', headers: admin.headers });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(String(r.headers['content-disposition'])).toMatch(/^attachment; filename="audit-2026-11-02\.csv"/);
    const bytes = r.rawPayload;
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const textBody = bytes.subarray(3).toString('utf8');
    const lines = textBody.split('\r\n');
    expect(lines[0]).toBe('시각,아이디,이름,행동,행동 코드,대상 종류,대상 번호,세부 내용,IP');
    expect(lines[1]).toMatch(/^2026-11-02 09:00:00,boss01,테스트 admin,직원 추가,user\.create,user,\d+,"\{""username"":""csv00001""/);
    expect(lines).toHaveLength(3); // 머리줄 + 1줄 + 끝 빈 줄
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'audit.export'")?.n).toBe(1);

    for (const role of ['manager', 'staff'] as const) {
      const who = loginAs(a, role);
      for (const url of ['/api/audit', '/api/audit?format=csv']) {
        const res = await a.inject({ method: 'GET', url, headers: who.headers });
        expect(res.statusCode, `${role} ${url}`).toBe(403);
      }
    }
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const res = await a.inject({ method, url: '/api/audit/1', headers: admin.writeHeaders, payload: {} });
      expect(res.statusCode, method).toBe(404);
    }
  });

  test('phase-01-task-05 AC5: CSV 칸은 쉼표·따옴표를 감싸고, 수식으로 시작하는 값은 실행되지 않게 막는다', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(null)).toBe('');
    const csv = auditCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(makeTempPassword()).not.toBe(makeTempPassword());
  });
});

describe('병원 기본 정보', () => {
  const clinic = {
    ...defaultClinic('하늘숲치과'),
    phone: '02-123-4567',
    hours: { ...defaultClinic().hours, wed: { open: '14:00', close: '21:00', lunch: null }, sat: null },
    holidayNote: '일요일·공휴일 휴진',
    parking: '건물 지하 2시간 무료',
    location: '하늘역 3번 출구 50m',
    insuranceNote: '스케일링은 연 1회 보험 적용',
  };

  test('phase-01-task-05 AC6: 저장한 병원 정보는 다시 불러와도 그대로이고, 세션의 병원 이름도 바뀐다', async () => {
    const { a, admin } = await makeApp();
    const first = await a.inject({ method: 'GET', url: '/api/settings/clinic', headers: admin.headers });
    expect(first.json()).toEqual({ data: defaultClinic('') });
    const put = await a.inject({ method: 'PUT', url: '/api/settings/clinic', headers: admin.writeHeaders, payload: clinic });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ data: clinic });
    // 서버를 다시 켜도(=DB에서 다시 읽어도) 같다
    const dataDir = tmp as string;
    await a.close();
    app = await buildApp({ dataDir, webDist: path.join(dataDir, 'no-web'), clock: manualClock(START) });
    const staff = loginAs(app, 'staff');
    const again = await app.inject({ method: 'GET', url: '/api/settings/clinic', headers: staff.headers });
    expect(again.json()).toEqual({ data: clinic });
    const session = await app.inject({ method: 'GET', url: '/api/session', headers: staff.headers });
    expect(session.json()).toMatchObject({ data: { clinicName: '하늘숲치과' } });
    const log = app.db.get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'settings.clinic.update'");
    expect(JSON.parse(log?.detail ?? '{}')).toMatchObject({ changed: expect.arrayContaining(['name', 'phone', 'hours', 'parking']) });
  });

  test('phase-01-task-05 AC6: 시간 형식·순서가 틀리면 400과 항목별 이유, 실장·직원은 저장할 수 없다', async () => {
    const { a, admin } = await makeApp();
    const bad = await a.inject({
      method: 'PUT',
      url: '/api/settings/clinic',
      headers: admin.writeHeaders,
      payload: { ...clinic, name: '', phone: '전화', hours: { ...clinic.hours, mon: { open: '18:00', close: '09:00' }, tue: { open: '9시', close: '18:00' } } },
    });
    expect(bad.statusCode).toBe(400);
    const fields = bad.json<{ error: { fields: Record<string, string> } }>().error.fields;
    expect(fields).toMatchObject({ name: '병원 이름을 적어 주세요.', 'hours.mon.close': '진료 끝 시각은 시작 시각보다 늦어야 해요.' });
    expect(fields['hours.tue.open']).toMatch(/24시간 형식/);
    expect(fields.phone).toMatch(/대표번호/);
    const lunchOut = await a.inject({
      method: 'PUT',
      url: '/api/settings/clinic',
      headers: admin.writeHeaders,
      payload: { ...clinic, hours: { ...clinic.hours, fri: { open: '09:00', close: '13:00', lunch: { start: '12:30', end: '14:00' } } } },
    });
    expect(lunchOut.statusCode).toBe(400);
    for (const role of ['manager', 'staff'] as const) {
      const who = loginAs(a, role);
      const r = await a.inject({ method: 'PUT', url: '/api/settings/clinic', headers: who.writeHeaders, payload: clinic });
      expect(r.statusCode, role).toBe(403);
    }
    expect((await a.inject({ method: 'GET', url: '/api/settings/clinic' })).statusCode).toBe(401);
  });
});

describe('세션 쿠키 지우기(01-03 검증 참고 사항)', () => {
  test('phase-01-task-05 AC4: 로그아웃·만료 때 지우는 쿠키도 발급 쿠키처럼 HttpOnly·SameSite=Strict다', async () => {
    const clock = manualClock(START);
    const { a } = await makeApp(clock);
    const s = await login(a, 'boss01', ADMIN_PW);
    const out = await a.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: s.cookie, 'x-csrf-token': s.csrf } });
    expect(out.statusCode).toBe(204);
    const cleared = String(out.headers['set-cookie']);
    expect(cleared).toMatch(/^sid=;/);
    expect(cleared).toMatch(/SameSite=Strict/i);
    expect(cleared).toMatch(/HttpOnly/i);

    const s2 = await login(a, 'boss01', ADMIN_PW);
    clock.advance(9 * HOUR_MS);
    const expired = await a.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: s2.cookie } });
    expect(expired.statusCode).toBe(401);
    const c2 = String(expired.headers['set-cookie']);
    expect(c2).toMatch(/^sid=;/);
    expect(c2).toMatch(/SameSite=Strict/i);
  });
});

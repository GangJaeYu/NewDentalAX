// 이 파일이 하는 일: AI 근무표 배정 제안(roster-suggest.ts·roster-suggest-routes.ts, FR-131)을 실제 라우트·DB·AI 게이트웨이로 확인한다(phase-06-task-02 AC1~AC3).
// AC1: 데모와 가짜 AI(일부러 휴가일에 근무를 넣고 토요일 인원을 모자라게 줌) 모두 미리보기에서 승인 휴가일에 근무가 없고 최소 인원이 맞는다.
// AC2: 제안을 받아도 근무표는 그대로이고, 적용해야 바뀐다(직원은 제안·적용 모두 403). AC3: 가짜 서버가 받은 요청 본문에 직원 이름이 없다.
// AI 설정의 기능 끄기·사용 기록·예산 초과도 다른 기능과 같이 적용되는지 본다. 시계는 2026-11-02 09:00(월), 데이터는 .tmp/unit/ 임시 폴더, 실제 공급자·키는 쓰지 않는다.
import { afterEach, describe, expect, test } from 'vitest';
import { makeAiEnv, putAiSettings, type AiTestEnv } from '../../../tests/helpers/ai-app.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { rosterUsers } from './roster.ts';
import { roster_suggest } from '../../ai/features/roster_suggest.ts';
import { repairPlan } from '../../../shared/schemas/roster-suggest.ts';
import type { RosterApplyResult, RosterSuggestion } from '../../../shared/schemas/roster-suggest.ts';
import type { RosterView } from '../../../shared/schemas/roster.ts';
import type { JobType } from '../../../shared/enums.ts';

const FAKE_KEY = 'sk-ant-unit-ONLYFAKE-roster-5Ws1';
const WEEK = '2026-11-02';
const WEEK_DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
const NAMES: Array<[string, JobType]> = [
  ['정하늘', 'hygienist'],
  ['오소담', 'hygienist'],
  ['임채은', 'assistant'],
  ['서다온', 'desk'],
];

type Env = AiTestEnv & { manager: TestLogin; ids: Record<string, number>; types: Record<string, number> };
let env: Env | null = null;

afterEach(async () => {
  if (env) await env.close();
  env = null;
});

/** 직원 넷(이름·직무)과 실장, 정하늘 11/3 연차·오소담 11/5 오전 반차(승인)를 넣는다 */
async function setup(): Promise<Env> {
  const e = await makeAiEnv();
  const manager = loginAs(e.app, 'manager');
  e.app.db.run("UPDATE users SET name = '윤실장', job_type = 'desk' WHERE id = ?", [manager.userId]);
  e.app.db.run("UPDATE users SET name = '한원장', job_type = 'doctor' WHERE id = ?", [e.admin.userId]);
  e.app.db.run("UPDATE users SET name = '배누리', job_type = 'assistant' WHERE id = ?", [e.staff.userId]);
  const ids: Record<string, number> = {};
  for (const [name, job] of NAMES) {
    const u = loginAs(e.app, 'staff');
    e.app.db.run('UPDATE users SET name = ?, job_type = ? WHERE id = ?', [name, job, u.userId]);
    ids[name] = u.userId;
  }
  const leave = (userId: number, type: string, date: string) =>
    e.app.db.run("INSERT INTO leave_requests (user_id, type, start_on, end_on, days, reason, status, created_at) VALUES (?, ?, ?, ?, 1, '', 'approved', '2026-10-20T00:00:00Z')", [userId, type, date, date]);
  leave(ids['정하늘'] as number, 'annual', '2026-11-03');
  leave(ids['오소담'] as number, 'half_am', '2026-11-05');
  const types = Object.fromEntries(e.app.db.all<{ id: number; label: string }>('SELECT id, label FROM shift_types').map((t) => [t.label, t.id]));
  env = { ...e, manager, ids, types };
  return env;
}

async function post<T>(e: Env, who: TestLogin, url: string, payload: unknown): Promise<{ status: number; body: { data: T; error?: { code: string; message: string } } }> {
  const res = await e.app.inject({ method: 'POST', url, headers: who.writeHeaders, payload: payload as Record<string, unknown> });
  return { status: res.statusCode, body: res.json() };
}

async function roster(e: Env): Promise<RosterView> {
  const res = await e.app.inject({ method: 'GET', url: `/api/roster?from=${WEEK}&to=2026-11-08`, headers: e.manager.headers });
  return res.json<{ data: RosterView }>().data;
}

/** 미리보기에서 "근무로 세는" 칸인지 */
function works(v: RosterView, date: string, userId: number): boolean {
  const c = v.days.find((d) => d.date === date)?.cells[String(userId)];
  const t = v.shiftTypes.find((s) => s.id === c?.shiftTypeId);
  return !!t?.countsAsWork && !c?.leave?.fullDay;
}

/** 직무별 근무 인원 */
function jobCount(v: RosterView, date: string, job: JobType): number {
  return v.users.filter((u) => u.jobType === job && works(v, date, u.id)).length;
}

const RULES = { weekStart: WEEK, minStaff: 3, minByJob: { hygienist: 1, desk: 1 } };

describe('phase-06-task-02 AI 근무표 배정 제안', () => {
  test('phase-06-task-02 AC1: 데모 제안 미리보기에서 승인 휴가일에 근무가 없고, 진료일마다 최소 인원·직무별 인원이 맞는다', async () => {
    const e = await setup();
    const r = await post<RosterSuggestion>(e, e.manager, '/api/roster/suggest', RULES);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = r.body.data;
    expect(s.ai.demo).toBe(true);
    const hanul = e.ids['정하늘'] as number;
    // 정하늘 11/3(연차): 칸에는 휴가만 있고 근무 유형이 없다. 적용할 칸에도 없다
    const cell = s.view.days.find((d) => d.date === '2026-11-03')?.cells[String(hanul)];
    expect(cell?.leave?.label).toBe('연차');
    expect(cell?.shiftTypeId).toBeNull();
    expect(s.cells.some((c) => c.userId === hanul && c.date === '2026-11-03')).toBe(false);
    for (const date of WEEK_DAYS) {
      expect(s.view.totals[date], date).toBeGreaterThanOrEqual(3);
      expect(jobCount(s.view, date, 'hygienist'), date).toBeGreaterThanOrEqual(1);
      expect(jobCount(s.view, date, 'desk'), date).toBeGreaterThanOrEqual(1);
    }
    // 평일은 "종일", 토요일(09:30~14:00)은 최소 인원만 "오전", 나머지는 "휴무". 일요일(휴진)은 비어 있다
    expect(s.cells.find((c) => c.userId === e.ids['서다온'] && c.date === '2026-11-02')?.shiftTypeId).toBe(e.types['종일']);
    const sat = s.cells.filter((c) => c.date === '2026-11-07');
    expect(sat.filter((c) => c.shiftTypeId === e.types['오전'])).toHaveLength(3);
    expect(sat.filter((c) => c.shiftTypeId === e.types['휴무']).length).toBeGreaterThan(0);
    expect(s.cells.some((c) => c.date === '2026-11-08')).toBe(false);
    // 반차는 근무와 함께 보이고 인원에서 빠지지 않는다
    expect(s.view.days.find((d) => d.date === '2026-11-05')?.cells[String(e.ids['오소담'])]).toMatchObject({ shiftTypeId: e.types['종일'], leave: { label: '반차(오전)' } });
    expect(s.warnings).toEqual([]);
    expect(s.sentStaff).toHaveLength(7);
  });

  test('phase-06-task-02 AC1: AI가 휴가일에 근무를 넣고 인원을 모자라게 줘도, 서버가 빼고 채워서 미리보기에는 위반이 남지 않는다', async () => {
    const e = await setup();
    await putAiSettings(e, { provider: 'anthropic', keys: { anthropic: FAKE_KEY } });
    const refs = new Map(rosterUsers(e.app.db).map((u, i) => [u.id, `S${i + 1}`]));
    const ref = (name: string) => refs.get(e.ids[name] as number) as string;
    // 일부러 틀린 제안: 정하늘 11/3(연차)에 종일, 토요일은 서다온 혼자, 없는 직원 S99·일요일 칸도 섞는다. 화요일 외 평일은 4명씩 배정
    const assignments = [
      ...WEEK_DAYS.slice(0, 5).flatMap((date) => ['정하늘', '오소담', '임채은', '서다온'].map((n) => ({ staff: ref(n), date, shift: e.types['종일'] }))),
      { staff: ref('서다온'), date: '2026-11-07', shift: e.types['오전'] },
      { staff: 'S99', date: '2026-11-04', shift: e.types['종일'] },
      { staff: ref('임채은'), date: '2026-11-08', shift: e.types['종일'] },
    ];
    e.fake.setReply(JSON.stringify({ assignments, note: '가짜 AI 제안' }), { input: 900, output: 400 });
    const r = await post<RosterSuggestion>(e, e.manager, '/api/roster/suggest', RULES);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = r.body.data;
    expect(s.ai).toMatchObject({ demo: false, note: '가짜 AI 제안' });
    const hanul = e.ids['정하늘'] as number;
    expect(works(s.view, '2026-11-03', hanul)).toBe(false);
    expect(s.cells.some((c) => c.userId === hanul && c.date === '2026-11-03')).toBe(false);
    expect(s.fixes).toContain('정하늘 11월 3일(화)에는 승인된 연차가 있어서 AI가 넣은 "종일" 근무를 뺐어요.');
    expect(s.fixes.some((f) => f.startsWith('AI 제안 중 맞지 않는 칸 2개'))).toBe(true);
    // 토요일: 치과위생사 1명 + 하루 3명을 채웠다
    expect(s.view.totals['2026-11-07']).toBeGreaterThanOrEqual(3);
    expect(jobCount(s.view, '2026-11-07', 'hygienist')).toBe(1);
    expect(s.fixes.some((f) => f.startsWith('11월 7일(토) 치과위생사 최소 1명을 맞추려고'))).toBe(true);
    expect(s.cells.some((c) => c.date === '2026-11-08')).toBe(false);
    for (const date of WEEK_DAYS) expect(s.view.totals[date], date).toBeGreaterThanOrEqual(3);
    // 사용 기록은 이 기능 이름으로, 비용과 함께 남는다
    expect(e.app.db.get<{ feature: string; status: string; demo: number }>('SELECT feature, status, demo FROM ai_usage ORDER BY id DESC LIMIT 1')).toEqual({ feature: 'roster_suggest', status: 'ok', demo: 0 });
    expect(s.ai.costKrw).toBeGreaterThan(0);
  });

  test('phase-06-task-02 AC1: 채울 사람이 없는 날은 경고로 알려 준다(치과위생사 2명 필요한데 한 명이 연차인 날)', async () => {
    const e = await setup();
    const r = await post<RosterSuggestion>(e, e.manager, '/api/roster/suggest', { weekStart: WEEK, minStaff: 2, minByJob: { hygienist: 2 } });
    expect(r.status).toBe(200);
    // 11/3은 치과위생사 정하늘이 연차라 오소담 1명뿐이다
    expect(r.body.data.warnings).toEqual(['11월 3일(화)에는 치과위생사가 최소 2명 필요한데, 근무할 수 있는 사람이 1명뿐이에요.']);
    expect(works(r.body.data.view, '2026-11-03', e.ids['정하늘'] as number)).toBe(false);
  });

  test('phase-06-task-02 AC2: 제안을 받아도 근무표는 그대로이고, "적용"해야 바뀐다. 직원은 제안·적용 모두 403이다', async () => {
    const e = await setup();
    // 미리 적어 둔 칸 하나
    const put = await e.app.inject({ method: 'PUT', url: '/api/roster/cell', headers: e.manager.writeHeaders, payload: { userId: e.ids['임채은'], date: '2026-11-04', shiftTypeId: e.types['야간'] } });
    expect(put.statusCode).toBe(200);
    const before = await roster(e);
    const rowsBefore = e.app.db.all('SELECT user_id, date, shift_type_id FROM roster ORDER BY user_id, date');

    const r = await post<RosterSuggestion>(e, e.manager, '/api/roster/suggest', RULES);
    expect(r.status).toBe(200);
    expect(r.body.data.changed).toBeGreaterThan(0);
    // 제안 뒤(취소한 것과 같음): 근무표는 한 칸도 바뀌지 않았다
    expect(e.app.db.all('SELECT user_id, date, shift_type_id FROM roster ORDER BY user_id, date')).toEqual(rowsBefore);
    expect(await roster(e)).toEqual(before);

    const staff = e.staff;
    expect((await post(e, staff, '/api/roster/suggest', RULES)).status).toBe(403);
    expect((await post(e, staff, '/api/roster/apply', { weekStart: WEEK, cells: r.body.data.cells })).status).toBe(403);
    expect(e.app.db.all('SELECT user_id, date, shift_type_id FROM roster ORDER BY user_id, date')).toEqual(rowsBefore);

    const a = await post<RosterApplyResult>(e, e.manager, '/api/roster/apply', { weekStart: WEEK, cells: r.body.data.cells });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.data).toEqual({ weekStart: WEEK, saved: r.body.data.cells.length, replaced: 1, skipped: 0 });
    const after = await roster(e);
    expect(after.totals).toEqual(r.body.data.view.totals);
    for (const d of after.days) for (const u of after.users) expect(d.cells[String(u.id)]?.shiftTypeId ?? null, `${u.name} ${d.date}`).toBe(r.body.data.view.days.find((x) => x.date === d.date)?.cells[String(u.id)]?.shiftTypeId ?? null);
    expect(e.app.db.get<{ action: string }>("SELECT action FROM audit_log WHERE action = 'roster.ai_apply'")).toEqual({ action: 'roster.ai_apply' });
  });

  test('phase-06-task-02 AC2: 적용은 주 밖 날짜·없는 유형을 막고, 그사이 승인된 휴가일의 근무는 넣지 않는다', async () => {
    const e = await setup();
    const out = await post(e, e.manager, '/api/roster/apply', { weekStart: WEEK, cells: [{ userId: e.ids['서다온'], date: '2026-11-10', shiftTypeId: e.types['종일'] }] });
    expect(out.status).toBe(400);
    expect(out.body.error?.message).toContain('제안받은 주 밖의 날짜');
    const bad = await post(e, e.manager, '/api/roster/apply', { weekStart: WEEK, cells: [{ userId: e.ids['서다온'], date: '2026-11-03', shiftTypeId: 9999 }] });
    expect(bad.status).toBe(404);
    const notMonday = await post(e, e.manager, '/api/roster/apply', { weekStart: '2026-11-03', cells: [] });
    expect(notMonday.status).toBe(400);
    const r = await post<RosterApplyResult>(e, e.manager, '/api/roster/apply', {
      weekStart: WEEK,
      cells: [
        { userId: e.ids['정하늘'], date: '2026-11-03', shiftTypeId: e.types['종일'] },
        { userId: e.ids['서다온'], date: '2026-11-03', shiftTypeId: e.types['종일'] },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ saved: 1, skipped: 1 });
    expect(e.app.db.get('SELECT 1 AS x FROM roster WHERE user_id = ? AND date = ?', [e.ids['정하늘'], '2026-11-03'])).toBeUndefined();
  });

  test('phase-06-task-02 AC3: AI 요청 본문(가짜 서버 수신)에 직원 이름이 없고 내부 번호·직무만 있다', async () => {
    const e = await setup();
    await putAiSettings(e, { provider: 'anthropic', keys: { anthropic: FAKE_KEY } });
    e.fake.setReply(JSON.stringify({ assignments: [] }), { input: 500, output: 20 });
    const r = await post<RosterSuggestion>(e, e.manager, '/api/roster/suggest', RULES);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(e.fake.requests).toHaveLength(1);
    const req = e.fake.requests[0];
    const sent = `${req?.rawBody ?? ''}\n${JSON.stringify(req?.body ?? null)}`;
    const names = e.app.db.all<{ name: string; username: string }>('SELECT name, username FROM users');
    expect(names.length).toBe(7);
    for (const n of names) {
      expect(sent, n.name).not.toContain(n.name);
      expect(sent, n.username).not.toContain(n.username);
    }
    for (const ref of ['S1', 'S2', 'S7']) expect(sent).toContain(ref);
    expect(sent).toContain('치과위생사(hygienist)');
    expect(sent).toContain('휴가(근무 불가): 2026-11-03');
    expect(r.body.data.sentStaff.map((s) => s.ref)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
    expect(JSON.stringify(r.body.data.sentStaff)).not.toContain('정하늘');
    // 빈 제안이어도 서버가 최소 인원을 채워 미리보기를 만든다(이름으로 돌려준다)
    expect(r.body.data.view.users.map((u) => u.name)).toContain('정하늘');
    for (const date of WEEK_DAYS) expect(r.body.data.view.totals[date], date).toBeGreaterThanOrEqual(3);
  });

  test('phase-06-task-02 AI 설정: 관리자가 끄면 403 AI_DISABLED, 실장 역할을 빼도 403, 예산을 넘으면 막힌다', async () => {
    const e = await setup();
    await putAiSettings(e, { features: { roster_suggest: { enabled: false } } });
    const off = await post(e, e.manager, '/api/roster/suggest', RULES);
    expect(off.status).toBe(403);
    expect(off.body.error?.code).toBe('AI_DISABLED');
    await putAiSettings(e, { features: { roster_suggest: { enabled: true, roles: ['admin'] } } });
    expect((await post(e, e.manager, '/api/roster/suggest', RULES)).body.error?.code).toBe('AI_DISABLED');
    expect((await post(e, e.admin, '/api/roster/suggest', RULES)).status).toBe(200);
    // 예산 초과: 이번 달 사용 기록을 예산보다 크게 넣는다
    await putAiSettings(e, { monthlyBudgetKrw: 1000, features: { roster_suggest: { enabled: true, roles: ['admin', 'manager'] } } });
    e.app.db.run(
      "INSERT INTO ai_usage (at, user_id, feature, provider, model, input_tokens, output_tokens, cost_usd, cost_krw, estimated, demo, status) VALUES ('2026-11-02T00:00:00.000Z', ?, 'quick', 'anthropic', 'm', 1, 1, 1, 5000, 0, 0, 'ok')",
      [e.admin.userId],
    );
    const over = await post(e, e.manager, '/api/roster/suggest', RULES);
    expect(over.status).toBe(402);
    expect(over.body.error?.code).toBe('AI_BUDGET_EXCEEDED');
  });

  test('phase-06-task-02 입력 검사: 월요일이 아닌 주·음수 인원·모르는 칸은 400 한국어 오류다', async () => {
    const e = await setup();
    for (const bad of [{ ...RULES, weekStart: '2026-11-03' }, { ...RULES, minStaff: -1 }, { ...RULES, minByJob: { nurse: 1 } }, { ...RULES, extra: 1 }]) {
      const r = await post(e, e.manager, '/api/roster/suggest', bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error?.message).toMatch(/[가-힣]/);
    }
  });
});

describe('phase-06-task-02 repairPlan·데모(순수 함수)', () => {
  const shifts = [
    { id: 1, label: '종일', startTime: '09:30', endTime: '18:30', countsAsWork: true },
    { id: 2, label: '오전', startTime: '09:30', endTime: '13:00', countsAsWork: true },
    { id: 5, label: '휴무', startTime: null, endTime: null, countsAsWork: false },
  ];
  const days = [
    { date: '2026-11-02', open: '09:30', close: '18:30' },
    { date: '2026-11-07', open: '09:30', close: '14:00' },
  ];
  test('phase-06-task-02 AC1: 휴가일 근무를 빼고, 근무가 적은 사람부터 채우며, 휴무는 조용히 뺀다', () => {
    const { plan, issues } = repairPlan({
      staff: [
        { key: 'S1', jobType: 'hygienist', leave: ['2026-11-02'] },
        { key: 'S2', jobType: 'desk', leave: [] },
        { key: 'S3', jobType: 'desk', leave: [] },
      ],
      days,
      shifts,
      rules: { minStaff: 2, minByJob: {} },
      entries: [
        { key: 'S1', date: '2026-11-02', shiftId: 1 },
        { key: 'S1', date: '2026-11-07', shiftId: 5 },
        { key: 'S2', date: '2026-11-02', shiftId: 1 },
      ],
    });
    expect(plan.get('S1')?.has('2026-11-02')).toBe(false);
    expect(issues.filter((i) => i.kind === 'leave')).toHaveLength(1);
    // 11/2: S2(종일) + S3을 그날 많이 쓴 "종일"로 채움. 11/7: 근무가 적은 S1이 먼저 "오전"(그날 진료 시간에 맞는 가장 긴 유형)
    expect(plan.get('S3')?.get('2026-11-02')).toBe(1);
    expect(plan.get('S1')?.get('2026-11-07')).toBe(2);
    expect(issues.some((i) => i.kind === 'short')).toBe(false);
  });

  test('phase-06-task-02 AC3: 데모 프롬프트·응답에 쓰는 입력은 직원 번호(S1)만 받고 이름은 받지 않는다', () => {
    const ok = roster_suggest.inputSchema.safeParse({
      week: { from: '2026-11-02', to: '2026-11-08' },
      days: days.map((d) => ({ ...d, weekday: '월' })),
      staff: [{ ref: 'S1', jobType: 'desk' }],
      shifts,
      rules: { minStaff: 1 },
    });
    expect(ok.success).toBe(true);
    const named = roster_suggest.inputSchema.safeParse({
      week: { from: '2026-11-02', to: '2026-11-08' },
      days: days.map((d) => ({ ...d, weekday: '월' })),
      staff: [{ ref: '정하늘', jobType: 'desk' }],
      shifts,
      rules: { minStaff: 1 },
    });
    expect(named.success).toBe(false);
  });
});

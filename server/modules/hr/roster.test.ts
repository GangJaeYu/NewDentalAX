// 이 파일이 하는 일: 근무표·근무 유형 API(roster.ts·roster-routes.ts, FR-081)를 실제 라우트와 DB로 확인한다(phase-04-task-01 AC1~AC5).
// 칸 저장 → 다시 조회해도 유지(AC1), 지난주 복사(휴가는 복사되지 않음, AC2), 승인된 연차가 칸에 "연차"로 보이고 인원 합계에서 빠짐(AC3),
// 직원은 조회만 되고 편집은 403(AC4), 오늘 근무자 목록(대시보드 카드, AC5), 근무 유형 저장·입력 오류, 데모 근무표 4주를 본다.
// 요청은 fastify.inject로 보내고 시계는 2026-11-02 09:00(월)으로 고정한다. 데이터는 .tmp/unit/ 임시 폴더만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { seedDemo as seedAdminDemo } from '../admin/seed.ts';
import { seedDemo as seedHrDemo } from './seed.ts';
import { demoRosterStart } from './roster-seed.ts';
import { todayRoster } from './roster.ts';
import {
  dayTotal,
  monthGridRange,
  rosterPeriodLabel,
  weekRange,
  weekStart,
  type CopyWeekResult,
  type RosterCellResult,
  type RosterView,
  type ShiftType,
  type TodayRoster,
} from '../../../shared/schemas/roster.ts';

const START = '2026-11-02T09:00:00+09:00';
const THIS_MON = '2026-11-02';
const LAST_MON = '2026-10-26';

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

async function makeApp() {
  tmp = makeTmpDir('dentalax-roster-');
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock: manualClock(START) });
  return app;
}

async function roster(a: FastifyInstance, who: TestLogin, from: string, to: string): Promise<RosterView> {
  const res = await a.inject({ method: 'GET', url: `/api/roster?from=${from}&to=${to}`, headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: RosterView }>().data;
}

async function putCell(a: FastifyInstance, who: TestLogin, payload: Record<string, unknown>) {
  return a.inject({ method: 'PUT', url: '/api/roster/cell', headers: who.writeHeaders, payload });
}

async function shiftTypes(a: FastifyInstance, who: TestLogin): Promise<ShiftType[]> {
  const res = await a.inject({ method: 'GET', url: '/api/shift-types', headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: ShiftType[] }>().data;
}

/** 기본 근무 유형 이름 → id */
async function typeIds(a: FastifyInstance, who: TestLogin): Promise<Record<string, number>> {
  return Object.fromEntries((await shiftTypes(a, who)).map((t) => [t.label, t.id]));
}

/** 승인된 휴가를 DB에 바로 넣는다(연차 화면 흐름은 phase-03-task-09 테스트가 본다) */
function approvedLeave(a: FastifyInstance, userId: number, type: string, startOn: string, endOn = startOn, status = 'approved'): number {
  return a.db.run(
    "INSERT INTO leave_requests (user_id, type, start_on, end_on, days, reason, status, reject_reason, created_at) VALUES (?, ?, ?, ?, 1, '', ?, ?, '2026-10-20T00:00:00Z')",
    [userId, type, startOn, endOn, status, status === 'rejected' ? '다른 날로 다시 신청해 주세요.' : null],
  ).lastInsertRowid;
}

function cellOf(view: RosterView, date: string, userId: number) {
  return view.days.find((d) => d.date === date)?.cells[String(userId)];
}

describe('칸 저장', () => {
  test('phase-04-task-01 AC1: 실장이 칸에 "오전"을 저장하면 다시 조회해도 유지되고, 다른 유형으로 바꾸거나 비울 수 있다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const ids = await typeIds(a, manager);
    expect(Object.keys(ids)).toEqual(['종일', '오전', '오후', '야간', '휴무']);

    const r = await putCell(a, manager, { userId: staff.userId, date: '2026-11-03', shiftTypeId: ids['오전'] });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ data: RosterCellResult }>().data).toEqual({ userId: staff.userId, date: '2026-11-03', cell: { shiftTypeId: ids['오전'] }, total: 1 });

    // 다시 조회(새 요청)해도 남아 있다
    const view = await roster(a, staff, THIS_MON, '2026-11-08');
    expect(cellOf(view, '2026-11-03', staff.userId)).toEqual({ shiftTypeId: ids['오전'] });
    expect(view.totals['2026-11-03']).toBe(1);
    expect(view.users.map((u) => u.id)).toEqual(expect.arrayContaining([manager.userId, staff.userId]));
    expect(view.days.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(view.days.find((d) => d.date === '2026-11-08')?.open).toBe(false); // 일요일 휴진

    // 같은 칸을 "휴무"로 바꾸면 한 칸만 남고 인원에서 빠진다
    await putCell(a, manager, { userId: staff.userId, date: '2026-11-03', shiftTypeId: ids['휴무'] });
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM roster')?.n).toBe(1);
    expect((await roster(a, staff, THIS_MON, '2026-11-08')).totals['2026-11-03']).toBe(0);

    // 비우기
    const cleared = await putCell(a, manager, { userId: staff.userId, date: '2026-11-03', shiftTypeId: null });
    expect(cleared.json<{ data: RosterCellResult }>().data.cell).toEqual({ shiftTypeId: null });
    expect(cellOf(await roster(a, staff, THIS_MON, '2026-11-08'), '2026-11-03', staff.userId)).toBeUndefined();

    // 감사 기록
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'roster.cell'")?.n).toBe(3);
  });

  test('phase-04-task-01 AC1: 없는 직원·사용 안 함 유형·틀린 날짜는 저장되지 않고 쉬운 문구가 온다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const ids = await typeIds(a, manager);

    const noUser = await putCell(a, manager, { userId: 9999, date: '2026-11-03', shiftTypeId: ids['종일'] });
    expect(noUser.statusCode).toBe(404);
    expect(noUser.json<{ error: { message: string } }>().error.message).toBe('그 직원을 찾지 못했어요. 화면을 새로 고쳐 주세요.');

    const badDate = await putCell(a, manager, { userId: staff.userId, date: '2026-02-30', shiftTypeId: ids['종일'] });
    expect(badDate.statusCode).toBe(400);
    expect(badDate.json<{ error: { fields: Record<string, string> } }>().error.fields.date).toBe('날짜를 2026-11-02처럼 적어 주세요.');

    a.db.run("UPDATE shift_types SET active = 0 WHERE label = '야간'");
    const inactive = await putCell(a, manager, { userId: staff.userId, date: '2026-11-03', shiftTypeId: ids['야간'] });
    expect(inactive.statusCode).toBe(400);
    expect(inactive.json<{ error: { message: string } }>().error.message).toBe('사용하지 않는 근무 유형이에요. 다른 유형을 골라 주세요.');

    const tooLong = await a.inject({ method: 'GET', url: '/api/roster?from=2026-11-01&to=2026-12-31', headers: manager.headers });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json<{ error: { fields: Record<string, string> } }>().error.fields.to).toBe('한 번에 42일까지만 볼 수 있어요.');
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM roster')?.n).toBe(0);
  });
});

describe('기본 기간', () => {
  test('phase-04-task-01 AC1: 기간을 주지 않으면 서버 기준 오늘이 든 주(월~일)를 돌려주고 today를 함께 준다', async () => {
    const a = await makeApp();
    const staff = loginAs(a, 'staff');
    const res = await a.inject({ method: 'GET', url: '/api/roster', headers: staff.headers });
    expect(res.statusCode).toBe(200);
    const v = res.json<{ data: RosterView }>().data;
    expect([v.from, v.to, v.today]).toEqual([THIS_MON, '2026-11-08', THIS_MON]);
    const half = await a.inject({ method: 'GET', url: '/api/roster?from=2026-11-02', headers: staff.headers });
    expect(half.statusCode).toBe(400);
  });
});

describe('지난주 복사', () => {
  test('phase-04-task-01 AC2: 지난주를 복사하면 이번 주 칸이 지난주와 같아지고, 지난주 휴가는 복사되지 않는다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const s1 = loginAs(a, 'staff');
    const s2 = loginAs(a, 'staff');
    const ids = await typeIds(a, manager);

    // 지난주(10/26~11/1): s1 월~금 종일, 수요일 야간 / s2 월 오전·화 오후·토 오전
    for (const [i, d] of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].entries()) {
      await putCell(a, manager, { userId: s1.userId, date: d, shiftTypeId: i === 2 ? ids['야간'] : ids['종일'] });
    }
    await putCell(a, manager, { userId: s2.userId, date: '2026-10-26', shiftTypeId: ids['오전'] });
    await putCell(a, manager, { userId: s2.userId, date: '2026-10-27', shiftTypeId: ids['오후'] });
    await putCell(a, manager, { userId: s2.userId, date: '2026-10-31', shiftTypeId: ids['오전'] });
    // 지난주 화요일 s1 연차(승인)
    approvedLeave(a, s1.userId, 'annual', '2026-10-27');
    // 이번 주에 미리 넣어 둔 칸은 복사로 지워진다
    await putCell(a, manager, { userId: s2.userId, date: '2026-11-05', shiftTypeId: ids['종일'] });

    const res = await a.inject({ method: 'POST', url: '/api/roster/copy-week', headers: manager.writeHeaders, payload: { fromWeekStart: LAST_MON, toWeekStart: THIS_MON } });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: CopyWeekResult }>().data).toEqual({ fromWeekStart: LAST_MON, toWeekStart: THIS_MON, copied: 8, replaced: 1 });

    const last = await roster(a, manager, LAST_MON, '2026-11-01');
    const now = await roster(a, manager, THIS_MON, '2026-11-08');
    for (let i = 0; i < 7; i += 1) {
      for (const u of [s1, s2]) {
        expect(now.days[i]?.cells[String(u.userId)]?.shiftTypeId ?? null, `${now.days[i]?.date} ${u.userId}`).toBe(last.days[i]?.cells[String(u.userId)]?.shiftTypeId ?? null);
      }
    }
    // 지난주 화요일은 연차라 인원에서 빠졌지만, 이번 주 화요일은 휴가 없이 두 사람 모두 근무다
    expect(cellOf(last, '2026-10-27', s1.userId)?.leave?.label).toBe('연차');
    expect(last.totals['2026-10-27']).toBe(1);
    expect(cellOf(now, '2026-11-03', s1.userId)).toEqual({ shiftTypeId: ids['종일'] });
    expect(now.totals['2026-11-03']).toBe(2);
    expect(cellOf(now, '2026-11-05', s2.userId)).toBeUndefined();
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM leave_requests WHERE start_on >= '2026-11-02'")?.n).toBe(0);
  });

  test('phase-04-task-01 AC2: 월요일이 아닌 날짜나 같은 주는 복사하지 않는다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const notMonday = await a.inject({ method: 'POST', url: '/api/roster/copy-week', headers: manager.writeHeaders, payload: { fromWeekStart: '2026-10-27', toWeekStart: THIS_MON } });
    expect(notMonday.statusCode).toBe(400);
    expect(notMonday.json<{ error: { fields: Record<string, string> } }>().error.fields.fromWeekStart).toBe('복사할 주는 월요일 날짜로 적어 주세요.');
    const same = await a.inject({ method: 'POST', url: '/api/roster/copy-week', headers: manager.writeHeaders, payload: { fromWeekStart: THIS_MON, toWeekStart: THIS_MON } });
    expect(same.statusCode).toBe(400);
    expect(same.json<{ error: { fields: Record<string, string> } }>().error.fields.toWeekStart).toBe('같은 주에는 복사할 수 없어요.');
  });
});

describe('승인된 휴가 표시', () => {
  test('phase-04-task-01 AC3: 승인된 연차 날짜 칸에 "연차"가 보이고 인원 합계에서 빠진다(대기·반려 휴가는 보이지 않고, 반차는 인원에 남는다)', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const s1 = loginAs(a, 'staff');
    const s2 = loginAs(a, 'staff');
    const s3 = loginAs(a, 'staff');
    const ids = await typeIds(a, manager);
    for (const u of [manager, s1, s2, s3]) {
      for (const d of ['2026-11-04', '2026-11-05']) await putCell(a, manager, { userId: u.userId, date: d, shiftTypeId: ids['종일'] });
    }
    const before = await roster(a, s1, THIS_MON, '2026-11-08');
    expect(before.totals['2026-11-04']).toBe(4);

    const leaveId = approvedLeave(a, s1.userId, 'annual', '2026-11-04', '2026-11-05');
    approvedLeave(a, s2.userId, 'half_pm', '2026-11-04');
    approvedLeave(a, s3.userId, 'annual', '2026-11-04', '2026-11-04', 'pending');
    approvedLeave(a, s3.userId, 'annual', '2026-11-05', '2026-11-05', 'rejected');
    // 근무 유형을 넣지 않은 날(금)의 연차도 칸에 보인다
    approvedLeave(a, manager.userId, 'annual', '2026-11-06');

    const view = await roster(a, s1, THIS_MON, '2026-11-08');
    expect(cellOf(view, '2026-11-04', s1.userId)).toEqual({ shiftTypeId: ids['종일'], leave: { type: 'annual', label: '연차', requestId: leaveId, fullDay: true } });
    expect(cellOf(view, '2026-11-05', s1.userId)?.leave?.label).toBe('연차');
    expect(cellOf(view, '2026-11-04', s2.userId)?.leave).toMatchObject({ label: '반차(오후)', fullDay: false });
    expect(cellOf(view, '2026-11-04', s3.userId)).toEqual({ shiftTypeId: ids['종일'] });
    expect(cellOf(view, '2026-11-05', s3.userId)).toEqual({ shiftTypeId: ids['종일'] });
    expect(cellOf(view, '2026-11-06', manager.userId)).toEqual({ shiftTypeId: null, leave: expect.objectContaining({ label: '연차' }) });
    // 4명 중 s1 연차만 빠진다(반차 s2는 남음)
    expect(view.totals['2026-11-04']).toBe(3);
    expect(view.totals['2026-11-05']).toBe(3);
    expect(view.days.find((d) => d.date === '2026-11-04')?.total).toBe(3);
    // roster 원본은 그대로다
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM roster')?.n).toBe(8);
  });

  test('phase-04-task-01 AC3: 인원 합계 규칙 — 근무로 세는 유형이고 하루 종일 휴가가 아닌 칸만 센다', () => {
    const types = new Map([
      [1, { countsAsWork: true }],
      [5, { countsAsWork: false }],
    ]);
    const leave = (fullDay: boolean) => ({ type: fullDay ? ('annual' as const) : ('half_am' as const), label: '', requestId: 1, fullDay });
    expect(dayTotal({ a: { shiftTypeId: 1 }, b: { shiftTypeId: 5 }, c: { shiftTypeId: 1, leave: leave(true) }, d: { shiftTypeId: 1, leave: leave(false) }, e: { shiftTypeId: null, leave: leave(true) } }, types)).toBe(2);
  });
});

describe('권한', () => {
  test('phase-04-task-01 AC4: 직원은 근무표·근무 유형을 조회만 할 수 있고, 칸 저장·지난주 복사·유형 저장은 403이다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const ids = await typeIds(a, manager);

    expect((await roster(a, staff, THIS_MON, '2026-11-08')).users.length).toBeGreaterThan(0);
    expect((await shiftTypes(a, staff)).length).toBe(5);
    const today = await a.inject({ method: 'GET', url: '/api/roster/today', headers: staff.headers });
    expect(today.statusCode).toBe(200);

    const cell = await putCell(a, staff, { userId: staff.userId, date: '2026-11-03', shiftTypeId: ids['종일'] });
    expect(cell.statusCode).toBe(403);
    expect(cell.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
    const copy = await a.inject({ method: 'POST', url: '/api/roster/copy-week', headers: staff.writeHeaders, payload: { fromWeekStart: LAST_MON, toWeekStart: THIS_MON } });
    expect(copy.statusCode).toBe(403);
    const types = await a.inject({ method: 'PUT', url: '/api/shift-types', headers: staff.writeHeaders, payload: { items: [] } });
    expect(types.statusCode).toBe(403);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM roster')?.n).toBe(0);

    // 원장(admin)은 편집할 수 있다
    const admin = loginAs(a, 'admin');
    expect((await putCell(a, admin, { userId: staff.userId, date: '2026-11-03', shiftTypeId: ids['종일'] })).statusCode).toBe(200);
  });
});

describe('오늘 근무(대시보드)', () => {
  test('phase-04-task-01 AC5: 오늘 근무자와 근무 유형이 근무 → 휴가 → 휴무 순으로 나오고, 근무 인원을 센다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const s1 = loginAs(a, 'staff');
    const s2 = loginAs(a, 'staff');
    const s3 = loginAs(a, 'staff');
    loginAs(a, 'staff'); // 오늘 칸이 없는 직원은 목록에 나오지 않는다
    const ids = await typeIds(a, manager);
    await putCell(a, manager, { userId: s1.userId, date: THIS_MON, shiftTypeId: ids['휴무'] });
    await putCell(a, manager, { userId: s2.userId, date: THIS_MON, shiftTypeId: ids['오전'] });
    await putCell(a, manager, { userId: manager.userId, date: THIS_MON, shiftTypeId: ids['종일'] });
    await putCell(a, manager, { userId: s3.userId, date: THIS_MON, shiftTypeId: ids['종일'] });
    approvedLeave(a, s3.userId, 'annual', THIS_MON);

    const res = await a.inject({ method: 'GET', url: '/api/roster/today', headers: s1.headers });
    expect(res.statusCode).toBe(200);
    const t = res.json<{ data: TodayRoster }>().data;
    expect(t.date).toBe(THIS_MON);
    expect(t.open).toBe(true);
    expect(t.working).toBe(2);
    expect(t.onLeave).toBe(1);
    expect(t.items.map((i) => [i.userId, i.shift?.label ?? null, i.leave?.label ?? null, i.working])).toEqual([
      [manager.userId, '종일', null, true],
      [s2.userId, '오전', null, true],
      [s3.userId, '종일', '연차', false],
      [s1.userId, '휴무', null, false],
    ]);
    // 함수로도 같은 값(phase-03-task-10이 쓴다)
    expect(todayRoster(a.db, THIS_MON)).toEqual(t);
    // 다른 날짜
    const other = await a.inject({ method: 'GET', url: '/api/roster/today?date=2026-11-08', headers: s1.headers });
    expect(other.json<{ data: TodayRoster }>().data).toEqual({ date: '2026-11-08', open: false, items: [], working: 0, onLeave: 0 });
  });
});

describe('근무 유형 관리', () => {
  test('phase-04-task-01: 실장이 근무 유형 이름·시간을 바꾸고 새 유형을 더하며, 사용 안 함 유형은 칸에 넣을 수 없다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const types = await shiftTypes(a, manager);
    const items: Array<Record<string, unknown>> = types.map((t, i) => ({
      id: t.id,
      label: t.label,
      startTime: i === 1 ? '09:00' : t.startTime,
      endTime: i === 1 ? '13:30' : t.endTime,
      colorToken: t.colorToken,
      countsAsWork: t.countsAsWork,
      active: i === 3 ? false : t.active,
    }));
    items.push({ label: '교육', startTime: '10:00', endTime: '16:00', colorToken: 'ok', countsAsWork: true, active: true });
    const res = await a.inject({ method: 'PUT', url: '/api/shift-types', headers: manager.writeHeaders, payload: { items } });
    expect(res.statusCode).toBe(200);
    const saved = res.json<{ data: ShiftType[] }>().data;
    expect(saved.map((t) => [t.label, t.startTime, t.endTime, t.active, t.sort])).toEqual([
      ['종일', '09:30', '18:30', true, 1],
      ['오전', '09:00', '13:30', true, 2],
      ['오후', '14:00', '18:30', true, 3],
      ['야간', '13:00', '20:30', false, 4],
      ['휴무', null, null, true, 5],
      ['교육', '10:00', '16:00', true, 6],
    ]);
    expect(saved[5]?.code).toMatch(/^custom-\d+$/);
    const night = saved.find((t) => t.label === '야간')!;
    expect((await putCell(a, manager, { userId: staff.userId, date: '2026-11-03', shiftTypeId: night.id })).statusCode).toBe(400);
    expect((await putCell(a, manager, { userId: staff.userId, date: '2026-11-03', shiftTypeId: saved[5]!.id })).statusCode).toBe(200);
  });

  test('phase-04-task-01: 근무 유형 입력 오류(이름 없음·이름 겹침·끝 시각이 빠름)는 저장되지 않는다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const put = (items: unknown[]) => a.inject({ method: 'PUT', url: '/api/shift-types', headers: manager.writeHeaders, payload: { items } });
    const base = { startTime: '09:00', endTime: '12:00', colorToken: 'info', countsAsWork: true, active: true };
    const noName = await put([{ ...base, label: ' ' }]);
    expect(noName.statusCode).toBe(400);
    expect(noName.json<{ error: { fields: Record<string, string> } }>().error.fields['items.0.label']).toBe('이름을 적어 주세요.');
    const dup = await put([{ ...base, label: '종일' }]);
    expect(dup.statusCode).toBe(400);
    expect(dup.json<{ error: { message: string } }>().error.message).toBe('"종일" 근무 유형이 이미 있어요.');
    const order = await put([{ ...base, label: '짧은 근무', startTime: '12:00', endTime: '09:00' }]);
    expect(order.statusCode).toBe(400);
    expect(order.json<{ error: { fields: Record<string, string> } }>().error.fields['items.0.endTime']).toBe('끝 시각이 시작 시각보다 늦어야 해요.');
    expect((await shiftTypes(a, manager)).length).toBe(5);
  });
});

describe('날짜 계산', () => {
  test('phase-04-task-01: 주간은 월~일, 월간 달력은 1일이 든 주 월요일부터 말일이 든 주 일요일까지다', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(weekRange('2026-11-04')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(monthGridRange('2026-11-15')).toEqual({ from: '2026-10-26', to: '2026-12-06', month: '2026-11' });
    expect(monthGridRange('2026-02-10')).toEqual({ from: '2026-01-26', to: '2026-03-01', month: '2026-02' });
    expect(rosterPeriodLabel('2026-11-02', '2026-11-08')).toBe('11월 2일 ~ 8일');
    expect(rosterPeriodLabel('2026-10-26', '2026-11-01')).toBe('10월 26일 ~ 11월 1일');
  });
});

describe('데모 데이터', () => {
  test('phase-04-task-01: 데모 근무표 4주가 들어가고(일요일 비움), 두 번 넣어도 늘지 않으며 데모 승인 휴가가 덧씌워진다', async () => {
    const a = await makeApp();
    const ctx = { clock: a.clock, scale: 1 };
    await seedAdminDemo(a.db, ctx);
    seedHrDemo(a.db, ctx);
    const first = demoRosterStart(THIS_MON);
    expect(first).toBe('2026-10-19');
    const span = a.db.get<{ lo: string; hi: string; n: number; days: number }>('SELECT MIN(date) AS lo, MAX(date) AS hi, COUNT(*) AS n, COUNT(DISTINCT date) AS days FROM roster');
    expect(span).toEqual({ lo: '2026-10-19', hi: '2026-11-14', n: 9 * 24, days: 24 });
    seedHrDemo(a.db, ctx);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM roster')?.n).toBe(9 * 24);

    const manager = loginAs(a, 'manager');
    const view = await roster(a, manager, THIS_MON, '2026-11-08');
    const haneul = view.users.find((u) => u.name === '정하늘')!;
    // 데모 연차(기준일 4일 뒤 = 11/6 금, 정하늘 연차 승인)
    expect(cellOf(view, '2026-11-06', haneul.id)?.leave?.label).toBe('연차');
    const t = todayRoster(a.db, THIS_MON);
    expect(t.working).toBe(9);
    expect(t.items[0]).toMatchObject({ name: '한서준', shift: expect.objectContaining({ label: '종일' }) });
  });
});

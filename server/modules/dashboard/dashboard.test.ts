// 이 파일이 하는 일: 대시보드 API(GET /api/dashboard, FR-008)를 실제 라우트와 DB로 확인한다(phase-03-task-10 AC2·AC3·AC4·AC6).
// 데모 데이터(하늘숲치과)에서 각 영역이 채워지고 항목이 이동할 화면 정보(id·link)를 갖는지, staff에게는 승인 대기·발주·지출이 빠지는지,
// 빈 DB에서 모든 영역이 빈 값(0·빈 배열)으로 오는지, 1배 데모 데이터에서 응답 p95가 300ms 이하인지 본다.
// 시계는 2026-11-02 09:00(월)으로 고정하고, 데이터는 .tmp/unit/ 임시 폴더만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { fixedClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { seedDemoAll } from '../../db/seed/registry.ts';
import type { DashboardData } from '../../../shared/schemas/dashboard.ts';
import { weekRange } from './service.ts';
import { measureDashboard, percentile } from './perf.ts';

const NOW = '2026-11-02T09:00:00+09:00';

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

async function makeApp(withDemo: boolean): Promise<FastifyInstance> {
  tmp = makeTmpDir('dentalax-dashboard-');
  const clock = fixedClock(NOW);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  if (withDemo) await seedDemoAll(app.db, { clock, scale: 1 });
  return app;
}

async function dashboard(a: FastifyInstance, who: TestLogin): Promise<DashboardData> {
  const res = await a.inject({ method: 'GET', url: '/api/dashboard', headers: who.headers });
  expect(res.statusCode).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return res.json<{ data: DashboardData }>().data;
}

describe('대시보드 API', () => {
  test('phase-03-task-10 AC2: 데모 데이터에서 각 영역이 채워지고, 항목마다 이동할 화면을 정할 번호·주소가 있다', async () => {
    const a = await makeApp(true);
    const d = await dashboard(a, loginAs(a, 'admin'));
    expect(d.today.date).toBe('2026-11-02');
    // 서버 시계 기준 지금(인사말용)과 근무표(phase-04-task-01)의 오늘 근무
    expect(d.now).toBe(new Date(NOW).toISOString());
    expect(d.today.rosterReady).toBe(true);
    expect(d.kpis.working).toBeGreaterThan(0);
    expect(d.today.working).toHaveLength(d.kpis.working ?? -1);
    expect(d.today.working.every((w) => w.name && w.shift)).toBe(true);
    expect(d.checklist.open.total).toBeGreaterThan(0);
    // 오늘 항목 전체가 원래 순서(오픈 먼저)로 온다
    expect(d.checklist.items).toHaveLength(d.checklist.open.total + d.checklist.close.total);
    expect(d.checklist.items[0]).toMatchObject({ kind: 'open', checked: false });
    expect(d.checklist.items.at(-1)?.kind).toBe('close');
    expect(d.handovers.items.length).toBeGreaterThan(0);
    expect(d.stockAlerts.items.length).toBeGreaterThan(0);
    // 재고 경고 숫자 = 상태별 합
    const s = d.kpis.stock;
    expect(s.total).toBe(s.low + s.expiring + s.soonLow + s.expired);
    expect(d.stockAlerts.items.every((i) => i.status !== 'ok' && i.id > 0)).toBe(true);
    expect(d.dueSoon.items.length).toBeGreaterThan(0);
    expect(d.dueSoon.items.every((t) => t.daysLeft !== null && t.daysLeft <= 30)).toBe(true);
    // 공지는 고정이 먼저
    expect(d.notices.items[0]?.pinned).toBe(true);
    expect(d.notices.items[0]?.totalUsers).toBeGreaterThan(0);
    expect(d.orders?.items.length).toBeGreaterThan(0);
    expect(d.recentMoves.length).toBeGreaterThan(0);
    expect(d.recentMoves.every((m) => m.itemId > 0)).toBe(true);
    // 이번 주(월~일) 일정은 주 안의 날짜이고, 누르면 갈 주소가 있다
    expect(d.week).toMatchObject({ start: '2026-11-02', end: '2026-11-08' });
    expect(d.week.events.every((e) => e.date >= d.week.start && e.date <= d.week.end && e.link.startsWith('/'))).toBe(true);
    // AI: 키가 없으니 데모, 관리자는 금액까지 본다
    expect(d.ai).toMatchObject({ demo: true, month: '2026-11', quickAllowed: true });
    expect(d.ai.monthKrw).not.toBeNull();
    expect(d.ai.budgetKrw).toBeGreaterThan(0);
  });

  test('phase-03-task-10 AC3: staff에게는 승인 대기·발주·지출 영역이 오지 않고, 실장에게는 오며, AI 금액은 원장(관리자)만 본다', async () => {
    const a = await makeApp(true);
    const staff = await dashboard(a, loginAs(a, 'staff'));
    expect(staff.approvals).toBeNull();
    expect(staff.orders).toBeNull();
    expect(staff.expenseMonth).toBeNull();
    expect(staff.kpis.approvals).toBeNull();
    expect(staff.ai.monthKrw).toBeNull();
    expect(staff.ai.budgetKrw).toBeNull();
    // 원본 응답 글에도 승인 대기 명단·발주서 번호가 없다
    const raw = (await a.inject({ method: 'GET', url: '/api/dashboard', headers: loginAs(a, 'staff').headers })).body;
    expect(raw).not.toContain('PO-');
    expect(raw).not.toContain('"startOn"');

    const manager = await dashboard(a, loginAs(a, 'manager'));
    expect(manager.approvals?.total).toBeGreaterThan(0);
    expect(manager.approvals?.items.length).toBeGreaterThan(0);
    expect(manager.kpis.approvals).toBe(manager.approvals?.total);
    expect(manager.orders).not.toBeNull();
    expect(manager.expenseMonth).toEqual({ ready: false, total: 0, trend6: [] });
    expect(manager.ai.monthKrw).toBeNull();
  });

  test('phase-03-task-10 AC4: 빈 DB에서는 모든 영역이 0과 빈 목록으로 온다(화면은 빈 상태 안내를 그린다)', async () => {
    const a = await makeApp(false);
    const d = await dashboard(a, loginAs(a, 'admin'));
    expect(d.today).toEqual({ date: '2026-11-02', rosterReady: false, working: [], onLeave: [] });
    expect(d.kpis).toEqual({
      working: null,
      checklistOpen: { done: 0, total: 0 },
      stock: { total: 0, low: 0, expiring: 0, soonLow: 0, expired: 0 },
      due: { total: 0, overdue: 0, today: 0, needCheck: 0 },
      approvals: 0,
      myPendingLeave: 0,
    });
    expect(d.checklist.items).toEqual([]);
    expect(d.handovers).toEqual({ total: 0, items: [] });
    expect(d.approvals).toEqual({ total: 0, items: [] });
    expect(d.stockAlerts).toEqual({ total: 0, orderable: 0, items: [] });
    expect(d.dueSoon).toEqual({ total: 0, items: [] });
    expect(d.notices).toEqual({ total: 0, items: [] });
    expect(d.orders).toEqual({ open: 0, items: [] });
    expect(d.week.events).toEqual([]);
    expect(d.recentMoves).toEqual([]);
    expect(d.expenseMonth).toEqual({ ready: false, total: 0, trend6: [] });
    expect(d.ai.pct).toBe(0);
  });

  test('phase-03-task-10 AC2: 로그인하지 않으면 401', async () => {
    const a = await makeApp(false);
    const res = await a.inject({ method: 'GET', url: '/api/dashboard' });
    expect(res.statusCode).toBe(401);
  });

  test('phase-03-task-10 AC6: 1배 데모 데이터에서 GET /api/dashboard 응답 p95가 300ms 이하다(10배는 phase-05-task-01)', async () => {
    const a = await makeApp(true);
    const who = loginAs(a, 'admin');
    const r = await measureDashboard(async () => {
      const res = await a.inject({ method: 'GET', url: '/api/dashboard', headers: who.headers });
      if (res.statusCode !== 200) throw new Error(`상태 ${res.statusCode}`);
    }, 40);
    expect(r.count).toBe(40);
    expect(r.p95).toBeLessThanOrEqual(300);
  });
});

describe('도움 함수', () => {
  test('phase-03-task-10 AC2: 이번 주는 월요일부터 일요일까지다', () => {
    expect(weekRange('2026-11-02')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(weekRange('2026-11-08')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(weekRange('2026-11-05')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(weekRange('2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' });
  });

  test('phase-03-task-10 AC6: p95는 정렬한 값의 95% 위치(올림)다', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([3, 1, 2], 50)).toBe(2);
    expect(() => percentile([], 95)).toThrow();
  });
});

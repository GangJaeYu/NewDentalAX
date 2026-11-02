// 이 파일이 하는 일: 실제로 띄운 서버에서 FR-090 AC2 알림 종류 6가지가 업무 API로 모두 생기고 맞는 사람에게만 가는지 본다(phase-04-task-05 AC1).
// 즉시 알림(연차 신청·결과, 재고 부족, 새 공지, 멸균 불합격, AI 예산)은 API를 부르는 순간 생기고,
// 기한형 알림(유효기간, 장비 점검, 법정 일정)은 서버를 다시 켤 때 scheduler가 처음 한 번 돌리는 알림 찾기로 생긴다(실제 운영과 같은 경로).
// 마지막으로 실장 계정이 휴대폰 너비 알림 화면에서 종류 칩을 보고 "모두 읽음"을 눌러 배지가 사라지는지 확인한다.
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';
import { appDbPath, openDb } from '../../server/db/index.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'srcadmin', password: 'Source-Admin-Pass-5', withDemo: false };
const MANAGER = { username: 'srcmanager', password: 'Source-Manager-Pass-5', name: '윤실장' };
const STAFF = { username: 'srcstaff', password: 'Source-Staff-Pass-5', name: '정하늘' };
const STAFF2 = { username: 'srcstaff2', password: 'Source-Staff2-Pass-5', name: '서다온' };

/** FR-090 AC2 알림 종류(영문 이름) */
const AC2_TYPES = ['leave_requested', 'leave_result', 'stock_low', 'stock_expiry', 'equipment_due', 'legal_due', 'notice', 'sterilizer_fail', 'ai_budget'];
const MANAGER_TYPES = ['equipment_due', 'leave_requested', 'legal_due', 'notice', 'sterilizer_fail', 'stock_expiry', 'stock_low'];

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;

interface Who {
  ctx: BrowserContext;
  csrf: string;
}

/** 새 브라우저 묶음을 만들고 API로 로그인해 둔다 */
async function loggedIn(browser: Browser, who: { username: string; password: string }, viewport = { width: 1440, height: 900 }): Promise<Who> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  return { ctx, csrf: ((await r.json()) as { data: { csrfToken: string } }).data.csrfToken };
}

/** 쓰기 API를 부르고 상태 코드를 확인한 뒤 data를 돌려준다 */
async function post<T>(who: Who, path: string, data: Record<string, unknown>, status = 201): Promise<T> {
  const r = await who.ctx.request.post(url(path), { headers: { 'x-csrf-token': who.csrf }, data });
  expect(r.status(), `${path} ${await r.text()}`).toBe(status);
  return ((await r.json()) as { data: T }).data;
}

/** 한 사람이 받은 AC2 알림 종류(중복 없이, 이름 순) */
async function ac2Types(who: Who): Promise<string[]> {
  const r = await who.ctx.request.get(url('/api/notifications?limit=50'));
  expect(r.status()).toBe(200);
  const items = ((await r.json()) as { data: { type: string }[] }).data;
  return [...new Set(items.map((i) => i.type))].filter((t) => AC2_TYPES.includes(t)).sort();
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe.serial('FR-090 AC2 알림 6가지(실제 서버)', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
    await isoServer.addUser('staff', STAFF2.username, STAFF2.password, STAFF2.name);
  });

  test('phase-04-task-05 AC1: 업무 API와 서버 시작 알림 찾기로 6가지 알림이 모두 생기고 맞는 사람에게만 간다', async ({ browser, isoServer }) => {
    const manager = await loggedIn(browser, MANAGER);
    const staff = await loggedIn(browser, STAFF);

    // ① 연차 신청 → 실장 이상, 승인 → 신청자
    const leave = await post<{ id: number }>(staff, '/api/leave', { type: 'half_am', startOn: '2026-11-06', reason: '은행 업무' });
    await post(manager, `/api/leave/${leave.id}/decide`, { approve: true }, 200);
    // ② 재고 부족(출고 즉시) · 유효기간 임박(기한형)
    const glove = await post<{ item: { id: number } }>(manager, '/api/items', { name: '니트릴 글러브 M', category: '소모품', unit: '박스', par: 6 });
    await post(staff, '/api/inventory/moves', { itemId: glove.item.id, type: 'in', qty: 8, unitPrice: 8400 });
    await post(staff, '/api/inventory/moves', { itemId: glove.item.id, type: 'out', qty: 3 });
    const gel = await post<{ item: { id: number } }>(manager, '/api/items', { name: '표면 마취 젤', category: '약품', unit: '개', par: 1, trackExpiry: true });
    await post(manager, '/api/inventory/moves', { itemId: gel.item.id, type: 'in', qty: 3, expiryOn: '2026-11-14' });
    // ③ 장비 점검 임박(기한형) · 멸균 불합격(즉시)
    const eq = await post<{ id: number }>(manager, '/api/equipment', { name: '오토클레이브 1호기', kind: 'sterilizer', inspectCycleMonths: 6 });
    await post(staff, `/api/equipment/${eq.id}/logs`, { date: '2026-05-10', kind: 'inspection', content: '정기 점검' });
    await post(staff, '/api/sterilizer-logs', { equipmentId: eq.id, date: '2026-11-02', testType: 'bi', cycleNo: '1002', tempC: 134, pressureKpa: 216, minutes: 4, result: 'fail' });
    // ④ 법정 일정 임박(기한형): TLD를 2026-08-10에 했다 → 2026-11-10(D-8)
    const legal = (await (await manager.ctx.request.get(url('/api/legal-tasks'))).json()) as { data: { items: { id: number; title: string }[] } };
    const tld = legal.data.items.find((t) => t.title === '개인 피폭선량 측정(TLD)');
    expect(tld).toBeDefined();
    await post(manager, `/api/legal-tasks/${tld?.id}/done`, { doneOn: '2026-08-10' }, 200);
    // ⑤ 새 공지(전원)
    await post(manager, '/api/posts', { kind: 'notice', category: '일반', title: '11월 회식 안내', body: '금요일 저녁' });
    // ⑥ AI 예산 80%: 이번 달 사용 32,000원을 넣고 데모 AI를 한 번 부른다(실제 AI 호출 없음)
    const db = openDb(appDbPath(isoServer.dataDir));
    try {
      db.run("INSERT INTO ai_usage (at, user_id, feature, provider, model, cost_usd, cost_krw, status) VALUES (?, NULL, 'quick', 'anthropic', 'claude-haiku-5-5', 0, 32000, 'ok')", ['2026-11-02T00:00:00.000Z']);
    } finally {
      db.close();
    }
    await post(staff, '/api/ai/run', { feature: 'quick', input: '오늘 할 일 정리' }, 200);

    // 즉시 알림은 바로 보인다(기한형은 아직)
    expect(await ac2Types(manager)).toEqual(['leave_requested', 'notice', 'sterilizer_fail', 'stock_low']);
    await manager.ctx.close();
    await staff.ctx.close();

    // 서버를 다시 켜면 scheduler가 시작하면서 알림 찾기를 한 번 돌린다
    await isoServer.stop();
    await isoServer.start();

    const m2 = await loggedIn(browser, MANAGER);
    const a2 = await loggedIn(browser, ADMIN);
    const s1 = await loggedIn(browser, STAFF);
    const s2 = await loggedIn(browser, STAFF2);
    await expect.poll(() => ac2Types(m2), { timeout: 15_000 }).toEqual(MANAGER_TYPES);
    expect(await ac2Types(a2)).toEqual(['ai_budget', ...MANAGER_TYPES].sort());
    expect(await ac2Types(s1)).toEqual(['leave_result', 'notice']);
    expect(await ac2Types(s2)).toEqual(['notice']);
    for (const w of [m2, a2, s1, s2]) await w.ctx.close();
  });

  test('phase-04-task-05 AC1: 실장이 휴대폰 너비 알림 화면에서 종류별 알림을 보고 "모두 읽음"으로 배지를 없앤다', async ({ browser }) => {
    const m = await loggedIn(browser, MANAGER, { width: 390, height: 844 });
    const page = await m.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/notifications'));
    const list = page.getByRole('article', { name: '알림 목록' });
    for (const label of ['연차 신청', '재고 부족', '유효기간', '장비 점검', '법정 일정', '새 공지', '멸균 불합격']) {
      await expect(list.getByText(label, { exact: true }).first(), label).toBeVisible();
    }
    await expect(list.getByText('AI 예산', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('notification-badge')).toBeVisible();
    const sw = (await page.evaluate('({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })')) as { sw: number; iw: number };
    expect(sw.sw).toBeLessThanOrEqual(sw.iw);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    await page.getByRole('button', { name: '모두 읽음' }).click();
    await expect(page.getByText('읽지 않은 알림 0개')).toBeVisible();
    await expect(page.getByTestId('notification-badge')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '모두 읽음' })).toBeDisabled();
    // 새로 고쳐도 읽음 상태가 남는다
    await page.reload();
    await expect(page.getByText('읽지 않은 알림 0개')).toBeVisible();
    expect(errors).toEqual([]);
    await m.ctx.close();
  });
});

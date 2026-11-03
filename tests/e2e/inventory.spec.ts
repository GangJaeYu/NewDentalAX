// 이 파일이 하는 일: 재고 화면 E2E(phase-03-task-01 AC1~AC7). 이 파일 전용 격리 서버(tests/e2e/fixtures.ts)에서 실장이 API로 품목·거래처·입고를 준비한 뒤,
// 직원이 품목 찾기 → 수량 → 저장으로 출고(AC1), 수량 0 거부·재고 초과 출고 확인(AC2), 부족·곧 부족·정상 칩(AC3), 유효기간 D-12와 FEFO 소진 뒤 다음 로트(AC4),
// 8,400 → 8,900 입고의 ▲6% 표시와 단가 추이(AC5), 기록 있는 품목 삭제 → 사용 안 함(AC6), 실장 부족 알림 1건(AC7)을 화면으로 확인한다.
// 화면마다 axe 위반 0건과 휴대폰 너비 가로 스크롤 없음도 본다(화면별 테스트로 나눴다). 서버 시계는 2026-11-02 09:00(KST)에 멈춰 있다.
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'invadmin1', password: 'Inv-Admin-Pass-1', withDemo: false };
const MANAGER = { name: '윤실장', username: 'invmgr01', password: 'Inv-Mgr-Pass-01' };
const STAFF = { name: '정직원', username: 'invstaff1', password: 'Inv-Staff-Pass-1' };

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;
/** 준비한 품목 번호 */
const ids: Record<string, number> = {};

/** 콘솔 오류를 모은다(일부러 만든 4xx 응답의 "Failed to load resource" 줄은 뺀다) */
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

function axeList(violations: Array<{ id: string; nodes: Array<{ target: unknown[] }> }>): string[] {
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** 새 브라우저 묶음을 만들고 API로 로그인해 둔다. CSRF 토큰도 돌려준다 */
async function loggedIn(browser: Browser, who: { username: string; password: string }, viewport = { width: 1440, height: 900 }): Promise<{ ctx: BrowserContext; csrf: string }> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  const body = (await r.json()) as { data: { csrfToken: string } };
  return { ctx, csrf: body.data.csrfToken };
}

/** API로 상태 변경 요청(CSRF 포함). 성공 응답의 data를 돌려준다 */
async function post<T>(req: APIRequestContext, csrf: string, path: string, data: unknown, method: 'post' | 'patch' = 'post'): Promise<T> {
  const r = await req[method](url(path), { data, headers: { 'x-csrf-token': csrf } });
  expect(r.ok(), `${path} ${r.status()} ${await r.text()}`).toBe(true);
  return ((await r.json()) as { data: T }).data;
}

/** API로 품목 상태를 읽는다 */
async function itemApi(req: APIRequestContext, id: number) {
  const r = await req.get(url(`/api/items/${id}`));
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: { stock: number; status: string; nearestExpiry: string | null; dday: number | null; active: boolean } }).data;
}

/** 표에서 글자가 들어 있는 줄 */
const rowOf = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

/** 가로 스크롤이 생겼는지 */
async function noHorizontalScroll(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
}

test.describe.serial('재고: 품목·입출고·상태·거래처·단가', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test('준비: 첫 설정, 실장·직원 계정, 거래처·품목·입고를 API로 만든다', async ({ request, browser, isoServer }) => {
    expect((await request.post('/api/setup', { data: ADMIN })).status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
    const { ctx, csrf } = await loggedIn(browser, MANAGER);
    const vendor = await post<{ id: number }>(ctx.request, csrf, '/api/vendors', { name: '한빛덴탈', contactName: '김도윤', phone: '02-555-0101', orderMethod: '전화 주문' });
    const make = async (key: string, body: Record<string, unknown>) => {
      const r = await post<{ item: { id: number } }>(ctx.request, csrf, '/api/items', { category: '소모품', unit: '박스', par: 6, ...body });
      ids[key] = r.item.id;
    };
    const inMove = (key: string, body: Record<string, unknown>) => post(ctx.request, csrf, '/api/inventory/moves', { itemId: ids[key], type: 'in', ...body });
    await make('glove', { name: '니트릴 글러브 M', vendorId: vendor.id, location: '소모품실 A-1' });
    await inMove('glove', { qty: 10, unitPrice: 8400 });
    await make('tip', { name: '석션 팁 (일회용)', unit: '봉', par: 2 });
    await inMove('tip', { qty: 2 });
    await make('five', { name: '품목 다섯' });
    await inMove('five', { qty: 5 });
    await make('seven', { name: '품목 일곱' });
    await inMove('seven', { qty: 7 });
    await make('eight', { name: '품목 여덟' });
    await inMove('eight', { qty: 8 });
    await make('resin', { name: '복합레진 A2', category: '재료', unit: '개', par: 2, trackExpiry: true });
    await inMove('resin', { qty: 5, lot: 'B-2', expiryOn: '2026-12-20' });
    await inMove('resin', { qty: 3, lot: 'A-1', expiryOn: '2026-11-14' });
    await make('used', { name: '쓰던 품목', par: 1 });
    await inMove('used', { qty: 1 });
    await ctx.close();
  });

  test('phase-03-task-01 AC1: staff가 품목 검색 → 수량 입력 → 저장으로 출고하면 현재고가 줄고 기록에 남는다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory'));
    await expect(page.getByRole('heading', { level: 1, name: '재고 현황' })).toBeVisible();
    await expect(rowOf(page, '니트릴 글러브 M')).toContainText('10박스');
    // 직원에게는 품목 추가 버튼이 없다
    await expect(page.getByRole('button', { name: '품목 추가' })).toHaveCount(0);

    await page.getByRole('button', { name: '출고 기록' }).click();
    const dialog = page.getByRole('dialog', { name: '출고 기록' });
    // ① 품목 검색
    await dialog.getByRole('searchbox', { name: '출고할 품목 찾기' }).fill('글러브');
    await dialog.getByRole('button', { name: /^니트릴 글러브 M 소모품/ }).click();
    // ② 수량 입력 → 저장
    await dialog.getByLabel('출고 수량(박스)').fill('3');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('니트릴 글러브 M 3박스 출고를 기록했어요. 남은 재고 7박스')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(rowOf(page, '니트릴 글러브 M')).toContainText('7박스');

    // 새로 고쳐도 그대로이고, 입출고 기록에 남는다
    await page.reload();
    await expect(rowOf(page, '니트릴 글러브 M')).toContainText('7박스');
    await page.goto(url('/inventory/moves'));
    const first = page.getByRole('table', { name: '입출고 기록' }).getByRole('row').nth(1);
    await expect(first).toContainText('니트릴 글러브 M');
    await expect(first).toContainText('출고');
    await expect(first).toContainText('−3박스');
    await expect(first).toContainText(STAFF.name);
    expect((await itemApi(ctx.request, ids.glove!)).stock).toBe(7);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-01 AC2: 수량 0은 거부되고, 재고보다 많이 출고하면 확인 대화상자가 떠서 확인해야만 저장된다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/moves'));
    await page.getByRole('button', { name: '출고 기록' }).click();
    const dialog = page.getByRole('dialog', { name: '출고 기록' });
    await dialog.getByRole('searchbox', { name: '출고할 품목 찾기' }).fill('석션');
    await dialog.getByRole('button', { name: /^석션 팁 \(일회용\) 소모품/ }).click();

    // 수량 0·음수 → 저장하지 않고 이유를 보여 준다
    for (const v of ['0', '-1']) {
      await dialog.getByLabel('출고 수량(봉)').fill(v);
      await dialog.getByRole('button', { name: '저장' }).click();
      await expect(dialog.getByText('수량은 0보다 크게 적어 주세요.')).toBeVisible();
    }
    expect((await itemApi(ctx.request, ids.tip!)).stock).toBe(2);

    // 재고(2봉)보다 많은 5봉 → 확인 대화상자, 취소하면 저장되지 않는다
    await dialog.getByLabel('출고 수량(봉)').fill('5');
    await dialog.getByRole('button', { name: '저장' }).click();
    const confirm = page.getByRole('dialog', { name: '재고보다 많이 출고할까요?' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('지금 재고는 2봉인데 5봉를 출고하려고 해요');
    await confirm.getByRole('button', { name: '취소' }).click();
    await expect(confirm).toHaveCount(0);
    expect((await itemApi(ctx.request, ids.tip!)).stock).toBe(2);

    // 다시 저장 → 확인 → 저장된다
    await dialog.getByRole('button', { name: '저장' }).click();
    await page.getByRole('dialog', { name: '재고보다 많이 출고할까요?' }).getByRole('button', { name: '그래도 출고' }).click();
    await expect(page.getByText('석션 팁 (일회용) 5봉 출고를 기록했어요. 남은 재고 -3봉')).toBeVisible();
    expect((await itemApi(ctx.request, ids.tip!)).stock).toBe(-3);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-01 AC3: 적정 6, 현재 5 → 부족 / 7 → 곧 부족 / 8 → 정상으로 표시된다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    await page.goto(url('/inventory'));
    await expect(rowOf(page, '품목 다섯').locator('.chip')).toHaveText('부족');
    await expect(rowOf(page, '품목 일곱').locator('.chip')).toHaveText('곧 부족');
    await expect(rowOf(page, '품목 여덟').locator('.chip')).toHaveText('정상');
    // 상태 필터 "부족"을 누르면 부족 품목만 남는다
    await page.getByRole('group', { name: '상태' }).getByRole('button', { name: /^부족/ }).click();
    await expect(rowOf(page, '품목 다섯')).toBeVisible();
    await expect(rowOf(page, '품목 일곱')).toHaveCount(0);
    await expect(rowOf(page, '품목 여덟')).toHaveCount(0);
    await ctx.close();
  });

  test('phase-03-task-01 AC4: 유효기간 2026-11-14 로트가 남으면 "D-12", 출고로 소진되면(FEFO) 다음 로트 기준으로 바뀐다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory'));
    const row = rowOf(page, '복합레진 A2');
    await expect(row).toContainText('2026-11-14');
    await expect(row.locator('.chip')).toHaveText('임박 D-12');

    await row.click();
    await expect(page.getByRole('heading', { level: 1, name: '복합레진 A2' })).toBeVisible();
    const lots = page.getByRole('table', { name: '복합레진 A2 로트별 남은 수량' });
    await expect(lots.getByRole('row').nth(1)).toContainText('2026-11-14');
    await expect(lots.getByRole('row').nth(1)).toContainText('D-12');

    // 출고 3개 → 11-14 로트(3개)가 먼저 빠진다
    await page.getByRole('button', { name: '출고 기록' }).click();
    const dialog = page.getByRole('dialog', { name: '출고 기록' });
    await dialog.getByLabel('출고 수량(개)').fill('3');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('복합레진 A2 3개 출고를 기록했어요. 남은 재고 5개')).toBeVisible();
    await expect(lots.getByRole('row')).toHaveCount(2);
    await expect(lots.getByRole('row').nth(1)).toContainText('2026-12-20');
    await expect(lots.getByRole('row').nth(1)).toContainText('D-48');
    await expect(page.getByRole('region', { name: '품목 요약' })).toContainText('2026-12-20');

    await page.goto(url('/inventory'));
    await expect(rowOf(page, '복합레진 A2')).toContainText('2026-12-20');
    await expect(rowOf(page, '복합레진 A2').locator('.chip')).toHaveText('정상');
    expect(await itemApi(ctx.request, ids.resin!)).toMatchObject({ nearestExpiry: '2026-12-20', dday: 48, status: 'ok' });
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-01 AC5: 직전 단가 8,400 → 8,900 입고 시 ▲6% 표시, 품목 상세에 단가 추이 표·그래프', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url(`/inventory/items/${ids.glove}`));
    await page.getByRole('button', { name: '입고', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '입고 기록' });
    await dialog.getByLabel('수량(박스)').fill('6');
    const price = dialog.getByLabel('단가(원)');
    await expect(price).toHaveValue('8400');
    await price.fill('8900');
    // 입고 화면에서 바로 ▲6% 안내
    await expect(dialog.getByText('직전 단가 8,400원 대비 ▲6% — 많이 올랐어요')).toBeVisible();
    await expect(dialog.getByLabel('거래처')).toHaveValue(String(await vendorId(ctx.request, '한빛덴탈')));
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText(/니트릴 글러브 M 입고 6박스을\(를\) 기록했어요/)).toBeVisible();

    // 상세: 단가 추이 표(2건, 최근 것이 ▲6%)와 그래프
    const prices = page.getByRole('table', { name: '니트릴 글러브 M 단가 기록' });
    await expect(prices.getByRole('row')).toHaveCount(3);
    await expect(prices.getByRole('row').nth(1)).toContainText('8,900원');
    await expect(prices.getByRole('row').nth(1)).toContainText('▲6%');
    await expect(prices.getByRole('row').nth(2)).toContainText('8,400원');
    await expect(page.getByRole('img', { name: /니트릴 글러브 M 입고 단가 추이\(원\): 8,400, 8,900/ })).toBeVisible();

    // 목록과 단가 변동 화면에도 ▲6%
    await page.goto(url('/inventory'));
    await expect(rowOf(page, '니트릴 글러브 M')).toContainText('8,900원');
    await expect(rowOf(page, '니트릴 글러브 M')).toContainText('▲6%');
    await page.goto(url('/inventory/prices'));
    await page.getByRole('button', { name: '많이 오른 것만' }).click();
    const t = page.getByRole('table', { name: '단가 기록' });
    await expect(t.getByRole('row')).toHaveCount(2);
    await expect(t.getByRole('row').nth(1)).toContainText('니트릴 글러브 M');
    await expect(t.getByRole('row').nth(1)).toContainText('▲6%');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-01 AC6: 입출고 기록이 있는 품목을 삭제하면 "사용 안 함"으로 바뀌고 목록 기본 필터에서 빠진다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory'));
    await rowOf(page, '쓰던 품목').click();
    await page.getByRole('button', { name: '삭제' }).click();
    const confirm = page.getByRole('dialog', { name: '품목을 삭제할까요?' });
    await expect(confirm).toContainText('입출고 기록이 1건 있어서 지우지 않고 "사용 안 함"으로 바꿔요');
    await confirm.getByRole('button', { name: '사용 안 함으로 바꾸기' }).click();
    await expect(page.getByText('입출고 기록이 있어 쓰던 품목을(를) "사용 안 함"으로 바꿨어요. 기록은 그대로 남아요.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '"사용 안 함"으로 바꾼 품목이에요' })).toBeVisible();
    await expect(page.getByRole('button', { name: '다시 사용' })).toBeVisible();

    await page.goto(url('/inventory'));
    await expect(rowOf(page, '니트릴 글러브 M')).toBeVisible();
    await expect(rowOf(page, '쓰던 품목')).toHaveCount(0);
    await page.getByRole('group', { name: '사용 여부' }).getByRole('button', { name: '사용 안 함' }).click();
    await expect(rowOf(page, '쓰던 품목')).toContainText('사용 안 함');
    expect((await itemApi(ctx.request, ids.used!)).active).toBe(false);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-01 AC7: 부족 품목이 생기면 manager에게 알림 1건(같은 날 중복 없음), 직원은 받지 않는다', async ({ browser }) => {
    // AC2에서 석션 팁을 부족으로 만들었다(같은 날 한 번 더 출고해도 늘지 않는다)
    const staff = await loggedIn(browser, STAFF);
    await post(staff.ctx.request, staff.csrf, '/api/inventory/moves', { itemId: ids.tip, type: 'out', qty: 1, force: true });
    const staffList = (await (await staff.ctx.request.get(url('/api/notifications'))).json()) as { data: Array<{ type: string }> };
    expect(staffList.data.filter((n) => n.type === 'stock_low')).toEqual([]);
    await staff.ctx.close();

    const { ctx } = await loggedIn(browser, MANAGER);
    const list = (await (await ctx.request.get(url('/api/notifications?pageSize=50'))).json()) as { data: Array<{ type: string; title: string; link: string }> };
    const tips = list.data.filter((n) => n.type === 'stock_low' && n.title === '석션 팁 (일회용) 재고가 부족해요');
    expect(tips).toHaveLength(1);
    expect(tips[0]?.link).toBe(`/inventory/items/${ids.tip}`);
    const page = await ctx.newPage();
    await page.goto(url('/notifications'));
    await expect(page.getByText('석션 팁 (일회용) 재고가 부족해요')).toHaveCount(1);
    await ctx.close();
  });

  test('phase-03-task-01 거래처: 실장은 거래처를 추가·수정하고, 직원은 보기만 한다', async ({ browser }) => {
    const m = await loggedIn(browser, MANAGER);
    const page = await m.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/vendors'));
    await expect(rowOf(page, '한빛덴탈')).toContainText('02-555-0101');
    await page.getByRole('button', { name: '거래처 추가' }).click();
    const form = page.getByRole('dialog', { name: '거래처 추가' });
    await form.getByLabel('상호').fill('미소치재');
    await form.getByLabel('담당자 이름').fill('이서연');
    await form.getByLabel('업무용 연락처').fill('02-555-0202');
    await form.getByLabel('주문 방법').fill('온라인 몰');
    await form.getByRole('button', { name: '저장' }).click();
    await expect(rowOf(page, '미소치재')).toContainText('온라인 몰');
    await page.reload();
    await expect(rowOf(page, '미소치재')).toContainText('이서연');
    expect(errors).toEqual([]);
    await m.ctx.close();

    const s = await loggedIn(browser, STAFF);
    const sp = await s.ctx.newPage();
    await sp.goto(url('/inventory/vendors'));
    await expect(rowOf(sp, '미소치재')).toBeVisible();
    await expect(sp.getByRole('button', { name: '거래처 추가' })).toHaveCount(0);
    await s.ctx.close();
  });

  for (const screen of [
    { name: '재고 현황', path: () => '/inventory', ready: '품목 목록' },
    { name: '품목 상세', path: () => `/inventory/items/${ids.resin}`, ready: '복합레진 A2 로트별 남은 수량' },
    { name: '입출고 기록', path: () => '/inventory/moves', ready: '입출고 기록' },
    { name: '거래처', path: () => '/inventory/vendors', ready: '거래처 목록' },
    { name: '단가 변동', path: () => '/inventory/prices', ready: '단가 기록' },
  ]) {
    test(`phase-03-task-01 화면 품질: ${screen.name} — axe 위반 0건, 휴대폰 너비 가로 스크롤 없음`, async ({ browser }) => {
      const { ctx } = await loggedIn(browser, MANAGER);
      const page = await ctx.newPage();
      const errors = watchErrors(page);
      await page.goto(url(screen.path()));
      await expect(page.getByRole('table', { name: screen.ready })).toBeVisible();
      const axe = await new AxeBuilder({ page }).analyze();
      expect(axeList(axe.violations)).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('table', { name: screen.ready })).toBeVisible();
      await noHorizontalScroll(page);
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test('phase-03-task-01 화면 품질: 출고·입고·품목 대화상자 axe 위반 0건', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    await page.goto(url('/inventory'));
    await page.getByRole('button', { name: '출고 기록' }).click();
    await expect(page.getByRole('dialog', { name: '출고 기록' }).getByRole('list', { name: '찾은 품목' }).getByRole('button').first()).toBeVisible();
    expect(axeList((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '품목 추가' }).click();
    await expect(page.getByRole('dialog', { name: '품목 추가' })).toBeVisible();
    expect(axeList((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.goto(url(`/inventory/items/${ids.glove}`));
    await page.getByRole('button', { name: '입고', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '입고 기록' })).toBeVisible();
    expect(axeList((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations)).toEqual([]);
    await ctx.close();
  });
});

/** 거래처 이름 → 번호 */
async function vendorId(req: APIRequestContext, name: string): Promise<number> {
  const r = (await (await req.get(url('/api/vendors'))).json()) as { data: Array<{ id: number; name: string }> };
  return r.data.find((v) => v.name === name)?.id ?? 0;
}

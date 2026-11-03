// 이 파일이 하는 일: 발주서 화면 E2E(phase-03-task-02 AC1~AC4). 이 파일 전용 격리 서버(tests/e2e/fixtures.ts)에서 실장이 API로 거래처 2곳·부족 품목 3개를 준비한 뒤,
// "발주서 만들기" → 거래처별 발주서 2건·권장 수량(AC1), 수량 수정 → 저장 → 새로 고침 뒤 유지 → 발주함 → 수정 불가(AC2),
// 입고 처리 → 재고 증가·입고 완료(AC3), 인쇄 화면 PDF가 A4 1쪽이고 병원명·거래처·품목·합계가 있으며 메뉴·버튼이 없는지(AC4)를 화면으로 확인한다.
// 화면마다 axe 위반 0건과 휴대폰 너비 가로 스크롤 없음, 직원의 권한 없음 안내도 본다. 서버 시계는 2026-11-02 09:00(KST)에 멈춰 있다.
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { extractText, getDocumentProxy } from 'unpdf';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'poadmin01', password: 'Po-Admin-Pass-01', withDemo: false };
const MANAGER = { name: '윤실장', username: 'pomgr0001', password: 'Po-Mgr-Pass-001' };
const STAFF = { name: '정직원', username: 'postaff01', password: 'Po-Staff-Pass-1' };

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;
/** 준비한 품목·발주서 번호 */
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

async function axe(page: Page, include?: string): Promise<string[]> {
  const b = new AxeBuilder({ page });
  return axeList((await (include ? b.include(include) : b).analyze()).violations);
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
async function post<T>(req: APIRequestContext, csrf: string, path: string, data: unknown): Promise<T> {
  const r = await req.post(url(path), { data, headers: { 'x-csrf-token': csrf } });
  expect(r.ok(), `${path} ${r.status()} ${await r.text()}`).toBe(true);
  return ((await r.json()) as { data: T }).data;
}

async function stockOf(req: APIRequestContext, id: number): Promise<number> {
  const r = await req.get(url(`/api/items/${id}`));
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: { stock: number } }).data.stock;
}

/** 가로 스크롤이 생겼는지 */
async function noHorizontalScroll(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
}

const rowOf = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

test.describe.serial('발주서: 자동 작성·수정·발주·입고·인쇄', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test('준비: 첫 설정, 실장·직원 계정, 거래처 2곳·부족 품목 3개·정상 품목 1개를 API로 만든다', async ({ request, browser, isoServer }) => {
    expect((await request.post('/api/setup', { data: ADMIN })).status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
    const { ctx, csrf } = await loggedIn(browser, MANAGER);
    const a = await post<{ id: number }>(ctx.request, csrf, '/api/vendors', { name: '한빛덴탈', contactName: '김도윤', phone: '02-555-0101', orderMethod: '전화 주문' });
    const b = await post<{ id: number }>(ctx.request, csrf, '/api/vendors', { name: '미소치재', contactName: '이서연', phone: '02-555-0202', orderMethod: '온라인 몰 주문' });
    const make = async (key: string, body: Record<string, unknown>, stock: number, unitPrice: number) => {
      const r = await post<{ item: { id: number } }>(ctx.request, csrf, '/api/items', { category: '소모품', unit: '박스', ...body });
      ids[key] = r.item.id;
      await post(ctx.request, csrf, '/api/inventory/moves', { itemId: r.item.id, type: 'in', qty: stock, unitPrice });
    };
    await make('glove', { name: '니트릴 글러브 M', par: 6, vendorId: a.id }, 2, 8400); // 권장 7
    await make('tip', { name: '석션 팁', par: 4, vendorId: a.id }, 1, 4200); // 권장 5
    await make('resin', { name: '복합레진 A2', par: 5, vendorId: b.id, category: '재료', unit: '개' }, 3, 32000); // 권장 ceil(4.5) = 5
    await make('mask', { name: '덴탈 마스크', par: 4, vendorId: a.id }, 10, 4500); // 정상
    ids.vendorA = a.id;
    await ctx.close();
  });

  test('phase-03-task-02 AC1: 부족 품목 3개(거래처 2곳)에서 "발주서 만들기" → 발주서 2건, 권장 수량 = ceil(적정×1.5−현재고)', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/orders'));
    await expect(page.getByRole('heading', { level: 1, name: '발주서' })).toBeVisible();
    await expect(page.getByText('진행 중인 발주서가 없어요')).toBeVisible();
    await page.getByRole('button', { name: '발주서 만들기' }).first().click();
    await expect(page.getByText('거래처별 발주서 2건을 만들었어요. 수량을 확인한 뒤 발주해 주세요.')).toBeVisible();

    const table = page.getByRole('table', { name: '발주서 목록' });
    await expect(table.getByRole('row')).toHaveCount(3); // 머리글 + 2건
    await expect(rowOf(page, '한빛덴탈')).toContainText('작성 중');
    await expect(rowOf(page, '한빛덴탈')).toContainText('2개');
    await expect(rowOf(page, '한빛덴탈')).toContainText('PO-2611-');
    await expect(rowOf(page, '미소치재')).toContainText('1개');
    await expect(rowOf(page, '미소치재')).toContainText('160,000원'); // 5 × 32,000
    expect(await axe(page)).toEqual([]);

    // 한빛덴탈 발주서: 권장 수량 7·5가 미리 채워지고 정상 품목은 없다
    await rowOf(page, '한빛덴탈').click();
    await expect(page).toHaveURL(/\/inventory\/orders\/\d+$/);
    ids.order = Number(page.url().split('/').pop());
    await expect(page.getByLabel('니트릴 글러브 M 발주 수량')).toHaveValue('7');
    await expect(page.getByLabel('석션 팁 발주 수량')).toHaveValue('5');
    await expect(page.getByLabel('덴탈 마스크 발주 수량')).toHaveCount(0);
    await expect(page.getByText('수량 12 · 합계 79,800원')).toBeVisible(); // 7×8,400 + 5×4,200
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-02 AC2: draft에서 수량 수정 후 발주함 → 상태 ordered, ordered 상태에서는 수정 불가', async ({ browser }) => {
    const { ctx, csrf } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url(`/inventory/orders/${ids.order}`));
    const glove = page.getByLabel('니트릴 글러브 M 발주 수량');
    await expect(glove).toHaveValue('7');

    // 잘못된 수량은 막는다
    await glove.fill('0');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('빨간 글씨로 표시한 수량을 고쳐 주세요.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '니트릴 글러브 M' }).getByText('수량은 0보다 크게 적어 주세요.')).toBeVisible();

    // 수량 10으로 고치고 저장 → 새로 고쳐도 남아 있다
    await glove.fill('10');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('발주서를 저장했어요.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('니트릴 글러브 M 발주 수량')).toHaveValue('10');
    await expect(page.getByText('수량 15 · 합계 105,000원')).toBeVisible();
    expect(await axe(page)).toEqual([]);

    // 발주함 → 확인 → 상태 "발주함", 수량 칸이 사라진다
    await page.getByRole('button', { name: '발주함', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: '발주함으로 바꿀까요?' });
    await expect(confirm).toContainText('합계 105,000원');
    await confirm.getByRole('button', { name: '발주함' }).click();
    await expect(page.getByText(/"발주함"으로 바꿨어요\. 이제 수량은 고칠 수 없어요\./)).toBeVisible();
    await expect(page.getByRole('region', { name: '발주서 요약' })).toContainText('발주함');
    await expect(page.getByLabel('니트릴 글러브 M 발주 수량')).toHaveCount(0);
    await expect(page.getByRole('table', { name: '발주 품목' })).toContainText('10박스');
    await expect(page.getByRole('button', { name: '입고 처리' })).toBeVisible();

    // 발주한 뒤에는 API로도 고칠 수 없다(409)
    const r = await ctx.request.patch(url(`/api/orders/${ids.order}`), { data: { lines: [{ itemId: ids.glove, qty: 99 }] }, headers: { 'x-csrf-token': csrf } });
    expect(r.status()).toBe(409);
    expect(((await r.json()) as { error: { message: string } }).error.message).toBe('이 발주서는 지금 "발주함" 상태라 고칠 수 없어요.');
    const d = (await (await ctx.request.get(url(`/api/orders/${ids.order}`))).json()) as { data: { status: string } };
    expect(d.data.status).toBe('ordered');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-02 AC4: 인쇄 화면을 PDF로 저장하면 1쪽 A4에 병원명·거래처·품목·합계가 있고 메뉴·버튼이 없다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url(`/inventory/orders/${ids.order}`));
    await page.getByRole('link', { name: '인쇄 미리보기' }).click();
    await expect(page).toHaveURL(new RegExp(`/print/order/${ids.order}$`));
    const paper = page.getByTestId('print-order');
    await expect(paper).toContainText('하늘숲치과');
    await expect(paper).toContainText('한빛덴탈');
    await expect(paper).toContainText('니트릴 글러브 M');
    await expect(paper).toContainText('105,000원');
    await expect(page.getByRole('button', { name: '인쇄하기' })).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0); // 셸(메뉴) 없음
    expect(await axe(page)).toEqual([]);

    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4' });
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    expect(doc.numPages).toBe(1);
    const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
    const mm = (pt: number) => (pt * 25.4) / 72;
    expect(Math.abs(mm(vp.width) - 210)).toBeLessThan(1);
    expect(Math.abs(mm(vp.height) - 297)).toBeLessThan(1);
    const { text } = await extractText(doc, { mergePages: true });
    const flat = (text as string).replace(/\s+/g, ' ');
    for (const want of ['하늘숲치과', '한빛덴탈', '니트릴 글러브 M', '석션 팁', '합계', '105,000', 'PO-2611-', '1 / 1']) expect(flat, want).toContain(want);
    for (const no of ['인쇄하기', '닫기', '재고·구매', '대시보드', '로그아웃', '인쇄 미리보기예요']) expect(flat, no).not.toContain(no);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-02 AC3: 입고 처리 시 발주 품목이 입고 기록으로 들어가 재고가 증가하고 상태 received', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    expect(await stockOf(ctx.request, ids.glove ?? 0)).toBe(2);
    await page.goto(url(`/inventory/orders/${ids.order}`));
    await page.getByRole('button', { name: '입고 처리' }).click();
    const dialog = page.getByRole('dialog', { name: '입고 처리' });
    await expect(dialog.getByRole('group', { name: /니트릴 글러브 M/ }).getByLabel('들어온 수량(박스)')).toHaveValue('10');
    expect(await axe(page, 'dialog[open]')).toEqual([]);
    // 글러브는 단가가 올라 8,900원, 석션 팁은 이번에 3박스만 왔다
    await dialog.getByRole('group', { name: /니트릴 글러브 M/ }).getByLabel('단가(원)').fill('8900');
    await dialog.getByRole('group', { name: /석션 팁/ }).getByLabel('들어온 수량(박스)').fill('3');
    await dialog.getByRole('button', { name: '입고 기록 저장' }).click();
    await expect(page.getByText('입고 처리했어요. 품목 2개가 재고에 더해졌어요.')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('region', { name: '발주서 요약' })).toContainText('입고 완료');
    await expect(page.getByRole('button', { name: '입고 처리' })).toHaveCount(0);
    const lines = page.getByRole('table', { name: '발주 품목' });
    await expect(lines.getByRole('row').filter({ hasText: '석션 팁' })).toContainText('3박스');

    // 재고가 늘고, 입출고 기록에 입고로 남는다(2 → 12, 1 → 4)
    expect(await stockOf(ctx.request, ids.glove ?? 0)).toBe(12);
    expect(await stockOf(ctx.request, ids.tip ?? 0)).toBe(4);
    await page.goto(url('/inventory/moves'));
    await expect(rowOf(page, '니트릴 글러브 M').first()).toContainText('입고');
    await expect(rowOf(page, '니트릴 글러브 M').first()).toContainText('10박스');
    // 단가 변동 기록: 8,400 → 8,900 ▲6%
    await page.goto(url('/inventory/prices'));
    await expect(rowOf(page, '니트릴 글러브 M').first()).toContainText('▲6%');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-02: 휴대폰 너비에서 가로 스크롤이 없고, 직원은 발주서 화면에서 권한 없음 안내를 본다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER, { width: 390, height: 844 });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/orders'));
    await page.getByRole('group', { name: '상태' }).getByRole('button', { name: '전체' }).click();
    await expect(page.getByRole('table', { name: '발주서 목록' })).toContainText('입고 완료');
    await noHorizontalScroll(page);
    await page.goto(url(`/inventory/orders/${ids.order}`));
    await expect(page.getByRole('table', { name: '발주 품목' })).toBeVisible();
    await noHorizontalScroll(page);
    // 아직 작성 중인 미소치재 발주서(편집 화면)도 휴대폰에서 넘치지 않는다
    const list = (await (await ctx.request.get(url('/api/orders?status=draft'))).json()) as { data: Array<{ id: number }> };
    await page.goto(url(`/inventory/orders/${list.data[0]?.id}`));
    await expect(page.getByLabel('복합레진 A2 발주 수량')).toHaveValue('5');
    await noHorizontalScroll(page);
    expect(await axe(page)).toEqual([]);
    await page.goto(url(`/print/order/${ids.order}`));
    await expect(page.getByTestId('print-order')).toContainText('니트릴 글러브 M');
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
    await ctx.close();

    const staff = await loggedIn(browser, STAFF);
    const sp = await staff.ctx.newPage();
    await sp.goto(url('/inventory/orders'));
    await expect(sp.getByRole('heading', { level: 1, name: '권한 없음' })).toBeVisible();
    expect((await staff.ctx.request.get(url('/api/orders'))).status()).toBe(403);
    await staff.ctx.close();
  });
});

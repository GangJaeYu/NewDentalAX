// 이 파일이 하는 일: 지출 기록·월간 요약 화면 E2E(phase-04-task-04 AC1~AC4). 이 파일 전용 격리 서버(tests/e2e/fixtures.ts)를 가짜 LLM 서버(tests/fake-llm)에 연결한다.
// AC1 직원은 메뉴에 "운영 지표"가 없고 주소로 들어가면 "권한 없음", API는 403. 실장은 화면에서 지출을 기록(영수증 PDF 첨부)·고치고 새로 고쳐도 남는지 본다.
// AC2 발주 입고 대화상자에서 "지출로도 기록" → 지출 목록에 합계 금액·거래처·재료비 1건. AC3 월간 요약 합계 = 그 달 지출 합계(API·DB), 지출 없는 달은 빈 상태.
// AC4 "AI 이번 달 요약" → 가짜 서버가 받은 요청 본문에 메모 글이 없고 집계 숫자만 있다. 화면마다 axe 위반 0건, 휴대폰 너비 가로 스크롤 없음도 본다.
// 서버 시계는 2026-11-02 09:00(KST)에 멈춰 있다. 가짜 키는 가짜 서버로만 간다.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startFakeLlm, type FakeLlm } from '../fake-llm/server.ts';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const KEY = 'sk-ant-e2e-ONLYFAKE-finance-9Wm2';
const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'finadmin01', password: 'Fin-Admin-Pass-01', withDemo: false };
const MANAGER = { name: '윤실장', username: 'finmgr001', password: 'Fin-Mgr-Pass-001' };
const STAFF = { name: '정직원', username: 'finstaff01', password: 'Fin-Staff-Pass-1' };
const SECRET_MEMO = '원장님 개인 메모 비밀글 4417';

let server: IsoServer;
let fake: FakeLlm;
const url = (p: string) => `${server.baseURL}${p}`;
const ids: Record<string, number> = {};

test.beforeAll(async () => {
  fake = await startFakeLlm();
});

test.afterAll(async () => {
  await fake.close();
});

/** 이 파일의 테스트 서버가 가짜 LLM 서버 주소를 쓰게 한다(처음 한 번 다시 켬) */
test.beforeEach(async ({ isoServer }) => {
  server = isoServer;
  if (isoServer.extraEnv.AI_BASE_URL_ANTHROPIC === fake.url) return;
  isoServer.extraEnv = { AI_BASE_URL_ANTHROPIC: fake.url, AI_BASE_URL_OPENAI: fake.url, AI_BASE_URL_GEMINI: fake.url };
  await isoServer.stop();
  await isoServer.start();
});

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

async function axe(page: Page, include?: string): Promise<string[]> {
  const b = new AxeBuilder({ page });
  const r = await (include ? b.include(include) : b).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** 새 브라우저 묶음을 만들고 API로 로그인해 둔다. CSRF 토큰도 돌려준다 */
async function loggedIn(browser: Browser, who: { username: string; password: string }, viewport = { width: 1440, height: 900 }): Promise<{ ctx: BrowserContext; csrf: string }> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  return { ctx, csrf: ((await r.json()) as { data: { csrfToken: string } }).data.csrfToken };
}

async function send<T>(req: APIRequestContext, csrf: string, method: 'post' | 'put', p: string, data: unknown): Promise<T> {
  const r = await req[method](url(p), { data, headers: { 'x-csrf-token': csrf } });
  expect(r.ok(), `${p} ${r.status()} ${await r.text()}`).toBe(true);
  return ((await r.json()) as { data: T }).data;
}

/** 서버 DB를 읽기 전용으로 열어 한 값을 읽는다(SQL 결과와 화면 숫자 대조용) */
function dbValue(sql: string): number {
  const db = new DatabaseSync(path.join(server.dataDir, 'app.db'), { readOnly: true });
  try {
    return Number((db.prepare(sql).get() as { v: number | null }).v ?? 0);
  } finally {
    db.close();
  }
}

async function noHorizontalScroll(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
}

const rowOf = (page: Page, text: string) => page.getByRole('table', { name: '지출 목록' }).getByRole('row').filter({ hasText: text });

test.describe.serial('지출 기록·월간 요약', () => {
  test('준비: 첫 설정, 실장·직원 계정, 거래처·부족 품목·발주함 발주서, AI 공급자(가짜 키)를 API로 만든다', async ({ request, browser, isoServer }) => {
    expect((await request.post('/api/setup', { data: ADMIN })).status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
    const admin = await loggedIn(browser, ADMIN);
    await send(admin.ctx.request, admin.csrf, 'put', '/api/ai/settings', { provider: 'anthropic', keys: { anthropic: KEY } });
    await admin.ctx.close();

    const { ctx, csrf } = await loggedIn(browser, MANAGER);
    const v = await send<{ id: number }>(ctx.request, csrf, 'post', '/api/vendors', { name: '한빛덴탈', phone: '02-555-0101' });
    const make = async (name: string, par: number, stock: number, unitPrice: number) => {
      const r = await send<{ item: { id: number } }>(ctx.request, csrf, 'post', '/api/items', { name, category: '소모품', unit: '박스', par, vendorId: v.id });
      await send(ctx.request, csrf, 'post', '/api/inventory/moves', { itemId: r.item.id, type: 'in', qty: stock, unitPrice });
      return r.item.id;
    };
    ids.glove = await make('니트릴 글러브 M', 6, 2, 8400); // 권장 7
    ids.tip = await make('석션 팁', 4, 1, 4200); // 권장 5
    const drafts = await send<{ orders: Array<{ id: number }> }>(ctx.request, csrf, 'post', '/api/orders/draft', {});
    ids.order = drafts.orders[0]?.id ?? 0;
    await send(ctx.request, csrf, 'post', `/api/orders/${ids.order}/order`, {});
    // 지난달 지출(월간 비교용)
    const cats = (await (await ctx.request.get(url('/api/expense-categories'))).json()) as { data: Array<{ id: number; name: string }> };
    for (const c of cats.data) ids[`cat:${c.name}`] = c.id;
    await send(ctx.request, csrf, 'post', '/api/expenses', { date: '2026-10-01', categoryId: ids['cat:임대료'], amount: 3300000, payMethod: 'transfer', vendorName: '하늘빌딩' });
    await send(ctx.request, csrf, 'post', '/api/expenses', { date: '2026-10-07', categoryId: ids['cat:재료비'], amount: 612000, payMethod: 'card', vendorName: '미소치재', memo: SECRET_MEMO });
    await ctx.close();
  });

  test('phase-04-task-04 AC1: 직원은 지출 메뉴가 없고, 주소로 들어가면 "권한 없음", API는 403이다', async ({ browser }) => {
    const { ctx, csrf } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/'));
    const nav = page.getByRole('navigation', { name: '주 메뉴' });
    await expect(nav.locator('a[href="/inventory"]').first()).toBeAttached();
    await expect(nav.locator('a[href="/finance/expenses"]')).toHaveCount(0);
    await expect(nav.locator('a[href="/finance/monthly"]')).toHaveCount(0);
    await expect(nav.getByText('운영 지표')).toHaveCount(0);
    for (const p of ['/finance/expenses', '/finance/monthly']) {
      await page.goto(url(p));
      await expect(page.getByRole('heading', { level: 1, name: '권한 없음' })).toBeVisible();
      await expect(page.getByText('이 화면을 볼 권한이 없어요')).toBeVisible();
    }
    for (const p of ['/api/expenses', '/api/expense-categories', '/api/finance/monthly?month=2026-10', '/api/expenses?format=csv']) {
      expect((await ctx.request.get(url(p))).status(), p).toBe(403);
    }
    const post = await ctx.request.post(url('/api/expenses'), { data: { date: '2026-11-01', categoryId: 1, amount: 1000, payMethod: 'card' }, headers: { 'x-csrf-token': csrf } });
    expect(post.status()).toBe(403);
    expect(((await post.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    expect(errors).toEqual([]);
    await ctx.close();

    // 실장에게는 메뉴가 보인다
    const m = await loggedIn(browser, MANAGER);
    const mp = await m.ctx.newPage();
    await mp.goto(url('/'));
    // 실장에게는 "운영 지표" 묶음과 지출 기록 링크가 보인다(묶음 아이콘 링크도 같은 주소라 1개 이상)
    await expect(mp.getByRole('navigation', { name: '주 메뉴' }).locator('a[href="/finance/expenses"]').first()).toBeAttached();
    await expect(mp.getByRole('navigation', { name: '주 메뉴' }).locator('a[href="/finance/monthly"]').first()).toBeAttached();
    await m.ctx.close();
  });

  test('실장이 화면에서 지출을 기록(영수증 PDF 첨부)·고치면 새로 고쳐도 남고, CSV로 내려받는다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/finance/expenses'));
    await expect(page.getByRole('heading', { level: 1, name: '지출 기록' })).toBeVisible();
    await expect(page.getByRole('group', { name: '달 고르기' })).toContainText('2026년 11월');
    await expect(page.getByText('2026년 11월에 기록한 지출이 없어요')).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await page.getByRole('button', { name: '지출 기록', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '지출 기록' });
    // 빈 금액은 막는다
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog.getByText('금액을 1원 이상 숫자로 적어 주세요.')).toBeVisible();
    await dialog.getByLabel('날짜').fill('2026-11-01');
    await dialog.getByLabel('분류').selectOption({ label: '공과금' });
    await dialog.getByLabel('금액(원)').fill('412,000');
    await dialog.getByLabel('결제 수단').selectOption({ label: '계좌이체' });
    await dialog.getByLabel('거래처').fill('한국전력');
    await dialog.getByLabel('메모').fill('10월분 전기 요금');
    await dialog.locator('input[type="file"]').setInputFiles({ name: '전기요금.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% 시험용 영수증\n%%EOF\n') });
    await expect(dialog.getByText('저장하면 올라가요')).toBeVisible();
    expect(await axe(page, 'dialog[open]')).toEqual([]);
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('412,000원 지출을 기록했어요.')).toBeVisible();
    await expect(rowOf(page, '한국전력')).toContainText('공과금');
    await expect(rowOf(page, '한국전력')).toContainText('계좌이체');
    await expect(rowOf(page, '한국전력')).toContainText('첨부');

    // 새로 고쳐도 남고, 고치면 바뀐다
    await page.reload();
    await rowOf(page, '한국전력').click();
    const edit = page.getByRole('dialog', { name: '지출 고치기' });
    await expect(edit.getByRole('link', { name: '전기요금.pdf' })).toBeVisible();
    await edit.getByLabel('금액(원)').fill('415000');
    await edit.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('지출을 고쳤어요.')).toBeVisible();
    await expect(rowOf(page, '한국전력')).toContainText('415,000원');
    await expect(page.getByRole('region', { name: '이 달 지출 요약' })).toContainText('415,000');

    // CSV(UTF-8 BOM)
    const href = await page.getByRole('link', { name: 'CSV 내려받기' }).getAttribute('href');
    const csv = await ctx.request.get(url(href ?? ''));
    expect(csv.status()).toBe(200);
    const bytes = await csv.body();
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf8')).toContain('2026-11-01,공과금,한국전력,415000,계좌이체,10월분 전기 요금,있음');

    // 휴대폰 너비에서도 가로 스크롤 없음
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-04 AC2: 발주 입고 때 "지출로도 기록"을 고르면 지출 목록에 합계 금액·거래처·재료비 분류로 1건이 생긴다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url(`/inventory/orders/${ids.order}`));
    await page.getByRole('button', { name: '입고 처리' }).click();
    const dialog = page.getByRole('dialog', { name: '입고 처리' });
    await dialog.getByRole('group', { name: /석션 팁/ }).getByLabel('들어온 수량(박스)').fill('3');
    const also = dialog.getByLabel('지출로도 기록');
    await expect(also).not.toBeChecked();
    await also.check();
    // 7 × 8,400 + 3 × 4,200 = 71,400원
    await expect(dialog.getByText('입고 합계 71,400원을(를) 재료비 지출 1건으로 남겨요(거래처: 한빛덴탈).')).toBeVisible();
    await dialog.getByLabel('결제 수단').selectOption({ label: '카드' });
    expect(await axe(page, 'dialog[open]')).toEqual([]);
    await dialog.getByRole('button', { name: '입고 기록 저장' }).click();
    await expect(page.getByText('입고 처리했어요. 품목 2개가 재고에 더해졌어요. 지출 71,400원(재료비)도 기록했어요.')).toBeVisible();
    await expect(page.getByRole('region', { name: '발주서 요약' })).toContainText('입고 완료');

    await page.goto(url('/finance/expenses'));
    const row = rowOf(page, '한빛덴탈');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('재료비');
    await expect(row).toContainText('발주 입고');
    await expect(row).toContainText('71,400원');
    await expect(row).toContainText('카드');
    expect(dbValue(`SELECT COUNT(*) AS v FROM expenses WHERE stock_move_ref = 'order:${ids.order}' AND deleted_at IS NULL`)).toBe(1);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-04 AC3: 월간 요약 숫자가 그 달 지출 합계 SQL과 같고, 지출이 없는 달은 빈 상태 안내를 보인다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/finance/monthly'));
    await expect(page.getByRole('heading', { level: 1, name: '월간 요약' })).toBeVisible();
    const kpis = page.getByRole('region', { name: '이 달 지출 요약 숫자' });
    const nov = dbValue("SELECT SUM(amount) AS v FROM expenses WHERE deleted_at IS NULL AND date BETWEEN '2026-11-01' AND '2026-11-30'");
    expect(nov).toBe(415000 + 71400);
    await expect(kpis).toContainText(`2026년 11월 지출 합계${nov.toLocaleString('ko-KR')}원`);
    await expect(page.getByRole('table', { name: '분류별 지출' })).toContainText('공과금');
    await expect(page.getByRole('table', { name: '거래처별 지출 상위 5곳' })).toContainText('한국전력');
    await expect(page.getByRole('img', { name: /최근 12개월 재료비/ })).toBeVisible();
    expect(await axe(page)).toEqual([]);

    // 지난달(10월)
    await page.getByRole('button', { name: '이전 달' }).click();
    const oct = dbValue("SELECT SUM(amount) AS v FROM expenses WHERE deleted_at IS NULL AND date BETWEEN '2026-10-01' AND '2026-10-31'");
    await expect(kpis).toContainText(`2026년 10월 지출 합계${oct.toLocaleString('ko-KR')}원`);
    await expect(page.getByRole('table', { name: '분류별 지출' })).toContainText('임대료');

    // 지출이 없는 달(9월)
    await page.getByRole('button', { name: '이전 달' }).click();
    await expect(page.getByText('2026년 9월에는 지출 기록이 없어요')).toBeVisible();
    await expect(page.getByRole('link', { name: '지출 기록하러 가기' })).toBeVisible();
    await expect(kpis).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-04 AC4: "AI 이번 달 요약" 요청 본문(가짜 서버 수신)에 개별 메모 글이 없고 집계 숫자만 있다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    fake.setReply('지난달보다 재료비가 늘었어요. 자주 쓰는 재료는 묶음 주문을 권해요.', { input: 300, output: 50 });
    const before = fake.requests.length;
    await page.goto(url('/finance/monthly'));
    await page.getByRole('button', { name: '이전 달' }).click();
    await expect(page.getByText('2026년 10월 지출 합계')).toBeVisible();
    await expect(page.getByText('지출 메모와 영수증은 보내지 않아요.')).toBeVisible();
    await page.getByRole('button', { name: 'AI 이번 달 요약' }).click();
    const result = page.getByTestId('monthly-ai-result');
    await expect(result).toContainText('지난달보다 재료비가 늘었어요. 자주 쓰는 재료는 묶음 주문을 권해요.');
    await expect(result).toContainText('AI 응답');
    await expect(result).toContainText('AI 초안은 참고용이며 법률 자문을 대신하지 않습니다.');
    expect(fake.requests.length).toBe(before + 1);
    const sent = fake.requests.at(-1)?.rawBody ?? '';
    for (const no of [SECRET_MEMO, '4417', '10월분 전기 요금', '2026-10-07']) expect(sent, no).not.toContain(no);
    expect(sent).toContain('이번 달 지출 합계(원): 3912000');
    expect(sent).toContain('분류 재료비 합계(원): 612000');
    expect(sent).toContain('거래처 1위 하늘빌딩 합계(원): 3300000');
    // 화면의 "보낸 숫자 보기"에도 숫자만 있다
    await result.getByText(/보낸 숫자 보기/).click();
    await expect(result.locator('.fin-sent li').first()).toContainText('이번 달 지출 합계(원)');
    await expect(result).not.toContainText(SECRET_MEMO);
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

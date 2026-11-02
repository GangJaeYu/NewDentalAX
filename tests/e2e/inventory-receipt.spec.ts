// 이 파일이 하는 일: "명세서 사진으로 입고" 화면 E2E(phase-04-task-08 AC1~AC5). 이 파일 전용 격리 서버(tests/e2e/fixtures.ts)를 데모 데이터로 시작하고,
// 뒤쪽 테스트는 가짜 LLM 서버(tests/fake-llm)에 연결한다. 실제 4000×3000 JPEG(tests/fixtures/receipt/statement-4000x3000.jpg)를 브라우저에서 고르게 해
// 브라우저 축소 → 서버가 받은 사진 크기(응답·저장 파일 머리) ≤ 1600px를 본다. 확인 체크 전 버튼 꺼짐, 품목 후보·입고·지출(실장만), 카드번호 가림 안내,
// 이미지 미지원 모델 비활성 안내, 화면별 axe 위반 0건과 휴대폰 너비 가로 스크롤 없음도 본다. 서버 시계는 2026-11-02 09:00(KST)에 멈춰 있다. 가짜 키는 가짜 서버로만 간다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startFakeLlm, type FakeLlm } from '../fake-llm/server.ts';
import { readImageSize } from '../../server/modules/inventory/receipt-image.ts';
import { fakeJpeg } from '../fixtures/receipt/images.ts';
import { expect, test, type IsoServer } from './fixtures.ts';

const KEY = 'sk-ant-e2e-ONLYFAKE-receipt-3Rk8';
const PHOTO = path.join(process.cwd(), 'tests', 'fixtures', 'receipt', 'statement-4000x3000.jpg');
const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'rcadmin001', password: 'Rc-Admin-Pass-001', withDemo: true };
const MANAGER = { name: '윤실장', username: 'rcmgr0001', password: 'Rc-Mgr-Pass-0001' };
const STAFF = { name: '정직원', username: 'rcstaff001', password: 'Rc-Staff-Pass-01' };

let server: IsoServer;
let fake: FakeLlm;
const url = (p: string) => `${server.baseURL}${p}`;

test.beforeAll(async () => {
  fake = await startFakeLlm();
});

test.afterAll(async () => {
  await fake.close();
});

/** 이 파일의 테스트 서버가 가짜 LLM 서버 주소를 쓰게 한다(처음 한 번 다시 켬). 공급자는 관리자가 바꾸기 전까지 데모다 */
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

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** 새 브라우저 묶음을 만들고 API로 로그인해 둔다. CSRF 토큰도 돌려준다 */
async function loggedIn(browser: Browser, who: { username: string; password: string }, viewport = { width: 1440, height: 900 }): Promise<{ ctx: BrowserContext; csrf: string }> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  return { ctx, csrf: ((await r.json()) as { data: { csrfToken: string } }).data.csrfToken };
}

async function send(req: APIRequestContext, csrf: string, method: 'post' | 'put', p: string, data: unknown): Promise<void> {
  const r = await req[method](url(p), { data, headers: { 'x-csrf-token': csrf } });
  expect(r.ok(), `${p} ${r.status()} ${await r.text()}`).toBe(true);
}

/** 서버 DB를 읽기 전용으로 열어 질의 결과를 돌려준다 */
function dbAll<T>(sql: string, params: Array<string | number> = []): T[] {
  const db = new DatabaseSync(path.join(server.dataDir, 'app.db'), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

async function noHorizontalScroll(page: Page): Promise<void> {
  expect((await page.evaluate('document.documentElement.scrollWidth > window.innerWidth')) as boolean).toBe(false);
}

/** 화면에서 사진을 고르고 확인 체크 → "AI로 읽기"를 누른 뒤 서버 응답 본문을 돌려준다 */
async function pickAndRead(page: Page): Promise<{ status: number; body: { data?: { fileId: number; image: { width: number; height: number } } } }> {
  await page.locator('input[type="file"]').setInputFiles(PHOTO);
  await expect(page.getByTestId('receipt-picked')).toContainText('1600×1200px');
  const send = page.getByRole('button', { name: 'AI로 읽기' });
  await expect(send).toBeDisabled();
  await page.getByLabel('사진에 환자 정보·카드번호가 보이지 않는 것을 확인했어요').check();
  await expect(send).toBeEnabled();
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/ai/receipt') && r.request().method() === 'POST'), send.click()]);
  return { status: res.status(), body: (await res.json()) as { data?: { fileId: number; image: { width: number; height: number } } } };
}

test.describe.serial('명세서 사진으로 입고', () => {
  test('준비: 첫 설정(데모 데이터 포함), 실장·직원 계정을 만든다', async ({ request, isoServer }) => {
    expect((await request.post('/api/setup', { data: ADMIN })).status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
    expect(dbAll<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE name = '니트릴 글러브 M'")[0]?.n).toBe(1);
  });

  test('phase-04-task-08 AC1·AC2: 경고가 보이고 확인 체크 전에는 전송 버튼이 꺼져 있으며, 4000×3000 사진은 서버에 긴 변 1600px 이하로 도착한다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/receipt'));
    await expect(page.getByRole('heading', { level: 1, name: '명세서 사진으로 입고' })).toBeVisible();
    await expect(page.getByTestId('receipt-warning')).toContainText('환자 정보·카드번호가 보이면 가리고 올리세요');
    await expect(page.getByText('데모 모드: 예시 명세서 결과가 나와요')).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI로 읽기' })).toBeDisabled();
    expect(await axe(page), '올리기 화면').toEqual([]);

    expect(fs.statSync(PHOTO).size).toBeGreaterThan(100_000);
    expect(readImageSize(fs.readFileSync(PHOTO))).toMatchObject({ width: 4000, height: 3000 });
    const r = await pickAndRead(page);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const img = r.body.data?.image;
    expect(Math.max(img?.width ?? 9999, img?.height ?? 9999)).toBeLessThanOrEqual(1600);
    expect(img).toMatchObject({ width: 1600, height: 1200 });
    // 서버에 저장된 사진 파일의 머리도 1600×1200이다
    const file = dbAll<{ stored_path: string; purpose: string }>('SELECT stored_path, purpose FROM files WHERE id = ?', [r.body.data?.fileId ?? 0])[0];
    expect(file?.purpose).toBe('receipt');
    const stored = fs.readFileSync(path.join(server.dataDir, 'uploads', ...(file?.stored_path ?? '').split('/')));
    expect(readImageSize(stored)).toMatchObject({ width: 1600, height: 1200, format: 'jpeg' });
    // 직원에게는 "지출로도 기록"이 없다
    await expect(page.getByRole('heading', { name: '2. 읽은 내용 확인·수정' })).toBeVisible();
    await expect(page.getByText('지출로도 기록')).toHaveCount(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-08 AC3: 데모 결과의 각 줄에 기존 품목 후보가 보이고, 실장이 확인 후 저장하면 입고 기록과 지출이 생긴다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/receipt'));
    const r = await pickAndRead(page);
    expect(r.status).toBe(200);
    const fileId = r.body.data?.fileId ?? 0;
    await expect(page.getByText('데모 응답').first()).toBeVisible();
    // 줄마다 후보 칩과 미리 고른 품목
    const expected = [
      ['니트릴 글러브 M (100매)', '니트릴 글러브 M'],
      ['석션팁 일회용', '석션 팁 (일회용)'],
      ['거즈 2x2 (200매)', '거즈 2×2'],
    ] as const;
    for (const [i, [readName, item]] of expected.entries()) {
      const line = page.getByTestId(`receipt-line-${i}`);
      await expect(line).toContainText(readName);
      await expect(line.getByLabel('비슷한 품목 후보')).toContainText(item);
      await expect(line.getByLabel('연결할 품목').locator('option:checked')).toHaveText(new RegExp(`^${item.replace(/[()]/g, '\\$&')} `));
    }
    await expect(page.getByLabel('거래처')).toHaveValue(/\d+/);
    await expect(page.getByLabel('거래처').locator('option:checked')).toHaveText('한빛덴탈');
    // 수량 하나를 고친다(10 → 12)
    await page.getByTestId('receipt-line-0').getByLabel('수량').fill('12');
    await expect(page.getByTestId('receipt-total')).toHaveText('134,600원');
    await expect(page.getByText('금액이 달라요')).toBeVisible();
    expect(await axe(page), '확인 화면').toEqual([]);

    const movesBefore = dbAll<{ n: number }>("SELECT COUNT(*) AS n FROM stock_moves WHERE reason LIKE '명세서 사진 입고%'")[0]?.n ?? 0;
    await page.getByText('지출로도 기록').click();
    await page.getByLabel('결제 수단').selectOption('card');
    await page.getByRole('button', { name: '입고 저장' }).click();
    await expect(page.getByTestId('receipt-saved')).toContainText('입고 3줄');
    await expect(page.getByTestId('receipt-saved')).toContainText('지출 134,600원(재료비, 영수증 사진 첨부)');

    const moves = dbAll<{ name: string; qty: number; unit_price: number; vendor: string }>(
      "SELECT i.name, m.qty, m.unit_price, v.name AS vendor FROM stock_moves m JOIN items i ON i.id = m.item_id LEFT JOIN vendors v ON v.id = m.vendor_id WHERE m.reason LIKE '명세서 사진 입고%' ORDER BY m.id",
    );
    expect(moves.length - movesBefore).toBe(3);
    expect(moves.slice(-3)).toEqual([
      { name: '니트릴 글러브 M', qty: 12, unit_price: 8400, vendor: '한빛덴탈' },
      { name: '석션 팁 (일회용)', qty: 5, unit_price: 4200, vendor: '한빛덴탈' },
      { name: '거즈 2×2', qty: 4, unit_price: 3200, vendor: '한빛덴탈' },
    ]);
    const ex = dbAll<{ amount: number; pay_method: string; file_id: number; vendor_name: string; code: string }>(
      'SELECT e.amount, e.pay_method, e.file_id, e.vendor_name, c.code FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.stock_move_ref = ?',
      [`receipt:${fileId}`],
    );
    expect(ex).toEqual([{ amount: 134600, pay_method: 'card', file_id: fileId, vendor_name: '한빛덴탈', code: 'material' }]);

    // 새로 고쳐도 입출고 기록 화면에 남아 있다
    await page.goto(url('/inventory/moves'));
    await expect(page.getByText('명세서 사진 입고(2026-11-02)').first()).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-08 AC3: 직원은 입고만 저장되고 지출은 생기지 않는다(휴대폰 너비, 가로 스크롤 없음)', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, STAFF, { width: 390, height: 844 });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/receipt'));
    await noHorizontalScroll(page);
    const r = await pickAndRead(page);
    expect(r.status).toBe(200);
    const fileId = r.body.data?.fileId ?? 0;
    await expect(page.getByTestId('receipt-line-2')).toBeVisible();
    await noHorizontalScroll(page);
    // 셋째 줄은 입고하지 않는다
    await page.getByTestId('receipt-line-2').getByLabel('연결할 품목').selectOption('skip');
    await page.getByRole('button', { name: '입고 저장' }).click();
    await expect(page.getByTestId('receipt-saved')).toContainText('입고 2줄');
    await expect(page.getByTestId('receipt-saved')).not.toContainText('지출');
    expect(dbAll<{ n: number }>('SELECT COUNT(*) AS n FROM expenses WHERE stock_move_ref = ?', [`receipt:${fileId}`])[0]?.n).toBe(0);
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-08 AC4: 가짜 공급자가 카드번호가 든 글을 돌려주면 화면에 가려진 채 표시되고 안내가 보인다', async ({ browser }) => {
    const admin = await loggedIn(browser, ADMIN);
    await send(admin.ctx.request, admin.csrf, 'put', '/api/ai/settings', { provider: 'anthropic', keys: { anthropic: KEY } });
    await admin.ctx.close();
    fake.setReply(
      JSON.stringify({
        vendorName: '미소치재',
        date: '2026-11-01',
        lines: [
          { name: '카드 4111-1111-1111-1111 일시불', qty: 1, unitPrice: 0, amount: 0 },
          { name: '복합레진 A2', qty: 2, unitPrice: 32000, amount: 64000 },
        ],
        total: 64000,
      }),
      { input: 1500, output: 120 },
    );
    const { ctx } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/receipt'));
    await expect(page.getByText('데모 모드: 예시 명세서 결과가 나와요')).toHaveCount(0);
    const before = fake.requests.length;
    const r = await pickAndRead(page);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(fake.requests.length).toBe(before + 1);
    expect(fake.requests.at(-1)?.rawBody ?? '').toContain('"media_type":"image/jpeg"');
    await expect(page.getByTestId('receipt-line-0')).toContainText('카드 [카드번호] 일시불');
    await expect(page.getByTestId('receipt-privacy-notice')).toHaveText('읽은 글에 카드번호 1건이 있어 가린 채 보여 드려요. 다음부터는 사진의 해당 부분을 가리고 올려 주세요.');
    expect(await page.locator('main').innerText()).not.toContain('4111');
    await expect(page.getByTestId('receipt-line-1').getByLabel('연결할 품목').locator('option:checked')).toHaveText(/^복합레진 A2 /);
    expect(await axe(page), '가림 안내 화면').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-08 AC5: 이미지 미지원 모델을 설정하면 기능 비활성 안내가 보이고 사진을 올릴 수 없다', async ({ browser }) => {
    const admin = await loggedIn(browser, ADMIN);
    await send(admin.ctx.request, admin.csrf, 'put', '/api/ai/models', { models: [{ provider: 'anthropic', tier: 'standard', supportsImages: false }] });
    const adminPage = await admin.ctx.newPage();
    await adminPage.goto(url('/inventory/receipt'));
    await expect(adminPage.getByTestId('receipt-off')).toContainText('사진을 읽을 수 있는 AI 모델이 설정되지 않았습니다.');
    await expect(adminPage.getByRole('link', { name: 'AI 설정으로 가기' })).toBeVisible();
    await admin.ctx.close();

    const { ctx, csrf } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/receipt'));
    const off = page.getByTestId('receipt-off');
    await expect(off).toContainText('사진으로 입고 기능을 지금은 쓸 수 없어요');
    await expect(off).toContainText('사진을 읽을 수 있는 AI 모델이 설정되지 않았습니다.');
    await expect(off).toContainText('원장님(관리자)께 사진을 읽을 수 있는 AI 모델 설정을 요청해 주세요.');
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'AI로 읽기' })).toHaveCount(0);
    expect(await axe(page), '비활성 안내 화면').toEqual([]);
    // API로 바로 보내도 403 AI_DISABLED
    const res = await ctx.request.post(url('/api/ai/receipt'), {
      headers: { 'x-csrf-token': csrf },
      multipart: { confirmed: 'true', file: { name: 'st.jpg', mimeType: 'image/jpeg', buffer: fakeJpeg(1600, 1200) } },
    });
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: 'AI_DISABLED', message: '사진을 읽을 수 있는 AI 모델이 설정되지 않았습니다.' });
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

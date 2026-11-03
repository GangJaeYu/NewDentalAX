// 이 파일이 하는 일: 바코드 출고 화면 E2E(FR-130, phase-06-task-01 AC1·AC2). 이 파일 전용 격리 서버에서 실장이 API로 바코드가 있는 품목과 입고를 준비한 뒤,
// AC1: 직원이 재고 화면 "바코드로 출고" 입력란에 스캐너처럼 글자를 빠르게 치고 Enter → 그 품목 출고 창이 수량 1로 열리고, 저장하면 재고가 1 줄며 입력란이 다시 비워져 다음 스캔을 받는다.
// AC2: "사진으로 찾기"에 fixture 사진(tests/fixtures/barcode/, make-barcodes.ts로 만든 EAN-13·Code128·QR 사진)을 올리면 브라우저 안에서 해독해 그 품목 출고 창이 열린다.
// 없는 바코드·바코드 없는 사진은 쉬운 안내, 품목 수정 창의 바코드 칸(스캐너 Enter로 저장되지 않음)도 본다. 4너비×2테마 가로 넘침 없음과 axe 위반 0건도 확인한다.
import path from 'node:path';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'bcadmin01', password: 'Bc-Admin-Pass-01', withDemo: false };
const MANAGER = { name: '윤실장', username: 'bcmgr0001', password: 'Bc-Mgr-Pass-0001' };
const STAFF = { name: '정직원', username: 'bcstaff01', password: 'Bc-Staff-Pass-01' };
const PHOTOS = path.join(process.cwd(), 'tests', 'fixtures', 'barcode');

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;
/** 준비한 품목 번호 */
const ids: Record<string, number> = {};

/** 콘솔 오류를 모은다(일부러 만든 404 응답의 "Failed to load resource" 줄은 뺀다) */
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

/** 새 브라우저 묶음을 만들고 API로 로그인해 둔다 */
async function loggedIn(browser: Browser, who: { username: string; password: string }, opts: Parameters<Browser['newContext']>[0] = {}): Promise<{ ctx: BrowserContext; csrf: string }> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1440, height: 900 }, ...opts });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  return { ctx, csrf: ((await r.json()) as { data: { csrfToken: string } }).data.csrfToken };
}

async function post<T>(req: APIRequestContext, csrf: string, p: string, data: unknown): Promise<T> {
  const r = await req.post(url(p), { data, headers: { 'x-csrf-token': csrf } });
  expect(r.ok(), `${p} ${r.status()} ${await r.text()}`).toBe(true);
  return ((await r.json()) as { data: T }).data;
}

async function stockOf(req: APIRequestContext, id: number): Promise<number> {
  const r = await req.get(url(`/api/items/${id}`));
  return ((await r.json()) as { data: { stock: number } }).data.stock;
}

const barcodeInput = (page: Page) => page.getByRole('textbox', { name: '바코드로 출고' });
const outDialog = (page: Page) => page.getByRole('dialog', { name: '출고 기록' });

test.describe.serial('바코드 출고(스캐너·사진)', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test('준비: 첫 설정, 실장·직원 계정, 바코드 품목과 입고를 API로 만든다', async ({ request, browser, isoServer }) => {
    expect((await request.post('/api/setup', { data: ADMIN })).status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
    const { ctx, csrf } = await loggedIn(browser, MANAGER);
    const make = async (key: string, body: Record<string, unknown>, qty: number) => {
      const r = await post<{ item: { id: number } }>(ctx.request, csrf, '/api/items', { category: '소모품', unit: '박스', par: 4, ...body });
      ids[key] = r.item.id;
      await post(ctx.request, csrf, '/api/inventory/moves', { itemId: r.item.id, type: 'in', qty });
    };
    // fixture 사진의 글자와 같은 바코드(ean13-photo: 2001000000029, code128-photo: HS-STER-090, qr-photo: HS-QR-0001)
    await make('glove', { name: '니트릴 글러브 M', barcode: '2001000000029', location: '소모품실 A-1' }, 10);
    await make('pouch', { name: '멸균 파우치 90×260', unit: '팩', barcode: 'HS-STER-090' }, 6);
    await make('qr', { name: '표면 소독 티슈', unit: '통', barcode: 'HS-QR-0001' }, 5);
    await make('mask', { name: '덴탈 마스크' }, 8);
    await ctx.close();
  });

  test('phase-06-task-01 AC1: 바코드 입력란에 스캐너처럼 빠르게 치고 Enter → 그 품목 출고 창이 수량 1로 열리고, 저장하면 재고가 1 준다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory'));
    await expect(page.getByRole('heading', { level: 1, name: '재고 현황' })).toBeVisible();

    // USB 스캐너는 키보드처럼 글자를 아주 빠르게 친 뒤 Enter를 누른다
    await barcodeInput(page).click();
    await page.keyboard.type('2001000000029', { delay: 8 });
    await page.keyboard.press('Enter');
    const dialog = outDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('니트릴 글러브 M');
    await expect(dialog).toContainText('현재 10박스');
    const amount = dialog.getByLabel('출고 수량(박스)');
    await expect(amount).toHaveValue('1');
    await expect(amount).toBeFocused();
    // 바로 미리 고른 품목이라 "다른 품목" 버튼은 없다
    await expect(dialog.getByRole('button', { name: '다른 품목' })).toHaveCount(0);
    expect(await axe(page, 'dialog[open]'), '출고 창').toEqual([]);

    // 저장하면 1박스 출고, 입력란은 비워지고 다시 커서가 간다(다음 스캔 바로 받기)
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('니트릴 글러브 M 1박스 출고를 기록했어요. 남은 재고 9박스')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(await stockOf(ctx.request, ids.glove!)).toBe(9);
    await expect(barcodeInput(page)).toHaveValue('');
    await expect(barcodeInput(page)).toBeFocused();

    // 이어서 다른 품목을 스캔해도 같은 방식으로 열린다. 취소하면 기록하지 않는다
    await page.keyboard.type('HS-STER-090', { delay: 8 });
    await page.keyboard.press('Enter');
    await expect(dialog).toContainText('멸균 파우치 90×260');
    await expect(dialog.getByLabel('출고 수량(팩)')).toHaveValue('1');
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toHaveCount(0);
    expect(await stockOf(ctx.request, ids.pouch!)).toBe(6);
    await expect(barcodeInput(page)).toBeFocused();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-06-task-01: 없는 바코드를 찍으면 출고 창 대신 쉬운 안내가 나온다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory'));
    await barcodeInput(page).click();
    await page.keyboard.type('8800000000000', { delay: 8 });
    await page.keyboard.press('Enter');
    const notice = page.getByTestId('barcode-notice');
    await expect(notice).toHaveText('"8800000000000" 바코드로 등록된 품목이 없어요. 실장님께 품목 수정에서 바코드를 넣어 달라고 해 주세요.');
    await expect(notice).toHaveAttribute('role', 'alert');
    await expect(outDialog(page)).toHaveCount(0);
    // 빈 칸에서 Enter
    await barcodeInput(page).fill('');
    await page.keyboard.press('Enter');
    await expect(notice).toHaveText('바코드를 찍거나 숫자를 입력한 뒤 Enter를 눌러 주세요.');
    expect(await axe(page), '안내가 보이는 재고 화면').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-06-task-01 AC2: 바코드 사진(EAN-13·Code128·QR fixture)을 올리면 이 기기에서 읽어 그 품목 출고 창이 수량 1로 열린다', async ({ browser }) => {
    // 휴대폰 흉내(390px, 터치)에서 확인한다
    const { ctx } = await loggedIn(browser, STAFF, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    // 사진을 서버로 보내지 않는지 본다(바코드 찾기 요청만 나간다)
    const uploads: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST') uploads.push(r.url());
    });
    await page.goto(url('/inventory'));
    const photo = page.getByTestId('barcode-photo');
    await expect(photo).toHaveAttribute('accept', 'image/*');
    await expect(photo).toHaveAttribute('capture', 'environment');
    const dialog = outDialog(page);

    for (const [file, name, unit] of [
      ['ean13-photo.png', '니트릴 글러브 M', '박스'],
      ['code128-photo.png', '멸균 파우치 90×260', '팩'],
      ['qr-photo.png', '표면 소독 티슈', '통'],
    ] as const) {
      await photo.setInputFiles(path.join(PHOTOS, file));
      await expect(dialog, file).toBeVisible({ timeout: 15000 });
      await expect(dialog, file).toContainText(name);
      await expect(dialog.getByLabel(`출고 수량(${unit})`), file).toHaveValue('1');
      await dialog.getByRole('button', { name: '취소' }).click();
      await expect(dialog).toHaveCount(0);
    }
    expect(uploads).toEqual([]);

    // 사진으로 연 창에서 저장하면 출고된다
    await photo.setInputFiles(path.join(PHOTOS, 'qr-photo.png'));
    await expect(dialog).toContainText('표면 소독 티슈');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('표면 소독 티슈 1통 출고를 기록했어요. 남은 재고 4통')).toBeVisible();
    expect(await stockOf(ctx.request, ids.qr!)).toBe(4);

    // 바코드가 없는 사진은 다시 찍어 달라는 안내
    await photo.setInputFiles(path.join(PHOTOS, 'no-barcode-photo.png'));
    await expect(page.getByTestId('barcode-notice')).toHaveText('사진에서 바코드를 찾지 못했어요. 바코드가 화면 가운데에 크고 또렷하게 나오도록 다시 찍어 주세요.', { timeout: 15000 });
    await expect(dialog).toHaveCount(0);
    await expectNoHorizontalScroll(page, '사진 안내가 보이는 휴대폰 재고 화면');
    expect(await axe(page), '휴대폰 재고 화면').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-06-task-01: 실장이 품목 수정 창에서 스캐너로 바코드를 넣으면(Enter로 저장되지 않음) 저장 뒤 그 바코드로 출고할 수 있다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url(`/inventory/items/${ids.mask}`));
    await page.getByRole('button', { name: '수정' }).click();
    const form = page.getByRole('dialog', { name: '품목 수정' });
    await form.getByLabel('바코드').click();
    await page.keyboard.type('2001000000050', { delay: 8 });
    await page.keyboard.press('Enter');
    // 스캐너의 Enter로는 저장되지 않는다(창이 그대로 있다)
    await expect(form).toBeVisible();
    await expect(form.getByLabel('바코드')).toHaveValue('2001000000050');
    expect(await axe(page, 'dialog[open]'), '품목 수정 창').toEqual([]);
    await form.getByRole('button', { name: '저장' }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByText('바코드 2001000000050')).toBeVisible();

    // 다른 품목에 같은 바코드를 넣으면 막는다
    await page.goto(url(`/inventory/items/${ids.pouch}`));
    await page.getByRole('button', { name: '수정' }).click();
    const form2 = page.getByRole('dialog', { name: '품목 수정' });
    await form2.getByLabel('바코드').fill('2001000000050');
    await form2.getByRole('button', { name: '저장' }).click();
    await expect(form2.getByRole('alert').first()).toContainText('이 바코드는 이미 "덴탈 마스크" 품목에 등록돼 있어요.');
    await form2.getByRole('button', { name: '취소' }).click();

    // 재고 화면에서 그 바코드로 출고 창이 열린다
    await page.goto(url('/inventory'));
    await barcodeInput(page).click();
    await page.keyboard.type('2001000000050', { delay: 8 });
    await page.keyboard.press('Enter');
    await expect(outDialog(page)).toContainText('덴탈 마스크');
    await expect(outDialog(page).getByLabel('출고 수량(박스)')).toHaveValue('1');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [768, 1024],
    [390, 844],
  ] as const) {
    test(`phase-06-task-01 화면 품질: 재고 화면 ${width}px 라이트·다크 — 가로 넘침 없음, axe 위반 0건`, async ({ browser }) => {
      for (const colorScheme of ['light', 'dark'] as const) {
        const phone = width === 390 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {};
        const { ctx } = await loggedIn(browser, STAFF, { viewport: { width, height }, colorScheme, ...phone });
        const page = await ctx.newPage();
        const errors = watchErrors(page);
        await page.goto(url('/inventory'));
        await expect(page.getByRole('row').filter({ hasText: '니트릴 글러브 M' })).toBeVisible();
        await expect(barcodeInput(page)).toBeVisible();
        await expect(page.getByText('사진으로 찾기', { exact: true })).toBeVisible();
        await expectNoHorizontalScroll(page, `재고 ${width} ${colorScheme}`);
        expect(await axe(page), `재고 ${width} ${colorScheme}`).toEqual([]);
        expect(errors).toEqual([]);
        await ctx.close();
      }
    });
  }
});

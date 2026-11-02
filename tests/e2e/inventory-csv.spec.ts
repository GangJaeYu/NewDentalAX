// 이 파일이 하는 일: CSV 가져오기·내보내기 화면 E2E(phase-03-task-03 AC1~AC4). 이 파일 전용 격리 서버(tests/e2e/fixtures.ts)를 쓴다.
// 실장이 /inventory/import에서 품목 CSV를 내려받아 첫 3바이트 BOM·한글 열 이름(AC1)과 =HYPERLINK 품목명 앞 작은따옴표(AC4)를 확인하고,
// CP949 예제 파일(tests/fixtures/csv/items-cp949.csv)을 올려 한글 그대로 신규·변경·오류 줄이 구분되는지(AC2),
// 오류 줄 이유가 보이고 "오류 줄 건너뛰고 확정"을 누르면 나머지만 반영되는지(AC3)를 본다. 화면 axe 위반 0건과 휴대폰 너비 가로 스크롤 없음도 본다.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'csvadmin1', password: 'Csv-Admin-Pass-1', withDemo: false };
const MANAGER = { name: '윤실장', username: 'csvmgr01', password: 'Csv-Mgr-Pass-01' };
const STAFF = { name: '정직원', username: 'csvstaff1', password: 'Csv-Staff-Pass-1' };
const CP949_FILE = path.join(process.cwd(), 'tests', 'fixtures', 'csv', 'items-cp949.csv');
const EVIL = '=HYPERLINK("http://evil.example","눌러 보세요")';

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;

/** 콘솔 오류를 모은다(일부러 만든 4xx 응답 줄은 뺀다) */
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

/** 새 브라우저 묶음을 만들고 API로 로그인해 둔다 */
async function loggedIn(browser: Browser, who: { username: string; password: string }, viewport = { width: 1440, height: 900 }): Promise<{ ctx: BrowserContext; csrf: string }> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport, acceptDownloads: true });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  return { ctx, csrf: ((await r.json()) as { data: { csrfToken: string } }).data.csrfToken };
}

/** 링크를 눌러 내려받은 파일의 바이트 */
async function download(page: Page, linkName: string): Promise<Buffer> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: linkName }).click()]);
  const file = await dl.path();
  return fs.readFileSync(file);
}

/** 품목 이름 → { 적정 재고 } (API로 읽음) */
async function itemsByName(ctx: BrowserContext): Promise<Map<string, { par: number; unit: string }>> {
  const r = await ctx.request.get(url('/api/items?active=all&pageSize=200'));
  expect(r.status()).toBe(200);
  const rows = ((await r.json()) as { data: Array<{ name: string; par: number; unit: string }> }).data;
  return new Map(rows.map((x) => [x.name, { par: x.par, unit: x.unit }]));
}

/** 표에서 글자가 들어 있는 줄 */
const rowOf = (page: Page, text: string) => page.getByRole('table', { name: '가져오기 미리보기' }).getByRole('row').filter({ hasText: text });

/** 가져오기 칸에 파일을 넣는다 */
async function upload(page: Page, file: string): Promise<void> {
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByRole('heading', { name: '미리보기' })).toBeVisible();
}

test.describe.serial('재고 CSV 가져오기·내보내기', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test('준비: 첫 설정, 실장·직원 계정, 거래처·기존 품목을 API로 만든다', async ({ request, browser, isoServer }) => {
    expect((await request.post('/api/setup', { data: ADMIN })).status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
    const { ctx, csrf } = await loggedIn(browser, MANAGER);
    const headers = { 'x-csrf-token': csrf };
    const v = await ctx.request.post(url('/api/vendors'), { data: { name: '한빛덴탈' }, headers });
    expect(v.status()).toBe(201);
    const vendorId = ((await v.json()) as { data: { id: number } }).data.id;
    for (const body of [
      { name: '니트릴 장갑(M)', category: '소모품', unit: '박스', par: 6, vendorId, location: '소모품 선반 1칸' },
      { name: EVIL, category: '소모품', unit: '개', par: 1 },
    ]) {
      expect((await ctx.request.post(url('/api/items'), { data: body, headers })).status()).toBe(201);
    }
    await ctx.close();
  });

  test('phase-03-task-03 AC1: 내보낸 품목·거래처·입출고 CSV의 첫 3바이트가 BOM이고 한글 열 이름이 들어 있다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/import'));
    await expect(page.getByRole('heading', { name: 'CSV 가져오기·내보내기' })).toBeVisible();
    for (const [link, header] of [
      ['품목 CSV', '품목명,분류,단위,적정 재고,유효기간 관리,기본 거래처,보관 위치,메모'],
      ['거래처 CSV', '상호,담당자,업무용 연락처,이메일,주문 방법,메모'],
      ['입출고 기록 CSV', '일시,구분,품목명,단위,수량,단가,거래처'],
      ['가져오기 양식 내려받기', '품목명,분류,단위,적정 재고,유효기간 관리,기본 거래처,보관 위치,메모'],
    ] as const) {
      const bytes = await download(page, link);
      expect([...bytes.subarray(0, 3)], link).toEqual([0xef, 0xbb, 0xbf]);
      expect(bytes.subarray(3).toString('utf8').startsWith(header), link).toBe(true);
    }
    const items = (await download(page, '품목 CSV')).toString('utf8');
    expect(items).toContain('니트릴 장갑(M),소모품,박스,6,아니오,한빛덴탈,소모품 선반 1칸');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-03 AC4: =HYPERLINK(...)로 시작하는 품목명을 내보내면 앞에 작은따옴표가 붙는다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    await page.goto(url('/inventory/import'));
    const text = (await download(page, '품목 CSV')).toString('utf8');
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""눌러 보세요"")"`);
    expect(text).not.toMatch(/(^|,|\r\n)"?=HYPERLINK/);
    await ctx.close();
  });

  test('phase-03-task-03 AC2: CP949 예제 CSV를 올리면 한글이 깨지지 않고 미리보기에 신규·변경·오류 줄이 구분된다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/import'));
    await upload(page, CP949_FILE);
    await expect(page.getByText('엑셀 기본 형식(CP949)으로 읽었어요.')).toBeVisible();
    await expect(rowOf(page, '니트릴 장갑(M)')).toContainText('변경');
    await expect(rowOf(page, '니트릴 장갑(M)')).toContainText('적정 재고: 6 → 10');
    await expect(rowOf(page, '치과용 거즈')).toContainText('신규');
    await expect(rowOf(page, '일회용 석션팁')).toContainText('신규');
    await expect(rowOf(page, '레진 A2')).toContainText('오류');
    await expect(page.getByLabel('미리보기 요약')).toContainText('신규 2');
    await expect(page.getByLabel('미리보기 요약')).toContainText('변경 1');
    await expect(page.getByLabel('미리보기 요약')).toContainText('오류 1');
    await expect(page.locator('body')).not.toContainText('�');
    // "오류" 구분만 보기
    await page.getByRole('group', { name: '구분' }).getByRole('button', { name: '오류 1' }).click();
    await expect(page.getByRole('table', { name: '가져오기 미리보기' }).getByRole('row')).toHaveCount(2);
    // 미리보기만으로는 저장되지 않는다
    expect((await itemsByName(ctx)).has('치과용 거즈')).toBe(false);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-03 AC3: 오류 줄(적정 재고에 문자)이 이유와 함께 보이고 "오류 줄 건너뛰고 확정"을 누르면 나머지만 반영된다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/inventory/import'));
    await upload(page, CP949_FILE);
    await expect(rowOf(page, '레진 A2')).toContainText('적정 재고는 숫자로 적어 주세요(지금 값: "다섯").');
    await expect(page.getByText('오류 줄 1개는 반영하지 않아요.')).toBeVisible();
    await expect(page.getByRole('button', { name: '확정', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '오류 줄 건너뛰고 확정' }).click();
    await expect(page.getByRole('status').filter({ hasText: '신규 2개, 변경 1개를 반영했어요.' })).toBeVisible();
    await expect(page.getByText('오류 줄 4번 포함')).toBeVisible();
    await expect(page.getByRole('heading', { name: '미리보기' })).toHaveCount(0);

    const after = await itemsByName(ctx);
    expect(after.get('니트릴 장갑(M)')?.par).toBe(10);
    expect(after.get('치과용 거즈')).toEqual({ par: 20, unit: '팩' });
    expect(after.get('일회용 석션팁')).toEqual({ par: 15, unit: '봉' });
    expect(after.has('레진 A2')).toBe(false);

    // 새로 고쳐도 재고 현황에 보인다
    await page.goto(url('/inventory'));
    await expect(page.getByRole('row').filter({ hasText: '치과용 거즈' })).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-03: 직원은 내보내기·가져오기 API를 쓸 수 없다(403)', async ({ browser }) => {
    const { ctx, csrf } = await loggedIn(browser, STAFF);
    for (const p of ['/api/export/items.csv', '/api/import/items/template.csv', '/api/inventory/moves?format=csv']) {
      expect((await ctx.request.get(url(p))).status(), p).toBe(403);
    }
    const r = await ctx.request.post(url('/api/import/items/preview'), {
      headers: { 'x-csrf-token': csrf },
      multipart: { file: { name: 'items.csv', mimeType: 'text/csv', buffer: fs.readFileSync(CP949_FILE) } },
    });
    expect(r.status()).toBe(403);
    await ctx.close();
  });

  test('phase-03-task-03: 가져오기 화면(미리보기 포함)은 axe 위반 0건이고 넓은 화면 가로 스크롤이 없다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    await page.goto(url('/inventory/import'));
    await expect(page.getByRole('heading', { name: '품목 가져오기' })).toBeVisible();
    await upload(page, CP949_FILE);
    expect(axeList((await new AxeBuilder({ page }).analyze()).violations)).toEqual([]);
    // 넓은 화면에서도 가로 스크롤이 없다(숨긴 파일 입력이 화면 밖으로 넘치지 않음)
    expect((await page.evaluate('document.documentElement.scrollWidth > window.innerWidth')) as boolean).toBe(false);
    await ctx.close();
  });

  test('phase-03-task-03: 휴대폰 너비(390)에서 가로 스크롤 없이 미리보기와 확정 버튼이 보인다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER, { width: 390, height: 844 });
    const page = await ctx.newPage();
    await page.goto(url('/inventory/import'));
    await upload(page, CP949_FILE);
    await expect(page.getByRole('button', { name: '오류 줄 건너뛰고 확정' })).toBeVisible();
    expect((await page.evaluate('document.documentElement.scrollWidth > window.innerWidth')) as boolean).toBe(false);
    await ctx.close();
  });
});

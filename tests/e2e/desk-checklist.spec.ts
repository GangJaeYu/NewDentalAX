// 이 파일이 하는 일: 오픈·마감 체크리스트 화면 E2E(phase-03-task-04 AC4·AC5, FR-041). 이 파일 전용 격리 서버(fixtures.ts)에서
// 실장이 항목을 만들고 순서를 바꿔 저장한 뒤 새로 고쳐도 순서가 그대로인지(AC5), 직원이 오늘 항목을 체크하면 체크한 사람·시각이 보이는지,
// 서버 시계(TEST_NOW, 주입 시계)를 다음 날로 바꿔 다시 켜면 미체크로 시작하고 어제 기록은 체크 상자가 잠긴 채 조회되는지(AC4)를 본다.
// 직원에게 항목 편집 버튼이 없는지, 인쇄 화면이 A4 PDF로 나오고 그날 기록이 들어가는지, axe 위반 0건·휴대폰 너비 가로 스크롤 없음도 확인한다.
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { extractText, getDocumentProxy } from 'unpdf';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'ckadmin', password: 'Check-Admin-Pass-4', withDemo: false };
const MANAGER = { username: 'ckmanager', password: 'Check-Manager-Pass-4', name: '윤실장' };
const STAFF = { username: 'ckstaff', password: 'Check-Staff-Pass-4', name: '서다온' };
const DAY2 = '2026-11-03T09:00:00+09:00';

/** 이 spec이 시작할 때의 TEST_NOW(끝나면 되돌린다) */
const ORIGINAL_TEST_NOW = process.env.TEST_NOW;

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;

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

async function loggedIn(browser: Browser, who: { username: string; password: string }, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  return ctx;
}

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** 체크리스트 줄의 항목 글자들(화면 순서) */
async function itemTexts(page: Page): Promise<string[]> {
  return page.getByTestId('checklist-item').locator('.checkline span').allTextContents();
}

test.describe.serial('오픈·마감 체크리스트', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
  });

  test.afterAll(() => {
    // 다른 spec에 바뀐 시계가 번지지 않게 되돌린다
    if (ORIGINAL_TEST_NOW === undefined) delete process.env.TEST_NOW;
    else process.env.TEST_NOW = ORIGINAL_TEST_NOW;
  });

  test('phase-03-task-04 AC5: 실장이 항목을 더하고 순서를 바꿔 저장하면 새로 고쳐도 그 순서가 유지된다', async ({ browser }) => {
    const ctx = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/desk/checklist'));
    await expect(page.getByText('오픈 체크리스트 항목이 없어요')).toBeVisible();
    await page.getByRole('button', { name: '항목 편집' }).click();
    const dialog = page.getByRole('dialog', { name: '오픈 체크리스트 항목 편집' });
    for (const [i, text] of ['출입문·대기실 조명 켜기', '체어·석션 작동 확인', '멸균기 예열'].entries()) {
      await dialog.getByRole('button', { name: '항목 더하기' }).click();
      await dialog.getByLabel(`${i + 1}번 항목 내용`).fill(text);
    }
    await dialog.getByLabel('1번 항목 담당').selectOption('desk');
    await dialog.getByLabel('2번 항목 담당').selectOption('hygienist');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('오픈 체크리스트 항목을 저장했어요.')).toBeVisible();
    await expect.poll(() => itemTexts(page)).toEqual(['출입문·대기실 조명 켜기', '체어·석션 작동 확인', '멸균기 예열']);

    // 3번을 맨 위로 올리고 저장
    await page.getByRole('button', { name: '항목 편집' }).click();
    await dialog.getByRole('button', { name: '3번 항목 위로' }).click();
    await dialog.getByRole('button', { name: '2번 항목 위로' }).click();
    await expect(dialog.getByLabel('1번 항목 내용')).toHaveValue('멸균기 예열');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => itemTexts(page)).toEqual(['멸균기 예열', '출입문·대기실 조명 켜기', '체어·석션 작동 확인']);

    await page.reload();
    await expect.poll(() => itemTexts(page)).toEqual(['멸균기 예열', '출입문·대기실 조명 켜기', '체어·석션 작동 확인']);
    await expect(page.getByTestId('checklist-item').nth(1)).toContainText('데스크');
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-04 AC4: 직원이 오늘 항목을 체크하면 체크한 사람과 시각이 보이고, 직원에게는 항목 편집 버튼이 없다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/desk/checklist'));
    await expect(page.getByText('2026년 11월 2일 월요일 · 오픈 0/3 완료')).toBeVisible();
    await expect(page.getByRole('button', { name: '항목 편집' })).toHaveCount(0);
    const first = page.getByTestId('checklist-item').filter({ hasText: '멸균기 예열' });
    await expect(first.getByTestId('checked-by')).toHaveText('아직 안 함');
    await first.getByRole('checkbox', { name: '멸균기 예열' }).check();
    await expect(first.getByTestId('checked-by')).toContainText(STAFF.name);
    await expect(first.getByTestId('checked-by')).toContainText('11/2 09:00');
    await expect(page.getByText('오픈 1/3 완료')).toBeVisible();
    // 새로 고쳐도 남아 있다
    await page.reload();
    await expect(page.getByTestId('checklist-item').filter({ hasText: '멸균기 예열' }).getByRole('checkbox')).toBeChecked();
    // 오늘 화면은 조회 전용이 아니다
    await expect(page.getByText(/조회만 할 수 있어요/)).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-04: 인쇄 화면은 그날 기록을 A4 PDF로 보여 준다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/desk/checklist'));
    await page.getByRole('link', { name: '인쇄' }).click();
    await expect(page).toHaveURL(/\/print\/checklist\/open\/2026-11-02$/);
    await expect(page.getByRole('heading', { name: '오픈 체크리스트 — 2026년 11월 2일 월요일' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '멸균기 예열' })).toContainText(STAFF.name);
    expect(await axe(page)).toEqual([]);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4' });
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    const { totalPages, text } = await extractText(doc, { mergePages: true });
    expect(totalPages).toBe(1);
    expect(text).toContain('멸균기 예열');
    expect(text).toContain(STAFF.name);
    expect(text).not.toContain('인쇄하기'); // 화면 전용 버튼은 인쇄되지 않는다
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-04 AC4: 주입 시계로 다음 날이 되면 미체크로 시작하고, 어제 기록은 읽기 전용으로 조회된다', async ({ browser, isoServer }) => {
    // 서버 시계를 다음 날로 바꿔 같은 데이터로 다시 켠다(TEST_NOW = 주입 시계)
    process.env.TEST_NOW = DAY2;
    await isoServer.stop();
    await isoServer.start();
    const health = await fetch(url('/api/health'));
    expect(health.ok).toBe(true);

    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/desk/checklist'));
    await expect(page.getByText('2026년 11월 3일 화요일 · 오픈 0/3 완료')).toBeVisible();
    for (const box of await page.getByTestId('checklist-item').getByRole('checkbox').all()) {
      await expect(box).not.toBeChecked();
      await expect(box).toBeEnabled();
    }
    await expect(page.getByTestId('checked-by').first()).toHaveText('아직 안 함');
    await expect(page.getByRole('button', { name: '다음 날' })).toBeDisabled();

    // 전날로 가면 어제 기록이 체크 상자가 잠긴 채 보인다
    await page.getByRole('button', { name: '전날' }).click();
    await expect(page).toHaveURL(/date=2026-11-02/);
    await expect(page.getByText('지난 날짜(2026년 11월 2일 월요일) 기록이에요. 조회만 할 수 있어요.')).toBeVisible();
    const yesterday = page.getByTestId('checklist-item').filter({ hasText: '멸균기 예열' });
    await expect(yesterday.getByRole('checkbox')).toBeChecked();
    await expect(yesterday.getByRole('checkbox')).toBeDisabled();
    await expect(yesterday.getByTestId('checked-by')).toContainText(`${STAFF.name}11/2 09:00`);
    for (const box of await page.getByTestId('checklist-item').getByRole('checkbox').all()) await expect(box).toBeDisabled();
    expect(await axe(page)).toEqual([]);

    // 오늘로 돌아오면 다시 체크할 수 있다
    await page.getByRole('button', { name: '오늘로' }).click();
    await expect(page.getByText('2026년 11월 3일 화요일 · 오픈 0/3 완료')).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-04: 체크리스트 화면은 휴대폰 너비에서 가로로 넘치지 않는다', async ({ browser }) => {
    const ctx = await loggedIn(browser, MANAGER, { width: 390, height: 844 });
    const page = await ctx.newPage();
    for (const path of ['/desk/checklist', '/desk/checklist?date=2026-11-02', '/print/checklist/open/2026-11-02']) {
      await page.goto(url(path));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText('멸균기 예열').first()).toBeVisible();
      await expectNoHorizontalScroll(page, path);
    }
    // 편집 대화상자도 휴대폰에서 넘치지 않는다
    await page.goto(url('/desk/checklist'));
    await page.getByRole('button', { name: '항목 편집' }).click();
    await expect(page.getByRole('dialog', { name: '오픈 체크리스트 항목 편집' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await axe(page)).toEqual([]);
    await ctx.close();
  });
});

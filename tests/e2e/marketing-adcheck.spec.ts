// 이 파일이 하는 일: 의료광고 문구 점검·홍보 글 화면 E2E(phase-04-task-06 AC1~AC4, FR-120·121). 이 파일 전용 격리 서버(fixtures.ts)에서 데모 AI 공급자로 본다.
// "국내 최고 임플란트, 100% 성공, 지금 50% 할인"을 점검하면 3건 이상 하이라이트·이유·바꿀 말과 AI 2차 결과가 보이는지(AC1), 결과마다 법률 고지가 붙는지(AC2),
// admin이 화면에서 규칙을 추가하면 다음 점검부터 걸리고 직원은 규칙을 바꿀 수 없는지(AC3), 홍보 글을 만들면 점검 결과가 자동으로 함께 보이고
// 문서 작성기의 "광고 문구 점검" 버튼이 동작하는지(AC4)를 확인한다. axe 위반 0건, 4너비 × 2테마 가로 스크롤 없음도 본다.
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'adadmin', password: 'Adcheck-Admin-Pass-8', withDemo: false };
const STAFF = { username: 'adstaff', password: 'Adcheck-Staff-Pass-8', name: '서다온' };
const AC1_TEXT = '국내 최고 임플란트, 100% 성공, 지금 50% 할인';
const NOTICE_A = '법률 자문이 아니며';
const NOTICE_B = '사전심의 대상 여부는 관련 기관에 확인';

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

async function loggedIn(
  browser: Browser,
  who: { username: string; password: string },
  opts: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {},
): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: opts.viewport ?? { width: 1440, height: 900 }, colorScheme: opts.colorScheme ?? 'light' });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  return ctx;
}

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

async function csrf(ctx: BrowserContext): Promise<Record<string, string>> {
  const s = (await (await ctx.request.get(url('/api/session'))).json()) as { data: { csrfToken: string } };
  return { 'x-csrf-token': s.data.csrfToken };
}

/** 점검 화면에서 글을 넣고 점검한다 */
async function runCheck(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: '점검할 글' }).fill(text);
  await page.getByRole('button', { name: '점검하기' }).click();
  await expect(page.getByTestId('adcheck-result')).toBeVisible();
}

test.describe.serial('의료광고 문구 점검·홍보 글', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
  });

  test('phase-04-task-06 AC1: "국내 최고 임플란트, 100% 성공, 지금 50% 할인" → 위험 표현 3건 이상 하이라이트와 이유·대체 표현, AI 2차 점검 결과', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/docs/adcheck'));
    await expect(page.getByRole('heading', { level: 1, name: '의료광고 문구 점검' })).toBeVisible();
    await expect(page.getByText('왼쪽에 글을 넣고 "점검하기"를 누르면')).toBeVisible();
    await runCheck(page, AC1_TEXT);

    const result = page.getByTestId('adcheck-result');
    const marks = result.getByTestId('adcheck-text').locator('mark');
    expect(await marks.count()).toBeGreaterThanOrEqual(3);
    await expect(marks.nth(0)).toHaveText('국내 최고1');
    await expect(marks.nth(1)).toHaveText('100%2');
    await expect(marks.nth(2)).toHaveText('50% 할인3');
    const hits = result.getByTestId('adcheck-hit');
    expect(await hits.count()).toBeGreaterThanOrEqual(3);
    await expect(hits.nth(0)).toContainText('“국내 최고”');
    await expect(hits.nth(0)).toContainText('위험');
    await expect(hits.nth(0)).toContainText('최고·유일 표현');
    await expect(hits.nth(0)).toContainText('이유');
    await expect(hits.nth(0)).toContainText('바꿀 말');
    await expect(hits.nth(1)).toContainText('치료 결과를 장담하는 표현');
    await expect(hits.nth(2)).toContainText('할인 강조');
    await expect(result.getByText('위험 3건')).toBeVisible();
    // AI 2차 점검(데모)
    const ai = result.getByTestId('adcheck-ai');
    await expect(ai).toContainText('AI 2차 점검');
    await expect(ai).toContainText('데모 응답');
    await expect(ai).toContainText('규칙 점검에서 찾은 표현 3곳을 다시 살펴봤어요');
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-06 AC2: 결과마다 "법률 자문이 아니며, 사전심의 대상 여부는 관련 기관에 확인" 고지가 붙는다(걸린 표현이 없거나 AI를 끈 경우도)', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    await page.goto(url('/docs/adcheck'));
    await runCheck(page, AC1_TEXT);
    await expect(page.getByTestId('adcheck-notice')).toContainText(NOTICE_A);
    await expect(page.getByTestId('adcheck-notice')).toContainText(NOTICE_B);

    // 걸린 표현 없음 + AI 끔
    await page.getByLabel('AI 2차 점검도 함께 하기').uncheck();
    await runCheck(page, '토요일은 오후 2시까지 진료해요. 주차는 건물 지하에 할 수 있어요.');
    const result = page.getByTestId('adcheck-result');
    await expect(result.getByText('규칙에 걸린 표현 없음')).toBeVisible();
    await expect(result.getByTestId('adcheck-hit')).toHaveCount(0);
    await expect(result.getByTestId('adcheck-ai')).toHaveCount(0);
    await expect(page.getByTestId('adcheck-notice')).toContainText(NOTICE_A);
    await expect(page.getByTestId('adcheck-notice')).toContainText(NOTICE_B);
    await ctx.close();
  });

  test('phase-04-task-06 AC3: admin이 화면에서 규칙을 추가하면 다음 점검부터 걸리고, 직원은 규칙을 볼 수만 있다', async ({ browser }) => {
    test.setTimeout(90000);
    const actx = await loggedIn(browser, ADMIN);
    const page = await actx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/docs/adcheck'));
    const rulesCard = page.getByRole('article', { name: '점검 규칙 사전' });
    await expect(rulesCard).toContainText('규칙 14개 · 켜짐 14개');
    // 추가 전에는 걸리지 않는다
    await runCheck(page, '기적의 치료로 새 치아를 드려요');
    await expect(page.getByText('규칙에 걸린 표현 없음')).toBeVisible();

    await page.getByRole('button', { name: '규칙 추가' }).click();
    const dialog = page.getByRole('dialog', { name: '규칙 추가' });
    await expect(dialog).toBeVisible();
    // 빈 칸이면 이유가 보인다
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog.getByText('찾을 말을 적어 주세요.')).toBeVisible();
    // 잘못된 정규식은 서버가 막는다
    await dialog.getByLabel('찾을 말').fill('기적(의');
    await dialog.getByLabel('찾는 방식').selectOption('regex');
    await dialog.getByLabel('분류').selectOption({ label: '효과 보장' });
    await dialog.getByLabel('이유').fill('치료 효과를 부풀리는 말이에요.');
    await dialog.getByLabel('바꿀 말').fill('치료 방법을 사실대로 적어 주세요.');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(dialog.getByText('정규식 모양이 틀렸어요')).toBeVisible();
    await dialog.getByLabel('찾을 말').fill('기적(의|같은)\\s*치료');
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('규칙을 추가했어요. 다음 점검부터 적용돼요.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(rulesCard).toContainText('규칙 15개 · 켜짐 15개');
    await expect(rulesCard.getByRole('row').filter({ hasText: '기적(의|같은)\\s*치료' })).toContainText('추가');

    // 다음 점검부터 걸린다
    await page.getByRole('button', { name: '점검하기' }).click();
    const hit = page.getByTestId('adcheck-hit');
    await expect(hit).toHaveCount(1);
    await expect(hit).toContainText('“기적의 치료”');
    await expect(hit).toContainText('치료 효과를 부풀리는 말이에요.');
    await expect(hit).toContainText('효과 보장');

    // 기본 규칙 끄기 → 다음 점검에서 빠진다
    await page.getByRole('button', { name: '유일 규칙 끄기' }).click();
    await expect(page.getByText('"유일" 규칙을 껐어요.')).toBeVisible();
    await runCheck(page, '지역 유일의 장비');
    await expect(page.getByText('규칙에 걸린 표현 없음')).toBeVisible();
    await page.getByRole('button', { name: '유일 규칙 켜기' }).click();
    await expect(page.getByText('"유일" 규칙을 켰어요.')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);

    // 직원: 규칙은 보이지만 추가·고치기는 없고, API로 바꾸면 403
    const sctx = await loggedIn(browser, STAFF);
    const staff = await sctx.newPage();
    await staff.goto(url('/docs/adcheck'));
    await expect(staff.getByRole('article', { name: '점검 규칙 사전' })).toContainText('규칙 15개');
    await expect(staff.getByText('규칙은 관리자가 추가·수정할 수 있어요.')).toBeVisible();
    await expect(staff.getByRole('button', { name: '규칙 추가' })).toHaveCount(0);
    await expect(staff.getByRole('button', { name: /규칙 고치기/ })).toHaveCount(0);
    const rules = (await (await sctx.request.get(url('/api/ad-rules'))).json()) as { data: unknown[] };
    const put = await sctx.request.put(url('/api/ad-rules'), { data: { rules: rules.data }, headers: await csrf(sctx) });
    expect(put.status()).toBe(403);
    await staff.getByRole('textbox', { name: '점검할 글' }).fill('기적같은 치료');
    await staff.getByRole('button', { name: '점검하기' }).click();
    await expect(staff.getByTestId('adcheck-hit')).toContainText('“기적같은 치료”');
    await sctx.close();
    await actx.close();
  });

  test('phase-04-task-06 AC4: 홍보 글 초안을 만들면 광고 문구 점검 결과가 자동으로 함께 보이고, 고친 뒤 다시 점검할 수 있다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/docs/promo'));
    await expect(page.getByRole('heading', { level: 1, name: '블로그·SNS 홍보 글' })).toBeVisible();
    await page.getByLabel('올릴 곳').selectOption('인스타그램');
    await page.getByLabel('분량').selectOption('short');
    const panel = page.getByTestId('ai-panel-promo');
    await panel.getByLabel('주제').fill('국내 최고 임플란트 50% 할인 이벤트');
    await panel.getByRole('button', { name: '초안 만들기' }).click();

    // 버튼을 더 누르지 않아도 점검 결과가 붙는다
    const card = page.getByRole('article', { name: '초안과 광고 문구 점검' });
    await expect(card.getByLabel('초안')).toHaveValue(/국내 최고 임플란트 50% 할인 이벤트/, { timeout: 15000 });
    await expect(card.getByLabel('초안')).toHaveValue(/#치아건강/);
    const result = card.getByTestId('adcheck-result');
    await expect(result).toBeVisible({ timeout: 15000 });
    await expect(result.getByTestId('adcheck-text').locator('mark').first()).toHaveText('국내 최고1');
    await expect(result.getByTestId('adcheck-hit').filter({ hasText: '“50% 할인”' }).first()).toBeVisible();
    await expect(result.getByTestId('adcheck-ai')).toContainText('AI 2차 점검');
    await expect(card.getByTestId('adcheck-notice')).toContainText(NOTICE_A);

    // 위험 표현을 고치고 다시 점검
    const fixed = (await card.getByLabel('초안').inputValue()).replaceAll('국내 최고 임플란트 50% 할인 이벤트', '임플란트 진료 안내');
    await card.getByLabel('초안').fill(fixed);
    await expect(card.getByText('초안이 바뀌었어요. 다시 점검해 주세요.')).toBeVisible();
    await card.getByRole('button', { name: '다시 점검' }).click();
    await expect(result.getByText('규칙에 걸린 표현 없음')).toBeVisible();
    await expect(card.getByText('초안이 바뀌었어요. 다시 점검해 주세요.')).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-06 AC4: 문서 작성기 결과에서 "광고 문구 점검"을 누르면 점검 결과와 고지가 보인다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/docs/writer'));
    const panel = page.getByTestId('ai-panel-doc_writer');
    await panel.getByLabel('요점').fill('임플란트 진료 안내, 국내 최고 의료진, 100% 성공');
    await panel.getByRole('button', { name: '초안 만들기' }).click();
    await expect(page.getByLabel('본문')).not.toHaveValue('', { timeout: 15000 });
    await page.getByLabel('본문').fill('# 임플란트 안내\n\n국내 최고 의료진이 100% 성공을 약속드려요.');
    await page.getByRole('button', { name: '광고 문구 점검' }).click();
    const result = page.getByTestId('adcheck-result');
    await expect(result).toBeVisible();
    expect(await result.getByTestId('adcheck-hit').count()).toBeGreaterThanOrEqual(2);
    await expect(result.getByTestId('adcheck-hit').first()).toContainText('“국내 최고”');
    await expect(page.getByTestId('adcheck-notice')).toContainText(NOTICE_B);
    await page.getByLabel('본문').fill('# 임플란트 안내\n\n진료 시간은 대표번호로 문의해 주세요.');
    await expect(page.getByText('글이 바뀌었어요. 다시 점검해 주세요.')).toBeVisible();
    await page.getByRole('button', { name: '광고 문구 점검 다시 하기' }).click();
    await expect(result.getByText('규칙에 걸린 표현 없음')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-06 화면: 점검·홍보 글 화면이 1440·1024·768·390 너비와 두 테마에서 가로 스크롤 없이 결과까지 보인다', async ({ browser }) => {
    test.setTimeout(240000);
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [768, 1024],
      [390, 844],
    ] as const) {
      for (const colorScheme of ['light', 'dark'] as const) {
        const ctx = await loggedIn(browser, ADMIN, { viewport: { width, height }, colorScheme });
        const page = await ctx.newPage();
        await page.goto(url('/docs/adcheck'));
        await runCheck(page, AC1_TEXT);
        await expect(page.getByRole('article', { name: '점검 규칙 사전' }).getByRole('row').filter({ hasText: '전문병원' })).toHaveCount(1);
        await expectNoHorizontalScroll(page, `adcheck ${width}-${colorScheme}`);
        await page.goto(url('/docs/promo'));
        await page.getByTestId('ai-panel-promo').getByLabel('주제').fill('스케일링 주기 안내');
        await page.getByTestId('ai-panel-promo').getByRole('button', { name: '초안 만들기' }).click();
        await expect(page.getByTestId('adcheck-result')).toBeVisible({ timeout: 15000 });
        await expectNoHorizontalScroll(page, `promo ${width}-${colorScheme}`);
        if (width === 390 && colorScheme === 'dark') expect(await axe(page)).toEqual([]);
        await ctx.close();
      }
    }
  });
});

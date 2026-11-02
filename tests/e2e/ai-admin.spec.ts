// 이 파일이 하는 일: AI 관리 화면 E2E(phase-02-task-03 AC1~AC3). 이 파일 전용 격리 서버(tests/e2e/fixtures.ts)를 가짜 LLM 서버(tests/fake-llm)에 연결해 띄운다.
// 가짜 서버 주소는 isoServer.extraEnv(AI_BASE_URL_ANTHROPIC/OPENAI/GEMINI)로 넘기고 서버를 다시 켠다. 주소가 없으면 e2e 서버가 닫힌 로컬 주소로 막으므로
// 실제 공급자로는 요청이 나가지 않는다(가짜 서버가 받은 요청 수로도 매번 확인).
// 순서: 기록 없는 사용량 화면의 빈 상태(AC3) → 키 저장·끝 4자리·새로고침(AC1) → 단가 수정 전후 가짜 공급자 호출 비용(AC2) → 사용량 표(AC3) → 두 화면의 접근성·가로 스크롤.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { startFakeLlm, type FakeLlm } from '../fake-llm/server.ts';
import { expect, test } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'aiadmin', password: 'Ai-Admin-Pass-7' };
/** 가짜 키(가짜 LLM 서버로만 간다) */
const KEY = 'sk-ant-e2e-ONLYFAKE-9fK2';
const WIDTHS: Array<[number, number]> = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];

let fake: FakeLlm;

test.beforeAll(async () => {
  fake = await startFakeLlm();
});

test.afterAll(async () => {
  await fake.close();
});

/** 이 파일의 테스트 서버가 가짜 LLM 서버 주소를 쓰게 한다(처음 한 번 다시 켬, 같은 데이터 폴더) */
test.beforeEach(async ({ isoServer }) => {
  if (isoServer.extraEnv.AI_BASE_URL_ANTHROPIC === fake.url) return;
  isoServer.extraEnv = { AI_BASE_URL_ANTHROPIC: fake.url, AI_BASE_URL_OPENAI: fake.url, AI_BASE_URL_GEMINI: fake.url };
  await isoServer.stop();
  await isoServer.start();
});

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

/** 첫 설정(처음 한 번)과 관리자 로그인 */
async function signIn(page: Page): Promise<void> {
  const s = await page.request.get('/api/session');
  if (((await s.json()) as { data: { setupRequired: boolean } }).data.setupRequired) {
    const r = await page.request.post('/api/setup', { data: { ...ADMIN, withDemo: false } });
    expect(r.status()).toBe(201);
  }
  const r = await page.request.post('/api/auth/login', { data: { username: ADMIN.username, password: ADMIN.password } });
  expect(r.status()).toBe(200);
}

/** AI 시험 패널에서 실행하고 결과 비용 글을 돌려준다 */
async function runTry(page: Page, text: string): Promise<string> {
  const panel = page.getByTestId('ai-panel-quick');
  await panel.getByLabel('시험 요청').fill(text);
  await panel.getByRole('button', { name: '실행' }).click();
  const cost = panel.getByTestId('ai-cost');
  await expect(cost).toBeVisible({ timeout: 15000 });
  return (await cost.textContent()) ?? '';
}

test.describe.serial('AI 설정·사용량 화면', () => {
  test('phase-02-task-03 AC3: 기록이 없을 때 사용량 화면에 이번 달 비용·예산 대비 요약과 빈 상태가 보인다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/admin/ai-usage');
    await expect(page.getByRole('heading', { level: 1, name: 'AI 사용량·비용' })).toBeVisible();
    const kpis = page.getByRole('region', { name: 'AI 사용 요약' });
    await expect(kpis.getByText('2026년 11월 비용')).toBeVisible();
    await expect(kpis.getByText('예산 대비')).toBeVisible();
    await expect(kpis).toContainText('0원');
    await expect(page.getByText('2026년 11월 AI 사용 기록이 없어요')).toBeVisible();
    await expect(page.getByRole('link', { name: 'AI 설정 보기' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('phase-02-task-03 AC1: 관리자가 키를 입력·저장하면 끝 4자리만 보이고, 새로고침 후에도 원문이 보이지 않는다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/admin/ai');
    await expect(page.getByRole('heading', { level: 1, name: 'AI 설정·예산' })).toBeVisible();
    const row = page.getByTestId('key-anthropic');
    await expect(row.getByText('키 없음')).toBeVisible();
    await row.getByLabel('Anthropic Claude API 키').fill(KEY);
    await row.getByRole('button', { name: '키 저장' }).click();
    await expect(page.getByText('Anthropic Claude 키를 저장했어요')).toBeVisible();

    const check = async () => {
      const r = page.getByTestId('key-anthropic');
      await expect(r.getByText('키 저장됨')).toBeVisible();
      await expect(r.getByTestId('masked-anthropic')).toHaveText(`••••${KEY.slice(-4)}`);
      await expect(r.getByLabel('Anthropic Claude API 키')).toHaveValue('');
      expect(await page.content()).not.toContain(KEY);
      expect(await page.content()).not.toContain(KEY.slice(0, -4));
    };
    await check();
    await page.reload();
    await check();
    // API 응답에도 원문이 없다
    const api = await page.request.get('/api/ai/settings');
    expect(await api.text()).not.toContain(KEY);
    expect(await api.text()).toContain(`••••${KEY.slice(-4)}`);
    expect(fake.requests.length).toBe(0);
    expect(errors).toEqual([]);
  });

  test('phase-02-task-03 AC2: 모델 단가를 고치면 그 뒤 가짜 공급자 호출의 비용이 새 단가로 계산된다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/admin/ai');
    // 공급자 Anthropic, 환율 1달러 = 1,000원
    await page.getByLabel('AI 공급자').selectOption('anthropic');
    await page.getByLabel('환율(1달러당 원)').fill('1000');
    await page.getByRole('button', { name: '설정 저장', exact: true }).click();
    await expect(page.getByText('AI 설정을 저장했어요')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).locator('xpath=..')).toContainText('Anthropic Claude로 동작 중');

    // 가짜 공급자 사용량: 입력 1,200 · 출력 340 토큰
    fake.setReply('가짜 공급자가 쓴 주차 안내 멘트입니다.', { input: 1200, output: 340 });
    const n0 = fake.requests.length;
    // 기본 단가(빠름 0.10 / 0.50달러): (1200×0.1 + 340×0.5) ÷ 100만 × 1000 = 0.29원
    const before = await runTry(page, '주차 2시간 무료 안내 멘트 만들어줘');
    expect(before).toContain('비용 1원 미만');
    expect(before).toContain('입력 1,200');
    expect(before).toContain('출력 340');
    expect(fake.requests.length).toBe(n0 + 1);
    expect(fake.requests.at(-1)?.provider).toBe('anthropic');
    expect(fake.requests.at(-1)?.headers['x-api-key']).toBe(KEY);
    await expect(page.getByTestId('ai-output')).toContainText('가짜 공급자가 쓴 주차 안내 멘트입니다.');

    // 단가 수정: 빠름 입력 50달러, 출력 100달러
    await page.getByLabel('Anthropic Claude 빠름 입력 단가').fill('50');
    await page.getByLabel('Anthropic Claude 빠름 출력 단가').fill('100');
    await page.getByRole('button', { name: '단가 저장' }).click();
    await expect(page.getByText(/모델·단가 1줄을 저장했어요/)).toBeVisible();

    // 새 단가: (1200×50 + 340×100) ÷ 100만 × 1000 = 94원
    const after = await runTry(page, '주차 2시간 무료 안내 멘트 다시 만들어줘');
    expect(after).toContain('비용 94원');
    expect(fake.requests.length).toBe(n0 + 2);

    // 새로고침해도 표에 새 단가가 남아 있다
    await page.reload();
    await expect(page.getByLabel('Anthropic Claude 빠름 입력 단가')).toHaveValue('50');
    await expect(page.getByLabel('Anthropic Claude 빠름 출력 단가')).toHaveValue('100');
    // 기록에도 새 단가 비용이 남는다
    const usage = (await (await page.request.get('/api/ai/usage')).json()) as { data: { recent: Array<{ costKrw: number; demo: boolean }> } };
    expect(usage.data.recent[0]?.demo).toBe(false);
    expect(usage.data.recent[0]?.costKrw).toBeCloseTo(94, 6);
    expect(usage.data.recent[1]?.costKrw).toBeCloseTo(0.29, 6);
    expect(errors).toEqual([]);
  });

  test('phase-02-task-03 AC3: 기록이 있으면 이번 달 비용·예산 대비 %·기능별 표가 보인다', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/admin/ai-usage');
    const kpis = page.getByRole('region', { name: 'AI 사용 요약' });
    // 94.29원 / 예산 40,000원 = 0.2%
    await expect(kpis.getByText('2026년 11월 비용').locator('..')).toContainText('94원');
    await expect(kpis.getByText('예산 대비').locator('..')).toContainText('0.2%');
    const table = page.getByRole('table', { name: '기능별 사용량' });
    await expect(table).toBeVisible();
    const row = table.getByRole('row', { name: /빠른 요청/ });
    await expect(row).toContainText('2회');
    await expect(row).toContainText('94원');
    await expect(page.getByRole('table', { name: '사용자별 사용량' })).toContainText(ADMIN.name);
    await expect(page.getByRole('table', { name: '최근 AI 사용 기록' })).toContainText('claude-haiku-5-5');
    await expect(page.getByText('AI 사용 기록이 없어요')).toHaveCount(0);
    // 지난달로 가면 빈 상태
    await page.getByRole('button', { name: '이전 달' }).click();
    await expect(page.getByText('2026년 10월 AI 사용 기록이 없어요')).toBeVisible();
    expect(errors).toEqual([]);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`phase-02-task-03 화면: /admin/ai 접근성 위반 0건(${theme})`, async ({ browser, isoServer }) => {
      const ctx = await browser.newContext({ baseURL: isoServer.baseURL, viewport: { width: 1440, height: 900 }, colorScheme: theme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
      const page = await ctx.newPage();
      await signIn(page);
      await page.goto('/admin/ai');
      await expect(page.getByLabel('Anthropic Claude 빠름 입력 단가')).toBeVisible();
      await page.getByTestId('ai-panel-quick').getByLabel('시험 요청').fill('문의 010-2222-3333');
      await expect(page.getByTestId('privacy-warning')).toBeVisible();
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      await ctx.close();
    });

    test(`phase-02-task-03 화면: /admin/ai-usage 접근성 위반 0건(${theme})`, async ({ browser, isoServer }) => {
      const ctx = await browser.newContext({ baseURL: isoServer.baseURL, viewport: { width: 1440, height: 900 }, colorScheme: theme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
      const page = await ctx.newPage();
      await signIn(page);
      await page.goto('/admin/ai-usage');
      await expect(page.getByRole('table', { name: '기능별 사용량' })).toBeVisible();
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      await ctx.close();
    });
  }

  for (const path of ['/admin/ai', '/admin/ai-usage']) {
    test(`phase-02-task-03 화면: ${path} 4너비에서 가로 스크롤이 없다`, async ({ browser, isoServer }) => {
      for (const [width, height] of WIDTHS) {
        const ctx = await browser.newContext({ baseURL: isoServer.baseURL, viewport: { width, height }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
        const page = await ctx.newPage();
        await signIn(page);
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('.skel')).toHaveCount(0);
        const m = (await page.evaluate('({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })')) as { sw: number; iw: number };
        expect(m.sw, `${path} ${width}px 가로 스크롤`).toBeLessThanOrEqual(m.iw);
        await ctx.close();
      }
    });
  }
});

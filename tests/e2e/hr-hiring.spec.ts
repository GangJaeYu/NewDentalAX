// 이 파일이 하는 일: 채용 공고·면접 질문 화면 E2E(phase-04-task-07 AC1~AC3, FR-084). 이 파일 전용 격리 서버(fixtures.ts, 키 없음 = 데모 공급자)에서
// 데모 공고와 직무·태도·상황 질문이 보이는지(AC1), 근무 조건에 "20대 여성 우대"를 넣으면 차별 소지 경고가 바로 보이고 공고에도 이어지는지(AC2),
// 저장한 초안이 보관함(saved_texts kind=hiring)에서 새로고침 뒤에도 다시 열리는지(AC3)를 실제 브라우저로 확인한다. axe 위반 0건, 4너비 × 2테마 가로 스크롤 없음도 본다.
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'hireadmin', password: 'Hiring-Admin-Pass-9', withDemo: false };
const STAFF = { username: 'hirestaff', password: 'Hiring-Staff-Pass-9', name: '서다온' };
const CLEAN = '주 5일(월~금 9:30~18:30), 4대 보험, 연차 15일';

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

async function loggedIn(browser: Browser, who: { username: string; password: string }, opts: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: opts.viewport ?? { width: 1440, height: 900 }, colorScheme: opts.colorScheme ?? 'light' });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  return ctx;
}

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** 근무 조건 입력란(AiPanel 안) */
const conditionsBox = (page: Page) => page.getByTestId('ai-panel-hiring').getByLabel('근무 조건', { exact: true });

/** 입력하고 공고 초안을 만든다 */
async function makeDraft(page: Page, input: { jobType?: string; preferred?: string; conditions: string }): Promise<void> {
  if (input.jobType) await page.getByLabel('직무', { exact: true }).fill(input.jobType);
  if (input.preferred !== undefined) await page.getByLabel('우대 사항(선택)').fill(input.preferred);
  await conditionsBox(page).fill(input.conditions);
  await page.getByTestId('ai-panel-hiring').getByRole('button', { name: /공고 초안 만들기|다시 만들기/ }).click();
  await expect(page.getByTestId('hiring-questions')).toBeVisible({ timeout: 15000 });
}

test.describe.serial('채용 공고·면접 질문', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
  });

  test('phase-04-task-07 AC1: 데모 모드로 채용 공고 초안과 면접 질문(직무·태도·상황 구분)이 표시된다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/hiring'));
    await expect(page.getByRole('heading', { level: 1, name: '채용 공고·면접 질문' })).toBeVisible();
    await expect(page.getByText('왼쪽에서 공고 초안을 만들거나')).toBeVisible();
    await expect(page.getByLabel('직무', { exact: true })).toHaveValue('치과위생사');

    await makeDraft(page, { preferred: '치과 근무 경력 1년 이상', conditions: CLEAN });
    const draft = page.getByRole('form', { name: '채용 공고 초안' });
    const posting = draft.getByLabel('채용 공고', { exact: true });
    await expect(posting).toHaveValue(/## 하늘숲치과 치과위생사 채용/);
    await expect(posting).toHaveValue(/- 주 5일\(월~금 9:30~18:30\)/);
    await expect(posting).toHaveValue(/### 우대 사항\n- 치과 근무 경력 1년 이상/);
    await expect(posting).not.toHaveValue(/데모 응답/);
    await expect(page.getByText('AI 키가 없어 예시 초안을 넣었어요.')).toBeVisible();

    // 질문은 직무 → 태도 → 상황으로 나뉘어 2개씩 보인다
    const groups = page.getByTestId('hiring-questions').locator('.hire-qgroup');
    await expect(groups).toHaveCount(3);
    for (const [i, type] of (['직무', '태도', '상황'] as const).entries()) {
      const g = page.getByTestId(`hiring-qgroup-${type}`);
      await expect(groups.nth(i)).toHaveAttribute('data-testid', `hiring-qgroup-${type}`);
      await expect(g).toContainText(`${type} 질문`);
      await expect(g.getByRole('listitem')).toHaveCount(2);
    }
    await expect(page.getByTestId('hiring-qgroup-직무')).toContainText('스케일링');
    await expect(page.getByTestId('hiring-qgroup-상황')).toContainText('어떻게 하시겠어요?');
    // 날 JSON은 보이지 않는다
    await expect(page.getByTestId('ai-panel-hiring')).not.toContainText('"questions"');
    // 깨끗한 조건·공고는 "없음" 확인 줄
    await expect(page.getByTestId('hiring-risk-conditions')).toContainText('근무 조건: 차별 소지 표현 없음');
    await expect(page.getByTestId('hiring-risk-posting')).toContainText('채용 공고: 차별 소지 표현 없음');

    // 직무를 바꾸면 직무 질문도 바뀐다
    await makeDraft(page, { jobType: '데스크·상담 코디네이터', conditions: CLEAN });
    await expect(posting).toHaveValue(/데스크·상담 코디네이터 채용/);
    await expect(page.getByTestId('hiring-qgroup-직무')).toContainText('예약 변경 전화');
    // 복사
    await draft.getByRole('button', { name: '공고·질문 복사' }).click();
    await expect(draft.getByRole('button', { name: '복사했어요' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-07 AC2: 조건에 "20대 여성 우대"를 넣으면 차별 소지 경고가 바로 보이고, 공고에 옮겨지면 공고에도 경고한다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/hiring'));
    await conditionsBox(page).fill('주 5일, 20대 여성 우대');

    // 만들기 전에도 입력하는 동안 바로 경고
    const risk = page.getByTestId('hiring-risk-conditions');
    await expect(risk).toContainText('근무 조건에 차별 소지 표현이 있어요');
    await expect(risk.getByRole('alert')).toContainText('빼야 해요 2건');
    const marks = risk.locator('mark');
    await expect(marks).toHaveCount(2);
    await expect(marks.nth(0)).toHaveText('20대1');
    await expect(marks.nth(1)).toHaveText('여성 우대2');
    const hits = risk.getByTestId('hiring-risk-hit');
    await expect(hits.nth(0)).toContainText('“20대”');
    await expect(hits.nth(0)).toContainText('나이');
    await expect(hits.nth(0)).toContainText('연령차별금지법');
    await expect(hits.nth(0)).toContainText('바꿀 말');
    await expect(hits.nth(1)).toContainText('“여성 우대”');
    await expect(hits.nth(1)).toContainText('성별');
    await expect(hits.nth(1)).toContainText('남녀고용평등법');
    expect(await axe(page)).toEqual([]);

    // 우대 사항의 결혼 조건도 따로 경고
    await page.getByLabel('우대 사항(선택)').fill('미혼자 우대');
    await expect(page.getByTestId('hiring-risk-preferred')).toContainText('우대 사항에 차별 소지 표현이 있어요');
    await expect(page.getByTestId('hiring-risk-preferred')).toContainText('결혼·임신·출산');

    // 그대로 만들면 공고에도 옮겨져 공고 경고가 보인다
    await page.getByTestId('ai-panel-hiring').getByRole('button', { name: '공고 초안 만들기' }).click();
    const postingRisk = page.getByTestId('hiring-risk-posting');
    await expect(postingRisk).toContainText('채용 공고에 차별 소지 표현이 있어요', { timeout: 15000 });
    await expect(postingRisk.getByTestId('hiring-risk-hit')).toHaveCount(3);

    // 공고에서 지우면 경고가 사라진다
    const posting = page.getByRole('form', { name: '채용 공고 초안' }).getByLabel('채용 공고', { exact: true });
    const fixed = (await posting.inputValue()).replace('- 20대 여성 우대\n', '').replace('- 미혼자 우대', '- 치과 근무 경력 1년 이상');
    await posting.fill(fixed);
    await expect(postingRisk).toContainText('채용 공고: 차별 소지 표현 없음');
    // 조건에서 지워도 사라진다
    await conditionsBox(page).fill(CLEAN);
    await expect(risk).toContainText('근무 조건: 차별 소지 표현 없음');
    await expect(risk.locator('mark')).toHaveCount(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-07 AC3: 저장한 초안이 보관함(saved_texts kind=hiring)에서 새로고침 뒤에도 다시 열린다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/hiring'));
    await expect(page.getByText('아직 보관한 글이 없어요')).toBeVisible();
    await makeDraft(page, { jobType: '간호조무사', preferred: '진료 보조 경력 우대', conditions: '주 4일, 오후 근무' });
    const draft = page.getByRole('form', { name: '채용 공고 초안' });
    const posting = draft.getByLabel('채용 공고', { exact: true });
    // 공고를 조금 고친 뒤 저장한다
    const edited = `${await posting.inputValue()}\n- 면접 때 근무복을 미리 보여 드려요.`;
    await posting.fill(edited);
    await draft.getByLabel('보관함 제목').fill('간호조무사 오후 채용');
    await draft.getByRole('button', { name: '보관함에 저장' }).click();
    await expect(draft.getByRole('button', { name: '저장했어요' })).toBeVisible();
    const lib = page.getByRole('list', { name: '채용 공고 보관함' });
    await expect(lib.getByTestId('saved-item')).toHaveCount(1);
    await expect(lib).toContainText('간호조무사 오후 채용');
    await expect(lib).toContainText('간호조무사');

    // 서버에도 kind=hiring으로 들어갔다
    const api = await ctx.request.get(url('/api/saved-texts?kind=hiring'));
    const rows = ((await api.json()) as { data: Array<{ kind: string; title: string; body: string; meta: Record<string, string> }> }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'hiring', title: '간호조무사 오후 채용', meta: { jobType: '간호조무사', conditions: '주 4일, 오후 근무', preferred: '진료 보조 경력 우대' } });
    expect(rows[0]!.body).toContain('면접 때 근무복을 미리 보여 드려요.');
    expect(rows[0]!.body).toContain('### 태도 질문');

    // 새로고침하면 초안 칸은 비고, 보관함에서 불러오면 그대로 다시 열린다
    await page.reload();
    await expect(page.getByText('왼쪽에서 공고 초안을 만들거나')).toBeVisible();
    await page.getByRole('button', { name: '간호조무사 오후 채용 불러오기' }).click();
    await expect(page.getByTestId('hiring-loaded')).toContainText('“간호조무사 오후 채용”을 다시 열었어요.');
    await expect(posting).toHaveValue(edited);
    for (const type of ['직무', '태도', '상황']) await expect(page.getByTestId(`hiring-qgroup-${type}`).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByTestId('hiring-qgroup-직무')).toContainText('감염 관리');
    await expect(draft.getByLabel('보관함 제목')).toHaveValue('간호조무사 오후 채용');
    // 입력 칸도 저장 때 값으로 채워진다
    await expect(page.getByLabel('직무', { exact: true })).toHaveValue('간호조무사');
    await expect(page.getByLabel('우대 사항(선택)')).toHaveValue('진료 보조 경력 우대');
    await expect(conditionsBox(page)).toHaveValue('주 4일, 오후 근무');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`phase-04-task-07 화면: 경고·초안이 보이는 상태에서 접근성 위반 0건, 4너비 가로 스크롤 없음(${theme})`, async ({ browser }) => {
      const ctx = await loggedIn(browser, STAFF, { colorScheme: theme });
      const page = await ctx.newPage();
      await page.goto(url('/hr/hiring'));
      await makeDraft(page, { conditions: '주 5일, 20대 여성 우대, 용모 단정' });
      await expect(page.getByTestId('hiring-risk-posting')).toContainText('차별 소지 표현이 있어요');
      expect(await axe(page)).toEqual([]);
      for (const [w, h] of [
        [1440, 900],
        [1024, 768],
        [768, 1024],
        [390, 844],
      ] as const) {
        await page.setViewportSize({ width: w, height: h });
        const { sw, iw } = (await page.evaluate('({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })')) as { sw: number; iw: number };
        expect(iw, `${w}px 창 너비 그대로`).toBe(w);
        expect(sw, `${w}px ${theme}`).toBeLessThanOrEqual(iw);
      }
      await ctx.close();
    });
  }
});

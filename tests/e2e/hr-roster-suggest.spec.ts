// 이 파일이 하는 일: 근무표 "AI 배정 제안" 화면 E2E(phase-06-task-02 AC1~AC3, FR-131). 이 파일 전용 격리 서버(fixtures.ts, TEST_NOW 2026-11-02 월요일)를
// 가짜 LLM 서버(tests/fake-llm) 주소로 띄운다. 처음에는 데모 모드로, 실장이 조건을 골라 제안을 받으면 미리보기에서 승인 연차일(정하늘 11/3)에 근무가 없고
// 진료일마다 최소 인원이 맞는지(AC1), 취소하면 근무표가 그대로이고 "적용하기"를 눌러야 바뀌는지(AC2)를 본다. 직원에게는 버튼이 없고 API도 403이다.
// 마지막에 공급자를 가짜 서버로 바꾸고, 가짜 서버가 받은 요청 본문에 직원 이름이 하나도 없는지(AC3)와 AI가 휴가일에 넣은 근무를 서버가 빼는지 본다.
// 대화상자는 4너비 × 2테마에서 가로 스크롤 없음(390px은 휴대폰 흉내, innerWidth 390 유지)과 axe 위반 0건을 확인한다.
import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';
import { startFakeLlm, type FakeLlm } from '../fake-llm/server.ts';

const KEY = 'sk-ant-e2e-ONLYFAKE-roster-8Hd2';
const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'rgadmin', password: 'RosterAi-Admin-Pass-9', withDemo: false };
const MANAGER = { username: 'rgmanager', password: 'RosterAi-Manager-Pass-9', name: '윤실장' };
const STAFF = [
  { username: 'rghanul', password: 'RosterAi-Staff1-Pass-9', name: '정하늘', jobType: 'hygienist' },
  { username: 'rgsodam', password: 'RosterAi-Staff2-Pass-9', name: '오소담', jobType: 'hygienist' },
  { username: 'rgchaeun', password: 'RosterAi-Staff3-Pass-9', name: '임채은', jobType: 'assistant' },
  { username: 'rgdaon', password: 'RosterAi-Staff4-Pass-9', name: '서다온', jobType: 'desk' },
] as const;
const OPEN_DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
const WIDTHS: Array<[number, number]> = [
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
];

let server: IsoServer;
let fake: FakeLlm;
const url = (p: string) => `${server.baseURL}${p}`;

interface Who {
  username: string;
  password: string;
}
interface View {
  users: Array<{ id: number; name: string }>;
  shiftTypes: Array<{ id: number; label: string }>;
  days: Array<{ date: string; cells: Record<string, { shiftTypeId: number | null; leave?: { label: string } }>; total: number }>;
}

let ids: Record<string, number> = {};
let types: Record<string, number> = {};

test.beforeAll(async () => {
  fake = await startFakeLlm();
});
test.afterAll(async () => {
  await fake.close();
});

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

/** 새 브라우저 묶음에 API로 로그인한다. CSRF 토큰도 돌려준다 */
async function loggedIn(browser: Browser, who: Who, opts: BrowserContextOptions = { viewport: { width: 1440, height: 900 } }): Promise<{ ctx: BrowserContext; csrf: string }> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...opts });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  const body = (await r.json()) as { data: { csrfToken: string } };
  return { ctx, csrf: body.data.csrfToken };
}

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

async function getRoster(req: APIRequestContext): Promise<View> {
  const r = await req.get(url('/api/roster?from=2026-11-02&to=2026-11-08'));
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: View }).data;
}

/** 근무표 칸(직원·날짜) */
function cell(page: Page, userId: number, date: string) {
  return page.locator(`td[data-user="${userId}"][data-date="${date}"]`);
}

/** 미리보기 칸·인원 */
function pcell(page: Page, userId: number, date: string) {
  return page.locator(`td[data-suggest-user="${userId}"][data-date="${date}"]`);
}
function ptotal(page: Page, date: string) {
  return page.locator(`td[data-suggest-total="${date}"]`);
}

/** 근무표에서 대화상자를 열고 하루 최소 인원을 정해 제안을 받는다 */
async function openAndSuggest(page: Page, minStaff = '3') {
  await page.goto(url('/hr/roster'));
  await page.getByRole('button', { name: 'AI 배정 제안' }).click();
  const dialog = page.getByRole('dialog', { name: 'AI 배정 제안 · 11월 2일 ~ 8일' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('하루 최소 인원').fill(minStaff);
  await dialog.getByRole('button', { name: '제안 받기' }).click();
  await expect(dialog.getByTestId('roster-suggest-preview')).toBeVisible();
  return dialog;
}

test.describe.serial('AI 근무표 배정 제안', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test('준비: 가짜 LLM 주소로 서버를 띄우고, 직원 넷(직무)·실장, 정하늘 11/3 연차 승인, 서다온 11/4 야간 칸을 넣는다', async ({ isoServer, browser }) => {
    server = isoServer;
    isoServer.extraEnv = { AI_BASE_URL_ANTHROPIC: fake.url, AI_BASE_URL_OPENAI: fake.url, AI_BASE_URL_GEMINI: fake.url };
    await isoServer.stop();
    await isoServer.start();
    const setup = await browser.newContext();
    const r = await setup.request.post(url('/api/setup'), { data: ADMIN });
    expect(r.status()).toBe(201);
    await setup.close();
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    for (const s of STAFF) await isoServer.addUser('staff', s.username, s.password, s.name);

    const admin = await loggedIn(browser, ADMIN);
    const users = ((await (await admin.ctx.request.get(url('/api/users'))).json()) as { data: Array<{ id: number; name: string }> }).data;
    ids = Object.fromEntries(users.map((u) => [u.name, u.id]));
    for (const s of STAFF) {
      const p = await admin.ctx.request.patch(url(`/api/users/${ids[s.name]}`), { headers: { 'x-csrf-token': admin.csrf }, data: { jobType: s.jobType } });
      expect(p.status(), s.name).toBe(200);
    }
    await admin.ctx.close();

    const hanul = await loggedIn(browser, STAFF[0]);
    const manager = await loggedIn(browser, MANAGER);
    const lr = await hanul.ctx.request.post(url('/api/leave'), { headers: { 'x-csrf-token': hanul.csrf }, data: { type: 'annual', startOn: '2026-11-03', endOn: '2026-11-03', reason: '개인 일정' } });
    expect(lr.status()).toBe(201);
    const leaveId = ((await lr.json()) as { data: { id: number } }).data.id;
    expect((await manager.ctx.request.post(url(`/api/leave/${leaveId}/decide`), { headers: { 'x-csrf-token': manager.csrf }, data: { approve: true } })).status()).toBe(200);
    const v = await getRoster(manager.ctx.request);
    types = Object.fromEntries(v.shiftTypes.map((t) => [t.label, t.id]));
    const put = await manager.ctx.request.put(url('/api/roster/cell'), { headers: { 'x-csrf-token': manager.csrf }, data: { userId: ids['서다온'], date: '2026-11-04', shiftTypeId: types['야간'] } });
    expect(put.status()).toBe(200);
    await hanul.ctx.close();
    await manager.ctx.close();
  });

  test('phase-06-task-02 AC1: 데모 제안 미리보기에서 정하늘의 승인 연차일(11/3)에는 근무가 없고, 진료일마다 최소 3명이 근무한다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/roster'));
    await page.getByRole('button', { name: 'AI 배정 제안' }).click();
    const dialog = page.getByRole('dialog', { name: 'AI 배정 제안 · 11월 2일 ~ 8일' });
    await expect(dialog.getByText('S1, S2 같은 번호')).toBeVisible();
    await expect(dialog.getByText('"적용하기"를 눌러야 근무표가 바뀌어요.')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    // 입력 오류는 쉬운 한국어로
    await dialog.getByLabel('하루 최소 인원').fill('-1');
    await dialog.getByRole('button', { name: '제안 받기' }).click();
    await expect(dialog.getByText('하루 최소 인원은 0 이상으로 적어 주세요.')).toBeVisible();

    await dialog.getByLabel('하루 최소 인원').fill('3');
    await dialog.getByLabel('치과위생사 최소').fill('1');
    await dialog.getByRole('button', { name: '제안 받기' }).click();
    const preview = dialog.getByTestId('roster-suggest-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByText('데모 응답')).toBeVisible();
    await expect(preview.getByText(/^바뀌는 칸 \d+개$/)).toBeVisible();
    // 정하늘 11/3: "연차"만 있고 근무 유형 칩이 없다
    await expect(pcell(page, ids['정하늘'] as number, '2026-11-03')).toHaveText('연차');
    await expect(pcell(page, ids['오소담'] as number, '2026-11-03')).toHaveText(/종일/);
    for (const d of OPEN_DAYS) {
      const n = Number(((await ptotal(page, d).textContent()) ?? '').replace('명', ''));
      expect(n, d).toBeGreaterThanOrEqual(3);
    }
    // 토요일은 최소 인원만 "오전", 일요일(휴진)은 비어 있다
    await expect(dialog.locator('td[data-date="2026-11-07"]').filter({ hasText: '오전' })).toHaveCount(3);
    await expect(ptotal(page, '2026-11-08')).toHaveText('0명');
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-06-task-02 AC2: 제안을 취소하면 근무표가 그대로이고, "적용하기"를 눌러야 바뀌며 새로 고쳐도 남는다', async ({ browser }) => {
    const manager = await loggedIn(browser, MANAGER);
    const before = await getRoster(manager.ctx.request);
    const page = await manager.ctx.newPage();
    const errors = watchErrors(page);
    const dialog = await openAndSuggest(page);
    // 미리보기에는 서다온 11/4가 "종일"로 바뀌어 보이지만, 근무표는 아직 "야간"이다
    await expect(pcell(page, ids['서다온'] as number, '2026-11-04')).toHaveText(/종일/);
    await expect(pcell(page, ids['서다온'] as number, '2026-11-04').locator('.rs-changed')).toHaveCount(1);
    await expect(cell(page, ids['서다온'] as number, '2026-11-04')).toHaveText('야간');
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toBeHidden();
    await expect(cell(page, ids['서다온'] as number, '2026-11-04')).toHaveText('야간');
    await expect(cell(page, ids['오소담'] as number, '2026-11-02')).toHaveText('-');
    expect(await getRoster(manager.ctx.request)).toEqual(before);
    await page.reload();
    await expect(cell(page, ids['오소담'] as number, '2026-11-02')).toHaveText('-');

    // Esc로 닫아도 그대로
    await page.getByRole('button', { name: 'AI 배정 제안' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '제안 받기' }).click();
    await expect(page.getByTestId('roster-suggest-preview')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await getRoster(manager.ctx.request)).toEqual(before);

    // 적용
    const d2 = await openAndSuggest(page);
    await d2.getByRole('button', { name: '적용하기' }).click();
    await expect(page.getByText(/^AI 제안을 11월 2일 ~ 8일 근무표에 적용했어요\. 근무 \d+칸\.$/)).toBeVisible();
    await expect(d2).toBeHidden();
    await expect(cell(page, ids['서다온'] as number, '2026-11-04')).toHaveText('종일');
    await expect(cell(page, ids['오소담'] as number, '2026-11-02')).toHaveText('종일');
    await expect(cell(page, ids['정하늘'] as number, '2026-11-03')).toHaveText('연차');
    await page.reload();
    await expect(cell(page, ids['오소담'] as number, '2026-11-02')).toHaveText('종일');
    const after = await getRoster(manager.ctx.request);
    expect(after.days.find((d) => d.date === '2026-11-03')?.cells[String(ids['정하늘'])]?.shiftTypeId ?? null).toBeNull();
    for (const d of OPEN_DAYS) expect(after.days.find((x) => x.date === d)?.total ?? 0, d).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
    await manager.ctx.close();
  });

  test('phase-06-task-02 AC2: 직원에게는 "AI 배정 제안" 버튼이 없고, 제안·적용 API는 403이다', async ({ browser }) => {
    const staff = await loggedIn(browser, STAFF[1]);
    const page = await staff.ctx.newPage();
    await page.goto(url('/hr/roster'));
    await expect(page.getByRole('heading', { level: 1, name: '근무표' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI 배정 제안' })).toHaveCount(0);
    const h = { 'x-csrf-token': staff.csrf };
    expect((await staff.ctx.request.post(url('/api/roster/suggest'), { headers: h, data: { weekStart: '2026-11-02', minStaff: 1 } })).status()).toBe(403);
    expect((await staff.ctx.request.post(url('/api/roster/apply'), { headers: h, data: { weekStart: '2026-11-02', cells: [] } })).status()).toBe(403);
    await staff.ctx.close();
  });

  test('phase-06-task-02 화면: 조건·미리보기 대화상자가 4너비 × 2테마에서 가로 스크롤 없이 보이고 axe 위반이 없다', async ({ browser }) => {
    for (const [width, height] of WIDTHS) {
      for (const scheme of ['light', 'dark'] as const) {
        const opts: BrowserContextOptions = width === 390 ? { viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme } : { viewport: { width, height }, colorScheme: scheme };
        const m = await loggedIn(browser, MANAGER, opts);
        const page = await m.ctx.newPage();
        await page.goto(url('/hr/roster'));
        await page.getByRole('button', { name: 'AI 배정 제안' }).click();
        await expect(page.getByLabel('하루 최소 인원')).toBeVisible();
        await expectNoHorizontalScroll(page, `${width} ${scheme} 조건`);
        await page.getByRole('dialog').getByRole('button', { name: '제안 받기' }).click();
        await expect(page.getByTestId('roster-suggest-preview')).toBeVisible();
        await expectNoHorizontalScroll(page, `${width} ${scheme} 미리보기`);
        if (width === 1440 || width === 390) expect(await axe(page), `${width} ${scheme}`).toEqual([]);
        await m.ctx.close();
      }
    }
  });

  test('phase-06-task-02 AC3: 가짜 AI 서버가 받은 요청 본문에 직원 이름이 없고, AI가 휴가일에 넣은 근무는 서버가 빼서 미리보기에 보인다', async ({ browser }) => {
    const admin = await loggedIn(browser, ADMIN);
    const s = await admin.ctx.request.put(url('/api/ai/settings'), { headers: { 'x-csrf-token': admin.csrf }, data: { provider: 'anthropic', keys: { anthropic: KEY } } });
    expect(s.status()).toBe(200);
    await admin.ctx.close();
    // 직원 순서(근무표와 같은 직무 순서): S1 정하늘(치과위생사) … 휴가일 11/3에 일부러 "종일"을 넣은 틀린 제안
    const v = await (async () => {
      const m = await loggedIn(browser, MANAGER);
      const r = await getRoster(m.ctx.request);
      await m.ctx.close();
      return r;
    })();
    const ref = (name: string) => `S${v.users.findIndex((u) => u.name === name) + 1}`;
    fake.setReply(
      JSON.stringify({
        assignments: [
          { staff: ref('정하늘'), date: '2026-11-03', shift: types['종일'] },
          ...OPEN_DAYS.slice(0, 5).map((date) => ({ staff: ref('서다온'), date, shift: types['종일'] })),
        ],
        note: '가짜 AI가 만든 제안',
      }),
      { input: 1200, output: 300 },
    );
    const before = fake.requests.length;

    const manager = await loggedIn(browser, MANAGER);
    const page = await manager.ctx.newPage();
    const errors = watchErrors(page);
    const dialog = await openAndSuggest(page, '2');
    expect(fake.requests.length).toBe(before + 1);
    const req = fake.requests.at(-1);
    const sent = `${req?.rawBody ?? ''}\n${JSON.stringify(req?.body ?? null)}`;
    for (const name of [ADMIN.name, MANAGER.name, ...STAFF.map((x) => x.name)]) expect(sent, name).not.toContain(name);
    for (const u of [ADMIN.username, MANAGER.username, ...STAFF.map((x) => x.username)]) expect(sent, u).not.toContain(u);
    expect(sent).toContain(ref('정하늘'));
    expect(sent).toContain('휴가(근무 불가): 2026-11-03');

    const preview = dialog.getByTestId('roster-suggest-preview');
    await expect(preview.getByText('AI 응답', { exact: true })).toBeVisible();
    await expect(preview.getByText('AI 설명: 가짜 AI가 만든 제안')).toBeVisible();
    await expect(pcell(page, ids['정하늘'] as number, '2026-11-03')).toHaveText('연차');
    await preview.getByText(/^규칙에 맞게 고친 내용 \d+건$/).click();
    await expect(preview.getByText('정하늘 11월 3일(화)에는 승인된 연차가 있어서 AI가 넣은 "종일" 근무를 뺐어요.')).toBeVisible();
    for (const d of OPEN_DAYS) {
      const n = Number(((await ptotal(page, d).textContent()) ?? '').replace('명', ''));
      expect(n, d).toBeGreaterThanOrEqual(2);
    }
    expect(await axe(page)).toEqual([]);
    await dialog.getByRole('button', { name: '취소' }).click();
    expect(errors).toEqual([]);
    await manager.ctx.close();
  });
});

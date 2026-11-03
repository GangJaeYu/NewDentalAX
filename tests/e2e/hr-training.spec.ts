// 이 파일이 하는 일: 교육 이수 기록·신규 직원 온보딩 화면 E2E(phase-04-task-02 AC1~AC3, FR-082·083). 이 파일 전용 격리 서버(fixtures.ts, TEST_NOW 2026-11-02, 키 없음 = 데모 AI)에서
// 실장이 화면에서 "감염관리 교육(1년마다)"을 만들고 → 직원이 2025-12-01 이수를 기록하면 다음 예정 2026-12-01·D-29가 보이고, 직원·실장 알림함에 알림이 오며 다른 직원에게는 없다(AC1).
// 증빙 PDF를 골라 기록한 뒤 기록 목록에서 내려받으면 같은 내용이다(AC2). AI(데모)로 치과위생사 초안 → 템플릿 저장 → 신규 직원·멘토 배정 →
// 직원이 체크하면 직원·멘토 화면 모두 진행률 %가 바뀐다(AC3). 화면마다 axe 위반 0건과 휴대폰 너비(390px) 가로 스크롤 없음도 본다.
import fs from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'tradmin', password: 'Train-Admin-Pass-9', withDemo: false };
const MANAGER = { username: 'trmanager', password: 'Train-Manager-Pass-9', name: '윤실장' };
const STAFF = { username: 'trstaff', password: 'Train-Staff-Pass-9', name: '정하늘' };
const OTHER = { username: 'trother', password: 'Train-Other-Pass-9', name: '서다온' };
const NEWBIE = { username: 'trnewbie', password: 'Train-Newbie-Pass-9', name: '배누리' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

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

/** 새 브라우저 묶음을 만들고 API로 로그인해 둔다 */
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

async function noHorizontalScroll(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
}

/** 알림함 제목들(API) */
async function noteTitles(ctx: BrowserContext): Promise<string[]> {
  const r = await ctx.request.get(url('/api/notifications?pageSize=50'));
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: { title: string; type: string }[] }).data.filter((n) => n.type === 'training_due').map((n) => n.title);
}

test.describe.serial('교육 이수 기록과 온보딩', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    for (const s of [STAFF, OTHER, NEWBIE]) await isoServer.addUser('staff', s.username, s.password, s.name);
  });

  test('phase-04-task-02 AC1: 주기 12개월 교육을 2025-12-01 이수로 기록하면 다음 예정 2026-12-01(D-29)이 보이고, 해당 직원과 실장에게 알림이 간다', async ({ browser }) => {
    // 1) 실장이 화면에서 교육 항목을 만든다
    const mctx = await loggedIn(browser, MANAGER);
    const mpage = await mctx.newPage();
    const merrors = watchErrors(mpage);
    await mpage.goto(url('/hr/training'));
    await expect(mpage.getByRole('heading', { level: 1, name: '교육 이수 기록' })).toBeVisible();
    await expect(mpage.getByText('등록된 교육 항목이 없어요')).toBeVisible();
    await mpage.getByRole('button', { name: '교육 항목 추가', exact: true }).click();
    const form = mpage.getByRole('dialog', { name: '교육 항목 추가' });
    await form.getByLabel('교육 이름').fill('감염관리 교육');
    await expect(form.getByLabel('주기')).toHaveValue('12');
    await form.getByRole('button', { name: '저장' }).click();
    await expect(mpage.getByText('"감염관리 교육" 교육 항목을 추가했어요.')).toBeVisible();
    await expect(mpage.getByRole('table', { name: '교육 항목 목록' })).toContainText('1년마다');

    // 2) 직원이 본인 이수를 기록한다
    const sctx = await loggedIn(browser, STAFF);
    const page = await sctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/training'));
    const myTable = page.getByRole('table', { name: '내 교육 이수 현황' });
    await expect(myTable.getByRole('row').filter({ hasText: '감염관리 교육' })).toContainText('이수 기록 필요');
    // 직원에게는 항목 관리·직원별 현황이 없다
    await expect(page.getByRole('button', { name: '교육 항목 추가' })).toHaveCount(0);
    await expect(page.getByRole('table', { name: '직원별 교육 이수 현황' })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);

    await page.getByRole('button', { name: '이수 기록하기' }).first().click();
    const dlg = page.getByRole('dialog', { name: '이수 기록하기' });
    await expect(dlg.getByLabel('이수일')).toHaveValue('2026-11-02');
    await dlg.getByLabel('이수일').fill('2025-12-01');
    await dlg.getByRole('button', { name: '기록하기' }).click();
    await expect(page.getByText('정하늘 님 감염관리 교육 이수를 기록했어요. 다음 예정일은 2026-12-01이에요. 예정일이 가까워 알림을 보냈어요.')).toBeVisible();
    const row = myTable.getByRole('row').filter({ hasText: '감염관리 교육' });
    await expect(row).toContainText('2025-12-01');
    await expect(row).toContainText('2026-12-01');
    await expect(row).toContainText('D-29');

    // 3) 알림: 직원 본인·실장에게 있고, 다른 직원에게는 없다
    const title = '정하늘 님 감염관리 교육 이수 예정일이 29일 남았어요';
    expect(await noteTitles(sctx)).toEqual([title]);
    expect(await noteTitles(mctx)).toEqual([title]);
    const octx = await loggedIn(browser, OTHER);
    expect(await noteTitles(octx)).toEqual([]);
    await page.goto(url('/notifications'));
    await expect(page.getByText(title).first()).toBeVisible();

    // 4) 실장 화면 직원별 현황(지남·임박)에 같은 값이 보인다
    await mpage.goto(url('/hr/training'));
    const pairRow = mpage.getByRole('table', { name: '직원별 교육 이수 현황' }).getByRole('row').filter({ hasText: STAFF.name });
    await expect(pairRow).toContainText('2026-12-01');
    await expect(pairRow).toContainText('D-29');
    expect(await axe(mpage)).toEqual([]);
    expect(errors).toEqual([]);
    expect(merrors).toEqual([]);
    await Promise.all([sctx.close(), mctx.close(), octx.close()]);
  });

  test('phase-04-task-02 AC2: 증빙 파일을 올려 기록한 뒤 기록 목록에서 내려받으면 같은 파일이다', async ({ browser }) => {
    const sctx = await loggedIn(browser, STAFF);
    const page = await sctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/training'));
    const row = page.getByRole('table', { name: '내 교육 이수 현황' }).getByRole('row').filter({ hasText: '감염관리 교육' });
    await row.getByRole('button', { name: `${STAFF.name} 감염관리 교육 이수 기록`, exact: true }).click();
    const dlg = page.getByRole('dialog', { name: '이수 기록하기' });
    await dlg.getByLabel('이수일').fill('2025-12-05');
    await dlg.getByLabel('메모(선택)').fill('보건소 온라인 교육');
    await dlg.locator('input[type=file]').setInputFiles({ name: '감염관리 이수증.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(dlg.getByTestId('training-file-picked')).toContainText('감염관리 이수증.pdf');
    expect(await axe(page)).toEqual([]);
    await dlg.getByRole('button', { name: '기록하기' }).click();
    await expect(page.getByText(/감염관리 교육 이수를 기록했어요\. 다음 예정일은 2026-12-05이에요/)).toBeVisible();
    await expect(row).toContainText('D-33');

    // 기록 목록 → 증빙 파일 내려받기
    await row.getByRole('button', { name: `${STAFF.name} 감염관리 교육 기록 2건 보기` }).click();
    const list = page.getByRole('dialog', { name: `${STAFF.name} · 감염관리 교육 이수 기록` });
    await expect(list.getByRole('list', { name: '이수 기록 목록' }).getByRole('listitem')).toHaveCount(2);
    await expect(list).toContainText('보건소 온라인 교육');
    await expect(list).toContainText('증빙 파일 없음');
    const [download] = await Promise.all([page.waitForEvent('download'), list.getByRole('link', { name: '2025-12-05 증빙 감염관리 이수증.pdf 내려받기' }).click()]);
    expect(download.suggestedFilename()).toBe('감염관리 이수증.pdf');
    const saved = await download.path();
    expect(fs.readFileSync(saved).equals(PDF)).toBe(true);
    expect(await axe(page)).toEqual([]);

    // 다른 직원은 이 파일을 받을 수 없다
    const id = (await (await sctx.request.get(url('/api/trainings'))).json()) as { data: { trainings: { id: number }[] } };
    const recs = (await (await sctx.request.get(url(`/api/trainings/${id.data.trainings[0]?.id}/records`))).json()) as { data: { id: number; file: unknown }[] };
    const withFile = recs.data.find((r) => r.file);
    const octx = await loggedIn(browser, OTHER);
    expect((await octx.request.get(url(`/api/trainings/records/${withFile?.id}/file`))).status()).toBe(403);
    expect(errors).toEqual([]);
    await Promise.all([sctx.close(), octx.close()]);
  });

  test('phase-04-task-02 AC3: AI(데모) 치과위생사 초안 → 템플릿 저장 → 신규 직원 배정 → 체크하면 직원·멘토 화면 모두 진행률이 바뀐다', async ({ browser }) => {
    // 1) 실장: AI 초안 → 템플릿 저장
    const mctx = await loggedIn(browser, MANAGER);
    const mpage = await mctx.newPage();
    const merrors = watchErrors(mpage);
    await mpage.goto(url('/hr/onboarding'));
    await expect(mpage.getByRole('heading', { level: 1, name: '신규 직원 온보딩' })).toBeVisible();
    await expect(mpage.getByText('아직 템플릿이 없어요')).toBeVisible();
    await expect(mpage.getByRole('combobox', { name: '직무', exact: true })).toHaveValue('hygienist');
    const panel = mpage.getByTestId('ai-panel-onboarding');
    await panel.getByRole('button', { name: '초안 만들기' }).click();
    const draft = mpage.getByTestId('onb-draft');
    await expect(draft).toBeVisible({ timeout: 15000 });
    const items = draft.getByRole('list', { name: 'AI 초안 항목' }).getByRole('textbox');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(8);
    await expect(items.first()).not.toHaveValue(/데모 응답/);
    const values: string[] = [];
    for (let i = 0; i < count; i += 1) values.push(await items.nth(i).inputValue());
    expect(values.some((v) => v.includes('스케일링'))).toBe(true);
    await expect(draft.getByLabel('템플릿 이름')).toHaveValue('치과위생사 온보딩 체크리스트');
    await draft.getByRole('button', { name: '템플릿으로 저장' }).click();
    await expect(mpage.getByText('"치과위생사 온보딩 체크리스트" 템플릿을 저장했어요. 이제 신규 직원에게 배정할 수 있어요.')).toBeVisible();
    const tplRow = mpage.getByRole('table', { name: '직무별 온보딩 템플릿' }).getByRole('row').filter({ hasText: '치과위생사 온보딩 체크리스트' });
    await expect(tplRow).toContainText(`항목 ${count}개 · AI 초안`);
    expect(await axe(mpage)).toEqual([]);

    // 2) 배정: 신규 직원 배누리, 멘토 정하늘
    await mpage.getByRole('button', { name: '온보딩 배정하기', exact: true }).click();
    const assign = mpage.getByRole('dialog', { name: '온보딩 배정' });
    await assign.getByLabel('신규 직원').selectOption({ label: `${NEWBIE.name} · 기타` });
    await assign.getByLabel('담당 멘토').selectOption({ label: `${STAFF.name} · 기타` });
    await assign.getByRole('button', { name: '배정하기' }).click();
    await expect(mpage.getByText(`${NEWBIE.name} 님에게 "치과위생사 온보딩 체크리스트"을(를) 배정했어요. 멘토는 ${STAFF.name} 님이에요.`)).toBeVisible();
    const allRow = mpage.getByRole('table', { name: '전체 온보딩 배정과 진행률' }).getByRole('row').filter({ hasText: NEWBIE.name });
    await expect(allRow).toContainText('0%');

    // 3) 신규 직원이 두 항목을 체크한다
    const nctx = await loggedIn(browser, NEWBIE);
    const npage = await nctx.newPage();
    const nerrors = watchErrors(npage);
    await npage.goto(url('/hr/onboarding'));
    const myCard = npage.getByRole('article', { name: '내 온보딩', exact: true }).getByTestId('onb-card');
    await expect(myCard).toContainText(`멘토 ${STAFF.name}`);
    await expect(myCard.getByTestId('onb-percent')).toHaveText('0%');
    const boxes = myCard.getByRole('checkbox');
    await expect(boxes).toHaveCount(count);
    await boxes.nth(0).check();
    await expect(myCard.getByTestId('onb-percent')).toHaveText(`${Math.round((1 / count) * 100)}%`);
    await boxes.nth(1).check();
    const two = `${Math.round((2 / count) * 100)}%`;
    await expect(myCard.getByTestId('onb-percent')).toHaveText(two);
    await expect(myCard).toContainText(`${count}개 중 2개 끝냄`);
    expect(await axe(npage)).toEqual([]);

    // 4) 멘토 화면에도 같은 진행률이 보이고, 멘토가 체크하면 직원 화면도 바뀐다
    const sctx = await loggedIn(browser, STAFF);
    const spage = await sctx.newPage();
    const serrors = watchErrors(spage);
    await spage.goto(url('/hr/onboarding'));
    const mentorCard = spage.getByRole('article', { name: '내가 멘토인 직원', exact: true }).getByTestId('onb-card');
    await expect(mentorCard).toContainText(`${NEWBIE.name} 님`);
    await expect(mentorCard.getByTestId('onb-percent')).toHaveText(two);
    await mentorCard.getByRole('checkbox').nth(2).check();
    const three = `${Math.round((3 / count) * 100)}%`;
    await expect(mentorCard.getByTestId('onb-percent')).toHaveText(three);
    expect(await axe(spage)).toEqual([]);
    await npage.reload();
    await expect(npage.getByRole('article', { name: '내 온보딩', exact: true }).getByTestId('onb-percent')).toHaveText(three);
    await expect(npage.getByRole('article', { name: '내 온보딩', exact: true })).toContainText(STAFF.name);
    // 실장 화면 전체 목록도 같은 값
    await mpage.reload();
    await expect(mpage.getByRole('table', { name: '전체 온보딩 배정과 진행률' }).getByRole('row').filter({ hasText: NEWBIE.name })).toContainText(three);

    // 상관없는 직원은 이 배정을 보지 못한다
    const octx = await loggedIn(browser, OTHER);
    const opage = await octx.newPage();
    await opage.goto(url('/hr/onboarding'));
    await expect(opage.getByText('배정된 온보딩이 없어요').first()).toBeVisible();
    await expect(opage.getByTestId('onb-card')).toHaveCount(0);
    expect(merrors).toEqual([]);
    expect(nerrors).toEqual([]);
    expect(serrors).toEqual([]);
    await Promise.all([mctx.close(), nctx.close(), sctx.close(), octx.close()]);
  });

  test('phase-04-task-02: 휴대폰 너비(390px)에서 두 화면 모두 가로 스크롤이 없다', async ({ browser }) => {
    for (const who of [MANAGER, NEWBIE]) {
      const ctx = await loggedIn(browser, who, { width: 390, height: 844 });
      const page = await ctx.newPage();
      await page.goto(url('/hr/training'));
      await expect(page.getByRole('heading', { level: 1, name: '교육 이수 기록' })).toBeVisible();
      await expect(page.getByRole('table', { name: '내 교육 이수 현황' })).toBeVisible();
      await noHorizontalScroll(page);
      await page.goto(url('/hr/onboarding'));
      await expect(page.getByRole('heading', { level: 1, name: '신규 직원 온보딩' })).toBeVisible();
      await expect(page.getByText(/불러오는 중이에요/)).toHaveCount(0);
      await noHorizontalScroll(page);
      await ctx.close();
    }
  });
});

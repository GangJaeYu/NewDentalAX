// 이 파일이 하는 일: 법정 의무 일정 화면 E2E(phase-03-task-08 AC1~AC5, FR-100). 이 파일 전용 격리 서버(fixtures.ts, TEST_NOW 2026-11-02)에서
// 직원이 TD-022 22개 항목을 근거·출처 링크·확인 상태 칩과 법령 변경 고지와 함께 보는지(AC1·AC5), 관리자가 템플릿에서 "파노라마 정기검사"를 만들고
// 실장이 최근 수행일 2023-11-23을 기록하면 다음 예정일 2026-11-23·D-21이 보이는지(AC2), "해당 없음"으로 끈 항목이 다가오는 일정·알림에서 빠지는지(AC3),
// 관리자가 주기를 바꾸면 예정일이 다시 계산되고 활동 기록에 남으며 실장은 수정할 수 없는지(AC4)를 본다. axe 위반 0건·4너비 가로 스크롤 없음도 확인한다.
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'lgadmin', password: 'Legal-Admin-Pass-8', withDemo: false };
const MANAGER = { username: 'lgmanager', password: 'Legal-Manager-Pass-8', name: '윤실장' };
const STAFF = { username: 'lgstaff', password: 'Legal-Staff-Pass-8', name: '서다온' };

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

/** 이 브라우저 묶음의 CSRF 토큰(API를 직접 부를 때) */
async function csrf(ctx: BrowserContext): Promise<Record<string, string>> {
  const s = (await (await ctx.request.get(url('/api/session'))).json()) as { data: { csrfToken: string } };
  return { 'x-csrf-token': s.data.csrfToken };
}

/** 목록 표의 한 줄(항목 이름으로) */
function row(page: Page, title: string) {
  return page.getByTestId('legal-table').getByRole('row').filter({ hasText: title });
}

/** 항목 이름으로 id를 찾는다 */
async function idOf(ctx: BrowserContext, title: string): Promise<number> {
  const l = (await (await ctx.request.get(url('/api/legal-tasks'))).json()) as { data: { items: Array<{ id: number; title: string }> } };
  const t = l.data.items.find((i) => i.title === title);
  expect(t, title).toBeTruthy();
  return t?.id ?? 0;
}

test.describe.serial('법정 의무 일정', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
  });

  test('phase-03-task-08 AC1·AC5: 직원 화면에 TD-022 22개 항목이 근거·출처 링크·확인 상태 칩과 함께 보이고 법령 변경 고지가 있다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/facility/legal'));
    await expect(page.getByRole('heading', { name: '법정 의무 일정' })).toBeVisible();
    // AC5: 고지
    await expect(page.getByTestId('legal-notice')).toContainText('법령은 바뀔 수 있습니다(확인일 2026-11-02)');
    await expect(page.getByTestId('legal-notice')).toContainText('관할 기관 안내를 확인하세요');
    // AC1: 22줄, 줄마다 근거 법령 링크(새 창, law.go.kr)와 확인 상태 칩
    const rows = page.getByTestId('legal-table').locator('tbody tr');
    await expect(rows).toHaveCount(22);
    for (let i = 0; i < 22; i += 1) {
      const r = rows.nth(i);
      const link = r.getByRole('link', { name: /법령 보기/ });
      await expect(link).toHaveAttribute('href', /^https:\/\/www\.law\.go\.kr\//);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(r.locator('.chip').filter({ hasText: /^(확인됨|권장값|확인 필요)$/ })).toHaveCount(1);
    }
    for (const title of ['진단용 방사선 발생장치 정기검사(장비별)', '개인 피폭선량 측정(TLD)', '의료폐기물 보관기간 안내', '소방시설 종합점검', '비급여 진료비용 보고', '간호조무사 보수교육·신고']) {
      await expect(row(page, title)).toHaveCount(1);
    }
    await expect(row(page, '간호조무사 보수교육·신고').locator('.chip', { hasText: /^확인 필요$/ })).toBeVisible();
    await expect(row(page, '감염병 예방 교육').locator('.chip', { hasText: /^권장값$/ })).toBeVisible();
    await expect(row(page, '진단용 방사선 발생장치 정기검사(장비별)')).toContainText('진단용 방사선 규칙 제4조');
    await expect(row(page, '의료폐기물 배출자 교육')).toContainText('최초 수행일 입력 필요');
    // 직원은 추가·수행 기록 버튼이 없다. 자세히 보기에서 적용 배제 설명이 보인다
    await expect(page.getByRole('button', { name: '항목 추가' })).toHaveCount(0);
    await row(page, '개인 피폭선량 측정(TLD)').click();
    const drawer = page.getByRole('dialog', { name: '개인 피폭선량 측정(TLD)' });
    await expect(drawer).toContainText('10mA·분');
    await expect(drawer.getByRole('button', { name: '기록 저장' })).toHaveCount(0);
    await expect(drawer.getByText('관리자 설정')).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    await drawer.getByRole('button', { name: '닫기' }).click();
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-08 AC2: 관리자가 템플릿으로 "파노라마 정기검사"를 만들고, 실장이 최근 수행일 2023-11-23을 기록하면 다음 예정일 2026-11-23·D-21이 보인다', async ({ browser }) => {
    const actx = await loggedIn(browser, ADMIN);
    const admin = await actx.newPage();
    const aErrors = watchErrors(admin);
    await admin.goto(url('/facility/legal'));
    await admin.getByRole('button', { name: '항목 추가' }).click();
    const dialog = admin.getByRole('dialog', { name: '법정 일정 추가' });
    await dialog.getByLabel('템플릿에서 가져오기(선택)').selectOption({ label: '진단용 방사선 발생장치 정기검사(장비별)' });
    await expect(dialog.getByLabel('주기(개월)')).toHaveValue('36');
    await expect(dialog.getByLabel('근거')).toHaveValue('진단용 방사선 규칙 제4조');
    await dialog.getByLabel('항목 이름').fill('파노라마 정기검사');
    expect(await axe(admin)).toEqual([]);
    await dialog.getByRole('button', { name: '추가' }).click();
    await expect(admin.getByText('"파노라마 정기검사" 항목을 추가했어요.')).toBeVisible();
    await expect(admin.getByRole('dialog', { name: '파노라마 정기검사' })).toContainText('최초 수행일 입력 필요');
    expect(aErrors).toEqual([]);
    await actx.close();

    const mctx = await loggedIn(browser, MANAGER);
    const page = await mctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/facility/legal'));
    await row(page, '파노라마 정기검사').click();
    const drawer = page.getByRole('dialog', { name: '파노라마 정기검사' });
    await expect(drawer.getByText('관리자 설정')).toHaveCount(0);
    // 앞으로의 날짜는 화면에서 막는다
    await drawer.getByLabel('수행일').fill('2026-11-05');
    await drawer.getByRole('button', { name: '기록 저장' }).click();
    await expect(drawer.getByText('오늘이나 지난 날짜를 골라 주세요.')).toBeVisible();
    await drawer.getByLabel('수행일').fill('2023-11-23');
    await drawer.getByLabel('메모').fill('검사기관 정기검사 합격');
    await drawer.getByRole('button', { name: '기록 저장' }).click();
    await expect(page.getByText('수행 기록을 남겼어요. 다음 예정일은 2026-11-23이에요.')).toBeVisible();
    await expect(drawer.getByTestId('legal-next-due')).toHaveText('2026-11-23 (D-21)');
    await expect(drawer.getByTestId('legal-logs')).toContainText('2023-11-23');
    await expect(drawer.getByTestId('legal-logs')).toContainText(MANAGER.name);
    expect(await axe(page)).toEqual([]);
    // 새로 고쳐도 목록에 남는다
    await page.reload();
    await expect(row(page, '파노라마 정기검사')).toContainText('2026-11-23');
    await expect(row(page, '파노라마 정기검사')).toContainText('D-21');
    await expect(row(page, '파노라마 정기검사')).toContainText('최근 수행 2023-11-23');
    expect(errors).toEqual([]);
    await mctx.close();
  });

  test('phase-03-task-08 AC3: "해당 없음"으로 끈 항목은 다가오는 일정과 알림에서 빠진다', async ({ browser, isoServer }) => {
    // 실장이 TLD(3개월)를 2026-08-10에 했다고 기록 → 2026-11-10, D-8
    const mctx = await loggedIn(browser, MANAGER);
    const tldId = await idOf(mctx, '개인 피폭선량 측정(TLD)');
    const done = await mctx.request.post(url(`/api/legal-tasks/${tldId}/done`), { headers: await csrf(mctx), data: { doneOn: '2026-08-10' } });
    expect(done.status()).toBe(200);
    await mctx.close();

    const actx = await loggedIn(browser, ADMIN);
    const page = await actx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/facility/legal?view=due'));
    await expect(row(page, '개인 피폭선량 측정(TLD)')).toContainText('D-8');
    await expect(row(page, '파노라마 정기검사')).toContainText('D-21');
    await row(page, '개인 피폭선량 측정(TLD)').click();
    const drawer = page.getByRole('dialog', { name: '개인 피폭선량 측정(TLD)' });
    await drawer.getByRole('button', { name: '해당 없음으로 끄기' }).click();
    await expect(page.getByText('"개인 피폭선량 측정(TLD)"을(를) 해당 없음으로 껐어요. 대시보드·알림에서 빠져요.')).toBeVisible();
    await expect(drawer.getByRole('button', { name: '다시 켜기' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: '기록 저장' })).toHaveCount(0);
    await drawer.getByRole('button', { name: '닫기' }).click();
    // 다가오는 일정에서 빠지고, 해당 없음 보기에 보인다
    await expect(row(page, '개인 피폭선량 측정(TLD)')).toHaveCount(0);
    await expect(row(page, '파노라마 정기검사')).toHaveCount(1);
    await page.getByRole('group', { name: '보는 범위' }).getByRole('button', { name: '해당 없음' }).click();
    await expect(row(page, '개인 피폭선량 측정(TLD)').locator('.chip', { hasText: '해당 없음' })).toBeVisible();
    expect(errors).toEqual([]);
    await actx.close();

    // 서버를 다시 켜면 기한 알림 찾기가 돈다(서버 시작 때·매시). 켜진 파노라마만 알림이 가고 꺼진 TLD는 가지 않는다
    await isoServer.stop();
    await isoServer.start();
    const m2 = await loggedIn(browser, MANAGER);
    const legalOf = async () => {
      const list = (await (await m2.request.get(url('/api/notifications'))).json()) as { data: Array<{ type: string; title: string; link: string }> };
      return list.data.filter((n) => n.type === 'legal_due');
    };
    // 서버 시작 직후 알림 찾기가 끝날 때까지 잠깐 기다린다
    await expect.poll(async () => (await legalOf()).map((n) => n.title)).toEqual(['파노라마 정기검사 기한이 21일 남았어요']);
    expect((await legalOf())[0]?.link).toBe('/facility/legal');
    const s2 = await loggedIn(browser, STAFF);
    const staffList = (await (await s2.request.get(url('/api/notifications'))).json()) as { data: Array<{ type: string }> };
    expect(staffList.data.filter((n) => n.type === 'legal_due')).toEqual([]);
    await m2.close();
    await s2.close();
  });

  test('phase-03-task-08 AC4: 관리자가 주기를 바꾸면 다음 예정일이 다시 계산되고 활동 기록에 남으며, 실장은 주기를 고칠 수 없다', async ({ browser }) => {
    // 실장: 화면에 수정 버튼이 없고, API로 보내도 403
    const mctx = await loggedIn(browser, MANAGER);
    const panoId = await idOf(mctx, '파노라마 정기검사');
    const mpage = await mctx.newPage();
    await mpage.goto(url('/facility/legal'));
    await row(mpage, '파노라마 정기검사').click();
    await expect(mpage.getByRole('button', { name: '주기·상태 수정' })).toHaveCount(0);
    const denied = await mctx.request.patch(url(`/api/legal-tasks/${panoId}`), { headers: await csrf(mctx), data: { cycleMonths: 12 } });
    expect(denied.status()).toBe(403);
    await mctx.close();

    const actx = await loggedIn(browser, ADMIN);
    const page = await actx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/facility/legal'));
    await expect(row(page, '파노라마 정기검사')).toContainText('2026-11-23');
    await row(page, '파노라마 정기검사').click();
    await page.getByRole('button', { name: '주기·상태 수정' }).click();
    const form = page.getByRole('form', { name: '법정 일정 설정 수정' });
    await expect(form.getByLabel('주기(개월)')).toHaveValue('36');
    await form.getByLabel('주기(개월)').fill('24');
    await form.getByLabel('주기 설명').fill('');
    expect(await axe(page)).toEqual([]);
    await form.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('"파노라마 정기검사" 설정을 저장했어요. 다음 예정일을 다시 계산했어요.')).toBeVisible();
    const drawer = page.getByRole('dialog', { name: '파노라마 정기검사' });
    await expect(drawer.getByTestId('legal-next-due')).toHaveText('2025-11-23 (기한 지남 344일)');
    await expect(drawer).toContainText('2년마다');
    await drawer.getByRole('button', { name: '닫기' }).click();
    await expect(row(page, '파노라마 정기검사')).toContainText('기한 지남 344일');

    // 활동 기록(감사 로그)에 주기 변경과 예정일 전·후가 남는다
    const audit = (await (await actx.request.get(url('/api/audit?action=legal.update'))).json()) as {
      data: Array<{ action: string; userName: string | null; detail: { changes?: Record<string, { from: unknown; to: unknown }>; nextDueOn?: { from: string; to: string } } }>;
    };
    const entry = audit.data.find((e) => e.detail.changes?.cycle_months);
    expect(entry?.userName).toBe(ADMIN.name);
    expect(entry?.detail.changes?.cycle_months).toEqual({ from: 36, to: 24 });
    expect(entry?.detail.nextDueOn).toEqual({ from: '2026-11-23', to: '2025-11-23' });
    expect(errors).toEqual([]);
    await actx.close();
  });

  test('phase-03-task-08 화면: 1440·1024·768·390 너비와 두 테마에서 가로 스크롤이 없다', async ({ browser }) => {
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [768, 1024],
      [390, 844],
    ] as const) {
      for (const colorScheme of ['light', 'dark'] as const) {
        const ctx = await loggedIn(browser, ADMIN, { viewport: { width, height }, colorScheme });
        const page = await ctx.newPage();
        await page.goto(url('/facility/legal'));
        await expect(row(page, '파노라마 정기검사')).toHaveCount(1);
        await expectNoHorizontalScroll(page, `${width}-${colorScheme}`);
        await ctx.close();
      }
    }
  });
});

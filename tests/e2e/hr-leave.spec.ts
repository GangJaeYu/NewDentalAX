// 이 파일이 하는 일: 연차·휴가 화면 E2E(phase-03-task-09 AC1~AC4, FR-080). 이 파일 전용 격리 서버(fixtures.ts, TEST_NOW 2026-11-02 월요일)에서
// 직원이 화면에서 반차를 신청 → 실장 알림 → 실장이 승인 → 직원 알림·잔여 14.5일(AC1), 반려 사유를 비우면 저장되지 않고 오류 문구가 보임(AC2),
// 같은 날 이미 2명이 승인된 날을 승인하려 하면 목록·대화상자에 경고가 보이고 승인은 됨(AC3), 직원에게는 승인 버튼이 없고 API로도 403(AC4)을 본다.
// 각 화면의 axe 위반 0건과 휴대폰 너비(390px) 가로 스크롤 없음도 확인한다. 무거운 axe 검사는 화면 단위로 나눠 한다.
import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'lvadmin', password: 'Leave-Admin-Pass-9', withDemo: false };
const MANAGER = { username: 'lvmanager', password: 'Leave-Manager-Pass-9', name: '윤실장' };
const STAFF = { username: 'lvstaff', password: 'Leave-Staff-Pass-9', name: '정하늘' };
const STAFF2 = { username: 'lvstaff2', password: 'Leave-Staff2-Pass-9', name: '서다온' };
const STAFF3 = { username: 'lvstaff3', password: 'Leave-Staff3-Pass-9', name: '오소담' };

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

/** 새 브라우저 묶음을 만들고 API로 로그인해 둔다. CSRF 토큰도 돌려준다 */
async function loggedIn(browser: Browser, who: { username: string; password: string }, viewport = { width: 1440, height: 900 }): Promise<{ ctx: BrowserContext; csrf: string }> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  const body = (await r.json()) as { data: { csrfToken: string } };
  return { ctx, csrf: body.data.csrfToken };
}

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** API로 신청한다(화면 흐름이 아닌 준비용) */
async function apiRequest(req: APIRequestContext, csrf: string, data: Record<string, unknown>): Promise<number> {
  const r = await req.post(url('/api/leave'), { headers: { 'x-csrf-token': csrf }, data });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { data: { id: number } }).data.id;
}

/** 요약 숫자 칸 하나의 값 */
function kpi(page: Page, label: string) {
  return page.getByRole('region', { name: '내 연차 요약' }).locator('.kpi').filter({ has: page.locator('small', { hasText: new RegExp(`^${label}$`) }) }).locator('b');
}

test.describe.serial('연차·휴가 신청과 승인', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    for (const s of [STAFF, STAFF2, STAFF3]) await isoServer.addUser('staff', s.username, s.password, s.name);
  });

  test('phase-03-task-09 AC1: 직원이 반차를 신청하면 실장에게 알림이 가고, 승인하면 직원에게 알림이 가며 잔여가 0.5일 줄어든다', async ({ browser }) => {
    // 1) 직원이 화면에서 오전 반차 신청
    const staff = await loggedIn(browser, STAFF);
    const page = await staff.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/leave'));
    await expect(page.getByRole('heading', { level: 1, name: '연차·휴가' })).toBeVisible();
    await expect(page.getByText('2026년 내 연차 잔여 15일')).toBeVisible();
    await expect(kpi(page, '잔여')).toHaveText('15일');
    await expect(page.getByText('아직 신청한 휴가가 없어요')).toBeVisible();
    // 직원 화면에는 승인 대기·직원별 현황이 없다
    await expect(page.getByRole('heading', { name: '승인 대기' })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);

    await page.getByRole('button', { name: '휴가 신청', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '휴가 신청', exact: true });
    await dialog.getByLabel('종류').selectOption('half_am');
    await dialog.getByLabel('날짜').fill('2026-11-06');
    await dialog.getByLabel('사유(선택)').fill('은행 업무');
    await expect(dialog.getByTestId('leave-preview')).toContainText('병원 진료일 기준 0.5일이에요');
    await expect(dialog.getByTestId('leave-preview')).toContainText('승인되면 남는 연차는 14.5일이에요');
    expect(await axe(page)).toEqual([]);
    await dialog.getByRole('button', { name: '신청하기' }).click();
    await expect(page.getByText('11월 6일(금) 반차(오전) 신청을 보냈어요. 실장님께 알림이 갔어요.')).toBeVisible();
    const myRow = page.getByRole('row').filter({ hasText: '11월 6일(금)' });
    await expect(myRow).toContainText('반차(오전)');
    await expect(myRow).toContainText('0.5일');
    await expect(myRow).toContainText('승인 대기');
    await expect(kpi(page, '승인 대기')).toHaveText('0.5일');
    await expect(kpi(page, '잔여')).toHaveText('15일');

    // 2) 실장에게 알림이 와 있고, 승인 대기 목록에서 승인한다
    const manager = await loggedIn(browser, MANAGER);
    const mpage = await manager.ctx.newPage();
    const merrors = watchErrors(mpage);
    await mpage.goto(url('/notifications'));
    await expect(mpage.getByText('정하늘 님이 휴가를 신청했어요').first()).toBeVisible();
    await mpage.goto(url('/hr/leave'));
    const item = mpage.getByTestId('leave-pending-item').filter({ hasText: STAFF.name });
    await expect(item).toContainText('11월 6일(금) · 0.5일');
    await expect(item).toContainText('사유: 은행 업무');
    await item.getByRole('button', { name: `${STAFF.name} 11월 6일(금) 승인` }).click();
    const approve = mpage.getByRole('dialog', { name: '휴가 승인' });
    await expect(approve).toContainText('반차(오전)');
    await expect(approve.getByTestId('leave-warnings')).toHaveCount(0);
    await approve.getByRole('button', { name: '승인하기' }).click();
    await expect(mpage.getByText('정하늘 님 휴가를 승인했어요.')).toBeVisible();
    await expect(mpage.getByText('승인을 기다리는 휴가가 없어요')).toBeVisible();
    const staffRow = mpage.getByRole('table', { name: '직원별 부여·사용·잔여 일수' }).getByRole('row').filter({ hasText: STAFF.name });
    await expect(staffRow).toContainText('14.5일');
    expect(await axe(mpage)).toEqual([]);

    // 3) 직원에게 결과 알림이 오고, 잔여가 14.5일로 줄었다
    await page.goto(url('/notifications'));
    await expect(page.getByText('11월 6일(금) 반차(오전) 신청이 승인됐어요').first()).toBeVisible();
    await page.goto(url('/hr/leave'));
    await expect(kpi(page, '사용')).toHaveText('0.5일');
    await expect(kpi(page, '잔여')).toHaveText('14.5일');
    await expect(page.getByRole('row').filter({ hasText: '11월 6일(금)' })).toContainText('승인');
    await expect(page.getByRole('row').filter({ hasText: '11월 6일(금)' })).toContainText(MANAGER.name);
    expect(errors).toEqual([]);
    expect(merrors).toEqual([]);
    await staff.ctx.close();
    await manager.ctx.close();
  });

  test('phase-03-task-09 AC2: 반려 사유를 비우면 저장되지 않고 오류 문구가 보이며, 사유를 적으면 반려되고 직원이 사유를 본다', async ({ browser }) => {
    const staff = await loggedIn(browser, STAFF);
    const id = await apiRequest(staff.ctx.request, staff.csrf, { type: 'annual', startOn: '2026-11-09', endOn: '2026-11-10', reason: '여행' });
    expect(id).toBeGreaterThan(0);

    const manager = await loggedIn(browser, MANAGER);
    const page = await manager.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/leave'));
    const item = page.getByTestId('leave-pending-item').filter({ hasText: '11월 9일(월)~11월 10일(화)' });
    await expect(item).toContainText('2일');
    await item.getByRole('button', { name: /반려$/ }).click();
    const dialog = page.getByRole('dialog', { name: '휴가 반려' });
    await dialog.getByRole('button', { name: '반려하기' }).click();
    await expect(dialog.getByText('반려 사유를 적어 주세요.')).toBeVisible();
    await expect(dialog.getByLabel('반려 사유')).toHaveAttribute('aria-invalid', 'true');
    // 공백만 적어도 같다
    await dialog.getByLabel('반려 사유').fill('   ');
    await dialog.getByRole('button', { name: '반려하기' }).click();
    await expect(dialog.getByText('반려 사유를 적어 주세요.')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    // 저장되지 않았다: 새로 고쳐도 승인 대기
    await page.reload();
    await expect(page.getByTestId('leave-pending-item').filter({ hasText: '11월 9일(월)~11월 10일(화)' })).toBeVisible();
    // 서버도 빈 사유를 거부한다
    const denied = await manager.ctx.request.post(url(`/api/leave/${id}/decide`), { headers: { 'x-csrf-token': manager.csrf }, data: { approve: false, reason: '' } });
    expect(denied.status()).toBe(400);
    expect(((await denied.json()) as { error: { fields: Record<string, string> } }).error.fields.reason).toBe('반려 사유를 적어 주세요.');

    // 사유를 적으면 반려된다
    await page.getByTestId('leave-pending-item').filter({ hasText: '11월 9일(월)~11월 10일(화)' }).getByRole('button', { name: /반려$/ }).click();
    await dialog.getByLabel('반려 사유').fill('그 주에 신규 직원 교육이 있어요');
    await dialog.getByRole('button', { name: '반려하기' }).click();
    await expect(page.getByText('정하늘 님 휴가를 반려했어요. 사유가 알림으로 전해졌어요.')).toBeVisible();
    await expect(page.getByTestId('leave-pending-item')).toHaveCount(0);

    const spage = await staff.ctx.newPage();
    await spage.goto(url('/notifications'));
    await expect(spage.getByText('11월 9일(월)~11월 10일(화) 연차 신청이 반려됐어요').first()).toBeVisible();
    await spage.goto(url('/hr/leave'));
    const row = spage.getByRole('row').filter({ hasText: '11월 9일(월)~11월 10일(화)' });
    await expect(row).toContainText('반려');
    await expect(row).toContainText('사유: 그 주에 신규 직원 교육이 있어요');
    // 반려된 연차는 잔여에서 빠지지 않는다
    await expect(kpi(spage, '잔여')).toHaveText('14.5일');
    expect(errors).toEqual([]);
    await staff.ctx.close();
    await manager.ctx.close();
  });

  test('phase-03-task-09 AC3: 같은 날 이미 2명이 승인된 날(하루 최대 2명)을 승인하려 하면 경고가 보이고, 승인은 된다', async ({ browser }) => {
    const manager = await loggedIn(browser, MANAGER);
    // 11월 11일(수)에 서다온·오소담을 먼저 승인해 둔다
    for (const who of [STAFF2, STAFF3]) {
      const s = await loggedIn(browser, who);
      const id = await apiRequest(s.ctx.request, s.csrf, { type: 'annual', startOn: '2026-11-11' });
      const ok = await manager.ctx.request.post(url(`/api/leave/${id}/decide`), { headers: { 'x-csrf-token': manager.csrf }, data: { approve: true } });
      expect(ok.status()).toBe(200);
      await s.ctx.close();
    }
    const staff = await loggedIn(browser, STAFF);
    await apiRequest(staff.ctx.request, staff.csrf, { type: 'half_pm', startOn: '2026-11-11', reason: '병원 진료 예약' });

    const page = await manager.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/leave'));
    const item = page.getByTestId('leave-pending-item').filter({ hasText: '11월 11일(수)' });
    await expect(item).toContainText('경고 1건');
    await expect(item.getByTestId('leave-warnings')).toContainText('11월 11일(수)에 이미 2명이 휴가예요. 승인하면 하루 최대 2명을 넘어요.');
    expect(await axe(page)).toEqual([]);

    await item.getByRole('button', { name: /승인$/ }).click();
    const dialog = page.getByRole('dialog', { name: '휴가 승인' });
    await expect(dialog.getByTestId('leave-warnings')).toContainText('11월 11일(수)에 이미 2명이 휴가예요. 승인하면 하루 최대 2명을 넘어요.');
    await expect(dialog.getByText('경고가 있어도 승인할 수 있어요.')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await dialog.getByRole('button', { name: '경고를 확인했고 승인하기' }).click();
    await expect(page.getByText('정하늘 님 휴가를 승인했어요. 경고 1건을 확인해 주세요.')).toBeVisible();
    await expect(page.getByTestId('leave-pending-item')).toHaveCount(0);
    // 전체 기록에서 승인으로 보인다
    await page.getByRole('group', { name: '상태로 거르기' }).getByRole('button', { name: '승인', exact: true }).click();
    const history = page.getByRole('table', { name: '전체 휴가 신청 기록' });
    await expect(history.getByRole('row').filter({ hasText: '11월 11일(수)' })).toHaveCount(3);
    expect(errors).toEqual([]);
    await staff.ctx.close();
    await manager.ctx.close();
  });

  test('phase-03-task-09 AC4: 직원에게는 승인 버튼이 없고, 다른 사람 신청을 API로 승인하려 하면 403이다', async ({ browser }) => {
    const other = await loggedIn(browser, STAFF2);
    const id = await apiRequest(other.ctx.request, other.csrf, { type: 'sick', startOn: '2026-11-13' });
    await other.ctx.close();

    const staff = await loggedIn(browser, STAFF);
    const page = await staff.ctx.newPage();
    await page.goto(url('/hr/leave'));
    await expect(page.getByRole('heading', { name: '내 신청' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '승인 대기' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /승인$/ })).toHaveCount(0);
    await expect(page.getByText(STAFF2.name)).toHaveCount(0); // 다른 사람 신청은 보이지 않는다
    await expect(page.getByRole('button', { name: '부여 일수 설정' })).toHaveCount(0);
    for (const data of [{ approve: true }, { approve: false, reason: '직원이 반려' }]) {
      const r = await staff.ctx.request.post(url(`/api/leave/${id}/decide`), { headers: { 'x-csrf-token': staff.csrf }, data });
      expect(r.status()).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    }
    const list = await staff.ctx.request.get(url('/api/leave'));
    expect(((await list.json()) as { data: Array<{ user: { name: string } }> }).data.every((x) => x.user.name === STAFF.name)).toBe(true);
    await staff.ctx.close();

    // 실장의 화면에는 아직 승인 대기로 남아 있다
    const manager = await loggedIn(browser, MANAGER);
    const mpage = await manager.ctx.newPage();
    await mpage.goto(url('/hr/leave'));
    await expect(mpage.getByTestId('leave-pending-item').filter({ hasText: STAFF2.name })).toContainText('병가');
    await manager.ctx.close();
  });

  test('phase-03-task-09: 원장은 부여 일수를 바꾸고, 직원은 승인 대기 신청을 취소할 수 있다', async ({ browser }) => {
    const admin = await loggedIn(browser, ADMIN);
    const page = await admin.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/leave'));
    await page.getByRole('button', { name: '부여 일수 설정' }).click();
    const dialog = page.getByRole('dialog', { name: '2026년 연차 부여 일수' });
    await expect(dialog.getByLabel('하루 최대 휴가 인원')).toHaveValue('2');
    await dialog.getByLabel(`${STAFF.name} 부여 일수`).fill('17');
    expect(await axe(page)).toEqual([]);
    await dialog.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText('부여 일수와 연차 설정을 저장했어요.')).toBeVisible();
    await expect(page.getByRole('table', { name: '직원별 부여·사용·잔여 일수' }).getByRole('row').filter({ hasText: STAFF.name })).toContainText('17일1일0일16일');
    await admin.ctx.close();

    const staff = await loggedIn(browser, STAFF);
    const spage = await staff.ctx.newPage();
    await spage.goto(url('/hr/leave'));
    // 부여 17일 − 사용 1일(AC1 오전 반차 + AC3 오후 반차)
    await expect(kpi(spage, '잔여')).toHaveText('16일');
    await apiRequest(staff.ctx.request, staff.csrf, { type: 'annual', startOn: '2026-11-20' });
    await spage.reload();
    await spage.getByRole('button', { name: '11월 20일(금) 연차 신청 취소' }).click();
    await spage.getByRole('dialog', { name: '휴가 신청 취소' }).getByRole('button', { name: '신청 취소' }).click();
    await expect(spage.getByText('신청을 취소했어요.')).toBeVisible();
    await expect(spage.getByRole('row').filter({ hasText: '11월 20일(금)' })).toContainText('취소');
    expect(errors).toEqual([]);
    await staff.ctx.close();
  });

  test('phase-03-task-09: 연차·휴가 화면은 휴대폰 너비에서 가로로 넘치지 않는다', async ({ browser }) => {
    for (const who of [MANAGER, STAFF]) {
      const { ctx } = await loggedIn(browser, who, { width: 390, height: 844 });
      const page = await ctx.newPage();
      await page.goto(url('/hr/leave'));
      await expect(page.getByRole('heading', { name: '내 신청' })).toBeVisible();
      await expect(page.getByRole('row').first()).toBeVisible();
      await expectNoHorizontalScroll(page, who.username);
      await page.getByRole('button', { name: '휴가 신청', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '휴가 신청', exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page, `${who.username} 대화상자`);
      if (who === STAFF) expect(await axe(page)).toEqual([]);
      await ctx.close();
    }
  });
});

// 이 파일이 하는 일: 공지·인수인계 화면 E2E(phase-03-task-04 AC1·AC2·AC3, FR-040). 이 파일 전용 격리 서버(fixtures.ts)에서
// 직원에게는 "공지 쓰기" 버튼이 없고 API로 공지를 보내도 403이며 인수인계는 화면에서 쓸 수 있는지(AC1),
// 실장이 화면에서 공지를 올리면 전 직원 알림센터에 새 공지 알림이 생기는지(AC3),
// 직원이 공지를 열면 실장 화면의 읽음 수가 1 늘고 안 읽은 사람 목록에서 빠지는지(AC2)를 본다.
// 화면별 axe 위반 0건, 휴대폰 너비 가로 스크롤 없음, 콘솔 오류 없음도 확인한다. 서버 시계는 2026-11-02 09:00(KST)에 멈춰 있다.
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'boardadmin', password: 'Board-Admin-Pass-4', withDemo: false };
const MANAGER = { username: 'boardmgr', password: 'Board-Manager-Pass-4', name: '윤실장' };
const STAFF = { username: 'boardstaff', password: 'Board-Staff-Pass-4', name: '정하늘' };
const NOTICE_TITLE = '11월 감염관리 교육 안내';

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;
let noticeId = 0;

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

test.describe.serial('공지·인수인계 보드', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
  });

  test('phase-03-task-04 AC1: 직원 화면에는 공지 쓰기 버튼이 없고 API로 공지를 보내면 403이며, 인수인계는 화면에서 쓸 수 있다', async ({ browser }) => {
    const { ctx, csrf } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/desk/board'));
    await expect(page.getByRole('heading', { level: 1, name: '공지·인수인계' })).toBeVisible();
    await expect(page.getByText('아직 올라온 공지가 없어요')).toBeVisible();
    await expect(page.getByRole('button', { name: '공지 쓰기', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '첫 공지 쓰기' })).toHaveCount(0);

    // 버튼을 거치지 않고 API로 보내도 서버가 막는다
    const denied = await ctx.request.post(url('/api/posts'), { headers: { 'x-csrf-token': csrf }, data: { kind: 'notice', category: '일반', title: '직원이 쓴 공지', body: '' } });
    expect(denied.status()).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');

    // 인수인계 쓰기(종류 고르기 없이 바로 인수인계)
    await page.getByRole('button', { name: '인수인계 쓰기' }).first().click();
    const dialog = page.getByRole('dialog', { name: '인수인계 쓰기' });
    await expect(dialog.getByLabel('종류')).toHaveCount(0);
    await dialog.getByLabel('분류').selectOption('재고');
    await dialog.getByLabel('제목').fill('거즈 박스 2개 남음');
    await dialog.getByLabel('내용').fill('내일 오전에 발주 여부 확인 부탁드려요.');
    await dialog.getByRole('button', { name: '올리기' }).click();
    await expect(page.getByText('인수인계를 남겼어요.')).toBeVisible();
    await expect(page).toHaveURL(/tab=handover/);
    const row = page.getByRole('row').filter({ hasText: '거즈 박스 2개 남음' });
    await expect(row).toContainText('재고');
    await expect(row).toContainText(STAFF.name);
    await expect(row).toContainText('처리 전');
    expect(await axe(page)).toEqual([]);

    // 상세에서 처리 완료 → 처리 전 목록에서 빠진다
    await row.click();
    await expect(page.getByRole('heading', { level: 1, name: '거즈 박스 2개 남음' })).toBeVisible();
    await page.getByRole('button', { name: '처리 완료' }).click();
    await expect(page.getByText('처리 완료로 표시했어요.')).toBeVisible();
    await expect(page.getByRole('button', { name: '처리 전으로 되돌리기' })).toBeVisible();
    await page.getByRole('button', { name: '목록으로' }).click();
    await expect(page.getByText('처리할 인수인계가 없어요')).toBeVisible();
    await page.getByRole('button', { name: '전체' }).click();
    await expect(page.getByRole('row').filter({ hasText: '거즈 박스 2개 남음' })).toContainText('처리 완료');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-04 AC3: 실장이 화면에서 새 공지를 올리면 전 직원의 알림센터에 새 공지 알림이 생긴다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/desk/board'));
    await page.getByRole('button', { name: '공지 쓰기', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '공지 쓰기' });
    await dialog.getByLabel('분류').selectOption('감염관리');
    await dialog.getByLabel('제목').fill(NOTICE_TITLE);
    await dialog.getByLabel('내용').fill('11월 12일(목) 13:10 상담실에서 교육이 있어요.\n자료를 미리 읽어 와 주세요.');
    await dialog.getByText('맨 위에 고정').click();
    await dialog.getByRole('button', { name: '올리기' }).click();
    await expect(page.getByText('공지를 올렸어요. 모든 직원에게 알림이 갔어요.')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: NOTICE_TITLE });
    await expect(row).toContainText('고정');
    await expect(row).toContainText('1/3명');

    // 직원·원장 모두 알림센터에 새 공지 알림이 있다
    for (const who of [STAFF, { username: ADMIN.username, password: ADMIN.password }]) {
      const other = await loggedIn(browser, who);
      const list = await other.ctx.request.get(url('/api/notifications'));
      const items = ((await list.json()) as { data: Array<{ type: string; title: string; link: string }> }).data;
      const n = items.find((i) => i.type === 'notice');
      expect(n, who.username).toBeTruthy();
      expect(n?.title).toBe(`새 공지: ${NOTICE_TITLE}`);
      noticeId = Number(n?.link.split('/').pop());
      await other.ctx.close();
    }
    expect(noticeId).toBeGreaterThan(0);

    // 직원 화면: 알림센터에서 공지 알림이 보인다
    const staff = await loggedIn(browser, STAFF);
    const sp = await staff.ctx.newPage();
    await sp.goto(url('/notifications'));
    await expect(sp.getByText(`새 공지: ${NOTICE_TITLE}`)).toBeVisible();
    await staff.ctx.close();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-04 AC2: 직원이 공지를 열면 실장 화면의 읽음 수가 1 늘고 안 읽은 사람 목록에서 빠진다', async ({ browser }) => {
    const mgr = await loggedIn(browser, MANAGER);
    const mp = await mgr.ctx.newPage();
    const errors = watchErrors(mp);
    await mp.goto(url(`/desk/board/${noticeId}`));
    await expect(mp.getByRole('heading', { level: 1, name: NOTICE_TITLE })).toBeVisible();
    const readers = mp.getByTestId('post-readers');
    await expect(readers.getByRole('heading', { name: '읽은 사람 1명' })).toBeVisible();
    await expect(readers.getByRole('list', { name: '안 읽은 사람 목록', exact: true })).toContainText(STAFF.name);
    await expect(mp.getByText('1/3명')).toBeVisible();

    // 직원이 목록에서 "안 읽음" 표시를 보고 공지를 연다
    const staff = await loggedIn(browser, STAFF);
    const sp = await staff.ctx.newPage();
    const staffErrors = watchErrors(sp);
    await sp.goto(url('/desk/board'));
    const row = sp.getByRole('row').filter({ hasText: NOTICE_TITLE });
    await expect(row).toContainText('안 읽음');
    await row.click();
    await expect(sp.getByRole('heading', { level: 1, name: NOTICE_TITLE })).toBeVisible();
    await expect(sp.getByText('자료를 미리 읽어 와 주세요.')).toBeVisible();
    // 직원(작성자 아님)에게는 읽은 사람 목록이 없다
    await expect(sp.getByTestId('post-readers')).toHaveCount(0);
    await expect(sp.getByRole('button', { name: '고치기' })).toHaveCount(0);
    await sp.getByRole('button', { name: '목록으로' }).click();
    await expect(sp.getByRole('row').filter({ hasText: NOTICE_TITLE })).not.toContainText('안 읽음');
    expect(staffErrors).toEqual([]);
    await staff.ctx.close();

    // 실장 화면을 새로 고치면 읽음 수가 1 늘고, 직원이 안 읽은 사람 목록에서 빠진다
    await mp.reload();
    await expect(readers.getByRole('heading', { name: '읽은 사람 2명' })).toBeVisible();
    await expect(mp.getByText('2/3명')).toBeVisible();
    await expect(readers.getByRole('list', { name: '읽은 사람 목록', exact: true })).toContainText(STAFF.name);
    await expect(readers.getByRole('list', { name: '안 읽은 사람 목록', exact: true })).not.toContainText(STAFF.name);
    await expect(readers.getByRole('list', { name: '안 읽은 사람 목록', exact: true })).toContainText(ADMIN.name);
    expect(await axe(mp)).toEqual([]);
    expect(errors).toEqual([]);
    await mgr.ctx.close();
  });

  test('phase-03-task-04: 공지·인수인계 화면은 휴대폰 너비에서 가로로 넘치지 않고 axe 위반이 없다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER, { width: 390, height: 844 });
    const page = await ctx.newPage();
    for (const path of ['/desk/board', '/desk/board?tab=handover', `/desk/board/${noticeId}`]) {
      await page.goto(url(path));
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // 목록 표·빈 상태 안내·읽은 사람 칸 중 하나가 그려질 때까지 기다린다(처리 전 인수인계가 없으면 빈 상태)
      await expect(page.locator('table, .empty, [data-testid="post-readers"]').first()).toBeVisible();
      await expectNoHorizontalScroll(page, path);
    }
    expect(await axe(page)).toEqual([]);
    await ctx.close();
  });
});

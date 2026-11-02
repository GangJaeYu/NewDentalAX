// 이 파일이 하는 일: 사용자·권한, 병원 기본 정보, 활동 기록 화면 E2E(phase-01-task-05 AC1~AC6). 이 파일 전용 격리 서버(tests/e2e/fixtures.ts)에서
// 직원 추가 → 임시 비밀번호 로그인 → 비밀번호 변경 강제 → 대시보드(AC1), 추가 폼 입력란 5개(AC2), 마지막 관리자 보호 안내(AC3),
// 비활성화 뒤 열린 세션 401(AC4), 활동 기록 기간·사용자 필터와 CSV(UTF-8 BOM)·직원 접근 차단(AC5), 병원 정보 저장 뒤 새로고침 유지(AC6)를 확인한다.
// 화면마다 axe 위반 0건과 휴대폰 너비 가로 스크롤 없음도 본다(axe는 화면별 테스트로 나눴다). 서버 시계는 2026-11-02 09:00(KST)에 멈춰 있다.
import fs from 'node:fs';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'admin0501', password: 'Admin-0501-Pass', withDemo: false };
const NEW_STAFF = { name: '이수진', username: 'sujin0501', newPassword: 'Sujin-0501-New' };
const OTHER_STAFF = { name: '박직원', username: 'staff0502', password: 'Staff-0502-Pass' };
const MANAGER = { name: '최실장', username: 'mgr00503', password: 'Mgr-0503-Pass1' };

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;
/** AC1에서 받은 임시 비밀번호와, 그 직원이 로그인해 둔 브라우저(AC4에서 씀) */
let tempPassword = '';
let staffCtx: BrowserContext | null = null;

/** 콘솔 오류를 모은다(일부러 만든 4xx 응답의 "Failed to load resource" 줄은 뺀다) */
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
async function loggedIn(browser: Browser, who: { username: string; password: string }, opts: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1440, height: 900 }, ...opts });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  return ctx;
}

/** 표에서 이름 칸이 name인 줄 */
const rowOf = (page: Page, name: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });

test.describe.serial('사용자·병원 정보·활동 기록', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.afterAll(async () => {
    await staffCtx?.close();
  });

  test('phase-01-task-05 AC2: 직원 추가 폼에는 이름·아이디·역할·직무·입사일 다섯 칸만 있다', async ({ request, browser, isoServer }) => {
    const setup = await request.post('/api/setup', { data: ADMIN });
    expect(setup.status()).toBe(201);
    await isoServer.addUser('staff', OTHER_STAFF.username, OTHER_STAFF.password, OTHER_STAFF.name);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);

    const ctx = await loggedIn(browser, ADMIN);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/admin/users'));
    await expect(page.getByRole('heading', { level: 1, name: '사용자·권한' })).toBeVisible();
    await expect(rowOf(page, OTHER_STAFF.name)).toBeVisible();
    await page.getByRole('button', { name: '직원 추가' }).click();
    const form = page.getByRole('form', { name: '직원 추가' });
    await expect(form).toBeVisible();
    const fields = await form.locator('input, select, textarea').evaluateAll((els) =>
      // 서버용 타입 설정에는 DOM 타입이 없어서 필요한 모양만 적는다
      els.map((el) => (el as unknown as { labels: ArrayLike<{ textContent: string | null }> | null }).labels?.[0]?.textContent?.replace('*', '').trim() ?? '(레이블 없음)'),
    );
    expect(fields).toEqual(['이름', '아이디', '역할', '직무', '입사일']);
    await expect(form.getByText(/전화|연락처|주소|생년월일|이메일/)).toHaveCount(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-01-task-05 AC1: admin이 직원을 추가하면 임시 비밀번호가 한 번 보이고 목록에 "비밀번호 변경 전"으로 나온다', async ({ browser }) => {
    const ctx = await loggedIn(browser, ADMIN);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/admin/users'));
    await page.getByRole('button', { name: '직원 추가' }).click();
    const form = page.getByRole('form', { name: '직원 추가' });
    await form.getByLabel('이름').fill(NEW_STAFF.name);
    await form.getByLabel('아이디').fill(NEW_STAFF.username);
    await form.getByLabel('역할').selectOption('staff');
    await form.getByLabel('직무').selectOption('hygienist');
    await form.getByLabel('입사일').fill('2026-03-02');
    await page.getByRole('button', { name: '추가하고 임시 비밀번호 받기' }).click();
    await expect(page.getByRole('heading', { name: '직원을 추가했어요' })).toBeVisible();
    tempPassword = (await page.getByTestId('temp-password').textContent())?.trim() ?? '';
    expect(tempPassword).toMatch(/^Tmp-/);
    await page.getByRole('button', { name: '확인했어요' }).click();
    const row = rowOf(page, NEW_STAFF.name);
    await expect(row).toContainText('비밀번호 변경 전');
    await expect(row).toContainText('치과위생사');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-01-task-05 AC1: 추가한 직원이 임시 비밀번호로 로그인하면 비밀번호 변경 화면으로 가고, 바꾼 뒤 대시보드에 들어간다', async ({ browser }) => {
    expect(tempPassword).toMatch(/^Tmp-/);
    // 직원 쪽: 로그인 화면에서 임시 비밀번호로 로그인 → 비밀번호 변경 강제 → 대시보드
    staffCtx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1440, height: 900 } });
    const sp = await staffCtx.newPage();
    const staffErrors = watchErrors(sp);
    await sp.goto(url('/login'));
    await sp.getByLabel('아이디').fill(NEW_STAFF.username);
    await sp.getByLabel('비밀번호').fill(tempPassword);
    await sp.getByRole('button', { name: '로그인' }).click();
    await expect(sp).toHaveURL(/\/change-password$/);
    await expect(sp.getByText('임시 비밀번호로 로그인했어요')).toBeVisible();
    // 다른 화면으로 가려 해도 비밀번호 변경 화면으로 돌아온다
    await sp.goto(url('/inventory'));
    await expect(sp).toHaveURL(/\/change-password$/);
    await sp.getByLabel('현재 비밀번호').fill(tempPassword);
    await sp.getByLabel(/^새 비밀번호\*?$/).fill(NEW_STAFF.newPassword);
    await sp.getByLabel('새 비밀번호 확인').fill(NEW_STAFF.newPassword);
    await sp.getByRole('button', { name: '비밀번호 바꾸기' }).click();
    await expect(sp).toHaveURL(url('/'));
    await expect(sp.getByRole('heading', { level: 1, name: new RegExp(`${NEW_STAFF.name}님`) })).toBeVisible();
    expect(staffErrors).toEqual([]);
  });

  test('phase-01-task-05 AC3: 마지막 관리자를 사용 중지하거나 실장으로 바꾸면 409 LAST_ADMIN 안내가 보이고 그대로 남는다', async ({ browser }) => {
    const ctx = await loggedIn(browser, ADMIN);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/admin/users'));
    await rowOf(page, ADMIN.name).getByRole('button', { name: `${ADMIN.name} 수정` }).click();
    const dialog = page.getByRole('dialog', { name: `${ADMIN.name} (${ADMIN.username})` });
    await expect(dialog).toBeVisible();

    // ① 사용 중지
    const patch = page.waitForResponse((r) => r.url().includes('/api/users/') && r.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: '사용 중지' }).click();
    await page.getByRole('dialog', { name: '계정을 사용 중지할까요?' }).getByRole('button', { name: '사용 중지' }).click();
    const res1 = await patch;
    expect(res1.status()).toBe(409);
    expect(await res1.json()).toMatchObject({ error: { code: 'LAST_ADMIN' } });
    await expect(dialog.getByRole('alert')).toHaveText(/마지막 관리자 계정은 바꾸거나 끌 수 없습니다/);

    // ② 실장으로 강등
    await dialog.getByLabel('역할').selectOption('manager');
    const patch2 = page.waitForResponse((r) => r.url().includes('/api/users/') && r.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: '저장' }).click();
    expect((await patch2).status()).toBe(409);
    await expect(dialog.getByRole('alert')).toHaveText(/마지막 관리자 계정은 바꾸거나 끌 수 없습니다/);
    await dialog.getByRole('button', { name: '취소' }).click();

    // 화면과 서버 모두 그대로
    await page.reload();
    const row = rowOf(page, ADMIN.name);
    await expect(row).toContainText('원장·관리자');
    await expect(row).toContainText('사용 중');
    const list = (await (await ctx.request.get(url('/api/users'))).json()) as { data: Array<{ username: string; role: string; active: boolean }> };
    expect(list.data.find((u) => u.username === ADMIN.username)).toMatchObject({ role: 'admin', active: true });
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-01-task-05 AC4: 사용 중지한 직원의 열린 세션은 다음 요청에서 401이 되고 로그인 화면으로 간다', async ({ browser }) => {
    expect(staffCtx).not.toBeNull();
    const sctx = staffCtx as BrowserContext;
    expect((await sctx.request.get(url('/api/auth/me'))).status()).toBe(200);

    const ctx = await loggedIn(browser, ADMIN);
    const page = await ctx.newPage();
    await page.goto(url('/admin/users'));
    await rowOf(page, NEW_STAFF.name).click();
    const dialog = page.getByRole('dialog', { name: `${NEW_STAFF.name} (${NEW_STAFF.username})` });
    await dialog.getByRole('button', { name: '사용 중지' }).click();
    await page.getByRole('dialog', { name: '계정을 사용 중지할까요?' }).getByRole('button', { name: '사용 중지' }).click();
    await expect(page.getByText(`${NEW_STAFF.name}님 계정을 사용 중지했어요.`)).toBeVisible();
    await page.getByRole('button', { name: /^사용 중지 \d+$/ }).click();
    await expect(rowOf(page, NEW_STAFF.name)).toContainText('사용 중지');
    await ctx.close();

    const me = await sctx.request.get(url('/api/auth/me'));
    expect(me.status()).toBe(401);
    expect(await me.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: '다시 로그인해 주세요.' } });
    const sp = sctx.pages()[0] as Page;
    await sp.goto(url('/'));
    await expect(sp).toHaveURL(/\/login/);
    const again = await sctx.request.post(url('/api/auth/login'), { data: { username: NEW_STAFF.username, password: NEW_STAFF.newPassword } });
    expect(again.status()).toBe(401);
  });

  test('phase-01-task-05 AC5: 활동 기록을 기간·사용자로 거르고 CSV(UTF-8 BOM)로 받는다', async ({ browser }) => {
    const ctx = await loggedIn(browser, ADMIN, { acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/admin/audit'));
    await expect(page.getByRole('heading', { level: 1, name: '활동 기록' })).toBeVisible();
    const table = page.getByRole('table', { name: '활동 기록' });
    await expect(table).toContainText('직원 추가');
    await expect(table).toContainText('직원 비활성화');

    // 사용자 필터: 새 직원 본인이 한 일(로그인·비밀번호 변경)만
    const userSelect = page.getByLabel('사용자');
    await expect(userSelect.locator('option', { hasText: NEW_STAFF.username })).toHaveCount(1);
    await userSelect.selectOption({ label: `${NEW_STAFF.name} (${NEW_STAFF.username}) · 사용 중지` });
    await expect(table).toContainText('비밀번호 변경');
    const actions = await table.locator('tbody tr td:nth-child(3)').allTextContents();
    expect(new Set(actions)).toEqual(new Set(['로그인', '비밀번호 변경']));
    const users = await table.locator('tbody tr td:nth-child(2)').allTextContents();
    expect(users.every((u) => u.includes(NEW_STAFF.username))).toBe(true);
    // 줄을 누르면 자세히 보기가 열리고, 고치기·지우기 버튼은 없다
    await table.locator('tbody tr').first().click();
    const detail = page.getByRole('dialog', { name: '기록 자세히' });
    await expect(detail).toContainText(NEW_STAFF.username);
    await expect(detail.getByRole('button', { name: /수정|삭제|지우기/ })).toHaveCount(0);
    await detail.getByRole('button', { name: '닫기' }).last().click();
    await expect(detail).toHaveCount(0);

    // 기간 필터: 서버 시계 기준 오늘(2026-11-02)은 있고, 다음 날부터는 없다
    await page.getByLabel('시작 날짜').fill('2026-11-02');
    await page.getByLabel('끝 날짜').fill('2026-11-02');
    await expect(table.locator('tbody tr')).toHaveCount(actions.length);
    await page.getByLabel('시작 날짜').fill('2026-11-03');
    await page.getByLabel('끝 날짜').fill('2026-11-30');
    await expect(page.getByText('조건에 맞는 기록이 없어요')).toBeVisible();

    // CSV: 오늘 + 사용자 조건으로 내려받는다
    await page.getByLabel('시작 날짜').fill('2026-11-01');
    await page.getByLabel('끝 날짜').fill('2026-11-02');
    await expect(table).toContainText('비밀번호 변경');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'CSV 내려받기' }).click()]);
    expect(download.suggestedFilename()).toBe('활동기록-2026-11-02.csv');
    const file = await download.path();
    const bytes = fs.readFileSync(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = bytes.subarray(3).toString('utf8').trim().split('\r\n');
    expect(lines[0]).toBe('시각,아이디,이름,행동,행동 코드,대상 종류,대상 번호,세부 내용,IP');
    expect(lines.length - 1).toBe(actions.length);
    expect(lines.slice(1).every((l) => l.startsWith('2026-11-02 09:00:00,sujin0501,이수진,'))).toBe(true);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-01-task-05 AC5: 직원·실장은 활동 기록 화면과 API에 접근할 수 없다', async ({ browser }) => {
    for (const who of [OTHER_STAFF, MANAGER]) {
      const ctx = await loggedIn(browser, who);
      const page = await ctx.newPage();
      await page.goto(url('/admin/audit'));
      await expect(page.getByText('이 화면을 볼 권한이 없어요')).toBeVisible();
      await expect(page.getByRole('navigation').getByRole('link', { name: '활동 기록' })).toHaveCount(0);
      for (const api of ['/api/audit', '/api/audit?format=csv']) {
        const r = await ctx.request.get(url(api));
        expect(r.status(), `${who.username} ${api}`).toBe(403);
        expect(await r.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
      }
      await ctx.close();
    }
  });

  test('phase-01-task-05 AC6: 병원 정보를 저장하고 새로고침해도 값이 그대로다', async ({ browser }) => {
    const ctx = await loggedIn(browser, ADMIN);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/admin/clinic'));
    await expect(page.getByRole('heading', { level: 1, name: '병원 기본 정보' })).toBeVisible();
    await expect(page.getByLabel('병원 이름')).toHaveValue(ADMIN.clinicName);

    await page.getByLabel('병원 이름').fill('하늘숲치과의원');
    await page.getByLabel('대표번호').fill('02-123-4567');
    const wed = page.locator('li[data-day="wed"]');
    await wed.getByLabel('수요일 진료 시작').fill('14:00');
    await wed.getByLabel('수요일 진료 끝').fill('21:00');
    await wed.getByLabel('점심시간').uncheck();
    await page.locator('li[data-day="sat"]').getByLabel('휴진').check();
    await page.getByLabel('휴진 안내').fill('일요일·공휴일 휴진');
    await page.getByLabel('주차 안내').fill('건물 지하 주차장 2시간 무료');
    await page.getByLabel('위치·교통 안내').fill('하늘역 3번 출구에서 50m');
    await page.getByLabel('보험 일반 안내').fill('스케일링은 연 1회 건강보험이 적용돼요.');

    // 틀린 값은 저장 전에 막는다
    await page.locator('li[data-day="fri"]').getByLabel('금요일 진료 끝').fill('08:00');
    await page.getByRole('button', { name: '저장' }).click();
    await expect(page.locator('li[data-day="fri"]').getByRole('alert')).toHaveText(/진료 끝 시각은 시작 시각보다 늦어야 해요/);
    await page.locator('li[data-day="fri"]').getByLabel('금요일 진료 끝').fill('18:30');

    const put = page.waitForResponse((r) => r.url().endsWith('/api/settings/clinic') && r.request().method() === 'PUT');
    await page.getByRole('button', { name: '저장' }).click();
    expect((await put).status()).toBe(200);
    await expect(page.getByText('병원 정보를 저장했어요.')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('병원 이름')).toHaveValue('하늘숲치과의원');
    await expect(page.getByLabel('대표번호')).toHaveValue('02-123-4567');
    await expect(page.locator('li[data-day="wed"]').getByLabel('수요일 진료 시작')).toHaveValue('14:00');
    await expect(page.locator('li[data-day="wed"]').getByLabel('수요일 진료 끝')).toHaveValue('21:00');
    await expect(page.locator('li[data-day="wed"]').getByLabel('점심시간')).not.toBeChecked();
    await expect(page.locator('li[data-day="sat"]').getByLabel('휴진')).toBeChecked();
    await expect(page.locator('li[data-day="mon"]').getByLabel('월요일 점심 시작')).toHaveValue('13:00');
    await expect(page.getByLabel('주차 안내')).toHaveValue('건물 지하 주차장 2시간 무료');
    await expect(page.getByLabel('보험 일반 안내')).toHaveValue('스케일링은 연 1회 건강보험이 적용돼요.');
    // 상단바 병원 이름도 바뀐다
    await expect(page.locator('.top')).toContainText('하늘숲치과의원');

    // 직원도 읽을 수는 있다(AI 안내 스크립트가 쓴다). 저장은 403
    const staff = await loggedIn(browser, OTHER_STAFF);
    const got = await staff.request.get(url('/api/settings/clinic'));
    expect(await got.json()).toMatchObject({ data: { name: '하늘숲치과의원', phone: '02-123-4567', hours: { sat: null, wed: { open: '14:00', close: '21:00', lunch: null } } } });
    expect(errors).toEqual([]);
    await staff.close();
    await ctx.close();
  });

  // axe·가로 스크롤 검사는 화면·테마별로 나눈다(한 테스트에 오래 걸리는 검사를 몰지 않는다)
  const SCREENS = [
    { path: '/admin/users', heading: '사용자·권한' },
    { path: '/admin/clinic', heading: '병원 기본 정보' },
    { path: '/admin/audit', heading: '활동 기록' },
  ];
  for (const s of SCREENS) {
    for (const theme of ['light', 'dark'] as const) {
      test(`phase-01-task-05 AC6: ${s.heading} 화면(${theme}) axe 위반 0건, 390px에서 가로 스크롤이 없다`, async ({ browser }) => {
        const ctx = await loggedIn(browser, ADMIN, { colorScheme: theme });
        const page = await ctx.newPage();
        const errors = watchErrors(page);
        await page.goto(url(s.path));
        await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeVisible();
        await expect(page.locator('.skel')).toHaveCount(0);
        const r = await new AxeBuilder({ page }).analyze();
        expect(axeList(r.violations), `${s.path} ${theme}`).toEqual([]);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByRole('heading', { level: 1, name: s.heading })).toBeVisible();
        const sw = await page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]');
        const [scrollWidth, innerWidth] = sw as [number, number];
        expect(scrollWidth, `${s.path} 390px`).toBeLessThanOrEqual(innerWidth);
        expect(errors).toEqual([]);
        await ctx.close();
      });
    }
  }
});

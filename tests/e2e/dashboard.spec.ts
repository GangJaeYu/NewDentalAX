// 이 파일이 하는 일: 대시보드(/) E2E(phase-03-task-10 AC1~AC5, FR-008, NFR-009). 이 파일 전용 격리 서버(fixtures.ts, TEST_NOW 2026-11-02 09:00 월요일)에서
// 빈 DB일 때 모든 카드의 빈 상태 안내·바로가기(AC4) → 데모 데이터 넣기 → 1440×900 첫 화면에 요약 숫자 줄과 카드 4개(AC1),
// 카드 항목을 누르면 해당 화면·항목으로 이동(AC2)과 불러오기 오류·다시 시도, staff에게 승인 대기·발주·지출이 없음(AC3),
// 대시보드에서 출고 기록을 3번 클릭 안에 끝냄(AC5, 클릭 수 측정)을 확인한다. 4너비×2테마 가로 스크롤 없음과 axe 위반 0건도 화면 단위로 나눠 본다.
// 테스트는 이 파일 안 순서대로 실행된다(serial). 응답 시간(AC6)은 server/modules/dashboard/dashboard.test.ts와 scripts/perf-dashboard.ts가 잰다.
import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '김원장', username: 'dashadmin', password: 'Dash-Admin-Pass-7', withDemo: false };
const MANAGER = { username: 'dashmanager', password: 'Dash-Manager-Pass-7', name: '윤실장' };
const STAFF = { username: 'dashstaff', password: 'Dash-Staff-Pass-7', name: '정하늘' };
const WIDTHS: Array<[number, number]> = [
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
];
const THEMES = ['light', 'dark'] as const;
/** DESIGN §4 카드 순서(원장 기준 10개) */
const CARD_TITLES = ['오늘 할 일', '재고 경고', '다가오는 점검·의무 일정', '오늘 근무', '공지', 'AI 빠른 요청', '발주 진행', '이번 주 일정', '최근 입출고', '이번 달 지출'];
const SHOTS = path.join(process.cwd(), 'artifacts', 'e2e', 'phase-03-task-10');

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
async function loggedIn(
  browser: Browser,
  who: { username: string; password: string },
  opts: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {},
): Promise<{ ctx: BrowserContext; csrf: string }> {
  const ctx = await browser.newContext({
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    colorScheme: opts.colorScheme ?? 'light',
  });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
  expect(r.status(), who.username).toBe(200);
  const body = (await r.json()) as { data: { csrfToken: string } };
  return { ctx, csrf: body.data.csrfToken };
}

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** 제목으로 카드 하나 찾기 */
function card(page: Page, title: string): Locator {
  return page
    .getByRole('region', { name: '오늘 현황' })
    .locator('article.card')
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) });
}

/** 요약 숫자 칸 하나 */
function kpi(page: Page, label: string): Locator {
  return page
    .getByRole('region', { name: '요약 숫자' })
    .locator('.kpi')
    .filter({ has: page.locator('small', { hasText: new RegExp(`^${label}$`) }) });
}

/** 대시보드를 열고 데모 데이터가 그려질 때까지 기다린다 */
async function openDemoDashboard(page: Page): Promise<void> {
  await page.goto(url('/'));
  await expect(card(page, '재고 경고').getByRole('link', { name: /니트릴 글러브 M/ })).toBeVisible();
}

test.describe.serial('대시보드', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    void isoServer;
  });

  test('phase-03-task-10 AC4: 데이터가 빈 DB에서 모든 카드가 빈 상태 안내와 바로가기를 보인다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, ADMIN);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/'));
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(`${ADMIN.name}님`) })).toBeVisible();
    await expect(card(page, '재고 경고').getByText('재고 경고가 없어요')).toBeVisible();

    // 원장은 카드 10개를 DESIGN §4 순서대로 본다
    const titles = await page.getByRole('region', { name: '오늘 현황' }).locator('article.card > header h2').allTextContents();
    expect(titles).toEqual(CARD_TITLES);
    for (const title of CARD_TITLES) {
      const c = card(page, title);
      if (title === 'AI 빠른 요청') {
        // 입력 도구 카드: 비어 있어도 바로 요청을 쓸 수 있다
        await expect(c.getByRole('textbox', { name: /AI에게 부탁할 내용/ }), title).toBeVisible();
        continue;
      }
      const empty = c.locator('.empty');
      await expect(empty, title).toBeVisible();
      await expect(empty.locator('b'), title).not.toBeEmpty();
      await expect(empty.locator('p'), title).not.toBeEmpty();
      const go = empty.locator('.act').getByRole('link');
      await expect(go, title).toHaveCount(1);
      expect(await go.getAttribute('href'), title).toMatch(/^\//);
    }
    // 요약 숫자도 비어 있다고 알려 준다
    await expect(kpi(page, '재고 경고').locator('b')).toHaveText('0건');
    await expect(kpi(page, '재고 경고')).toContainText('경고 없음');
    await expect(kpi(page, '오픈 체크리스트')).toContainText('항목을 만들면 보여요');
    await expect(kpi(page, '30일 내 점검·의무')).toContainText('30일 안 일정 없음');

    // 빈 상태 바로가기를 누르면 그 화면으로 간다
    await card(page, '재고 경고').getByRole('link', { name: '재고 현황 보기' }).click();
    await expect(page).toHaveURL(url('/inventory'));
    await expect(page.getByRole('heading', { level: 1, name: '재고 현황' })).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-10 AC4: 빈 대시보드의 axe 위반 0건', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, ADMIN);
    const page = await ctx.newPage();
    await page.goto(url('/'));
    await expect(card(page, '공지').getByText('새 공지가 없어요')).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await ctx.close();
  });

  test('데모 데이터 넣기(다음 시험 준비)', async ({ browser, isoServer }) => {
    // 데모 넣기는 업무 데이터·직원이 없을 때만 되므로, 실장·직원 계정은 넣은 뒤에 만든다
    const { ctx, csrf } = await loggedIn(browser, ADMIN);
    const r = await ctx.request.post(url('/api/demo/load'), { headers: { 'x-csrf-token': csrf }, data: {} });
    expect(r.status()).toBe(204);
    await ctx.close();
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
  });

  test('phase-03-task-10 AC1: 데모 데이터 1440×900에서 요약 숫자 줄과 카드 4개가 스크롤 없이 보인다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, ADMIN);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await openDemoDashboard(page);
    await expect(card(page, '다가오는 점검·의무 일정').getByRole('listitem').first()).toBeVisible();
    await page.evaluate('document.fonts.ready');

    const box = async (l: Locator) => {
      const b = await l.boundingBox();
      expect(b).not.toBeNull();
      return b as { x: number; y: number; width: number; height: number };
    };
    // 화면이 맨 위에 있고(스크롤 없음) 요약 숫자 6칸이 한 줄에 다 보인다
    expect(await page.locator('.main').evaluate((el) => el.scrollTop)).toBe(0);
    const kpis = page.getByRole('region', { name: '요약 숫자' }).locator('.kpi');
    await expect(kpis).toHaveCount(6);
    const kpiBoxes = await Promise.all((await kpis.all()).map(box));
    expect(new Set(kpiBoxes.map((b) => Math.round(b.y))).size).toBe(1);
    for (const b of kpiBoxes) expect(b.y + b.height).toBeLessThanOrEqual(900);
    // 카드 4개(오늘 할 일·재고 경고·점검·의무 일정·오늘 근무)가 화면 안에 통째로 들어온다
    for (const title of CARD_TITLES.slice(0, 4)) {
      const b = await box(card(page, title));
      expect(b.y, title).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, title).toBeLessThanOrEqual(900);
      expect(b.x + b.width, title).toBeLessThanOrEqual(1440);
    }
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'ac1-dashboard-1440x900.png') });
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-10 AC2: 각 카드 항목을 누르면 해당 화면·항목으로 이동한다', async ({ browser }) => {
    test.setTimeout(120000);
    const { ctx } = await loggedIn(browser, ADMIN);
    const page = await ctx.newPage();
    const errors = watchErrors(page);

    // 재고 경고 → 품목 상세
    await openDemoDashboard(page);
    await card(page, '재고 경고')
      .getByRole('link', { name: /니트릴 글러브 M/ })
      .click();
    await expect(page).toHaveURL(/\/inventory\/items\/\d+$/);
    await expect(page.getByRole('heading', { level: 1, name: '니트릴 글러브 M' })).toBeVisible();

    // 오늘 할 일의 인수인계 → 그 글
    await openDemoDashboard(page);
    const handover = card(page, '오늘 할 일').getByRole('link').filter({ hasText: '인수인계' }).first();
    const handoverTitle = (await handover.locator('.t b').textContent()) ?? '';
    expect(handoverTitle).not.toBe('');
    await handover.click();
    await expect(page).toHaveURL(/\/desk\/board\/\d+$/);
    await expect(page.getByRole('heading', { level: 1, name: handoverTitle })).toBeVisible();

    // 오늘 할 일의 승인 대기 → 연차·휴가
    await openDemoDashboard(page);
    await card(page, '오늘 할 일').getByRole('link').filter({ hasText: '승인 대기' }).first().click();
    await expect(page).toHaveURL(url('/hr/leave'));
    await expect(page.getByRole('heading', { level: 1, name: '연차·휴가' })).toBeVisible();

    // 점검·의무 일정 → 법정 의무 일정(다가오는 일정)
    await openDemoDashboard(page);
    await card(page, '다가오는 점검·의무 일정').getByRole('link').filter({ hasText: '의료폐기물 보관시설 소독' }).click();
    await expect(page).toHaveURL(url('/facility/legal?view=due'));
    await expect(page.getByRole('heading', { level: 1, name: '법정 의무 일정' })).toBeVisible();

    // 공지 → 그 공지(고정 공지가 먼저)
    await openDemoDashboard(page);
    const notice = card(page, '공지').getByRole('listitem').first();
    await expect(notice).toContainText('고정');
    await expect(notice).toContainText(/읽음 \d+ \/ \d+/);
    await notice.click();
    await expect(page).toHaveURL(/\/desk\/board\/\d+$/);
    await expect(page.getByRole('heading', { level: 1, name: '11월 원내 감염관리 교육 일정 안내' })).toBeVisible();

    // 발주 진행 → 발주서 상세
    await openDemoDashboard(page);
    const order = card(page, '발주 진행')
      .getByRole('link')
      .filter({ hasText: /PO-\d{4}-\d{3}/ })
      .first();
    const poNo = /PO-\d{4}-\d{3}/.exec((await order.textContent()) ?? '')?.[0];
    await order.click();
    await expect(page).toHaveURL(/\/inventory\/orders\/\d+$/);
    await expect(page.getByRole('heading', { level: 1, name: `발주서 ${poNo}` })).toBeVisible();

    // 최근 입출고 → 그 품목 상세
    await openDemoDashboard(page);
    const move = card(page, '최근 입출고').getByRole('list').getByRole('link').first();
    const moveItem = ((await move.locator('.t b').textContent()) ?? '').split(' · ')[0] ?? '';
    await move.click();
    await expect(page).toHaveURL(/\/inventory\/items\/\d+$/);
    await expect(page.getByRole('heading', { level: 1, name: moveItem })).toBeVisible();

    // 이번 주 일정 → 법정 일정, 요약 숫자 → 각 화면
    await openDemoDashboard(page);
    await card(page, '이번 주 일정').getByRole('link', { name: '의료폐기물 보관시설 소독' }).click();
    await expect(page).toHaveURL(url('/facility/legal?view=due'));
    await openDemoDashboard(page);
    await kpi(page, '재고 경고').click();
    await expect(page).toHaveURL(url('/inventory'));
    await openDemoDashboard(page);
    await kpi(page, '승인 대기').click();
    await expect(page).toHaveURL(url('/hr/leave'));
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-10 AC2: 체크리스트는 대시보드에서 한 번 눌러 체크하고, 새로 고쳐도·체크리스트 화면에서도 체크돼 있다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, { username: STAFF.username, password: STAFF.password });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await openDemoDashboard(page);
    const todo = card(page, '오늘 할 일');
    const box = todo.getByRole('checkbox', { name: /출입문·대기실 조명 켜기/ });
    await expect(box).not.toBeChecked();
    await expect(kpi(page, '오픈 체크리스트').locator('b')).toHaveText('0/ 7');
    await box.click();
    await expect(kpi(page, '오픈 체크리스트').locator('b')).toHaveText('1/ 7');
    await expect(todo.getByRole('checkbox', { name: /출입문·대기실 조명 켜기/ })).toBeChecked();
    await page.reload();
    await expect(page.getByRole('region', { name: '오늘 현황' }).getByRole('checkbox', { name: /출입문·대기실 조명 켜기/ })).toBeChecked();
    await page.goto(url('/desk/checklist'));
    await expect(page.getByRole('checkbox', { name: /출입문·대기실 조명 켜기/ })).toBeChecked();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-03-task-10 AC2: 불러오지 못하면 카드마다 이유와 다시 시도가 보이고, 다시 시도하면 채워진다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, ADMIN);
    const page = await ctx.newPage();
    await page.route('**/api/dashboard', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '잠시 문제가 생겼어요. 다시 시도해 주세요.' } }) }),
    );
    await page.goto(url('/'));
    const stock = card(page, '재고 경고');
    await expect(stock.getByRole('alert')).toContainText('불러오지 못했어요');
    await expect(stock.getByRole('alert')).toContainText('잠시 문제가 생겼어요');
    await expect(card(page, '오늘 할 일').getByRole('button', { name: '다시 시도' })).toBeVisible();
    await expect(kpi(page, '재고 경고')).toContainText('불러오지 못했어요');
    await page.unroute('**/api/dashboard');
    await stock.getByRole('button', { name: '다시 시도' }).click();
    await expect(stock.getByRole('link', { name: /니트릴 글러브 M/ })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: '불러오지 못했어요' })).toHaveCount(0);
    await ctx.close();
  });

  test('phase-03-task-10 AC3: staff 로그인 시 승인 대기·발주·지출 카드가 없고, 실장에게는 있다', async ({ browser }) => {
    const staff = await loggedIn(browser, STAFF);
    const page = await staff.ctx.newPage();
    const errors = watchErrors(page);
    await openDemoDashboard(page);
    const region = page.getByRole('region', { name: '오늘 현황' });
    const titles = await region.locator('article.card > header h2').allTextContents();
    expect(titles).toEqual(CARD_TITLES.filter((t) => t !== '발주 진행' && t !== '이번 달 지출'));
    await expect(page.getByRole('heading', { name: '발주 진행' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '이번 달 지출' })).toHaveCount(0);
    await expect(page.getByText('승인 대기')).toHaveCount(0);
    await expect(page.getByText(/PO-\d{4}/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /발주서/ })).toHaveCount(0);
    // 직원 칸에는 내 휴가 신청이 대신 보인다
    await expect(kpi(page, '내 휴가 신청')).toBeVisible();
    // 직원은 공지 대신 인수인계를 쓴다
    await expect(page.getByRole('link', { name: '공지 쓰기' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '인수인계 쓰기' })).toBeVisible();
    expect(errors).toEqual([]);
    await staff.ctx.close();

    const manager = await loggedIn(browser, MANAGER);
    const mpage = await manager.ctx.newPage();
    await openDemoDashboard(mpage);
    await expect(kpi(mpage, '승인 대기').locator('b')).toHaveText('3건');
    await expect(card(mpage, '발주 진행')).toBeVisible();
    await expect(card(mpage, '이번 달 지출')).toBeVisible();
    await expect(card(mpage, '오늘 할 일').getByText('승인 대기').first()).toBeVisible();
    await manager.ctx.close();
  });

  test('phase-03-task-10 AC5: 대시보드에서 출고 기록을 3번 클릭 이하로 완료한다(클릭 수 측정)', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await openDemoDashboard(page);
    let clicks = 0;
    const click = async (l: Locator) => {
      clicks += 1;
      await l.click();
    };

    await click(page.getByRole('button', { name: '출고 기록' }));
    const dialog = page.getByRole('dialog', { name: '출고 기록' });
    // 품목 찾기 글자 입력은 클릭이 아니다(키보드)
    await dialog.getByRole('searchbox', { name: '출고할 품목 찾기' }).fill('글러브');
    await click(dialog.getByRole('button', { name: /^니트릴 글러브 M 소모품/ }));
    // 수량은 기본 1(그대로 저장)
    await expect(dialog.getByLabel('출고 수량(박스)')).toHaveValue('1');
    await click(dialog.getByRole('button', { name: '저장' }));
    await expect(page.getByText('니트릴 글러브 M 1박스 출고를 기록했어요. 남은 재고 1박스')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(clicks).toBeLessThanOrEqual(3);

    // 대시보드가 바로 새로 고쳐져 최근 입출고 맨 위에 보인다
    const first = card(page, '최근 입출고').getByRole('list').getByRole('link').first();
    await expect(first).toContainText('출고');
    await expect(first).toContainText('니트릴 글러브 M · 1박스');
    await expect(first).toContainText(STAFF.name);
    await expect(card(page, '재고 경고').getByRole('link', { name: /니트릴 글러브 M/ })).toContainText('남은 1박스');
    console.log(`[phase-03-task-10 AC5] 대시보드 출고 기록 클릭 수: ${clicks}`);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  for (const theme of THEMES) {
    test(`phase-03-task-10 AC1: 데모 대시보드 4너비 가로 스크롤·카드 넘침 없음(${theme})`, async ({ browser }) => {
      test.setTimeout(120000);
      for (const [width, height] of WIDTHS) {
        const { ctx } = await loggedIn(browser, ADMIN, { viewport: { width, height }, colorScheme: theme });
        const page = await ctx.newPage();
        await openDemoDashboard(page);
        const r = await page.evaluate(`(() => {
          const wrap = document.querySelector('.wrap').getBoundingClientRect();
          const boxes = [...document.querySelectorAll('.kpi, .card')].map((e) => e.getBoundingClientRect());
          return { sw: document.documentElement.scrollWidth, iw: window.innerWidth,
            outside: boxes.filter((b) => b.left < wrap.left - 0.5 || b.right > wrap.right + 0.5).length };
        })()`);
        const v = r as { sw: number; iw: number; outside: number };
        const label = `${width}-${theme}`;
        expect(v.sw, label).toBeLessThanOrEqual(v.iw);
        expect(v.outside, label).toBe(0);
        await ctx.close();
      }
    });

    test(`phase-03-task-10 AC1: 데모 대시보드 axe 위반 0건(${theme})`, async ({ browser }) => {
      const { ctx } = await loggedIn(browser, ADMIN, { colorScheme: theme });
      const page = await ctx.newPage();
      await openDemoDashboard(page);
      expect(await axe(page)).toEqual([]);
      await ctx.close();
    });
  }
});

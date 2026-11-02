// 이 파일이 하는 일: 근무표 화면 E2E(phase-04-task-01 AC1~AC5, FR-081). 이 파일 전용 격리 서버(fixtures.ts, TEST_NOW 2026-11-02 월요일)에서
// 실장이 칸을 눌러 "오전"을 골라 2번 클릭으로 저장하고 새로 고쳐도 남는지(AC1), 지난주 복사 뒤 이번 주가 지난주와 같고 휴가는 복사되지 않는지(AC2),
// 승인된 연차 칸에 "연차"가 보이고 인원 합계가 줄어드는지(AC3), 직원은 조회만 되고 편집 API는 403인지(AC4), 대시보드 "오늘 근무" 카드에 근무자·유형이 보이는지(AC5)를 본다.
// 월간 보기, 근무 유형 관리, 인쇄(PDF A4 가로 한 장), 각 화면 axe 위반 0건과 휴대폰 너비(390px) 가로 스크롤 없음도 확인한다. 무거운 axe 검사는 화면 단위로 나눠 한다.
import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { extractText, getDocumentProxy } from 'unpdf';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'rsadmin', password: 'Roster-Admin-Pass-9', withDemo: false };
const MANAGER = { username: 'rsmanager', password: 'Roster-Manager-Pass-9', name: '윤실장' };
const STAFF = { username: 'rsstaff', password: 'Roster-Staff-Pass-9', name: '정하늘' };
const STAFF2 = { username: 'rsstaff2', password: 'Roster-Staff2-Pass-9', name: '서다온' };

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;

interface Who {
  username: string;
  password: string;
}
interface View {
  from: string;
  users: Array<{ id: number; name: string }>;
  shiftTypes: Array<{ id: number; label: string }>;
  days: Array<{ date: string; cells: Record<string, { shiftTypeId: number | null; leave?: { label: string } }>; total: number }>;
}

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
async function loggedIn(browser: Browser, who: Who, viewport = { width: 1440, height: 900 }): Promise<{ ctx: BrowserContext; csrf: string }> {
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

async function getRoster(req: APIRequestContext, from: string, to: string): Promise<View> {
  const r = await req.get(url(`/api/roster?from=${from}&to=${to}`));
  expect(r.status()).toBe(200);
  return ((await r.json()) as { data: View }).data;
}

/** 준비용: API로 칸을 넣는다 */
async function apiCell(req: APIRequestContext, csrf: string, userId: number, date: string, shiftTypeId: number | null): Promise<void> {
  const r = await req.put(url('/api/roster/cell'), { headers: { 'x-csrf-token': csrf }, data: { userId, date, shiftTypeId } });
  expect(r.status()).toBe(200);
}

/** 준비용: 직원이 연차를 신청하고 실장이 승인한다 */
async function approvedAnnual(staff: { ctx: BrowserContext; csrf: string }, manager: { ctx: BrowserContext; csrf: string }, startOn: string): Promise<void> {
  const r = await staff.ctx.request.post(url('/api/leave'), { headers: { 'x-csrf-token': staff.csrf }, data: { type: 'annual', startOn, endOn: startOn, reason: '개인 일정' } });
  expect(r.status()).toBe(201);
  const id = ((await r.json()) as { data: { id: number } }).data.id;
  const d = await manager.ctx.request.post(url(`/api/leave/${id}/decide`), { headers: { 'x-csrf-token': manager.csrf }, data: { approve: true } });
  expect(d.status()).toBe(200);
}

/** 표의 칸(직원 이름·날짜) */
function cell(page: Page, userId: number, date: string) {
  return page.locator(`td[data-user="${userId}"][data-date="${date}"]`);
}

/** 맨 아래 줄 인원 칸 */
function total(page: Page, date: string) {
  return page.locator(`td[data-total="${date}"]`);
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const [sw, iw] = (await page.evaluate('[document.documentElement.scrollWidth, window.innerWidth]')) as [number, number];
  expect(sw).toBeLessThanOrEqual(iw);
}

let ids: { staff: number; staff2: number; manager: number; types: Record<string, number> };

test.describe.serial('근무표', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer, browser }) => {
    server = isoServer;
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    for (const s of [STAFF, STAFF2]) await isoServer.addUser('staff', s.username, s.password, s.name);
    const m = await loggedIn(browser, MANAGER);
    const v = await getRoster(m.ctx.request, '2026-11-02', '2026-11-08');
    const idOf = (name: string) => v.users.find((u) => u.name === name)?.id ?? 0;
    ids = { staff: idOf(STAFF.name), staff2: idOf(STAFF2.name), manager: idOf(MANAGER.name), types: Object.fromEntries(v.shiftTypes.map((t) => [t.label, t.id])) };
    expect(ids.staff).toBeGreaterThan(0);
    await m.ctx.close();
  });

  test('phase-04-task-01 AC1: 실장이 칸을 눌러 "오전"을 고르면 2번 클릭으로 저장되고 새로 고쳐도 남는다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/roster'));
    await expect(page.getByRole('heading', { level: 1, name: '근무표' })).toBeVisible();
    await expect(page.getByText('11월 2일 ~ 8일 · 오늘 근무 0명')).toBeVisible();
    await expect(page.getByTestId('roster-empty-hint')).toBeVisible();
    await expect(total(page, '2026-11-03')).toHaveText('0명');
    expect(await axe(page)).toEqual([]);

    let clicks = 0;
    await cell(page, ids.staff, '2026-11-03').getByRole('button', { name: `${STAFF.name} 11월 3일(화) 비어 있음, 바꾸기` }).click();
    clicks += 1;
    const dialog = page.getByRole('dialog', { name: `${STAFF.name} · 11월 3일(화)` });
    await expect(dialog.getByRole('group', { name: '근무 유형' }).getByRole('button')).toHaveCount(6); // 유형 5개 + 비우기
    expect(await axe(page)).toEqual([]);
    await dialog.getByRole('button', { name: /^오전/ }).click();
    clicks += 1;
    await expect(page.getByText(`${STAFF.name} · 11월 3일(화) 근무를 "오전"으로 저장했어요. 그날 근무 1명.`)).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(clicks).toBeLessThanOrEqual(2);
    await expect(cell(page, ids.staff, '2026-11-03')).toHaveText('오전');
    await expect(total(page, '2026-11-03')).toHaveText('1명');

    await page.reload();
    await expect(cell(page, ids.staff, '2026-11-03').getByRole('button', { name: `${STAFF.name} 11월 3일(화) 오전, 바꾸기` })).toBeVisible();
    await expect(total(page, '2026-11-03')).toHaveText('1명');

    // 같은 칸을 다시 눌러 비울 수 있다(현재 유형은 눌린 상태로 보인다)
    await cell(page, ids.staff, '2026-11-03').getByRole('button').click();
    await expect(page.getByRole('dialog').getByRole('button', { name: /^오전/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('dialog').getByRole('button', { name: /^비우기/ }).click();
    await expect(cell(page, ids.staff, '2026-11-03')).toHaveText('-');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-01 AC2: 지난주 복사 후 이번 주 칸이 지난주와 같고, 지난주 휴가는 복사되지 않는다', async ({ browser }) => {
    const manager = await loggedIn(browser, MANAGER);
    const staff = await loggedIn(browser, STAFF);
    const req = manager.ctx.request;
    const t = ids.types;
    // 지난주(10/26~11/1) 근무: 정하늘 월~금 종일(수 야간), 토 오전 / 서다온 월 오전·화 오후·목 종일
    const lastWeek = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
    for (const [i, d] of lastWeek.entries()) await apiCell(req, manager.csrf, ids.staff, d, i === 2 ? t['야간']! : t['종일']!);
    await apiCell(req, manager.csrf, ids.staff, '2026-10-31', t['오전']!);
    await apiCell(req, manager.csrf, ids.staff2, '2026-10-26', t['오전']!);
    await apiCell(req, manager.csrf, ids.staff2, '2026-10-27', t['오후']!);
    await apiCell(req, manager.csrf, ids.staff2, '2026-10-29', t['종일']!);
    // 지난주 화요일 정하늘 연차(승인)
    await approvedAnnual(staff, manager, '2026-10-27');
    // 이번 주에 미리 적어 둔 칸(복사로 지워진다)
    await apiCell(req, manager.csrf, ids.staff2, '2026-11-06', t['야간']!);

    const page = await manager.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/roster'));
    await page.getByRole('button', { name: '이전 주' }).click();
    await expect(page).toHaveURL(/date=2026-10-26/);
    await expect(cell(page, ids.staff, '2026-10-27')).toHaveText('연차');
    await expect(total(page, '2026-10-27')).toHaveText('1명');
    await page.getByRole('button', { name: '다음 주' }).click();
    await expect(page.locator('.period')).toHaveText('11월 2일 ~ 8일');

    await page.getByRole('button', { name: '지난주 복사' }).click();
    const confirm = page.getByRole('dialog', { name: '지난주 복사' });
    await expect(confirm).toContainText('지난주(10월 26일 ~ 11월 1일) 근무를 11월 2일 ~ 8일에 그대로 붙여 넣어요');
    await expect(confirm).toContainText('휴가는 복사되지 않아요');
    await confirm.getByRole('button', { name: '복사하기' }).click();
    await expect(page.getByText('지난주 근무 9칸을 11월 2일 ~ 8일에 복사했어요.')).toBeVisible();

    // 화면: 이번 주 칸이 지난주 유형 그대로이고, 화요일은 "연차"가 아니라 "종일"
    const expected: Array<[number, string, string]> = [
      [ids.staff, '2026-11-02', '종일'],
      [ids.staff, '2026-11-03', '종일'],
      [ids.staff, '2026-11-04', '야간'],
      [ids.staff, '2026-11-07', '오전'],
      [ids.staff2, '2026-11-02', '오전'],
      [ids.staff2, '2026-11-03', '오후'],
      [ids.staff2, '2026-11-04', '-'],
      [ids.staff2, '2026-11-05', '종일'],
      [ids.staff2, '2026-11-06', '-'],
    ];
    for (const [u, d, text] of expected) await expect(cell(page, u, d), `${u} ${d}`).toHaveText(text);
    await expect(total(page, '2026-11-03')).toHaveText('2명');

    // API로 7일 × 직원 전부를 맞춰 본다
    const last = await getRoster(req, '2026-10-26', '2026-11-01');
    const now = await getRoster(req, '2026-11-02', '2026-11-08');
    for (let i = 0; i < 7; i += 1) {
      for (const u of now.users) {
        const a = last.days[i]?.cells[String(u.id)]?.shiftTypeId ?? null;
        const b = now.days[i]?.cells[String(u.id)]?.shiftTypeId ?? null;
        expect(b, `${now.days[i]?.date} ${u.name}`).toBe(a);
        expect(now.days[i]?.cells[String(u.id)]?.leave, `${now.days[i]?.date} ${u.name} 휴가`).toBeUndefined();
      }
    }
    expect(errors).toEqual([]);
    await manager.ctx.close();
    await staff.ctx.close();
  });

  test('phase-04-task-01 AC3: 승인된 연차 날짜 칸에 "연차"가 보이고 인원 합계에서 빠진다', async ({ browser }) => {
    const manager = await loggedIn(browser, MANAGER);
    const staff2 = await loggedIn(browser, STAFF2);
    const page = await manager.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/roster'));
    // 복사로 목요일(11/5)은 서다온 종일만 있다 → 정하늘도 종일로 넣어 2명
    await expect(cell(page, ids.staff2, '2026-11-05')).toHaveText('종일');
    await apiCell(manager.ctx.request, manager.csrf, ids.staff, '2026-11-05', ids.types['종일']!);
    await page.reload();
    await expect(total(page, '2026-11-05')).toHaveText('2명');

    await approvedAnnual(staff2, manager, '2026-11-05');
    await page.reload();
    await expect(cell(page, ids.staff2, '2026-11-05')).toHaveText('연차');
    await expect(cell(page, ids.staff2, '2026-11-05').getByRole('button', { name: `${STAFF2.name} 11월 5일(목) 연차, 바꾸기` })).toBeVisible();
    await expect(total(page, '2026-11-05')).toHaveText('1명');
    // 연차 칸을 눌러도 휴가가 먼저 보인다는 안내가 나온다
    await cell(page, ids.staff2, '2026-11-05').getByRole('button').click();
    await expect(page.getByTestId('roster-pick-leave')).toContainText('승인된 연차가 있는 날이에요');
    await page.keyboard.press('Escape');
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await manager.ctx.close();
    await staff2.ctx.close();
  });

  test('phase-04-task-01 AC4: 직원은 근무표를 조회만 하고, 편집 버튼이 없으며 편집 API는 403이다', async ({ browser }) => {
    const staff = await loggedIn(browser, STAFF);
    const page = await staff.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/roster'));
    await expect(page.getByRole('heading', { level: 1, name: '근무표' })).toBeVisible();
    await expect(page.getByText(/조회만 할 수 있어요/)).toBeVisible();
    await expect(cell(page, ids.staff2, '2026-11-05')).toHaveText('연차');
    await expect(page.getByRole('button', { name: /바꾸기$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '지난주 복사' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '근무 유형' })).toHaveCount(0);
    expect(await axe(page)).toEqual([]);

    const h = { 'x-csrf-token': staff.csrf };
    const put = await staff.ctx.request.put(url('/api/roster/cell'), { headers: h, data: { userId: ids.staff, date: '2026-11-03', shiftTypeId: ids.types['휴무'] } });
    expect(put.status()).toBe(403);
    const copy = await staff.ctx.request.post(url('/api/roster/copy-week'), { headers: h, data: { fromWeekStart: '2026-10-26', toWeekStart: '2026-11-02' } });
    expect(copy.status()).toBe(403);
    const types = await staff.ctx.request.put(url('/api/shift-types'), { headers: h, data: { items: [] } });
    expect(types.status()).toBe(403);
    await page.reload();
    await expect(cell(page, ids.staff, '2026-11-03')).toHaveText('종일'); // 바뀌지 않았다
    expect(errors).toEqual([]);
    await staff.ctx.close();
  });

  test('phase-04-task-01 AC5: 대시보드 "오늘 근무" 카드에 오늘 근무자와 유형이 보인다', async ({ browser }) => {
    const manager = await loggedIn(browser, MANAGER);
    // 오늘(11/2): 복사로 정하늘 종일·서다온 오전. 윤실장은 휴무로 넣는다
    await apiCell(manager.ctx.request, manager.csrf, ids.manager, '2026-11-02', ids.types['휴무']!);
    const staff = await loggedIn(browser, STAFF);
    const page = await staff.ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/'));
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '오늘 근무' }) });
    const list = card.getByRole('list', { name: '11월 2일(월) 근무자' });
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list.getByRole('listitem').nth(0)).toContainText(STAFF.name);
    await expect(list.getByRole('listitem').nth(0)).toContainText('종일');
    await expect(list.getByRole('listitem').nth(1)).toContainText(STAFF2.name);
    await expect(list.getByRole('listitem').nth(1)).toContainText('오전');
    await expect(list.getByRole('listitem').nth(2)).toContainText(MANAGER.name);
    await expect(list.getByRole('listitem').nth(2)).toContainText('휴무');
    await card.getByRole('link', { name: '근무표' }).click();
    await expect(page).toHaveURL(/\/hr\/roster$/);
    await expect(page.getByText('11월 2일 ~ 8일 · 오늘 근무 2명 · 조회만 할 수 있어요')).toBeVisible();
    expect(errors).toEqual([]);
    await staff.ctx.close();
    await manager.ctx.close();
  });

  test('phase-04-task-01: 근무 유형을 더하면 칸 고르기에 나오고, 월간 보기와 휴대폰 너비에서도 화면이 넘치지 않는다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, MANAGER);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/roster'));
    await page.getByRole('button', { name: '근무 유형' }).click();
    const dialog = page.getByRole('dialog', { name: '근무 유형 관리' });
    await expect(dialog.getByRole('group', { name: /^근무 유형 \d/ })).toHaveCount(5);
    await dialog.getByRole('button', { name: '유형 추가' }).click();
    const row = dialog.getByRole('group', { name: '근무 유형 6' });
    await dialog.getByRole('button', { name: '저장하기' }).click();
    await expect(row.getByText('이름을 적어 주세요.')).toBeVisible();
    await row.getByLabel('이름').fill('교육');
    await row.getByLabel('시작 시각').fill('10:00');
    await row.getByLabel('끝 시각').fill('16:00');
    expect(await axe(page)).toEqual([]);
    await dialog.getByRole('button', { name: '저장하기' }).click();
    await expect(page.getByText('근무 유형을 저장했어요.')).toBeVisible();
    await expect(page.getByRole('region', { name: '근무표 표' })).toBeVisible();
    await expect(page.locator('.roster-legend')).toContainText('교육 10:00~16:00');
    await cell(page, ids.staff2, '2026-11-04').getByRole('button').click();
    await page.getByRole('dialog').getByRole('button', { name: /^교육/ }).click();
    await expect(cell(page, ids.staff2, '2026-11-04')).toHaveText('교육');

    // 월간 보기: 10/26 ~ 12/6, 주소에 남는다
    await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '월간' }).click();
    await expect(page).toHaveURL(/view=month/);
    await expect(page.locator('.period')).toHaveText('2026년 11월');
    await expect(page.locator('thead th[scope="col"]')).toHaveCount(1 + 42);
    await expect(cell(page, ids.staff2, '2026-11-04')).toHaveText('교육');
    await page.reload();
    await expect(page.locator('.period')).toHaveText('2026년 11월');
    await page.getByRole('button', { name: '다음 달' }).click();
    await expect(page.locator('.period')).toHaveText('2026년 12월');
    expect(await axe(page)).toEqual([]);
    await noHorizontalScroll(page);
    expect(errors).toEqual([]);
    await ctx.close();

    for (const scheme of ['light', 'dark'] as const) {
      const phone = await loggedIn(browser, STAFF, { width: 390, height: 844 });
      const p = await phone.ctx.newPage();
      await p.emulateMedia({ colorScheme: scheme });
      await p.goto(url('/hr/roster'));
      await expect(cell(p, ids.staff, '2026-11-02')).toHaveText('종일');
      await noHorizontalScroll(p);
      await p.goto(url('/'));
      await expect(p.getByRole('list', { name: '11월 2일(월) 근무자' })).toBeVisible();
      await noHorizontalScroll(p);
      await phone.ctx.close();
    }
  });

  test('phase-04-task-01: 근무표 인쇄는 셸 없이 열리고 PDF가 A4 가로 한 장에 병원명·근무·연차·인원을 담는다', async ({ browser }) => {
    const { ctx } = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/hr/roster'));
    await page.getByRole('link', { name: '인쇄' }).click();
    await expect(page).toHaveURL(/\/print\/roster\?from=2026-11-02&to=2026-11-08$/);
    const paper = page.getByTestId('print-roster');
    await expect(paper).toContainText('하늘숲치과');
    await expect(paper).toContainText('근무표 (11월 2일 ~ 8일)');
    await expect(paper).toContainText('연차');
    await expect(page.getByRole('navigation')).toHaveCount(0);
    expect(await axe(page)).toEqual([]);

    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true });
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    expect(doc.numPages).toBe(1);
    const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
    const mm = (pt: number) => (pt * 25.4) / 72;
    expect(Math.abs(mm(vp.width) - 297)).toBeLessThan(1);
    expect(Math.abs(mm(vp.height) - 210)).toBeLessThan(1);
    const { text } = await extractText(doc, { mergePages: true });
    const flat = (text as string).replace(/\s+/g, ' ');
    for (const want of ['하늘숲치과', '근무표 11월 2일 ~ 8일', STAFF.name, STAFF2.name, '종일', '오전', '연차', '근무 인원', '1 / 1']) expect(flat, want).toContain(want);
    for (const no of ['인쇄하기', '닫기', '대시보드', '로그아웃', '인쇄 미리보기예요']) expect(flat, no).not.toContain(no);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

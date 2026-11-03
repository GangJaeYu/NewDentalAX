// 이 파일이 하는 일: 장비 점검·멸균기 기록 화면 E2E(phase-04-task-03 AC1~AC4, FR-101·102). 이 파일 전용 격리 서버(fixtures.ts, TEST_NOW 2026-11-02)에서
// 멸균 기록 입력 양식의 칸 목록에 환자 관련 칸이 없는지(AC1), 직원이 BI "불합격"을 저장하면 실장에게 알림이 1건 가고 조치 전 경고가 보이다가
// 조치 기록 뒤 사라지는지(AC2), 6개월 주기 장비에 마지막 점검 2026-05-10을 기록하면 다음 2026-11-10·D-8이 보이는지(AC3),
// 기간을 정한 인쇄 PDF에 그 기간 기록 줄이 모두 들어가고 기간 밖 기록은 없는지(AC4)를 본다. axe 위반 0건·4너비×2테마 가로 스크롤 없음도 확인한다.
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { extractText, getDocumentProxy } from 'unpdf';
import { expect, test, type IsoServer } from './fixtures.ts';
import { expectNoHorizontalScroll } from './layout.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'eqadmin', password: 'Equip-Admin-Pass-8', withDemo: false };
const MANAGER = { username: 'eqmanager', password: 'Equip-Manager-Pass-8', name: '윤실장' };
const STAFF = { username: 'eqstaff', password: 'Equip-Staff-Pass-8', name: '서다온' };

/** 멸균 기록 입력 칸(서버 STERILIZER_INPUT_FIELDS와 같음) */
const STERILIZER_FIELDS = ['equipmentId', 'date', 'testType', 'cycleNo', 'tempC', 'pressureKpa', 'minutes', 'result', 'actionTaken'];
/** 환자 관련으로 볼 말(칸 이름·레이블) */
const PATIENT_WORDS = /환자|성명|이름|차트|주민|생년|연락처|전화|진료|patient|chart|name|birth|phone/i;

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;
const ids: { st1: number; st2: number; xray: number } = { st1: 0, st2: 0, xray: 0 };

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

/** 장비 목록 표의 한 줄 */
function eqRow(page: Page, name: string) {
  return page.getByTestId('equipment-table').getByRole('row').filter({ hasText: name });
}

test.describe.serial('장비 점검·멸균기 기록', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request, isoServer }) => {
    server = isoServer;
    const r = await request.post('/api/setup', { data: ADMIN });
    expect(r.status()).toBe(201);
    await isoServer.addUser('manager', MANAGER.username, MANAGER.password, MANAGER.name);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
  });

  test('phase-04-task-03 AC3: 실장이 6개월 주기 장비를 등록하고 직원이 마지막 점검 2026-05-10을 기록하면 다음 점검 2026-11-10·D-8이 보인다', async ({ browser }) => {
    const mctx = await loggedIn(browser, MANAGER);
    const m = await mctx.newPage();
    const mErrors = watchErrors(m);
    await m.goto(url('/facility/equipment'));
    await expect(m.getByRole('heading', { name: '장비 점검·유지보수' })).toBeVisible();
    await expect(m.getByText('등록한 장비가 없어요')).toBeVisible();
    await m.getByRole('button', { name: '장비 등록', exact: true }).click();
    const dialog = m.getByRole('dialog', { name: '장비 등록' });
    await dialog.getByLabel('장비 이름').fill('오토클레이브 1호기');
    await dialog.getByLabel('종류').selectOption({ label: '멸균기' });
    await dialog.getByLabel('설치일').fill('2022-03-15');
    await dialog.getByLabel('점검 주기(개월)').fill('6');
    await dialog.getByLabel('업체').fill('한빛메디칼');
    expect(await axe(m)).toEqual([]);
    await dialog.getByRole('button', { name: '등록' }).click();
    await expect(m.getByText('"오토클레이브 1호기" 장비를 등록했어요.')).toBeVisible();
    // 점검 기록 전에는 설치일 기준으로 계산되어 이미 지났다
    const drawer0 = m.getByRole('dialog', { name: '오토클레이브 1호기' });
    await expect(drawer0.getByTestId('equipment-next-due')).toContainText('2022-09-15');
    await drawer0.getByRole('button', { name: '닫기' }).click();
    // 나머지 장비는 API로(멸균기 2호기, 방사선 장비)
    const h = await csrf(mctx);
    for (const [key, body] of [
      ['st2', { name: '오토클레이브 2호기', kind: 'sterilizer', inspectCycleMonths: 6, installedOn: '2026-08-20' }],
      ['xray', { name: '파노라마 촬영장치', kind: 'xray', inspectCycleMonths: 12, installedOn: '2025-10-28' }],
    ] as const) {
      const r = await mctx.request.post(url('/api/equipment'), { headers: h, data: body });
      expect(r.status()).toBe(201);
      ids[key] = ((await r.json()) as { data: { id: number } }).data.id;
    }
    const list = (await (await mctx.request.get(url('/api/equipment'))).json()) as { data: { items: Array<{ id: number; name: string }> } };
    ids.st1 = list.data.items.find((i) => i.name === '오토클레이브 1호기')?.id ?? 0;
    expect(mErrors).toEqual([]);
    await mctx.close();

    const sctx = await loggedIn(browser, STAFF);
    const page = await sctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/facility/equipment'));
    // 직원에게는 등록 버튼이 없다
    await expect(page.getByRole('button', { name: '장비 등록', exact: true })).toHaveCount(0);
    await eqRow(page, '오토클레이브 1호기').click();
    const drawer = page.getByRole('dialog', { name: '오토클레이브 1호기' });
    await expect(drawer.getByText('장비 관리')).toHaveCount(0);
    const form = drawer.getByRole('form', { name: '점검·수리 기록 남기기' });
    // 앞날짜는 화면에서 막는다
    await form.getByLabel('일자').fill('2026-11-05');
    await form.getByLabel('내용').fill('정기 점검');
    await form.getByRole('button', { name: '기록 저장' }).click();
    await expect(form.getByText('오늘이나 지난 날짜를 골라 주세요.')).toBeVisible();
    await form.getByLabel('일자').fill('2026-05-10');
    await form.getByLabel('내용').fill('정기 점검: 챔버 청소, 필터 교체');
    await form.getByLabel('첨부(선택)').setInputFiles({ name: '점검표.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n') });
    await form.getByRole('button', { name: '기록 저장' }).click();
    await expect(page.getByText('점검 기록을 남겼어요.')).toBeVisible();
    await expect(drawer.getByTestId('equipment-next-due')).toHaveText('2026-11-10 (D-8)');
    await expect(drawer.getByTestId('equipment-logs')).toContainText('정기 점검: 챔버 청소, 필터 교체');
    await expect(drawer.getByTestId('equipment-logs')).toContainText('첨부: 점검표.pdf');
    await expect(drawer.getByTestId('equipment-logs')).toContainText(STAFF.name);
    expect(await axe(page)).toEqual([]);
    await drawer.getByRole('button', { name: '닫기' }).click();
    // 목록에도 D-8, 새로 고쳐도 그대로
    await page.reload();
    await expect(eqRow(page, '오토클레이브 1호기')).toContainText('2026-11-10');
    await expect(eqRow(page, '오토클레이브 1호기').locator('.chip', { hasText: /^D-8$/ })).toBeVisible();
    await expect(eqRow(page, '파노라마 촬영장치').locator('.chip', { hasText: /^점검 지남 5일$/ })).toBeVisible();
    // 점검 임박 보기에는 둘 다, 여유 있는 2호기는 없다
    await page.getByRole('button', { name: '점검 임박' }).click();
    await expect(page.getByTestId('equipment-table').locator('tbody tr')).toHaveCount(2);
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await sctx.close();
  });

  test('phase-04-task-03 AC1: 멸균 기록 입력 양식의 칸 목록에 환자 관련 입력란이 없다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/facility/sterilizer'));
    await expect(page.getByRole('heading', { name: '멸균기 점검 기록' })).toBeVisible();
    const form = page.getByTestId('sterilizer-form');
    await expect(form).toBeVisible();
    // 불합격을 골라야 보이는 칸(조치 내용)까지 펼친다
    await form.getByLabel('불합격').check();
    await expect(form.getByLabel('조치 내용(알면 바로 적기)')).toBeVisible();
    // 문자열로 넘겨 브라우저 안에서 계산한다(서버용 타입 설정에는 DOM 타입이 없음). 칸마다 name·type·연결된 레이블 글자를 모은다
    const fields = (await page.evaluate(`[...document.querySelectorAll('[data-testid="sterilizer-form"] input, [data-testid="sterilizer-form"] select, [data-testid="sterilizer-form"] textarea')].map((e) => ({
      name: e.name,
      type: e.type,
      label: ((e.id ? document.querySelector('label[for="' + e.id + '"]') : e.closest('label'))?.textContent ?? '').trim(),
    }))`)) as Array<{ name: string; type: string; label: string }>;
    expect(fields.length).toBeGreaterThanOrEqual(9);
    // 모든 입력 칸은 정해 둔 칸 이름 중 하나이고, 그 밖의 칸은 없다
    expect(fields.every((f) => STERILIZER_FIELDS.includes(f.name)), JSON.stringify(fields)).toBe(true);
    expect([...new Set(fields.map((f) => f.name))].sort()).toEqual([...STERILIZER_FIELDS].filter((f) => f !== 'testType').sort());
    for (const f of fields) {
      expect(f.name, f.name).not.toMatch(PATIENT_WORDS);
      expect(f.label, f.label).not.toMatch(PATIENT_WORDS);
    }
    // 검사 종류는 단추 묶음(B&D·BI·CI·사이클)
    for (const t of ['B&D 테스트', 'BI(생물학적 지표)', 'CI(화학적 지표)', '사이클 기록']) await expect(form.getByRole('button', { name: t })).toBeVisible();
    await expect(form).not.toContainText(/환자|차트|주민/);
    await form.getByLabel('합격', { exact: true }).check();
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-03 AC2: 직원이 BI "불합격"을 저장하면 실장에게 알림이 즉시 1건 가고, 조치 기록 전까지 경고가 보이다가 조치 후 사라진다', async ({ browser }) => {
    const sctx = await loggedIn(browser, STAFF);
    const page = await sctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/facility/sterilizer'));
    const form = page.getByTestId('sterilizer-form');
    await expect(page.getByTestId('sterilizer-alert')).toHaveCount(0);
    await form.getByRole('button', { name: 'BI(생물학적 지표)' }).click();
    await form.getByLabel('멸균기').selectOption({ label: '오토클레이브 1호기' });
    await form.getByLabel('사이클 번호').fill('BI-1102');
    await expect(form.getByLabel('온도(℃)')).toHaveValue('134');
    await form.getByLabel('불합격').check();
    await form.getByRole('button', { name: '기록 저장' }).click();
    await expect(page.getByText('불합격을 기록했어요. 실장님께 알림을 보냈어요. 조치 내용을 꼭 적어 주세요.')).toBeVisible();
    const alert = page.getByTestId('sterilizer-alert');
    await expect(alert).toContainText('조치하지 않은 멸균 불합격이 1건 있어요');
    await expect(alert).toContainText('오토클레이브 1호기 · BI(생물학적 지표) · 사이클 BI-1102');
    await expect(page.getByTestId('sterilizer-table').getByRole('row').filter({ hasText: 'BI-1102' }).locator('.chip', { hasText: '불합격 · 조치 전' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await sctx.close();

    // 실장: 알림 1건(직원에게는 가지 않음), 경고가 보인다
    const mctx = await loggedIn(browser, MANAGER);
    const notes = (await (await mctx.request.get(url('/api/notifications'))).json()) as { data: Array<{ type: string; title: string; link: string }> };
    const fails = notes.data.filter((n) => n.type === 'sterilizer_fail');
    expect(fails).toHaveLength(1);
    expect(fails[0]?.title).toBe('오토클레이브 1호기 BI(생물학적 지표) 불합격이에요');
    const staffCtx = await loggedIn(browser, STAFF);
    const sNotes = (await (await staffCtx.request.get(url('/api/notifications'))).json()) as { data: Array<{ type: string }> };
    expect(sNotes.data.filter((n) => n.type === 'sterilizer_fail')).toHaveLength(0);
    await staffCtx.close();

    const m = await mctx.newPage();
    const mErrors = watchErrors(m);
    // 알림 링크(?focus=)로 들어오면 조치 입력 창이 바로 열린다
    await m.goto(url(fails[0]?.link ?? '/facility/sterilizer'));
    const dialog = m.getByRole('dialog', { name: '불합격 조치 기록' });
    await expect(dialog).toContainText('BI-1102');
    await dialog.getByRole('button', { name: '조치 저장' }).click();
    await expect(dialog.getByText('어떻게 조치했는지 적어 주세요.')).toBeVisible();
    expect(await axe(m)).toEqual([]);
    await dialog.getByLabel('조치 내용').fill('같은 날 멸균한 기구 전부 재멸균, BI 재검사 의뢰');
    await dialog.getByRole('button', { name: '조치 저장' }).click();
    await expect(m.getByText('조치 내용을 기록했어요. 경고에서 빠졌어요.')).toBeVisible();
    await expect(m.getByTestId('sterilizer-alert')).toHaveCount(0);
    await expect(m.getByTestId('sterilizer-table').getByRole('row').filter({ hasText: 'BI-1102' }).locator('.chip', { hasText: '불합격 · 조치함' })).toBeVisible();
    // 새로 고쳐도 경고가 없고, 서버의 조치 전 목록도 비었다
    await m.reload();
    await expect(m.getByRole('heading', { name: '멸균기 점검 기록' })).toBeVisible();
    await expect(m.getByTestId('sterilizer-table')).toContainText('BI-1102');
    await expect(m.getByTestId('sterilizer-alert')).toHaveCount(0);
    const l = (await (await mctx.request.get(url('/api/sterilizer-logs'))).json()) as { data: { openFailures: unknown[] } };
    expect(l.data.openFailures).toEqual([]);
    expect(mErrors).toEqual([]);
    await mctx.close();
  });

  test('phase-04-task-03 AC4: 기간을 정해 인쇄한 PDF에 그 기간 기록 줄이 모두 들어 있고 기간 밖 기록은 없다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const h = await csrf(ctx);
    // 2026-09-25 ~ 2026-11-02 매일: 1호기 B&D, 2호기 사이클
    const inRange: string[] = [];
    const outRange: string[] = [];
    for (let d = 0; d <= 38; d += 1) {
      const date = new Date(Date.UTC(2026, 8, 25 + d)).toISOString().slice(0, 10);
      for (const [eq, type] of [
        [ids.st1, 'bd'],
        [ids.st2, 'cycle'],
      ] as const) {
        const cycleNo = `P${type === 'bd' ? 'A' : 'B'}${date.slice(5).replace('-', '')}`;
        const r = await ctx.request.post(url('/api/sterilizer-logs'), { headers: h, data: { equipmentId: eq, date, testType: type, cycleNo, tempC: 134, pressureKpa: 216, minutes: 4, result: 'pass' } });
        expect(r.status()).toBe(201);
        (date >= '2026-10-01' && date <= '2026-10-31' ? inRange : outRange).push(cycleNo);
      }
    }
    expect(inRange).toHaveLength(62);
    // 기록 화면에서 기간을 고르고 "기간 인쇄"로 이동
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/facility/sterilizer'));
    await page.getByLabel('시작일').fill('2026-10-01');
    await expect(page).toHaveURL(/from=2026-10-01/);
    await page.getByLabel('끝일').fill('2026-10-31');
    await expect(page).toHaveURL(/to=2026-10-31/);
    await expect(page.getByTestId('sterilizer-csv')).toHaveAttribute('href', '/api/sterilizer-logs/export?from=2026-10-01&to=2026-10-31');
    await page.getByRole('link', { name: '기간 인쇄' }).click();
    await expect(page).toHaveURL(/\/print\/sterilizer\?from=2026-10-01&to=2026-10-31/);
    const paper = page.getByTestId('print-sterilizer');
    await expect(paper).toContainText('2026-10-01 ~ 2026-10-31');
    await expect(page.getByTestId('print-sterilizer-table').locator('tbody tr')).toHaveCount(62);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    expect(await axe(page)).toEqual([]);

    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4' });
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    expect(doc.numPages).toBeGreaterThanOrEqual(2);
    const { text } = await extractText(doc, { mergePages: true });
    const flat = (text as string).replace(/\s+/g, ' ');
    for (const want of inRange) expect(flat, want).toContain(want);
    for (const no of outRange) expect(flat, no).not.toContain(no);
    for (const want of ['하늘숲치과', '멸균기 점검 기록', '2026-10-01 ~ 2026-10-31', '62건', '확인자']) expect(flat, want).toContain(want);
    for (const no of ['인쇄하기', '닫기', '로그아웃', '인쇄 미리보기예요']) expect(flat, no).not.toContain(no);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('phase-04-task-03 FR-101: 장비 대장 인쇄 화면에 장비 정보와 점검·수리 이력이 들어 있다', async ({ browser }) => {
    const ctx = await loggedIn(browser, STAFF);
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(url('/facility/equipment'));
    await eqRow(page, '오토클레이브 1호기').click();
    await page.getByRole('dialog', { name: '오토클레이브 1호기' }).getByRole('link', { name: '장비 대장 인쇄' }).click();
    await expect(page).toHaveURL(new RegExp(`/print/equipment/${ids.st1}$`));
    const paper = page.getByTestId('print-equipment');
    await expect(paper).toContainText('장비 대장 — 오토클레이브 1호기');
    await expect(paper).toContainText('2026-11-10 (D-8)');
    await expect(page.getByTestId('print-equipment-table')).toContainText('정기 점검: 챔버 청소, 필터 교체');
    expect(await axe(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  for (const path of ['/facility/equipment', '/facility/sterilizer']) {
    test(`phase-04-task-03 화면 ${path}: 1440·1024·768·390 너비와 두 테마에서 가로 스크롤이 없다`, async ({ browser }) => {
      test.setTimeout(60000);
      for (const [width, height] of [
        [1440, 900],
        [1024, 768],
        [768, 1024],
        [390, 844],
      ] as const) {
        for (const colorScheme of ['light', 'dark'] as const) {
          const ctx = await loggedIn(browser, MANAGER, { viewport: { width, height }, colorScheme });
          const page = await ctx.newPage();
          await page.goto(url(path));
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          await expect(page.locator('.eq-table tbody tr').first()).toBeVisible();
          await expectNoHorizontalScroll(page, `${path} ${width}-${colorScheme}`);
          await ctx.close();
        }
      }
    });
  }
});

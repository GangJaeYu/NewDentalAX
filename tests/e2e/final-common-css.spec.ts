// 이 파일이 하는 일: 공통 CSS로 모은 두 가지 처리를 확인한다(phase-05-task-03, STATE 하네스 점검 항목).
// ① 인쇄: styles/print.css가 인쇄물 전체에서 대체 숫자 모양(ss06·tabular-nums)을 꺼서, PDF 글자를 뽑아도 화면의 숫자가 빠지지 않는다
//    (발주서·근무표·멸균기 기록 인쇄 화면, 데모 데이터). ② 그래프: components.css의 계열 색 class(.c1~.c6)가 fill="none" 도형(도넛 호)을 채우지 않는다.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { extractText, getDocumentProxy } from 'unpdf';
import type { Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'cssadmin', password: 'Css-Admin-Pass-6', withDemo: true };

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;

/** 데모 데이터의 첫 발주서 번호 */
function firstOrderId(dataDir: string): number {
  const db = new DatabaseSync(path.join(dataDir, 'app.db'), { readOnly: true });
  try {
    return Number((db.prepare('SELECT MIN(id) AS id FROM purchase_orders').get() as { id: number }).id);
  } finally {
    db.close();
  }
}

/** 관리자로 로그인해 둔다 */
async function login(page: Page): Promise<void> {
  const r = await page.request.post(url('/api/auth/login'), { data: { username: ADMIN.username, password: ADMIN.password } });
  expect(r.status()).toBe(200);
}

test.describe.serial('공통 CSS: 인쇄 숫자·도넛 그래프', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test.beforeAll(async ({ request }) => {
    expect((await request.post('/api/setup', { data: ADMIN })).status()).toBe(201);
  });

  for (const screen of ['/print/order/', '/print/roster', '/print/sterilizer']) {
    test(`phase-05-task-03 AC2: 인쇄 ${screen} — 인쇄 때 숫자 모양 기능이 꺼지고, PDF 글자에 화면의 숫자가 모두 들어 있다`, async ({ page }) => {
      const to = screen.endsWith('/') ? `${screen}${firstOrderId(server.dataDir)}` : screen;
      await login(page);
      await page.goto(url(to), { waitUntil: 'networkidle' });
      await expect(page.locator('h2.doctitle').first()).toBeVisible();
      await page.evaluate('document.fonts.ready');
      // 화면(스크린)에서는 본문 글꼴 기능(ss06)이 켜져 있다
      expect(await page.evaluate('getComputedStyle(document.body).fontFeatureSettings')).toContain('ss06');
      await page.emulateMedia({ media: 'print' });
      const styles = (await page.evaluate(`[...document.querySelectorAll('body, body *')].filter((el) => {
        const s = getComputedStyle(el);
        return s.fontFeatureSettings !== 'normal' || s.fontVariantNumeric !== 'normal';
      }).length`)) as number;
      expect(styles, '인쇄 때 숫자 모양 기능이 남은 요소 수').toBe(0);
      // 화면 글의 숫자 묶음(2자리 이상)이 PDF 글자에도 그대로 있어야 한다
      const runs = [...new Set(((await page.locator('.paper, main').first().innerText()).match(/\d{2,}/g) ?? []))];
      expect(runs.length).toBeGreaterThan(0);
      const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true });
      const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true });
      const flat = text.replace(/\s+/g, '');
      const missing = runs.filter((r) => !flat.includes(r));
      expect(missing, `${to} PDF에서 빠진 숫자`).toEqual([]);
    });
  }

  test('phase-05-task-03 AC2: 월간 요약 도넛 그래프의 호(fill="none")가 계열 색으로 채워지지 않고 선 색만 쓴다', async ({ page }) => {
    await login(page);
    await page.goto(url('/finance/monthly'), { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const donut = page.locator('svg.chart[aria-label^="분류별 지출 비중"]');
    await expect(donut).toBeVisible();
    const arcs = (await page.evaluate(`[...document.querySelectorAll('svg.chart[aria-label^="분류별 지출 비중"] [fill="none"]')].map((el) => {
      const s = getComputedStyle(el);
      return { cls: el.getAttribute('class') || '', fill: s.fill, stroke: s.stroke };
    })`)) as Array<{ cls: string; fill: string; stroke: string }>;
    const colored = arcs.filter((a) => /\bc\d\b/.test(a.cls));
    expect(colored.length, '색이 있는 도넛 호').toBeGreaterThan(0);
    for (const a of arcs) expect(a.fill, a.cls).toBe('none');
    for (const a of colored) expect(a.stroke, a.cls).not.toBe('none');
  });
});

// 이 파일이 하는 일: 최종 통합 점검(phase-05-task-03 AC3, NFR-006·NFR-007) — 데모 데이터를 넣은 서버에서 앱의 모든 화면(frontend.md §3 경로 전체 +
// 첫 설정·로그인·비밀번호 변경·권한 없음·없는 주소)을 열어 라이트·다크 두 테마에서 axe 위반이 0건인지 보고,
// 휴대폰 흉내(390×844, isMobile·터치)에서 가로 넘침이 없는지 잰다. 휴대폰 흉내에서는 넘치면 브라우저가 화면을 축소해 innerWidth가 커지므로
// "scrollWidth ≤ innerWidth"와 "innerWidth = 390 그대로"를 함께 본다(04-05 발견 함정). 무거운 axe 검사는 화면 하나씩 테스트로 나눈다.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '하늘숲치과', name: '한원장', username: 'finaladmin', password: 'Final-Admin-Pass-3', withDemo: true };
const STAFF = { username: 'finalstaff', password: 'Final-Staff-Pass-3', name: '정하늘' };
const NEWBIE = { username: 'finalnew', password: 'Final-New-Temp-3', name: '서다온' };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const THEMES = ['light', 'dark'] as const;

type Who = { username: string; password: string } | null;
/** 점검할 화면: 이름, 주소(데모 데이터 id가 필요하면 함수), 누구로 들어가는지(null = 로그인 전) */
interface Screen {
  name: string;
  path: string | ((ids: Ids) => string);
  who?: Who;
}
type Ids = Record<'item' | 'order' | 'doc' | 'equipment' | 'post', number>;

const SCREENS: Screen[] = [
  { name: '로그인', path: '/login', who: null },
  { name: '대시보드', path: '/' },
  { name: '알림', path: '/notifications' },
  { name: '공지·인수인계', path: '/desk/board' },
  { name: '공지 상세', path: (i) => `/desk/board/${i.post}` },
  { name: '오픈·마감 체크리스트', path: '/desk/checklist' },
  { name: '응대 스크립트', path: '/desk/script' },
  { name: '리뷰 답글', path: '/desk/review' },
  { name: '자주 쓰는 문구', path: '/desk/templates' },
  { name: '재고 현황', path: '/inventory' },
  { name: '품목 상세', path: (i) => `/inventory/items/${i.item}` },
  { name: '입출고 기록', path: '/inventory/moves' },
  { name: '영수증 입고', path: '/inventory/receipt' },
  { name: '발주서 목록', path: '/inventory/orders' },
  { name: '발주서 상세', path: (i) => `/inventory/orders/${i.order}` },
  { name: '거래처', path: '/inventory/vendors' },
  { name: '단가 비교', path: '/inventory/prices' },
  { name: '품목 가져오기', path: '/inventory/import' },
  { name: 'AI 문서 작성', path: '/docs/writer' },
  { name: '업무 도우미', path: '/docs/assistant' },
  { name: '회의록', path: '/docs/minutes' },
  { name: '광고 문구 점검', path: '/docs/adcheck' },
  { name: '홍보 글', path: '/docs/promo' },
  { name: '서식 보관함', path: '/docs/library' },
  { name: '서식 상세', path: (i) => `/docs/library/${i.doc}` },
  { name: '근무표', path: '/hr/roster' },
  { name: '연차·휴가', path: '/hr/leave' },
  { name: '교육 이수', path: '/hr/training' },
  { name: '신입 적응', path: '/hr/onboarding' },
  { name: '채용', path: '/hr/hiring' },
  { name: '장비 점검', path: '/facility/equipment' },
  { name: '멸균기 기록', path: '/facility/sterilizer' },
  { name: '법정 의무 일정', path: '/facility/legal' },
  { name: '지출 기록', path: '/finance/expenses' },
  { name: '월간 운영 요약', path: '/finance/monthly' },
  { name: '사용자·권한', path: '/admin/users' },
  { name: '병원 기본 정보', path: '/admin/clinic' },
  { name: 'AI 설정', path: '/admin/ai' },
  { name: 'AI 사용 기록', path: '/admin/ai-usage' },
  { name: '백업·복원', path: '/admin/backup' },
  { name: '활동 기록', path: '/admin/audit' },
  { name: '데모 데이터 초기화', path: '/admin/reset' },
  { name: '인쇄: 발주서', path: (i) => `/print/order/${i.order}` },
  { name: '인쇄: 문서', path: (i) => `/print/document/${i.doc}` },
  { name: '인쇄: 체크리스트', path: '/print/checklist/open/2026-11-02' },
  { name: '인쇄: 근무표', path: '/print/roster' },
  { name: '인쇄: 멸균기 기록', path: '/print/sterilizer' },
  { name: '인쇄: 장비 이력', path: (i) => `/print/equipment/${i.equipment}` },
  { name: '권한 없음(직원이 관리 화면)', path: '/admin/users', who: STAFF },
  { name: '없는 주소', path: '/no-such-page' },
  { name: '비밀번호 변경(임시 비밀번호)', path: '/change-password', who: NEWBIE },
];

let server: IsoServer;
let ids: Ids;
const url = (p: string) => `${server.baseURL}${p}`;

/** 브라우저 묶음을 만들고(who가 있으면 API로 로그인) 돌려준다 */
async function open(browser: Browser, opts: Record<string, unknown>, who: Who): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...opts, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  if (who) {
    const r = await ctx.request.post(url('/api/auth/login'), { data: { username: who.username, password: who.password } });
    expect(r.status(), who.username).toBe(200);
  }
  return ctx;
}

/** 화면이 다 그려질 때까지 기다린다(제목 — 인쇄 화면은 문서 제목 — 이 보이고 뼈대 모양이 사라짐) */
async function ready(page: Page, to: string): Promise<void> {
  await page.goto(url(to), { waitUntil: 'networkidle' });
  await expect(page.locator('h1, h2.doctitle').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15000 });
  await page.evaluate('document.fonts.ready');
}

async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** 지금 화면의 가로 넘침(넘친 요소 이름 몇 개도 같이, 390 기준) */
async function overflow(page: Page): Promise<{ sw: number; iw: number; wide: string[] }> {
  return (await page.evaluate(`(() => {
    const limit = ${PHONE.viewport.width};
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > limit + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.tablewrap, [data-scroll-x]'))
      .slice(0, 5)
      .map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''));
    return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, wide };
  })()`)) as { sw: number; iw: number; wide: string[] };
}

/** 데모 데이터에서 상세 화면 주소에 쓸 첫 번째 id를 읽는다 */
function readIds(dataDir: string): Ids {
  const db = new DatabaseSync(path.join(dataDir, 'app.db'), { readOnly: true });
  try {
    const first = (table: string) => {
      const row = db.prepare(`SELECT MIN(id) AS id FROM ${table}`).get() as { id: number | null };
      expect(row.id, `${table} 데모 데이터`).not.toBeNull();
      return Number(row.id);
    };
    return { item: first('items'), order: first('purchase_orders'), doc: first('documents'), equipment: first('equipment'), post: first('posts') };
  } finally {
    db.close();
  }
}

test.describe.serial('최종 점검: 전 화면 axe(두 테마)·휴대폰 390px', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test('phase-05-task-03 AC3: 첫 설정 화면(두 테마) axe 위반 0건, 휴대폰 390px 넘침 없음', async ({ browser }) => {
    test.setTimeout(90000);
    for (const theme of THEMES) {
      const ctx = await open(browser, { ...DESKTOP, colorScheme: theme }, null);
      const page = await ctx.newPage();
      await ready(page, '/setup');
      await expect(page.getByRole('heading', { level: 1 })).toContainText('첫 설정');
      expect(await axe(page), `첫 설정 ${theme}`).toEqual([]);
      await ctx.close();
      const pctx = await open(browser, { ...PHONE, colorScheme: theme }, null);
      const ppage = await pctx.newPage();
      await ready(ppage, '/setup');
      const o = await overflow(ppage);
      expect(o.iw === 390 && o.sw <= o.iw, `첫 설정 ${theme} sw ${o.sw} / iw ${o.iw}, 넘친 요소: ${o.wide.join(', ')}`).toBe(true);
      await pctx.close();
    }
  });

  test('준비: 데모 데이터로 첫 설정, 직원·임시 비밀번호 계정, 상세 화면 id', async ({ request, isoServer }) => {
    expect((await request.post('/api/setup', { data: ADMIN })).status()).toBe(201);
    await isoServer.addUser('staff', STAFF.username, STAFF.password, STAFF.name);
    await isoServer.addUser('staff', NEWBIE.username, NEWBIE.password, NEWBIE.name);
    const db = new DatabaseSync(path.join(isoServer.dataDir, 'app.db'));
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.prepare('UPDATE users SET must_change_pw = 1 WHERE username = ?').run(NEWBIE.username);
    } finally {
      db.close();
    }
    ids = readIds(isoServer.dataDir);
  });

  for (const s of SCREENS) {
    test(`phase-05-task-03 AC3: ${s.name} 화면 — 라이트·다크 axe 위반 0건, 휴대폰 390px(innerWidth 390 유지) 넘침 없음`, async ({ browser }) => {
      test.setTimeout(120000);
      const to = typeof s.path === 'function' ? s.path(ids) : s.path;
      const who = s.who === undefined ? ADMIN : s.who;
      for (const theme of THEMES) {
        const ctx = await open(browser, { ...DESKTOP, colorScheme: theme }, who);
        const page = await ctx.newPage();
        await ready(page, to);
        expect(await axe(page), `${to} ${theme}`).toEqual([]);
        await ctx.close();

        const pctx = await open(browser, { ...PHONE, colorScheme: theme }, who);
        const ppage = await pctx.newPage();
        await ready(ppage, to);
        const o = await overflow(ppage);
        expect(o.iw === 390 && o.sw <= o.iw, `${to} ${theme} sw ${o.sw} / iw ${o.iw}, 넘친 요소: ${o.wide.join(', ')}`).toBe(true);
        await pctx.close();
      }
    });
  }
});

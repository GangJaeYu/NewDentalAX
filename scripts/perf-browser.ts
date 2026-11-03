// 이 파일이 하는 일: 성능 측정(NFR-005, phase-05-task-01)의 브라우저 부분. Playwright(설치된 Edge, 화면 없이)로 로그인 뒤 대시보드 첫 화면이
// 다 그려질 때까지 걸린 시간을 잰다. 서버 코드를 불러오지 않아서 E2E spec(tests/e2e/perf-first-screen.spec.ts)과 scripts/perf.ts가 함께 쓴다.
import type { Browser } from '@playwright/test';

/** 측정용 관리자 계정(임시 폴더의 DB에만 들어간다) */
export const PERF_USER = { username: 'perfadmin', password: 'Perf-Admin-Pass-7', name: '측정용 원장' } as const;

/** 첫 화면 측정 결과(ms) */
export interface FirstScreenResult {
  /** 로그인 단추를 누른 때부터 대시보드가 다 그려질 때까지 */
  loginToDashboard: number[];
  /** 로그인한 상태에서 새 탭으로 주소(/)를 열어 다 그려질 때까지 */
  openDashboard: number[];
  worst: number;
}

/** 대시보드 카드 제목(DESIGN §4 순서, 원장 기준 10개) */
export const DASHBOARD_CARDS = ['오늘 할 일', '재고 경고', '다가오는 점검·의무 일정', '오늘 근무', '공지', 'AI 빠른 요청', '발주 진행', '이번 주 일정', '최근 입출고', '이번 달 지출'];

/** 브라우저 쪽 "다 그려졌다" 조건: 카드 10개 제목이 모두 보이고, 서버 날짜가 머리말에 들어가고, "불러오는 중"이 사라졌다.
 * 화면의 보안 정책(CSP)이 글자 코드 실행을 막으므로 함수로 넘긴다(브라우저 안에서 실행된다). */
/** 브라우저 안 요소에서 이 검사가 쓰는 부분만(서버용 타입 설정에는 DOM 타입이 없다) */
interface El {
  textContent: string | null;
  parentElement: El | null;
  querySelector(sel: string): El | null;
  querySelectorAll(sel: string): Iterable<El>;
}

function dashboardReady(want: string[]): boolean {
  const doc = (globalThis as unknown as { document: El & { body: El } }).document;
  const main = doc.querySelector('main') ?? doc.body;
  const titles = [...main.querySelectorAll('h2')].map((h) => (h.textContent ?? '').trim());
  if (!want.every((t) => titles.includes(t))) return false;
  const h1 = main.querySelector('h1');
  if (!h1?.parentElement || !/\d{4}년 \d{1,2}월 \d{1,2}일/.test(h1.parentElement.textContent ?? '')) return false;
  return !(main.textContent ?? '').includes('불러오는 중');
}

/**
 * Playwright(설치된 Edge, 화면 없이)로 첫 화면 시간을 잰다. runs번씩 새 브라우저 묶음(빈 캐시)을 만들어
 * (browser를 주면 그 브라우저를 쓰고 닫지 않는다)
 * ① 로그인 화면에서 로그인 단추를 누른 때부터 대시보드가 다 그려질 때까지, ② 로그인한 묶음에서 주소 /를 새로 열어 다 그려질 때까지를 잰다.
 */
export async function measureFirstScreen(
  base: string,
  runs = 5,
  who: { username: string; password: string } = PERF_USER,
  given?: Browser,
): Promise<FirstScreenResult> {
  const browser = given ?? (await (await import('@playwright/test')).chromium.launch({ channel: 'msedge', headless: true }));
  const loginToDashboard: number[] = [];
  const openDashboard: number[] = [];
  try {
    for (let i = 0; i < runs; i++) {
      const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1440, height: 900 } });
      try {
        const page = await ctx.newPage();
        await page.goto(`${base}/login`, { waitUntil: 'load' });
        await page.getByLabel('아이디').fill(who.username);
        await page.getByLabel('비밀번호').fill(who.password);
        const t0 = performance.now();
        await page.getByRole('button', { name: '로그인' }).click();
        await page.waitForFunction(dashboardReady, DASHBOARD_CARDS, { timeout: 15000, polling: 'raf' });
        loginToDashboard.push(Math.round(performance.now() - t0));

        const tab = await ctx.newPage();
        const t1 = performance.now();
        await tab.goto(`${base}/`, { waitUntil: 'commit' });
        await tab.waitForFunction(dashboardReady, DASHBOARD_CARDS, { timeout: 15000, polling: 'raf' });
        openDashboard.push(Math.round(performance.now() - t1));
      } finally {
        await ctx.close();
      }
    }
  } finally {
    if (!given) await browser.close();
  }
  return { loginToDashboard, openDashboard, worst: Math.max(...loginToDashboard, ...openDashboard) };
}


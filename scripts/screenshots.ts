// 이 파일이 하는 일: 화면 스크린샷 생성(`npm run screenshots`). 임시 서버를 띄워 지정한 화면을 4너비(1440·1024·768·390)×2테마(라이트·다크)로
// Edge에서 찍어 artifacts/screens/<page>-<너비>-<테마>.png(화면 크기)와 -full.png(전체 길이)로 저장하고, 가로 스크롤이 생긴 화면과 Pretendard 글꼴이 안 걸린 화면을 알려 준다.
// 순서: 첫 설정 전 화면(setup) → API로 첫 설정(관리자 생성) → 로그아웃 상태 화면(login) → 로그인 상태 화면(대시보드 셸·스텁 등).
// 화면 목록은 각 화면 태스크(최종 phase-05-task-03)가 PAGES에 더한다. 특정 화면만: node scripts/screenshots.ts dashboard stub
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, type BrowserContext } from '@playwright/test';

const ROOT = process.cwd();
const PORT = Number(process.env.E2E_PORT || 18090);
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, 'artifacts', 'screens');
const WIDTHS: Array<[number, number]> = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
const THEMES = ['light', 'dark'] as const;
const ADMIN = { clinicName: '하늘숲치과', name: '김지현', username: 'shotadmin', password: 'Shot-Admin-Pass-1', withDemo: false };

/** 찍을 화면: 이름, 주소, 상태(setup = 첫 설정 전, anon = 로그아웃, user = 관리자로 로그인), 화면이 다 그려졌다고 볼 글자 */
const PAGES: Array<{ name: string; url: string; state: 'setup' | 'anon' | 'user'; ready: string }> = [
  { name: 'setup', url: '/setup', state: 'setup', ready: '첫 설정' },
  { name: 'login', url: '/login', state: 'anon', ready: '로그인' },
  { name: 'dashboard', url: '/', state: 'user', ready: '오늘 할 일' },
  { name: 'stub', url: '/inventory', state: 'user', ready: '준비 중인 화면이에요' },
  // phase-02-task-05: 백업·복원, 데모 데이터 초기화
  { name: 'admin-backup', url: '/admin/backup', state: 'user', ready: '보관할 백업 개수' },
  { name: 'admin-reset', url: '/admin/reset', state: 'user', ready: '업무 데이터 비어 있음' },
];

/** 서버가 준비될 때까지 /api/health를 확인한다 */
async function waitReady(timeoutMs = 30000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok && ((await r.json()) as { ok?: boolean }).ok) return;
    } catch {
      // 아직 안 켜짐
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`테스트 서버(${BASE})가 ${timeoutMs / 1000}초 안에 준비되지 않았어요.`);
}

/** 브라우저 묶음(context)에 관리자 로그인 쿠키를 심는다 */
async function login(ctx: BrowserContext): Promise<void> {
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: ADMIN.username, password: ADMIN.password } });
  if (r.status() !== 200) throw new Error(`스크린샷용 로그인 실패: ${r.status()}`);
}

const only = process.argv.slice(2);
const pages = only.length ? PAGES.filter((p) => only.includes(p.name)) : PAGES;
fs.mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['scripts/e2e-server.ts'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, E2E_PORT: String(PORT) } });
let problems = 0;
try {
  await waitReady();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let setupDone = false;
  for (const p of pages) {
    if (p.state !== 'setup' && !setupDone) {
      const r = await fetch(`${BASE}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ADMIN) });
      if (r.status !== 201) throw new Error(`스크린샷용 첫 설정 실패: ${r.status}`);
      setupDone = true;
    }
    for (const [width, height] of WIDTHS) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
        if (p.state === 'user') await login(ctx);
        const page = await ctx.newPage();
        await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' });
        await page.getByText(p.ready).first().waitFor({ state: 'attached', timeout: 10000 });
        await page.evaluate('document.fonts.ready');
        const file = path.join(OUT, `${p.name}-${width}-${theme}.png`);
        // 기준선(harness_setup/evidence/design-baseline)과 같은 화면 크기 캡처 + 아래까지 이어 찍은 캡처(-full).
        // 전체 캡처에서는 고정 요소(휴대폰 아래쪽 탭)가 첫 화면 위치에 찍히므로 겹침 판단은 화면 크기 캡처로 한다.
        await page.screenshot({ path: file });
        await page.screenshot({ path: file.replace(/\.png$/, '-full.png'), fullPage: true });
        // 문자열로 넘겨 브라우저 안에서 계산한다(서버용 타입 설정에는 DOM 타입이 없음)
        const overflow = (await page.evaluate('document.documentElement.scrollWidth > window.innerWidth')) as boolean;
        const font = (await page.evaluate(`document.fonts.check('14px "Pretendard Variable"')`)) as boolean;
        if (overflow || !font) problems += 1;
        console.log(`${overflow ? '가로 스크롤 있음' : font ? 'OK' : '글꼴 안 걸림'}  ${path.relative(ROOT, file)}`);
        await ctx.close();
      }
    }
  }
  await browser.close();
} finally {
  server.kill();
}
if (problems) {
  console.error(`문제가 있는 화면 ${problems}개`);
  process.exit(1);
}

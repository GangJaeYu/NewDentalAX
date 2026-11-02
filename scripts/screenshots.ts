// 이 파일이 하는 일: 화면 스크린샷 생성(`npm run screenshots`). 임시 서버를 띄워 지정한 화면을 4너비(1440·1024·768·390)×2테마(라이트·다크)로
// Edge에서 찍어 artifacts/screens/<page>-<너비>-<테마>.png로 저장하고, 가로 스크롤이 생긴 화면을 알려 준다.
// 지금은 첫 화면(home)만 찍는다. 화면 목록은 각 화면 태스크(최종 phase-05-task-03)가 PAGES에 더한다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const ROOT = process.cwd();
const PORT = Number(process.env.E2E_PORT || 18090);
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, 'artifacts', 'screens');
const WIDTHS: Array<[number, number]> = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
const THEMES = ['light', 'dark'] as const;
/** 찍을 화면: 이름과 주소 */
const PAGES: Array<{ name: string; url: string }> = [{ name: 'home', url: '/' }];

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

fs.mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['scripts/e2e-server.ts'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, E2E_PORT: String(PORT) } });
let problems = 0;
try {
  await waitReady();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const p of PAGES) {
    for (const [width, height] of WIDTHS) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
        const page = await ctx.newPage();
        await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' });
        const file = path.join(OUT, `${p.name}-${width}-${theme}.png`);
        await page.screenshot({ path: file, fullPage: true });
        // 문자열로 넘겨 브라우저 안에서 계산한다(서버용 타입 설정에는 DOM 타입이 없음)
        const overflow = (await page.evaluate('document.documentElement.scrollWidth > window.innerWidth')) as boolean;
        if (overflow) problems += 1;
        console.log(`${overflow ? '가로 스크롤 있음' : 'OK'}  ${path.relative(ROOT, file)}`);
        await ctx.close();
      }
    }
  }
  await browser.close();
} finally {
  server.kill();
}
if (problems) {
  console.error(`가로 스크롤이 생긴 화면 ${problems}개`);
  process.exit(1);
}

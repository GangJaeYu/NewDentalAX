// 이 파일이 하는 일: README에 넣을 대표 화면을 찍어 docs/images/<파일>.png로 저장한다(phase-05-task-04).
// 찍을 화면 목록은 scripts/screens/phase-05-task-04.ts의 readmeShots에 있다. 임시 서버(.tmp/readme-shots/, 포트 E2E_PORT 기본 18090)를 띄우고
// 첫 설정 때 "데모 데이터 넣기"를 켜서 가상 하늘숲치과 데이터(환자 정보 없음)로 찍는다. AI는 데모 모드라 비용이 들지 않는다.
// 사용법: npm run build:web 뒤 node scripts/readme-shots.ts [파일이름 ...]   (화면이 바뀌면 다시 실행해 같은 이름으로 덮어쓴다)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { acquireHeavySlot } from './heavy-slot.ts';
import { readmeShots } from './screens/phase-05-task-04.ts';

const ROOT = process.cwd();
const PORT = Number(process.env.E2E_PORT || 18090);
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, 'docs', 'images');
const ADMIN = { clinicName: '하늘숲치과', name: '김지현', username: 'readmeadmin', password: 'Readme-Admin-Pass-1', withDemo: true };

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
  throw new Error(`README 촬영용 서버(${BASE})가 ${timeoutMs / 1000}초 안에 준비되지 않았어요.`);
}

if (!fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) {
  console.error('화면 파일(web/dist)이 없어요. 먼저 npm run build:web 을 실행해 주세요.');
  process.exit(1);
}

const only = process.argv.slice(2);
const shots = only.length ? readmeShots.filter((s) => only.includes(s.file)) : readmeShots;
fs.mkdirSync(OUT, { recursive: true });
const releaseSlot = await acquireHeavySlot('readme-shots');
const DATA_DIR = path.join(ROOT, '.tmp', 'readme-shots', `run-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
const server = spawn(process.execPath, ['scripts/e2e-server.ts'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, E2E_PORT: String(PORT), E2E_DATA_DIR: DATA_DIR } });
let problems = 0;
try {
  await waitReady();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let setupDone = false;
  // 첫 설정 전 화면(setup)을 먼저 찍고, 그다음 데모 데이터와 함께 첫 설정을 마친 뒤 나머지를 찍는다
  const ordered = [...shots.filter((s) => s.state === 'setup'), ...shots.filter((s) => s.state !== 'setup')];
  for (const s of ordered) {
    if (s.state !== 'setup' && !setupDone) {
      const r = await fetch(`${BASE}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ADMIN) });
      if (r.status !== 201) throw new Error(`README 촬영용 첫 설정 실패: ${r.status}`);
      setupDone = true;
    }
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, colorScheme: 'light', locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    if (s.state === 'user') {
      const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { username: ADMIN.username, password: ADMIN.password } });
      if (r.status() !== 200) throw new Error(`README 촬영용 로그인 실패: ${r.status()}`);
    }
    const page = await ctx.newPage();
    await page.goto(`${BASE}${s.url}`, { waitUntil: 'networkidle' });
    await page.getByText(s.ready).first().waitFor({ timeout: 15000 });
    if (s.action) await s.action(page);
    await page.evaluate('document.fonts.ready');
    const file = path.join(OUT, `${s.file}.png`);
    await page.screenshot({ path: file });
    const overflow = (await page.evaluate('document.documentElement.scrollWidth > window.innerWidth')) as boolean;
    if (overflow) problems += 1;
    console.log(`${overflow ? '가로 스크롤 있음' : 'OK'}  ${path.relative(ROOT, file)}  (${s.width}×${s.height})`);
    await ctx.close();
  }
  await browser.close();
} finally {
  releaseSlot();
  server.kill();
  await new Promise((res) => setTimeout(res, 500));
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    // 서버가 아직 파일을 쥐고 있으면 남겨 둔다(.tmp는 git 제외)
  }
}
if (problems) {
  console.error(`문제가 있는 화면 ${problems}개`);
  process.exit(1);
}

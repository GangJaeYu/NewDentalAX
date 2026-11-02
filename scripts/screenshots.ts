// 이 파일이 하는 일: 화면 스크린샷 생성(`npm run screenshots`). 임시 서버를 띄워 지정한 화면을 4너비(1440·1024·768·390)×2테마(라이트·다크)로
// Edge에서 찍어 artifacts/screens/<page>-<너비>-<테마>.png(화면 크기)와 -full.png(전체 길이)로 저장하고, 가로 스크롤이 생긴 화면과 Pretendard 글꼴이 안 걸린 화면을 알려 준다.
// 순서: 첫 설정 전 화면(setup) → API로 첫 설정(관리자 생성) → 로그아웃 상태 화면(login) → 로그인 상태 화면(대시보드 셸·스텁 등).
// 화면 목록: 새 화면은 scripts/screens/<태스크ID>.ts에 `export const pages`로 더한다(이 파일의 PAGES는 고치지 않는다). 특정 화면만: node scripts/screenshots.ts dashboard stub
// 알림 화면·종 팝오버(phase-02-task-04)를 위해 첫 설정 뒤 서버 DB(임시 데이터 폴더)에 예시 알림을 notify.emit으로 넣는다. action이 있는 화면은 찍기 전에 그 동작(팝오버 열기)을 한다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { appDbPath, openDb } from '../server/db/index.ts';
import { fixedClock } from '../server/lib/clock.ts';
import { emitNotification } from '../server/modules/notifications/emit.ts';
import { seedDemo as seedDeskDemo } from '../server/modules/desk/seed.ts';

const ROOT = process.cwd();
const PORT = Number(process.env.E2E_PORT || 18090);
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, 'artifacts', 'screens');
const WIDTHS: Array<[number, number]> = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
const THEMES = ['light', 'dark'] as const;
const ADMIN = { clinicName: '하늘숲치과', name: '김지현', username: 'shotadmin', password: 'Shot-Admin-Pass-1', withDemo: false };

/** 찍을 화면: 이름, 주소, 상태(setup = 첫 설정 전, anon = 로그아웃, user = 관리자로 로그인), 화면이 다 그려졌다고 볼 글자 */
const PAGES: Array<{ name: string; url: string; state: 'setup' | 'anon' | 'user'; ready: string; action?: (page: Page) => Promise<void> }> = [
  { name: 'setup', url: '/setup', state: 'setup', ready: '첫 설정' },
  { name: 'login', url: '/login', state: 'anon', ready: '로그인' },
  { name: 'dashboard', url: '/', state: 'user', ready: '오늘 할 일' },
  // 아직 준비 중인 화면 하나(실제 화면이 되면 다른 준비 중 화면으로 옮기거나 지운다. 04-04가 /finance/monthly → /inventory/receipt, 04-08이 /inventory/receipt → /hr/hiring으로 옮김)
  { name: 'stub', url: '/hr/hiring', state: 'user', ready: '준비 중인 화면이에요' },
  { name: 'notifications', url: '/notifications', state: 'user', ready: '거즈 재고가 부족해요' },
  {
    name: 'notification-popover',
    url: '/',
    state: 'user',
    ready: '오늘 할 일',
    action: async (page) => {
      await page.getByTestId('notification-bell').click();
      await page.getByRole('dialog', { name: '알림' }).getByText('거즈 재고가 부족해요').waitFor();
    },
  },
  { name: 'admin-ai', url: '/admin/ai', state: 'user', ready: 'AI 시험해 보기' },
  { name: 'admin-ai-usage', url: '/admin/ai-usage', state: 'user', ready: 'AI 사용 기록이 없어요' },
  // phase-01-task-05: 사용자·권한, 병원 기본 정보, 활동 기록
  { name: 'users', url: '/admin/users', state: 'user', ready: '직원 목록' },
  { name: 'clinic', url: '/admin/clinic', state: 'user', ready: '진료시간' },
  { name: 'audit', url: '/admin/audit', state: 'user', ready: '시작 날짜' },
  // phase-02-task-05: 백업·복원, 데모 데이터 초기화
  { name: 'admin-backup', url: '/admin/backup', state: 'user', ready: '보관할 백업 개수' },
  // 스크린샷용 예시 알림(업무 데이터)이 들어가 있어 '있음/비어 있음' 대신 공통 제목으로 기다린다(02-04·02-05 통합 결함 수정)
  { name: 'admin-reset', url: '/admin/reset', state: 'user', ready: '지금 상태' },
  // phase-03-task-04: 공지·인수인계, 오픈·마감 체크리스트, 체크리스트 인쇄(데스크 데모 데이터를 한 번 넣고 다시 그린다)
  { name: 'desk-board', url: '/desk/board', state: 'user', ready: '공지·인수인계', action: (page) => withDeskDemo(page, '11월 원내 감염관리 교육 일정 안내') },
  { name: 'desk-board-detail', url: '/desk/board/1', state: 'user', ready: '공지·인수인계', action: (page) => withDeskDemo(page, '읽은 사람 1명') },
  { name: 'desk-checklist', url: '/desk/checklist', state: 'user', ready: '오픈·마감 체크리스트', action: (page) => withDeskDemo(page, '출입문·대기실 조명 켜기') },
  { name: 'desk-checklist-past', url: '/desk/checklist?date=2026-11-01', state: 'user', ready: '오픈·마감 체크리스트', action: (page) => withDeskDemo(page, '조회만 할 수 있어요') },
  { name: 'print-checklist', url: '/print/checklist/open/2026-11-01', state: 'user', ready: '체크리스트', action: (page) => withDeskDemo(page, '확인자') },
];

/** phase-03-task-04: 데스크 데모 데이터(공지·인수인계·체크리스트)를 처음 한 번만 서버 DB에 넣고, 화면을 다시 그려 waitText가 보일 때까지 기다린다 */
let deskSeeded = false;
async function withDeskDemo(page: Page, waitText: string): Promise<void> {
  if (!deskSeeded) {
    const db = openDb(appDbPath(DATA_DIR));
    try {
      seedDeskDemo(db, { clock: fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00'), scale: 1 });
    } finally {
      db.close();
    }
    deskSeeded = true;
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(waitText).first().waitFor({ timeout: 10000 });
}

/** 스크린샷용 예시 알림(관리자가 받는 것): 읽지 않음 4건 + 읽음 1건 */
function seedNotifications(dataDir: string): void {
  const db = openDb(appDbPath(dataDir));
  const clock = fixedClock(process.env.TEST_NOW || '2026-11-02T09:00:00+09:00');
  try {
    emitNotification(db, { type: 'notice', title: '11월 원내 감염관리 교육 일정 안내', link: '/desk/board', dedupeKey: 'shot:notice' }, clock);
    db.run('UPDATE notifications SET read_at = created_at');
    emitNotification(db, { type: 'leave_requested', title: '이수진 님이 11월 7일 연차를 신청했어요', body: '사유: 개인 일정', link: '/hr/leave', dedupeKey: 'shot:leave' }, clock);
    emitNotification(db, { type: 'equipment_due', title: '오토클레이브 정기 점검이 7일 남았어요', link: '/facility/equipment', dedupeKey: 'shot:equip' }, clock);
    emitNotification(db, { type: 'ai_budget', title: '이번 달 AI 사용 금액이 예산의 80%를 넘었어요', body: '사용 40,120원 / 예산 50,000원', link: '/admin/ai-usage', dedupeKey: 'shot:budget' }, clock);
    emitNotification(db, { type: 'stock_low', title: '거즈 재고가 부족해요', body: '현재 3팩 · 적정 10팩', link: '/inventory', dedupeKey: 'shot:stock' }, clock);
  } finally {
    db.close();
  }
}

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
// 각 태스크가 scripts/screens/<태스크ID>.ts에 내보낸 화면 목록도 더한다(types.ts 제외, 이름순)
const screensDir = path.join(ROOT, 'scripts', 'screens');
for (const f of fs.existsSync(screensDir) ? fs.readdirSync(screensDir).filter((n) => n.endsWith('.ts') && n !== 'types.ts').sort() : []) {
  const mod = (await import(pathToFileURL(path.join(screensDir, f)).href)) as { pages?: typeof PAGES };
  for (const pg of mod.pages ?? []) PAGES.push(pg);
}
const pages = only.length ? PAGES.filter((p) => only.includes(p.name)) : PAGES;
fs.mkdirSync(OUT, { recursive: true });
// 데이터 폴더를 직접 정해 예시 알림을 넣을 수 있게 한다(끝나면 지운다)
const DATA_DIR = path.join(ROOT, '.tmp', 'screens', `run-${Date.now()}`);
fs.mkdirSync(DATA_DIR, { recursive: true });
const server = spawn(process.execPath, ['scripts/e2e-server.ts'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, E2E_PORT: String(PORT), E2E_DATA_DIR: DATA_DIR } });
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
      seedNotifications(DATA_DIR);
    }
    for (const [width, height] of WIDTHS) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
        if (p.state === 'user') await login(ctx);
        const page = await ctx.newPage();
        await page.goto(`${BASE}${p.url}`, { waitUntil: 'networkidle' });
        await page.getByText(p.ready).first().waitFor({ state: 'attached', timeout: 10000 });
        if (p.action) await p.action(page);
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

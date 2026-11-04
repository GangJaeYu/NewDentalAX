// 이 파일이 하는 일: GitHub Pages에 올릴 구경용 체험판(서버 없이 화면만)을 만든다. 결과는 .tmp/demo-site/dist(git 제외).
// 1) 시연 영상 장면을 빠르게 실행하며(demo-video.ts --fast --record-dir) 화면이 주고받은 응답과 AI 예시 답을 녹화한다.
// 2) 그 데이터로 서버를 다시 켜고 관리자로 모든 화면·상세 화면·탭을 돌며 조회(GET) 응답을 녹화한다.
// 3) 둘을 합쳐 demo-data.json을 만들고(PC 경로·사설 IP는 지움), VITE_DEMO=1로 화면을 빌드한다(web/src/demo/demoMode.ts가 응답을 대신함).
// 4) Pages와 같은 하위 주소로 띄워 모든 화면을 열어 보고, 녹화가 빠진 요청과 화면 오류를 알려 준다.
// 사용법: npm run build:web 뒤 node scripts/demo-site.ts [--skip-walkthrough] [--serve]   (--serve는 확인용 주소를 열어 둔 채 기다린다)
// 가상 하늘숲치과 데이터만 쓰고(환자 정보 없음), AI는 데모 모드라 비용 0원이다.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium, type Page } from '@playwright/test';
import { DEMO_ADMIN } from './demo-video-scenes.ts';
import { featureOf, normQuery, REPLAY_POST_PATHS, type DemoData, type DemoRecord } from '../web/src/demo/demoData.ts';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp', 'demo-site');
const REC = path.join(TMP, 'rec');
const OUT = path.join(TMP, 'dist');
const DATA_FILE = path.join(TMP, 'demo-data.json');
const argv = process.argv.slice(2);
const BASE_PATH = argv.find((a) => a.startsWith('--base='))?.slice('--base='.length) ?? '/NewDentalAX/';
const DEMO_NOW = process.env.TEST_NOW || '2026-11-02T09:00:00+09:00';
const API_PORT = Number(process.env.DEMO_SITE_PORT || 18330);
const STATIC_PORT = API_PORT + 1;
const MAX_PAGES = 400;

/** AI 스트림 기능별 예시 입력(가상 내용, 환자 정보 없음) */
const AI_STREAM_SAMPLES: Record<string, unknown> = {
  quick: { text: '주차 2시간 무료 안내 전화 멘트 만들어줘' },
  script: { situation: '예약 시간을 다른 날로 바꾸고 싶다는 전화', tone: '친절하게' },
  review_reply: { review: '원장님이 친절하게 설명해 주셔서 좋았어요. 다만 대기 시간이 조금 길었어요.' },
  template: { purpose: '정기 검진 시기 안내 문자', length: 'short' },
  doc_writer: { kind: '원내 공지', points: '다음 주 수요일 감염관리 교육, 점심시간 13:10~13:50, 장소 상담실, 교육 자료 미리 읽기', length: 'medium' },
  minutes: { notes: '11월 직원 회의. 멸균기 2호기 점검 일정 확정 필요. 연말 휴진 일정 공지하기로 함. 재고 정리는 실장이 금요일까지.' },
  promo: { topic: '스케일링 건강보험 적용 안내', channel: '블로그', length: 'medium' },
  hiring: { jobType: '치과위생사', conditions: '주 5일, 09:30~18:30, 점심 1시간', preferred: '경력 2년 이상' },
  onboarding: { jobType: '치과위생사' },
};

/** 목록 API → 그 목록의 id로 여는 화면 주소들 */
const DETAIL_FROM_LIST: Record<string, string[]> = {
  '/api/items': ['/inventory/items/:id'],
  '/api/posts': ['/desk/board/:id'],
  '/api/orders': ['/inventory/orders/:id', '/print/order/:id'],
  '/api/documents': ['/docs/library/:id', '/print/document/:id'],
  '/api/equipment': ['/print/equipment/:id'],
};

/** 주·달을 넘기며 보는 화면 */
const PAGED_SCREENS = ['/hr/roster', '/hr/leave', '/finance/expenses', '/finance/monthly', '/facility/sterilizer', '/desk/checklist', '/facility/legal'];

/** 목록 응답 본문({ data: [{ id }] } 또는 [{ id }])에서 id를 꺼낸다 */
function idsOf(body: string): number[] {
  try {
    const j = JSON.parse(body) as { data?: unknown } | unknown[];
    const list = Array.isArray(j) ? j : Array.isArray((j as { data?: unknown }).data) ? ((j as { data: unknown[] }).data) : [];
    return list.map((x) => (x as { id?: unknown })?.id).filter((id): id is number => typeof id === 'number');
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 서버가 준비될 때까지 기다린다 */
async function waitReady(base: string, timeoutMs = 30000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {
      // 아직 안 켜짐
    }
    await sleep(300);
  }
  throw new Error(`체험판 녹화용 서버(${base})가 준비되지 않았어요.`);
}

/** 화면 경로 표(web/src/routes.tsx)에서 경로 패턴을 읽는다 */
function routePatterns(): string[] {
  const src = fs.readFileSync(path.join(ROOT, 'web', 'src', 'routes.tsx'), 'utf8');
  return [...src.matchAll(/\{ path: '(\/[^']*)', load:/g)].map((m) => m[1] as string);
}

/** 경로 패턴(/a/:id)을 정규식으로 */
function patternRegex(p: string): RegExp {
  return new RegExp(`^${p.replace(/:[a-z]+/gi, '[^/]+')}$`);
}

/** 녹화 본문에서 이 PC의 폴더 경로·사설 IP를 지운다(공개 사이트에 올리기 때문) */
function scrub(text: string): string {
  let t = text;
  for (const p of [ROOT, ROOT.replace(/\\/g, '/')]) {
    t = t.split(p).join('C:/DentalAX');
    t = t.split(JSON.stringify(p).slice(1, -1)).join('C:/DentalAX');
  }
  t = t.replace(/C:\\\\Users\\\\[^\\"]+/gi, 'C:\\\\DentalAX').replace(/C:\/Users\/[^/"]+/gi, 'C:/DentalAX');
  t = t.replace(/\b(192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g, '192.168.0.10');
  return t;
}

// ───────────── 1) 시연 장면 녹화 ─────────────
if (!fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) {
  console.error('화면 파일(web/dist)이 없어요. 먼저 npm run build:web 을 실행해 주세요.');
  process.exit(1);
}
fs.mkdirSync(TMP, { recursive: true });
if (!argv.includes('--skip-walkthrough') || !fs.existsSync(path.join(REC, 'walkthrough.jsonl'))) {
  fs.rmSync(REC, { recursive: true, force: true });
  console.log('[demo-site] 1/4 시연 장면을 빠르게 실행하며 응답을 녹화합니다');
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/demo-video.ts', '--fast', `--record-dir=${REC}`], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('[demo-site] 시연 장면 실행이 실패했어요. 위 메시지를 확인해 주세요.');
    process.exit(1);
  }
}

// ───────────── 2) 모든 화면 돌며 조회 응답 녹화 ─────────────
console.log('[demo-site] 2/4 모든 화면을 돌며 조회 응답을 녹화합니다');
const crawlDir = path.join(TMP, `crawl-${Date.now()}`);
fs.cpSync(path.join(REC, 'data'), crawlDir, { recursive: true });
const API_BASE = `http://localhost:${API_PORT}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/e2e-server.ts'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: { ...process.env, E2E_PORT: String(API_PORT), E2E_DATA_DIR: crawlDir, TEST_NOW: DEMO_NOW },
});
const crawled = new Map<string, DemoRecord>();
const patterns = routePatterns();
const paramRes = patterns.filter((p) => p.includes(':')).map(patternRegex);
try {
  await waitReady(API_BASE);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light' });
  await ctx.clock.setFixedTime(new Date(DEMO_NOW));
  const login = await ctx.request.post(`${API_BASE}/api/auth/login`, { data: { username: DEMO_ADMIN.username, password: DEMO_ADMIN.password } });
  if (login.status() !== 200) throw new Error(`관리자 로그인 실패: ${login.status()}`);
  ctx.on('response', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/') || r.request().method() !== 'GET') return;
    const key = `GET ${u.pathname}?${normQuery(u.search)}`;
    if (crawled.has(key)) return;
    void r
      .text()
      .then((b) => crawled.set(key, { m: 'GET', p: u.pathname, q: normQuery(u.search), k: '', s: r.status(), t: r.headers()['content-type'] ?? '', b }))
      .catch(() => undefined);
  });
  const page = await ctx.newPage();
  const queue: string[] = ['/', ...patterns.filter((p) => !p.includes(':'))];
  const seen = new Set<string>(queue);
  let visited = 0;
  while (queue.length && visited < MAX_PAGES) {
    const p = queue.shift() as string;
    visited += 1;
    await visit(page, p);
    const hrefs = (await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href') ?? ''))).map((h) => h.split('#')[0] ?? '');
    for (const h of hrefs) {
      const pathOnly = h.split('?')[0] ?? '';
      if (!h.startsWith('/') || h.startsWith('/api/') || seen.has(h)) continue;
      if (!paramRes.some((re) => re.test(pathOnly))) continue;
      seen.add(h);
      queue.push(h);
    }
  }
  // 목록 응답의 id로 상세·인쇄 화면을 하나씩 연다(목록 줄은 링크가 아니라 눌러서 여는 경우가 많아서)
  await sleep(500);
  const detailUrls = new Set<string>();
  for (const r of crawled.values()) {
    const routes = DETAIL_FROM_LIST[r.p];
    if (!routes) continue;
    for (const id of idsOf(r.b)) for (const t of routes) detailUrls.add(t.replace(':id', String(id)));
  }
  for (const u of detailUrls) {
    if (visited >= MAX_PAGES || seen.has(u)) continue;
    seen.add(u);
    visited += 1;
    await visit(page, u);
  }
  // 주·달을 넘기는 화면은 앞뒤로 두 번씩 넘겨 본다
  for (const p of PAGED_SCREENS) {
    for (const name of [/^(‹ )?이전( 달| 주)?$/, /^다음( 달| 주)?( ›)?$/]) {
      await visit(page, p);
      for (let i = 0; i < 2; i += 1) {
        await page.getByRole('button', { name }).first().click({ timeout: 3000 }).catch(() => undefined);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
      }
    }
  }
  console.log(`[demo-site] 화면 ${visited}곳, 조회 응답 ${crawled.size}개 녹화`);
  // AI 기능마다 예시 요청을 한 번씩 보내 데모 모드 답을 받아 둔다(키 없는 데모 모드라 비용 0원). 체험판은 같은 기능이면 이 답을 보여 준다
  const csrf = ((await login.json()) as { data?: { csrfToken?: string } }).data?.csrfToken ?? '';
  const headers = { 'x-csrf-token': csrf };
  const aiSamples: Array<{ path: string; body: Record<string, unknown> }> = [
    ...Object.entries(AI_STREAM_SAMPLES).map(([feature, input]) => ({ path: '/api/ai/stream', body: { feature, input } })),
    { path: '/api/ai/run', body: { feature: 'doc_revise', input: { text: '다음 주 수요일 점심시간에 상담실에서 감염관리 교육이 있습니다. 모두 참석해 주시기 바랍니다.', instruction: '더 부드럽게' } } },
    { path: '/api/finance/monthly/summary', body: { month: '2026-11' } },
  ];
  for (const s of aiSamples) {
    const r = await ctx.request.post(`${API_BASE}${s.path}`, { data: s.body, headers });
    const k = typeof s.body.feature === 'string' ? s.body.feature : '';
    if (r.status() >= 400) {
      console.warn(`[demo-site] AI 예시 실패 ${s.path} ${k}: ${r.status()} ${(await r.text()).slice(0, 200)}`);
      continue;
    }
    crawled.set(`POST ${s.path} ${k}`, { m: 'POST', p: s.path, q: '', k, s: r.status(), t: r.headers()['content-type'] ?? '', b: await r.text() });
  }
  await sleep(1000);
  await browser.close();
} finally {
  server.kill();
  await sleep(500);
  fs.rmSync(crawlDir, { recursive: true, force: true });
}

/** 화면 하나를 열고, 탭을 하나씩 눌러 본다(조회만 하는 동작) */
async function visit(page: Page, p: string): Promise<void> {
  await page.goto(`${API_BASE}${p}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
  const tabs = page.getByRole('tab');
  const n = await tabs.count();
  for (let i = 0; i < n; i += 1) {
    const tab = tabs.nth(i);
    if (!(await tab.isVisible().catch(() => false))) continue;
    await tab.click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
  }
}

// ───────────── 3) 합치기 → 체험판 빌드 ─────────────
console.log('[demo-site] 3/4 녹화를 합쳐 체험판을 빌드합니다');
const records = new Map<string, DemoRecord>(crawled);
const lines = fs.readFileSync(path.join(REC, 'walkthrough.jsonl'), 'utf8').split('\n').filter(Boolean);
for (const line of lines) {
  const r = JSON.parse(line) as { m: string; p: string; q: string; reqBody: string; s: number; t: string; b: string };
  if (r.s >= 500) continue;
  if (r.m === 'GET') {
    const key = `GET ${r.p}?${normQuery(r.q)}`;
    if (!crawled.has(key)) records.set(key, { m: 'GET', p: r.p, q: normQuery(r.q), k: '', s: r.s, t: r.t, b: r.b });
  } else if (r.m === 'POST' && REPLAY_POST_PATHS.includes(r.p) && r.s < 400) {
    const k = featureOf(r.reqBody);
    records.set(`POST ${r.p} ${k}`, { m: 'POST', p: r.p, q: '', k, s: r.s, t: r.t, b: r.b });
  }
}
const data: DemoData = { now: DEMO_NOW, records: [...records.values()].map((r) => ({ ...r, b: scrub(r.b) })) };
fs.writeFileSync(DATA_FILE, JSON.stringify(data));
const posts = data.records.filter((r) => r.m === 'POST').map((r) => `${r.p}${r.k ? `(${r.k})` : ''}`);
console.log(`[demo-site] 녹화 ${data.records.length}개, ${(fs.statSync(DATA_FILE).size / 1024 / 1024).toFixed(1)}MB. AI 예시: ${posts.join(', ')}`);

const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'config/vite.config.ts', '--base', BASE_PATH, '--outDir', OUT, '--emptyOutDir'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_DEMO: '1', VITE_DEMO_NOW: DEMO_NOW },
});
if (build.status !== 0) {
  console.error('[demo-site] 체험판 빌드가 실패했어요.');
  process.exit(1);
}
fs.copyFileSync(DATA_FILE, path.join(OUT, 'demo-data.json'));
// Pages는 없는 주소에 404.html을 보여 주므로, 같은 화면을 넣어 두면 /NewDentalAX/inventory 같은 주소로 바로 들어와도 열린다
fs.copyFileSync(path.join(OUT, 'index.html'), path.join(OUT, '404.html'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

// ───────────── 4) Pages처럼 띄워 모든 화면 확인 ─────────────
console.log('[demo-site] 4/4 Pages와 같은 주소로 띄워 모든 화면을 열어 봅니다');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const statics = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  const rel = decodeURIComponent(u.pathname.startsWith(BASE_PATH) ? u.pathname.slice(BASE_PATH.length) : '');
  let file = path.join(OUT, rel || 'index.html');
  let status = 200;
  if (!u.pathname.startsWith(BASE_PATH) || !file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(OUT, '404.html');
    status = 404;
  }
  res.writeHead(status, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise<void>((r) => statics.listen(STATIC_PORT, '127.0.0.1', r));
const SITE = `http://localhost:${STATIC_PORT}${BASE_PATH}`;
const problems: string[] = [];
{
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  let current = '';
  page.on('console', (m) => {
    if (m.text().startsWith('[체험판]')) problems.push(`${current}: ${m.text()}`);
    else if (m.type() === 'error' && !/status of 40[34]/.test(m.text())) problems.push(`${current}: 콘솔 오류 ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`${current}: 화면 오류 ${e.message}`));
  for (const p of ['/', ...patterns.filter((x) => !x.includes(':') && !x.startsWith('/print'))]) {
    current = p;
    await page.goto(`${SITE}${p.slice(1)}`, { waitUntil: 'domcontentloaded' });
    const ok = await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
    if (!ok) problems.push(`${p}: 제목(h1)이 보이지 않음`);
    if (page.url().includes('/login') || page.url().includes('/setup')) problems.push(`${p}: 로그인·첫 설정 화면으로 넘어감`);
  }
  await browser.close();
}
const uniq = [...new Set(problems)];
console.log(uniq.length ? `[demo-site] 확인할 것 ${uniq.length}건:\n  ${uniq.join('\n  ')}` : '[demo-site] 모든 화면이 열렸어요.');
console.log(`[demo-site] 결과: ${path.relative(ROOT, OUT)}`);
if (argv.includes('--serve')) {
  console.log(`[demo-site] 확인 주소: ${SITE}  (끝내려면 Ctrl+C)`);
} else {
  statics.close();
}

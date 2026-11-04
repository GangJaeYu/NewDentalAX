// 이 파일이 하는 일: 화면으로 보는 사용 흐름 문서(docs/walkthrough/)와 음성 없이 자막으로 따라가는 시연 영상(mp4)을 한 번에 만든다.
// 임시 서버(scripts/e2e-server.ts, 포트 18310~18319, 데이터 .tmp/demo-video/run-*)를 띄우고, Edge로 첫 설정부터 장면(demo-video-scenes.ts)을 천천히 조작하며 화면 송출을 FFMPEG로 녹화한다.
// 녹화 화면에만 가짜 커서·클릭 물결·자막 띠·단계 표시를 덧씌운다(제품 코드는 그대로). AI는 키가 없는 데모 모드라 비용 0원, 가상 하늘숲치과 데이터라 환자 정보 없음.
// 사용법: FFMPEG=<ffmpeg.exe 경로> node scripts/demo-video.ts [--fast]   (--fast는 녹화 없이 선택자만 빠르게 확인, 그림은 .tmp/demo-video/fast-shots)
// --record-dir=<폴더>를 주면(scripts/demo-site.ts가 씀) 화면이 주고받은 /api 응답을 <폴더>/walkthrough.jsonl에 적고, 끝난 뒤 서버 데이터를 <폴더>/data로 복사해 둔다.
// 음성은 넣지 않는다(사용자 결정 2026-11-03): 영상에 오디오 트랙이 없고, 장면 길이는 자막을 편하게 읽을 시간(초당 약 5.5글자 + 1.2초)으로 잡는다.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { acquireHeavySlot } from './heavy-slot.ts';
import { scenes, type Demo, type DemoScene } from './demo-video-scenes.ts';

const ROOT = process.cwd();
const TMP = path.join(ROOT, '.tmp', 'demo-video');
const argv = process.argv.slice(2);
const FAST = argv.includes('--fast');
/** 점검용: 앞에서부터 N개 장면만 실행(--until=N, --fast와 함께 쓴다) */
const RECORD_DIR = argv.find((a) => a.startsWith('--record-dir='))?.slice('--record-dir='.length) ?? '';
const UNTIL = Number(argv.find((a) => a.startsWith('--until='))?.split('=')[1] ?? scenes.length);
const OUT = FAST ? path.join(TMP, 'fast-shots') : path.join(ROOT, 'docs', 'walkthrough');
const IMG = FAST ? OUT : path.join(OUT, 'images');
const FFMPEG = process.env.FFMPEG ?? '';
const W = 1280;
const H = 720;
/** 속도: 커서 이동(ms)·한 글자 입력 간격(ms)·머무는 시간 배율 */
const SPEED = FAST ? { move: 0, type: 0, dwell: 0.05 } : { move: 600, type: 70, dwell: 1 };
/** 장면 시작부터 첫 자막까지(ms), 자막 문장 사이 쉼(ms) */
const LEAD = 300;
const GAP = 250;
/** 자막 읽기 속도(한국어 초당 글자 수, 띄어쓰기 제외)와 장면 끝 여유(ms) */
const CHARS_PER_SEC = 5.5;
const TAIL = 1200;
const HIDE_OVERLAY_CSS = '#__demo_cursor,#__demo_cap,#__demo_step,.__demo_ripple{visibility:hidden !important}';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pad2 = (n: number) => String(n).padStart(2, '0');

// ───────────── 자막 시각 준비 ─────────────
interface Line {
  text: string;
  /** 첫 자막으로부터(ms) */
  off: number;
  dur: number;
}
interface CaptionPlan {
  lines: Line[];
  /** 자막 전체를 읽는 시간(ms) */
  total: number;
}

/** 글자 수로 문장마다 자막을 보여 줄 시간을 정한다 */
function byChars(say: string[]): CaptionPlan {
  let t = 0;
  const lines = say.map((text) => {
    const dur = Math.round((text.replace(/\s/g, '').length / CHARS_PER_SEC) * 1000);
    const l = { text, off: t, dur };
    t += dur + GAP;
    return l;
  });
  return { lines, total: Math.max(0, t - GAP) };
}

function planCaptions(): CaptionPlan[] {
  return scenes.map((s) => byChars(s.say));
}

// ───────────── 녹화 화면 덧씌움(커서·물결·자막·단계·휴대폰 무대) ─────────────
/** 녹화용 페이지에만 넣는 스크립트(제품 코드 아님). 상태는 sessionStorage에 두어 새로 고침 뒤에도 이어진다 */
const OVERLAY_SCRIPT = String.raw`(() => {
  if (window.__demo) return;
  const KEY = '__demoState';
  let st = {};
  try { st = JSON.parse(sessionStorage.getItem(KEY) || '{}') || {}; } catch (e) { st = {}; }
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  let cx = typeof st.x === 'number' ? st.x : 640, cy = typeof st.y === 'number' ? st.y : 400;
  let root = null, cur = null, cap = null, step = null, stage = null, dialogs = -1;
  const CSS = '#__demo_root{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;color-scheme:light}'
    + '#__demo_root *{pointer-events:none;box-sizing:border-box}'
    + '.toasts{bottom:128px !important}'
    + '#__demo_cursor{position:fixed;left:0;top:0;width:26px;height:26px;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}'
    + '.__demo_ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid rgba(37,99,235,.95);background:rgba(37,99,235,.18);animation:__demo_rip .65s ease-out forwards}'
    + '@keyframes __demo_rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.7);opacity:0}}'
    + '#__demo_cap{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:1140px;width:max-content;padding:12px 28px;border-radius:14px;background:rgba(0,0,0,.88);border:2px solid rgba(255,255,255,.18);color:#fff;font:700 28px/1.4 "Malgun Gothic","Apple SD Gothic Neo",sans-serif;text-align:center;letter-spacing:-.3px;word-break:keep-all;text-shadow:0 1px 2px #000;box-shadow:0 6px 20px rgba(0,0,0,.35);display:none}'
    + '#__demo_step{position:fixed;left:8px;top:9px;padding:7px 14px;border-radius:999px;background:#111827;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.25);font:700 15px/1.4 "Malgun Gothic",sans-serif;display:none}'
    + '#__demo_stage{position:fixed;inset:0;display:none;align-items:center;justify-content:center;gap:64px;padding-bottom:70px;background:linear-gradient(180deg,#eef3f8,#dfe7f0)}'
    + '#__demo_stage .ph{height:560px;border:10px solid #1f2937;border-radius:38px;overflow:hidden;background:#fff;box-shadow:0 18px 40px rgba(15,23,42,.28)}'
    + '#__demo_stage .ph img{display:block;height:100%;width:auto}'
    + '#__demo_stage .card{padding:36px 56px;border-radius:20px;background:rgba(255,255,255,.96);color:#0f172a;text-align:center;font-family:"Malgun Gothic",sans-serif;box-shadow:0 18px 40px rgba(15,23,42,.28)}'
    + '#__demo_stage .card b{display:block;font-size:40px;margin-bottom:10px}#__demo_stage .card span{font-size:22px;color:#334155}'
    + '#__demo_stage.endcard{background:rgba(15,23,42,.55)}';
  const ARROW = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2 L4 21 L9 16.5 L12.6 24 L16 22.4 L12.5 15.2 L19.5 15.2 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function raise() {
    if (!root || !root.showPopover) return;
    try { root.hidePopover(); } catch (e) {}
    try { root.showPopover(); } catch (e) {}
  }
  function place() { if (cur) cur.style.transform = 'translate(' + (cx - 4) + 'px,' + (cy - 2) + 'px)'; }
  function render() {
    if (!root) return;
    // 자막 글은 녹화 스크립트(Node)가 정해진 시각에 넣는다(페이지 시계는 데모 날짜로 고정돼 흐르지 않음)
    const text = st.cap || '';
    cap.style.display = text ? 'block' : 'none';
    if (cap.textContent !== text) cap.textContent = text;
    step.style.display = st.step ? 'block' : 'none';
    if (step.textContent !== (st.step || '')) step.textContent = st.step || '';
    const n = document.querySelectorAll('dialog[open]').length;
    if (n !== dialogs) { dialogs = n; raise(); }
  }
  function mount() {
    if (root && root.isConnected) return;
    root = document.createElement('div');
    root.id = '__demo_root';
    if ('popover' in root) root.setAttribute('popover', 'manual');
    root.innerHTML = '<style>' + CSS + '</style><div id="__demo_stage"></div><div id="__demo_step"></div><div id="__demo_cap"></div><div id="__demo_cursor">' + ARROW + '</div>';
    document.documentElement.appendChild(root);
    cur = root.querySelector('#__demo_cursor');
    cap = root.querySelector('#__demo_cap');
    step = root.querySelector('#__demo_step');
    stage = root.querySelector('#__demo_stage');
    place();
    raise();
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  setInterval(() => { mount(); render(); }, 100);
  window.__demo = {
    set(s) { Object.assign(st, s); save(); mount(); render(); },
    move(x, y, ms) {
      mount(); raise();
      const sx = cx, sy = cy, t0 = performance.now();
      return new Promise((done) => {
        if (!ms) { cx = x; cy = y; place(); st.x = x; st.y = y; save(); done(); return; }
        const tick = (t) => {
          const k = Math.min(1, (t - t0) / ms);
          const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          cx = sx + (x - sx) * e; cy = sy + (y - sy) * e; place();
          if (k < 1) requestAnimationFrame(tick); else { st.x = x; st.y = y; save(); done(); }
        };
        requestAnimationFrame(tick);
      });
    },
    ripple(x, y) {
      mount();
      const r = document.createElement('div');
      r.className = '__demo_ripple'; r.style.left = x + 'px'; r.style.top = y + 'px';
      root.insertBefore(r, cur);
      setTimeout(() => r.remove(), 700);
    },
    phones(urls) {
      mount(); stage.className = ''; stage.innerHTML = '';
      for (const u of urls) { const f = document.createElement('div'); f.className = 'ph'; const i = document.createElement('img'); i.src = u; f.appendChild(i); stage.appendChild(f); }
      stage.style.display = 'flex';
    },
    card(title, sub) {
      mount(); stage.className = 'endcard'; stage.innerHTML = '';
      const c = document.createElement('div'); c.className = 'card';
      const b = document.createElement('b'); b.textContent = title; const s = document.createElement('span'); s.textContent = sub;
      c.appendChild(b); c.appendChild(s); stage.appendChild(c); stage.style.display = 'flex';
    },
    clear() { if (stage) { stage.style.display = 'none'; stage.innerHTML = ''; } },
    // 이 앱은 문서 전체가 스크롤된다(대화상자 안은 .dialog-body). 그 칸을 부드럽게 굴려 위쪽 막대(56px)와 아래 자막 띠 사이 가운데에 대상을 둔다
    scrollToEl(el) {
      const p = el.closest('dialog .dialog-body');
      const doc = !p || p.scrollHeight <= p.clientHeight;
      const box = doc ? (document.scrollingElement || document.documentElement) : p;
      const r = el.getBoundingClientRect();
      const top = doc ? 64 : Math.max(64, p.getBoundingClientRect().top);
      const room = innerHeight - 90 - top;
      const delta = r.top - top - Math.max(0, (room - Math.min(r.height, room)) / 2);
      box.scrollTo({ top: box.scrollTop + delta, behavior: 'smooth' });
    },
  };
})();`;

interface DemoApi {
  set(s: Record<string, unknown>): void;
  move(x: number, y: number, ms: number): Promise<void>;
  ripple(x: number, y: number): void;
  phones(urls: string[]): void;
  card(title: string, sub: string): void;
  clear(): void;
  scrollToEl(el: unknown): void;
}
type WithDemo = { __demo?: DemoApi };

// ───────────── 서버·포트 ─────────────
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

async function pickPort(): Promise<number> {
  for (let p = 18310; p <= 18319; p++) if (await portFree(p)) return p;
  throw new Error('시연 영상용 포트 18310~18319가 모두 사용 중이에요. 잠시 뒤 다시 실행해 주세요.');
}

async function waitReady(base: string, timeoutMs = 60000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok && ((await r.json()) as { ok?: boolean }).ok) return;
    } catch {
      // 아직 안 켜짐
    }
    await sleep(300);
  }
  throw new Error(`시연용 서버(${base})가 ${timeoutMs / 1000}초 안에 준비되지 않았어요.`);
}

// ───────────── 시각 표기 ─────────────
function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${String(t % 1000).padStart(3, '0')}`;
}

function clock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

function runFfmpeg(args: string[]): void {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg 실패: ${r.stderr}`);
}

/**
 * 녹화기: 브라우저 화면 송출(CDP Page.startScreencast)의 JPEG 장면을 받아, 벽시계 기준 25fps로 FFMPEG에 넘겨 원본 영상을 만든다.
 * 화면이 그대로면 마지막 장면을 되풀이해 넣으므로 영상 시각 = (지금 - t0)이 정확히 맞는다(장면 시작 시각·자막 시각 기준).
 * Playwright 자체 녹화(recordVideo)는 별도 ffmpeg 내려받기가 필요해 쓰지 않는다.
 */
async function startRecorder(ctx: BrowserContext, page: Page, out: string): Promise<{ t0: number; stop(): Promise<void> }> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  let latest: Buffer | null = null;
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    latest = Buffer.from(f.data, 'base64');
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const until = Date.now() + 10000;
  while (!latest && Date.now() < until) await sleep(50);
  if (!latest) throw new Error('브라우저 화면을 받아 오지 못했어요(녹화 시작 실패).');
  const ff = spawn(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '25', '-i', '-',
      '-vf', `scale=${W}:${H}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', '-pix_fmt', 'yuv420p', '-threads', '2', out],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let err = '';
  ff.stderr.on('data', (d: Buffer) => (err += d.toString()));
  const done = new Promise<number>((res) => ff.once('exit', (c) => res(c ?? 1)));
  const t0 = Date.now();
  let written = 0;
  const pump = () => {
    const due = Math.floor((Date.now() - t0) / 40) + 1;
    while (written < due && latest) {
      ff.stdin.write(latest);
      written += 1;
    }
  };
  const timer = setInterval(pump, 20);
  return {
    t0,
    async stop() {
      pump();
      clearInterval(timer);
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      ff.stdin.end();
      const code = await done;
      if (code !== 0) throw new Error(`녹화 원본 만들기 실패(ffmpeg): ${err}`);
    },
  };
}

function mediaSeconds(file: string): number {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr ?? '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

// ───────────── 시작 전 확인 ─────────────
if (!fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) {
  console.error('화면 파일(web/dist)이 없어요. 먼저 npm run build:web 을 실행해 주세요.');
  process.exit(1);
}
if (!FAST && (!FFMPEG || !fs.existsSync(FFMPEG))) {
  console.error('영상을 만들 ffmpeg를 찾지 못했어요. FFMPEG 환경 변수에 ffmpeg.exe 경로를 넣고 다시 실행해 주세요.');
  console.error('예) FFMPEG=C:\\...\\ffmpeg.exe node scripts/demo-video.ts   (빠른 선택자 확인만 하려면 --fast)');
  process.exit(1);
}

fs.mkdirSync(TMP, { recursive: true });
const plans = planCaptions();
fs.mkdirSync(IMG, { recursive: true });
// 지난 실행이 남긴 장면 그림(NN-이름.png)만 지운다
for (const f of fs.readdirSync(IMG)) if (/^\d\d-[a-z0-9-]+\.png$/.test(f)) fs.rmSync(path.join(IMG, f));
for (const f of fs.readdirSync(TMP)) if (/^(run|video)-\d+$/.test(f)) fs.rmSync(path.join(TMP, f), { recursive: true, force: true });

const releaseSlot = await acquireHeavySlot('demo-video');
const PORT = await pickPort();
const BASE = `http://localhost:${PORT}`;
/** 데모 서버(scripts/e2e-server.ts)의 고정 시각과 같은 값 */
const DEMO_NOW = process.env.TEST_NOW || '2026-11-02T09:00:00+09:00';
const stamp = Date.now();
const DATA_DIR = path.join(TMP, `run-${stamp}`);
const RAW = path.join(TMP, `video-${stamp}`, 'raw.mkv');
fs.mkdirSync(DATA_DIR, { recursive: true });
const log = fs.openSync(path.join(TMP, 'server.log'), 'w');
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/e2e-server.ts'], {
  cwd: ROOT,
  stdio: ['ignore', log, log],
  env: { ...process.env, E2E_PORT: String(PORT), E2E_DATA_DIR: DATA_DIR },
});

interface Timed {
  scene: DemoScene;
  index: number;
  start: number;
  end: number;
  capAt: number;
  plan: CaptionPlan;
  image: string;
}
const timeline: Timed[] = [];
const problems: string[] = [];
const pageErrors: string[] = [];
let videoMs!: number;

try {
  await waitReady(BASE);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx: BrowserContext = await browser.newContext({
    viewport: { width: W, height: H },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
    // 제품의 CSP(style-src 'self')가 녹화용 덧씌움의 <style>을 막으므로, 녹화용 브라우저에서만 CSP를 건너뛴다(제품 설정은 그대로)
    bypassCSP: true,
  });
  // 화면 속 날짜(문서 미리보기 등)가 서버의 데모 날짜와 같도록 브라우저 시계도 고정한다(타이머는 그대로 흐른다)
  await ctx.clock.setFixedTime(new Date(DEMO_NOW));
  await ctx.addInitScript(OVERLAY_SCRIPT);
  if (RECORD_DIR) {
    // 구경용 체험판 녹화: 메인 창이 주고받은 /api 응답을 순서대로 적는다(파일 업로드 본문은 적지 않음)
    fs.mkdirSync(RECORD_DIR, { recursive: true });
    const out = path.join(RECORD_DIR, 'walkthrough.jsonl');
    fs.writeFileSync(out, '');
    ctx.on('response', (r) => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith('/api/')) return;
      const req = r.request();
      const ct = req.headers()['content-type'] ?? '';
      const reqBody = ct.startsWith('application/json') ? (req.postData() ?? '') : '';
      void r
        .text()
        .then((body) => {
          const line = { m: req.method(), p: u.pathname, q: u.search, reqBody, s: r.status(), t: r.headers()['content-type'] ?? '', b: body };
          fs.appendFileSync(out, `${JSON.stringify(line)}\n`);
        })
        .catch(() => undefined);
    });
  }
  const page = await ctx.newPage();
  let t0 = Date.now();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) pageErrors.push(m.text());
  });
  const api = {
    set: (s: Record<string, unknown>) => page.evaluate((v) => (globalThis as unknown as WithDemo).__demo?.set(v), s).catch(() => undefined),
    move: (x: number, y: number, ms: number) => page.evaluate(([a, b, c]) => (globalThis as unknown as WithDemo).__demo?.move(a, b, c), [x, y, ms] as const),
    ripple: (x: number, y: number) => page.evaluate(([a, b]) => (globalThis as unknown as WithDemo).__demo?.ripple(a, b), [x, y] as const),
    clear: () => page.evaluate(() => (globalThis as unknown as WithDemo).__demo?.clear()).catch(() => undefined),
  };

  let shotTaken = false;
  let currentShot = '';
  const dwell = (ms = 1500) => sleep(Math.round(ms * SPEED.dwell));
  const shot = async () => {
    await page.evaluate('document.fonts.ready');
    await page.screenshot({ path: currentShot, style: HIDE_OVERLAY_CSS });
    shotTaken = true;
  };
  /** 대상의 가운데 좌표(화면 기준) */
  const centerOf = async (target: Locator): Promise<{ x: number; y: number }> => {
    await target.waitFor({ state: 'visible', timeout: 15000 });
    await target.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
    let b = await target.boundingBox();
    // 아래 자막 띠(약 110px)에 가리거나 위쪽 막대에 붙어 있으면, 자막 띠 위 가운데로 올려 놓고 누른다
    if (b && b.height < H - 200 && (b.y + b.height > H - 115 || b.y < 60)) {
      await target.evaluate((el) => (globalThis as unknown as WithDemo).__demo?.scrollToEl(el));
      await sleep(FAST ? 50 : 750);
      b = await target.boundingBox();
    }
    if (!b) throw new Error('대상 위치를 찾지 못했어요.');
    return { x: Math.round(b.x + Math.min(b.width / 2, 260)), y: Math.round(b.y + Math.min(b.height / 2, 200)) };
  };
  const moveTo = async (target: Locator) => {
    const { x, y } = await centerOf(target);
    await api.move(x, y, SPEED.move);
    await page.mouse.move(x, y);
    return { x, y };
  };
  const demo: Demo = {
    page,
    async go(p, heading) {
      await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { level: 1, name: heading }).first().waitFor({ timeout: 20000 });
    },
    async nav(group, item, heading) {
      const menu = page.getByRole('navigation', { name: '주 메뉴' });
      const esc = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const link = menu.getByRole('link', { name: new RegExp(`^${esc}`) }).first();
      if (!(await link.isVisible()) && group) {
        const g = menu.getByRole('button', { name: group });
        if (await g.isVisible()) await demo.click(g);
        await dwell(300);
      }
      await demo.click(link);
      await page.getByRole('heading', { level: 1, name: heading }).first().waitFor({ timeout: 20000 });
      await page.waitForLoadState('networkidle').catch(() => undefined);
    },
    async click(target) {
      const { x, y } = await moveTo(target);
      await api.ripple(x, y);
      await target.click({ timeout: 10000 });
      await dwell(450);
    },
    async type(target, text, opts) {
      await demo.click(target);
      if (opts?.clear) await target.fill('');
      await page.keyboard.type(text, { delay: SPEED.type });
      await dwell(400);
    },
    async point(target) {
      await moveTo(target);
      await dwell(300);
    },
    async scrollTo(target) {
      await target.waitFor({ state: 'visible', timeout: 15000 });
      await target.evaluate((el) => (globalThis as unknown as WithDemo).__demo?.scrollToEl(el));
      await dwell(900);
    },
    async see(target, timeoutMs = 15000) {
      await target.waitFor({ state: 'visible', timeout: timeoutMs });
    },
    dwell,
    shot,
    async showPhones(paths) {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light' });
      await phone.clock.setFixedTime(new Date(DEMO_NOW));
      await phone.addCookies(await ctx.cookies());
      const urls: string[] = [];
      for (const [i, p] of paths.entries()) {
        const pp = await phone.newPage();
        await pp.goto(`${BASE}${p}`, { waitUntil: 'networkidle' });
        await pp.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20000 });
        await sleep(800);
        await pp.evaluate('document.fonts.ready');
        const png = await pp.screenshot();
        if (!FAST) fs.writeFileSync(path.join(TMP, `phone-${i + 1}.png`), png);
        urls.push(`data:image/png;base64,${png.toString('base64')}`);
        await pp.close();
      }
      await phone.close();
      await page.evaluate((u) => (globalThis as unknown as WithDemo).__demo?.phones(u), urls);
      await sleep(500);
    },
    async endCard(title, sub) {
      await page.evaluate(([a, b]) => (globalThis as unknown as WithDemo).__demo?.card(a, b), [title, sub] as const);
    },
    files: {
      receiptPhoto: path.join(ROOT, 'tests', 'fixtures', 'receipt', 'statement-4000x3000.jpg'),
      fakeM4a: () => {
        // 가짜 m4a(앞부분 'ftyp' 머리 + 채움 바이트). 데모 모드라 내용은 읽지 않고 예시 받아쓰기가 나온다
        const b = Buffer.alloc(4096, 0x11);
        Buffer.from([0x00, 0x00, 0x00, 0x20]).copy(b, 0);
        Buffer.from('ftypM4A ', 'latin1').copy(b, 4);
        return b;
      },
    },
  };

  await page.goto(`${BASE}/setup`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: '첫 설정' }).waitFor({ timeout: 20000 });
  const recorder = FAST ? null : await startRecorder(ctx, page, RAW);
  t0 = recorder?.t0 ?? Date.now();
  await sleep(FAST ? 0 : 600);

  for (const [i, scene] of scenes.entries()) {
    if (i >= UNTIL) break;
    const plan = plans[i] as CaptionPlan;
    const n = i + 1;
    currentShot = path.join(IMG, `${pad2(n)}-${scene.slug}.png`);
    shotTaken = false;
    const start = Date.now();
    const capAt = start + LEAD; // 첫 자막이 뜨는 시각
    await api.clear();
    await api.set({ step: `단계 ${n}/${scenes.length} · ${scene.title}`, cap: '' });
    const capTimers = plan.lines.map((l) => setTimeout(() => void api.set({ cap: l.text }), Math.max(0, capAt + l.off - Date.now())));
    console.log(`[demo-video] ${pad2(n)} ${scene.title}`);
    try {
      await scene.run(demo);
      await dwell(1500);
    } catch (e) {
      const lines = (e as Error).message.split('\n');
      const waiting = lines.find((l) => /waiting for/.test(l))?.trim() ?? '';
      const msg = `${pad2(n)} ${scene.title}: ${lines[0]} ${waiting}`;
      problems.push(msg);
      console.error(`[demo-video] 장면 문제 — ${msg}`);
    }
    if (!FAST) {
      const minEnd = capAt + plan.total + TAIL;
      if (Date.now() < minEnd) await sleep(minEnd - Date.now());
    }
    for (const t of capTimers) clearTimeout(t);
    if (!shotTaken) await shot().catch((e: Error) => problems.push(`${pad2(n)} 그림 저장 실패: ${e.message}`));
    timeline.push({ scene, index: n, start: start - t0, end: Date.now() - t0, capAt: capAt - t0, plan, image: currentShot });
  }
  videoMs = Date.now() - t0;
  if (recorder) await recorder.stop();
  await ctx.close();
  await browser.close();
} finally {
  server.kill();
  fs.closeSync(log);
  await sleep(500);
  if (RECORD_DIR) fs.cpSync(DATA_DIR, path.join(RECORD_DIR, 'data'), { recursive: true });
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    // 서버가 아직 파일을 쥐고 있으면 남겨 둔다(.tmp는 git 제외)
  }
  if (FAST) releaseSlot();
}

if (FAST) {
  console.log(`\n빠른 확인 끝: 그림 ${timeline.length}장 → ${path.relative(ROOT, IMG)}`);
  if (pageErrors.length) console.log(`화면 오류 ${pageErrors.length}건:\n  ${[...new Set(pageErrors)].join('\n  ')}`);
  if (problems.length) {
    console.error(`장면 문제 ${problems.length}건:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  process.exit(0);
}

// ───────────── 영상 만들기(ffmpeg) ─────────────
const MP4 = path.join(OUT, 'dentalax-demo.mp4');
try {
  fs.mkdirSync(OUT, { recursive: true });
  // 녹화 원본(빠른 설정 H.264) → 최종 H.264 mp4. 음성이 없으므로 오디오 트랙은 넣지 않는다(-an). 부하를 줄이려고 스레드는 2개만 쓴다
  const encode = (crf: number) =>
    runFfmpeg(['-i', RAW, '-map', '0:v', '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', '25', '-threads', '2', '-an', '-movflags', '+faststart', MP4]);
  console.log('[demo-video] 영상을 mp4로 바꾸는 중...');
  for (const crf of [23, 27, 31]) {
    encode(crf);
    const mb = fs.statSync(MP4).size / 1024 / 1024;
    console.log(`[demo-video] crf ${crf}: ${mb.toFixed(1)}MB`);
    if (mb <= 40) break;
  }

  // 자막(.srt): 문장마다 영상 기준 시각
  const cues: string[] = [];
  let k = 0;
  for (const t of timeline) {
    t.plan.lines.forEach((l, j) => {
      const s = t.capAt + l.off;
      const next = t.plan.lines[j + 1];
      const e = next ? t.capAt + next.off - 50 : Math.min(t.end - 50, s + l.dur + TAIL);
      k += 1;
      cues.push(`${k}\n${srtTime(s)} --> ${srtTime(Math.max(e, s + 800))}\n${l.text}\n`);
    });
  }
  fs.writeFileSync(path.join(OUT, 'dentalax-demo.srt'), cues.join('\n'), 'utf8');

  // 자막 대본(narration.md): 장면 번호·시각·길이와 자막 문장을 사람이 읽기 좋게 적는다
  const total = clock(videoMs);
  const nar: string[] = [
    '# 시연 영상 자막 대본',
    '',
    `영상 \`dentalax-demo.mp4\`(약 ${total}, 음성 없음)의 장면별 자막입니다. 시각은 영상 기준(분:초)입니다.`,
    `장면 길이는 자막을 편하게 읽을 시간(띄어쓰기를 뺀 한국어 초당 약 ${CHARS_PER_SEC}글자 + ${TAIL / 1000}초)과 화면 조작 시간 중 긴 쪽입니다.`,
    '',
    '| 장면 | 제목 | 시작 | 끝 | 길이 | 자막 읽는 시간 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...timeline.map((t) => `| ${pad2(t.index)} | ${t.scene.title} | ${clock(t.start)} | ${clock(t.end)} | ${((t.end - t.start) / 1000).toFixed(1)}초 | ${(t.plan.total / 1000).toFixed(1)}초 |`),
    '',
  ];
  for (const t of timeline) {
    nar.push(`## ${pad2(t.index)}. ${t.scene.title} (${clock(t.start)} ~ ${clock(t.end)}, ${((t.end - t.start) / 1000).toFixed(1)}초)`, '');
    for (const l of t.plan.lines) nar.push(`- [${clock(t.capAt + l.off)}] ${l.text}`);
    nar.push('');
  }
  fs.writeFileSync(path.join(OUT, 'narration.md'), nar.join('\n'), 'utf8');

  // 포스터: 대시보드 장면 그림
  const dash = timeline.find((t) => t.scene.slug === 'dashboard') ?? timeline[0];
  if (dash) fs.copyFileSync(dash.image, path.join(OUT, 'demo-poster.png'));

  // 사용 흐름 문서(README.md)
  const md: string[] = [
    '# 화면으로 보는 사용 흐름',
    '',
    '치과 원내 AX 서비스(가상의 하늘숲치과 데모 데이터)를 처음 켜는 순간부터 재고·문서·AI·근무·시설·관리 화면까지, 실제로 누르는 순서대로 보여 드립니다.',
    '',
    '[![시연 영상 보기](demo-poster.png)](dentalax-demo.mp4)',
    '',
    `▶ **[시연 영상 보기 (dentalax-demo.mp4, 약 ${Math.floor(videoMs / 60000)}분 ${Math.round((videoMs % 60000) / 1000)}초)](dentalax-demo.mp4)** — 음성 없이 자막으로 따라가는 영상입니다. 자막 파일 [dentalax-demo.srt](dentalax-demo.srt) · 자막 대본 [narration.md](narration.md)`,
    '',
    '> 그림을 누르면 영상 파일이 열립니다. GitHub에서 바로 재생되지 않으면 "Download"(내려받기)를 눌러 주세요.',
    '',
  ];
  for (const t of timeline) {
    md.push(`## ${t.index}. ${t.scene.title}`, '', `![${t.scene.title}](images/${path.basename(t.image)})`, '');
    for (const line of t.scene.doc) md.push(`- ${line}`);
    md.push('');
  }
  md.push('---', '', `이 영상·그림은 가상 데모 데이터(하늘숲치과)로 만들었고 환자 정보는 없습니다. 음성 없이 자막으로 따라가는 영상입니다.`, '');
  fs.writeFileSync(path.join(OUT, 'README.md'), md.join('\n'), 'utf8');
} finally {
  releaseSlot();
}

const secs = mediaSeconds(MP4);
console.log(`\n완성: ${path.relative(ROOT, MP4)}  (${Math.floor(secs / 60)}분 ${Math.round(secs % 60)}초, ${(fs.statSync(MP4).size / 1024 / 1024).toFixed(1)}MB, 장면 ${timeline.length}개, 음성 없음·자막)`);
console.log(`녹화 원본: ${path.relative(ROOT, RAW)}`);
if (pageErrors.length) console.log(`화면 오류 ${new Set(pageErrors).size}건:\n  ${[...new Set(pageErrors)].join('\n  ')}`);
if (problems.length) {
  console.error(`장면 문제 ${problems.length}건:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

// 이 파일이 하는 일: 구경용 체험판(GitHub Pages, 서버 없음)을 켠다. 체험판 빌드(VITE_DEMO=1)에서만 main.tsx가 부른다.
// 1) 화면의 /api 요청을 가로채 미리 녹화한 응답(demo-data.json, demoData.ts)으로 답한다. 저장·삭제 요청은 "체험판이라 저장되지 않아요"로 막는다.
// 2) 브라우저 시계를 녹화한 날(가상 데이터의 오늘)로 옮긴다. 3) 위쪽에 체험판 안내 띠를 붙이고, 파일 내려받기 링크는 안내로 바꾼다.
import { featureOf, findRecord, type DemoData } from './demoData.ts';

/** 체험판에서 저장·삭제 요청에 보여 줄 문구 */
export const DEMO_READONLY_MESSAGE = '구경용 체험판이라 저장·변경은 되지 않아요. 화면을 둘러보는 용도로 써 주세요.';
const DEMO_MISSING_MESSAGE = '체험판에는 이 내용을 담아 두지 않았어요. 다른 화면을 둘러봐 주세요.';
const DEMO_AI_MISSING_MESSAGE = '체험판에는 이 AI 기능의 예시 답을 담아 두지 않았어요. 다른 AI 기능을 눌러 봐 주세요.';
const REPO_URL = 'https://github.com/GangJaeYu/NewDentalAX';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** JSON 응답을 만든다 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

/** SSE 본문을 사건 단위로 조금씩 흘려보내 AI가 글을 쓰는 것처럼 보이게 한다 */
function sseResponse(status: number, type: string, text: string): Response {
  const chunks = text.split(/(?<=\n\n)/);
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(c));
        await sleep(35);
      }
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': type } });
}

/** 브라우저 시계를 target 시각부터 흐르게 옮긴다(가상 데이터의 날짜와 화면의 "오늘"을 맞춤) */
function shiftClock(target: number): void {
  if (!Number.isFinite(target)) return;
  const Real = Date;
  const offset = target - Real.now();
  const now = () => Real.now() + offset;
  const Shifted = function (this: unknown, ...args: unknown[]) {
    if (!new.target) return new Real(now()).toString();
    return args.length === 0 ? new Real(now()) : (Reflect.construct(Real, args) as Date);
  } as unknown as DateConstructor;
  Object.setPrototypeOf(Shifted, Real);
  Object.defineProperty(Shifted, 'prototype', { value: Real.prototype });
  Object.defineProperty(Shifted, 'now', { value: now });
  globalThis.Date = Shifted;
}

/** 위쪽 안내 띠 */
function addBanner(): void {
  const bar = document.createElement('div');
  bar.setAttribute('role', 'note');
  bar.style.cssText =
    'background:#0C4A47;color:#fff;font-size:13px;line-height:1.5;padding:6px 12px;text-align:center;position:relative;z-index:1000;';
  const text = document.createElement('span');
  text.textContent = '구경용 체험판입니다. 가상 하늘숲치과 데이터이고, 저장·변경은 되지 않아요. AI 결과는 미리 받아 둔 예시예요. ';
  const link = document.createElement('a');
  link.href = REPO_URL;
  link.textContent = 'GitHub 저장소';
  link.style.cssText = 'color:#fff;text-decoration:underline;';
  bar.append(text, link);
  document.body.prepend(bar);
}

/** 서버 파일 내려받기 링크(/api/...)를 누르면 안내만 띄운다 */
function blockDownloads(): void {
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      if (new URL(a.href, location.href).pathname.startsWith('/api/')) {
        e.preventDefault();
        window.alert('구경용 체험판에서는 파일을 내려받을 수 없어요.');
      }
    },
    true,
  );
}

/** 체험판을 켠다. 화면을 그리기 전에 한 번 부른다 */
export function installDemo(): void {
  const realFetch = window.fetch.bind(window);
  const base = import.meta.env.BASE_URL;
  let loaded: Promise<DemoData> | null = null;
  const data = () => (loaded ??= realFetch(`${base}demo-data.json`).then((r) => r.json() as Promise<DemoData>));
  shiftClock(Date.parse(String(import.meta.env.VITE_DEMO_NOW ?? '')));

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.pathname === '/api/health') return json(200, { ok: true });
    if (url.pathname === '/api/hiring/check') {
      // 차별 표현 점검은 입력한 글마다 결과가 달라 녹화로 대신할 수 없다. 체험판에서는 "걸린 표현 없음"으로 답한다
      let text: string;
      try {
        text = String((JSON.parse(String(init?.body ?? '{}')) as { text?: unknown }).text ?? '').trim();
      } catch {
        text = '';
      }
      return json(200, { data: { text, hits: [] } });
    }
    const rec = findRecord(await data(), method, url.pathname, url.search, featureOf(init?.body));
    if (rec) {
      await sleep(method === 'GET' ? 60 : 500);
      if (rec.t.startsWith('text/event-stream')) return sseResponse(rec.s, rec.t, rec.b);
      return new Response(rec.s === 204 ? null : rec.b, { status: rec.s, headers: { 'content-type': rec.t || 'application/json' } });
    }
    if (method === 'GET') {
      console.warn(`[체험판] 녹화 없음: GET ${url.pathname}${url.search}`);
      return json(404, { error: { code: 'DEMO_MISSING', message: DEMO_MISSING_MESSAGE } });
    }
    if (url.pathname.startsWith('/api/ai/') || url.pathname === '/api/assistant/ask') {
      console.warn(`[체험판] AI 예시 없음: ${url.pathname} ${featureOf(init?.body)}`);
      return json(403, { error: { code: 'DEMO_READONLY', message: DEMO_AI_MISSING_MESSAGE } });
    }
    return json(403, { error: { code: 'DEMO_READONLY', message: DEMO_READONLY_MESSAGE } });
  };

  addBanner();
  blockDownloads();
}

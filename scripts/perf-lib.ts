// 이 파일이 하는 일: 성능 측정(`npm run perf`, NFR-005, phase-05-task-01)에 쓰는 부품을 모아 둔다.
// ① 10배 데모 데이터(scale=10)에 측정용 보충 데이터(품목 1,000개 이상·발주서·감사 기록·공지·지출·도우미 질문)를 넣는 preparePerfData,
// ② 주요 목록 API를 실제 HTTP로 차례로 불러 p95를 재는 measureEndpoints, ③ autocannon으로 20개 동시 연결 부하를 거는 runLoad,
// ④ Playwright(Edge)로 로그인 뒤 대시보드가 다 그려질 때까지 걸린 시간을 재는 measureFirstScreen, ⑤ 여러 번 잰 결과 중 가장 나쁜 값으로 판정하는 함수를 둔다.
// 명령줄 실행은 scripts/perf.ts가 한다. 데이터는 부른 쪽이 준 임시 폴더(작업 사본 안 .tmp/)에만 쓴다. 환자 정보는 넣지 않는다.
import os from 'node:os';
import autocannon from 'autocannon';
import type { Db } from '../server/db/index.ts';
import { openAppDb } from '../server/db/migrate.ts';
import { seedDemoAll } from '../server/db/seed/registry.ts';
import { hashPassword } from '../server/auth/password.ts';
import { fixedClock, type Clock } from '../server/lib/clock.ts';
import { measureDashboard, percentile, type PerfResult } from '../server/modules/dashboard/perf.ts';
import { CSRF_HEADER } from '../shared/schemas/auth.ts';
import { PERF_USER, type FirstScreenResult } from './perf-browser.ts';

export { DASHBOARD_CARDS, PERF_USER, measureFirstScreen, type FirstScreenResult } from './perf-browser.ts';

/** NFR-005 기준값 */
export const LIMITS = {
  /** 주요 목록 API p95(ms) */
  apiP95Ms: 300,
  /** 동시 연결 시나리오 오류 수 */
  loadErrors: 0,
  /** 첫 화면 표시(ms) */
  firstScreenMs: 2000,
} as const;

/** 측정 데이터의 최소 규모(PRD NFR-005: 품목 1,000·입출고 2만 건) */
export const DATA_TARGETS = {
  items: 1000,
  stockMoves: 20000,
  orders: 300,
  audit: 20000,
  notices: 300,
  expenses: 1000,
  assistantMessages: 1200,
} as const;


/** 기준 시각(테스트 서버의 TEST_NOW와 같다) */
export const PERF_NOW = '2026-11-02T09:00:00+09:00';

/** 테이블별 줄 수 */
export type DataCounts = Record<'items' | 'stockMoves' | 'orders' | 'audit' | 'notices' | 'expenses' | 'assistantMessages' | 'users', number>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 0 이상 n 미만의 정수를 늘 같은 순서로 내는 간단한 난수(측정을 다시 해도 같은 데이터가 나오게) */
function makeRandom(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n: number) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % n;
  };
}

/** 지금 DB의 테이블별 줄 수를 센다 */
export function countData(db: Db): DataCounts {
  const n = (sql: string) => (db.get<{ c: number }>(sql)?.c ?? 0) as number;
  return {
    items: n('SELECT COUNT(*) AS c FROM items'),
    stockMoves: n('SELECT COUNT(*) AS c FROM stock_moves'),
    orders: n('SELECT COUNT(*) AS c FROM purchase_orders'),
    audit: n('SELECT COUNT(*) AS c FROM audit_log'),
    notices: n("SELECT COUNT(*) AS c FROM posts WHERE kind = 'notice'"),
    expenses: n('SELECT COUNT(*) AS c FROM expenses'),
    assistantMessages: n('SELECT COUNT(*) AS c FROM assistant_messages'),
    users: n('SELECT COUNT(*) AS c FROM users'),
  };
}

/**
 * 데모 데이터만으로 모자란 표를 측정 규모까지 채운다(품목·입출고·발주서·감사 기록·공지·지출·도우미 질문).
 * 모든 이름은 "측정용"으로 시작해서 실제 데이터와 헷갈리지 않는다. 한 트랜잭션으로 넣는다.
 */
export function topUpPerfData(db: Db, clock: Clock, adminId: number): void {
  const rnd = makeRandom(20261102);
  const now = clock.now().getTime();
  const iso = (daysAgo: number) => new Date(now - daysAgo * DAY_MS).toISOString();
  const ymd = (daysAgo: number) => new Date(now - daysAgo * DAY_MS + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const userIds = db.all<{ id: number }>('SELECT id FROM users ORDER BY id').map((r) => r.id);
  const vendorIds = db.all<{ id: number }>('SELECT id FROM vendors ORDER BY id').map((r) => r.id);
  const categories = db.all<{ category: string }>('SELECT DISTINCT category FROM items ORDER BY category').map((r) => r.category);
  const pick = <T>(list: readonly T[]): T => list[rnd(list.length)] as T;
  const vendor = () => (vendorIds.length ? pick(vendorIds) : null);

  db.tx(() => {
    // 품목: 1,000개가 될 때까지 넣고, 품목마다 입고 1건·출고 20건을 붙인다
    const haveItems = countData(db).items;
    for (let i = haveItems; i < DATA_TARGETS.items; i++) {
      const at = iso(200);
      const item = db.run(
        'INSERT INTO items (name, category, unit, par_level, track_expiry, default_vendor_id, location, memo, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)',
        [`측정용 품목 ${String(i + 1).padStart(4, '0')}`, categories.length ? pick(categories) : '소모품', '개', 5 + rnd(10), i % 3 === 0 ? 1 : 0, vendor(), '측정용 선반', at, at],
      );
      const id = item.lastInsertRowid;
      db.run("INSERT INTO stock_moves (item_id, type, qty, unit_price, vendor_id, expiry_on, moved_at, user_id) VALUES (?, 'in', ?, ?, ?, ?, ?, ?)", [
        id,
        60,
        1000 + rnd(9000),
        vendor(),
        i % 3 === 0 ? ymd(-30 - rnd(400)) : null,
        iso(180),
        adminId,
      ]);
      for (let k = 0; k < 20; k++) {
        db.run("INSERT INTO stock_moves (item_id, type, qty, moved_at, user_id) VALUES (?, 'out', ?, ?, ?)", [id, 1 + rnd(2), iso(170 - k * 8 - rnd(5)), pick(userIds)]);
      }
    }

    // 발주서: 상태를 골고루 섞어 300건, 각 3줄
    const itemIds = db.all<{ id: number }>('SELECT id FROM items ORDER BY id').map((r) => r.id);
    const statuses = ['draft', 'ordered', 'received', 'canceled'] as const;
    for (let i = countData(db).orders; i < DATA_TARGETS.orders; i++) {
      const status = statuses[i % statuses.length] as (typeof statuses)[number];
      const created = iso(1 + ((i * 7) % 360));
      const po = db.run(
        'INSERT INTO purchase_orders (po_no, vendor_id, status, note, created_by, created_at, updated_at, ordered_at, received_at, canceled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          `PERF-${String(i + 1).padStart(4, '0')}`,
          vendor(),
          status,
          '측정용 발주서',
          adminId,
          created,
          created,
          status === 'ordered' || status === 'received' ? created : null,
          status === 'received' ? created : null,
          status === 'canceled' ? created : null,
        ],
      );
      const used = new Set<number>();
      while (used.size < 3) used.add(pick(itemIds));
      for (const itemId of used) db.run('INSERT INTO po_lines (po_id, item_id, qty, unit_price) VALUES (?, ?, ?, ?)', [po.lastInsertRowid, itemId, 1 + rnd(10), 1000 + rnd(9000)]);
    }

    // 감사 기록: 최근 180일에 흩어진 2만 건
    const actions = ['auth.login', 'auth.logout', 'inventory.move', 'post.create', 'expense.create', 'order.create', 'settings.update', 'leave.request'];
    for (let i = countData(db).audit; i < DATA_TARGETS.audit; i++) {
      const uid = pick(userIds);
      db.run('INSERT INTO audit_log (at, user_id, username, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        new Date(now - rnd(180 * 24 * 60) * 60 * 1000).toISOString(),
        uid,
        `user${uid}`,
        pick(actions),
        'perf',
        String(i),
        '{"perf":true}',
        '127.0.0.1',
      ]);
    }

    // 공지: 300건(읽음 기록 일부 포함)
    for (let i = countData(db).notices; i < DATA_TARGETS.notices; i++) {
      const at = iso(1 + ((i * 3) % 360));
      const post = db.run("INSERT INTO posts (kind, category, title, body, pinned, author_id, created_at, updated_at) VALUES ('notice', '일반', ?, ?, 0, ?, ?, ?)", [
        `측정용 공지 ${i + 1}`,
        '측정용 공지 본문입니다. 원내 일정과 준비물을 확인해 주세요.',
        adminId,
        at,
        at,
      ]);
      if (i % 2 === 0) for (const uid of userIds.slice(0, 4)) db.run('INSERT OR IGNORE INTO post_reads (post_id, user_id, read_at) VALUES (?, ?, ?)', [post.lastInsertRowid, uid, at]);
    }

    // 지출: 최근 1년에 흩어진 1,000건(이번 달 몫 포함)
    const categoryIds = db.all<{ id: number }>('SELECT id FROM expense_categories ORDER BY id').map((r) => r.id);
    const methods = ['card', 'transfer', 'cash', 'other'];
    for (let i = countData(db).expenses; i < DATA_TARGETS.expenses; i++) {
      const daysAgo = i % 10 === 0 ? rnd(2) : rnd(365);
      const at = iso(daysAgo);
      db.run(
        'INSERT INTO expenses (date, category_id, vendor_id, vendor_name, amount, pay_method, memo, created_by, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)',
        [ymd(daysAgo), pick(categoryIds), vendor(), 10000 + rnd(990000), pick(methods), '측정용 지출', adminId, at, at],
      );
    }

    // 원내 도우미 질문: 측정 계정 200줄(보관 한도)과 다른 직원 1,000줄
    const perfRows = 200;
    const others = userIds.filter((id) => id !== adminId);
    for (let i = 0; i < DATA_TARGETS.assistantMessages; i++) {
      const uid = i < perfRows || others.length === 0 ? adminId : pick(others);
      const role = i % 2 === 0 ? 'user' : 'assistant';
      const text = role === 'user' ? '측정용 질문: 소독 순서가 어떻게 되나요?' : '측정용 답변: 원내 매뉴얼의 소독 절차를 따라 주세요.';
      db.run('INSERT INTO assistant_messages (user_id, role, text, sources, found, demo, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)', [uid, role, text, '[]', iso(30 - (i % 30))]);
    }
  });
}

/**
 * 빈 데이터 폴더에 측정 데이터를 만든다: 마이그레이션 → 데모 데이터(scale 배율) → 측정용 관리자 계정 → 보충 데이터.
 * 서버를 켜기 전에 부른다. 만든 뒤의 줄 수를 돌려준다.
 */
export async function preparePerfData(dataDir: string, opts: { scale?: number; now?: string } = {}): Promise<DataCounts> {
  const clock = fixedClock(opts.now ?? PERF_NOW);
  const { db } = openAppDb(dataDir, { clock });
  try {
    await seedDemoAll(db, { clock, scale: opts.scale ?? 10 });
    const at = clock.now().toISOString();
    const hash = await hashPassword(PERF_USER.password);
    const admin = db.run(
      "INSERT INTO users (username, name, role, job_type, password_hash, must_change_pw, active, created_at, updated_at) VALUES (?, ?, 'admin', 'other', ?, 0, 1, ?, ?)",
      [PERF_USER.username, PERF_USER.name, hash, at, at],
    );
    topUpPerfData(db, clock, admin.lastInsertRowid);
    db.run('ANALYZE');
    return countData(db);
  } finally {
    db.close();
  }
}

/** 로그인한 세션(쿠키·CSRF 토큰) */
export interface PerfAuth {
  cookie: string;
  csrf: string;
}

/** 실제 로그인 API로 세션을 연다 */
export async function login(base: string, username: string = PERF_USER.username, password: string = PERF_USER.password): Promise<PerfAuth> {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (res.status !== 200) throw new Error(`측정용 로그인이 실패했어요(응답 ${res.status}).`);
  const body = (await res.json()) as { data: { csrfToken: string } };
  const sid = (res.headers.getSetCookie().find((c) => c.startsWith('sid=')) ?? '').split(';')[0];
  if (!sid) throw new Error('로그인 응답에 세션 쿠키가 없어요.');
  return { cookie: sid, csrf: body.data.csrfToken };
}

/** 측정할 API 한 개 */
export interface Endpoint {
  key: string;
  /** 화면 이름(보고서용) */
  label: string;
  method: 'GET' | 'POST';
  /** 화면이 실제로 부르는 주소와 같은 조건 */
  path: string;
  body?: unknown;
}

/** NFR-005 측정 대상: 화면이 처음 열릴 때 부르는 주소(쪽 크기·기본 필터 포함) */
export const LIST_ENDPOINTS: readonly Endpoint[] = [
  { key: 'items', label: '재고 목록', method: 'GET', path: '/api/items?status=all&active=active&page=1&pageSize=100' },
  { key: 'items-search', label: '재고 목록(검색)', method: 'GET', path: `/api/items?status=all&active=active&page=1&pageSize=100&q=${encodeURIComponent('측정용')}` },
  { key: 'items-low', label: '재고 목록(부족만)', method: 'GET', path: '/api/items?status=low&active=active&page=1&pageSize=100' },
  { key: 'moves', label: '입출고 기록', method: 'GET', path: '/api/inventory/moves?page=1&pageSize=50' },
  { key: 'moves-out', label: '입출고 기록(출고·검색)', method: 'GET', path: `/api/inventory/moves?page=1&pageSize=50&type=out&q=${encodeURIComponent('글러브')}` },
  { key: 'orders', label: '발주서', method: 'GET', path: '/api/orders?status=open&page=1&pageSize=50' },
  { key: 'orders-all', label: '발주서(전체)', method: 'GET', path: '/api/orders?status=all&page=1&pageSize=50' },
  { key: 'notices', label: '공지', method: 'GET', path: '/api/posts?kind=notice&pageSize=200' },
  { key: 'handovers', label: '인수인계', method: 'GET', path: '/api/posts?kind=handover&pageSize=200' },
  { key: 'expenses', label: '지출(이번 달)', method: 'GET', path: '/api/expenses?pageSize=500' },
  { key: 'expenses-all', label: '지출(전체)', method: 'GET', path: '/api/expenses?pageSize=500&month=all' },
  { key: 'audit', label: '감사 로그', method: 'GET', path: '/api/audit?page=1&pageSize=50' },
  { key: 'assistant-history', label: '원내 도우미 질문 기록', method: 'GET', path: '/api/assistant/history' },
  { key: 'assistant-ask', label: '원내 도우미 질문(데모 답변)', method: 'POST', path: '/api/assistant/ask', body: { question: '기구 소독은 어떤 순서로 하나요?' } },
  { key: 'dashboard', label: '대시보드', method: 'GET', path: '/api/dashboard' },
];

/** 요청 헤더(세션 쿠키, 상태를 바꾸는 요청이면 CSRF 토큰) */
function headersFor(auth: PerfAuth, ep: Endpoint): Record<string, string> {
  const h: Record<string, string> = { cookie: auth.cookie };
  if (ep.method !== 'GET') {
    h[CSRF_HEADER] = auth.csrf;
    h['content-type'] = 'application/json';
  }
  return h;
}

/** API 한 개를 한 번 부른다. 200이 아니면 오류로 멈춘다 */
export async function callEndpoint(base: string, auth: PerfAuth, ep: Endpoint): Promise<void> {
  const res = await fetch(`${base}${ep.path}`, { method: ep.method, headers: headersFor(auth, ep), body: ep.body === undefined ? undefined : JSON.stringify(ep.body) });
  if (res.status !== 200) throw new Error(`${ep.label}(${ep.method} ${ep.path}) 응답이 ${res.status}이에요: ${(await res.text()).slice(0, 200)}`);
  await res.arrayBuffer();
}

/** API 하나의 측정 결과 */
export interface EndpointResult extends PerfResult {
  key: string;
  label: string;
  method: string;
  path: string;
}

/** 대상 API마다 count번 차례로 불러(준비 운동 1번 뒤) p50·p95·최대를 잰다 */
export async function measureEndpoints(base: string, auth: PerfAuth, count = 100, endpoints: readonly Endpoint[] = LIST_ENDPOINTS): Promise<EndpointResult[]> {
  const out: EndpointResult[] = [];
  for (const ep of endpoints) {
    const r = await measureDashboard(() => callEndpoint(base, auth, ep), count);
    out.push({ key: ep.key, label: ep.label, method: ep.method, path: ep.path, ...r });
  }
  return out;
}

/** 동시 연결 시나리오 결과 */
export interface LoadResult {
  connections: number;
  durationSec: number;
  requests: number;
  /** 연결 오류 + 시간 초과 + 2xx가 아닌 응답 */
  errors: number;
  timeouts: number;
  non2xx: number;
  rps: number;
  p50: number;
  p97_5: number;
  p99: number;
  max: number;
}

/** 부하 시나리오에서 섞어 부를 주소(대시보드·목록·알림 요약, 화면을 오가는 직원처럼) */
export const LOAD_PATHS: readonly string[] = [
  '/api/dashboard',
  '/api/notifications/summary',
  '/api/items?status=all&active=active&page=1&pageSize=100',
  '/api/inventory/moves?page=1&pageSize=50',
  '/api/dashboard',
  '/api/orders?status=open&page=1&pageSize=50',
  '/api/posts?kind=notice&pageSize=200',
  '/api/expenses?pageSize=500',
  '/api/dashboard',
  '/api/audit?page=1&pageSize=50',
  '/api/assistant/history',
  '/api/notifications/summary',
];

/** autocannon으로 connections개 연결이 durationSec초 동안 LOAD_PATHS를 돌아가며 부른다 */
export async function runLoad(base: string, auth: PerfAuth, opts: { connections?: number; durationSec?: number } = {}): Promise<LoadResult> {
  const connections = opts.connections ?? 20;
  const durationSec = opts.durationSec ?? 60;
  const result = await autocannon({
    url: base,
    connections,
    duration: durationSec,
    timeout: 10,
    headers: { cookie: auth.cookie },
    requests: LOAD_PATHS.map((p) => ({ method: 'GET' as const, path: p })),
  });
  return {
    connections,
    durationSec,
    requests: result.requests.total,
    errors: result.errors + result.non2xx,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    rps: Math.round(result.requests.average),
    p50: result.latency.p50,
    p97_5: result.latency.p97_5,
    p99: result.latency.p99,
    max: result.latency.max,
  };
}

/** 측정 한 회차 */
export interface PerfRound {
  round: number;
  cpuBusyBefore: number;
  /** 회차를 재는 동안의 PC 전체 CPU 사용률(이 측정의 서버·부하 도구 몫 포함) */
  cpuDuring?: CpuWatch;
  endpoints: EndpointResult[];
  load: LoadResult | null;
  firstScreen: FirstScreenResult | null;
}

/** 회차별 결과를 API마다 가장 나쁜 값으로 모은다(p95가 가장 큰 회차의 값) */
export function worstEndpoints(rounds: readonly PerfRound[]): EndpointResult[] {
  const byKey = new Map<string, EndpointResult>();
  for (const r of rounds) {
    for (const e of r.endpoints) {
      const prev = byKey.get(e.key);
      if (!prev || e.p95 > prev.p95) byKey.set(e.key, e);
    }
  }
  return [...byKey.values()];
}

/** 회차 중 오류가 가장 많은(같으면 p99가 큰) 부하 결과 */
export function worstLoad(rounds: readonly PerfRound[]): LoadResult | null {
  let worst: LoadResult | null = null;
  for (const r of rounds) {
    const l = r.load;
    if (!l) continue;
    if (!worst || l.errors > worst.errors || (l.errors === worst.errors && l.p99 > worst.p99)) worst = l;
  }
  return worst;
}

/** 회차 중 가장 오래 걸린 첫 화면 시간(ms) */
export function worstFirstScreen(rounds: readonly PerfRound[]): number | null {
  const v = rounds.map((r) => r.firstScreen?.worst).filter((x): x is number => typeof x === 'number');
  return v.length ? Math.max(...v) : null;
}

/** 판정 */
export interface Verdict {
  api: { pass: boolean; worstP95: number; failed: string[] };
  load: { pass: boolean; errors: number } | null;
  firstScreen: { pass: boolean; worstMs: number } | null;
  pass: boolean;
}

/** 가장 나쁜 값으로 기준(LIMITS)과 견준다. 재지 않은 항목(null)은 실패로 본다 */
export function judge(rounds: readonly PerfRound[]): Verdict {
  const eps = worstEndpoints(rounds);
  const failed = eps.filter((e) => e.p95 > LIMITS.apiP95Ms).map((e) => `${e.label} p95 ${e.p95}ms`);
  const worstP95 = eps.length ? Math.max(...eps.map((e) => e.p95)) : Number.POSITIVE_INFINITY;
  const api = { pass: eps.length > 0 && failed.length === 0, worstP95, failed };
  const l = worstLoad(rounds);
  const load = l ? { pass: l.errors + l.timeouts <= LIMITS.loadErrors, errors: l.errors + l.timeouts } : null;
  const fs = worstFirstScreen(rounds);
  const firstScreen = fs === null ? null : { pass: fs <= LIMITS.firstScreenMs, worstMs: fs };
  return { api, load, firstScreen, pass: api.pass && !!load?.pass && !!firstScreen?.pass };
}

/** CPU 사용 시간 합계(유휴 제외·전체) */
function cpuTimes(): { busy: number; total: number } {
  let busy = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    const all = t.user + t.nice + t.sys + t.idle + t.irq;
    total += all;
    busy += all - t.idle;
  }
  return { busy, total };
}

/** 두 시점의 CPU 시간으로 사용률(%)을 구한다 */
export function busyPercent(a: { busy: number; total: number }, b: { busy: number; total: number }): number {
  const dt = b.total - a.total;
  if (dt <= 0) return 0;
  return Math.round(((b.busy - a.busy) / dt) * 1000) / 10;
}

/** sampleMs 동안 PC 전체 CPU 사용률(%)을 잰다(Windows에서는 os.loadavg가 0이라 직접 계산) */
export async function sampleCpuBusy(sampleMs = 1000): Promise<number> {
  const a = cpuTimes();
  await new Promise((res) => setTimeout(res, sampleMs));
  return busyPercent(a, cpuTimes());
}

/** CPU 관찰 결과(%) */
export interface CpuWatch {
  avg: number;
  max: number;
  samples: number;
}

/** CPU 사용률 표본들을 평균·최대로 요약한다 */
export function summarizeCpu(samples: readonly number[]): CpuWatch {
  if (samples.length === 0) return { avg: 0, max: 0, samples: 0 };
  return { avg: Math.round((samples.reduce((s, x) => s + x, 0) / samples.length) * 10) / 10, max: Math.max(...samples), samples: samples.length };
}

/** 측정하는 동안 intervalMs마다 PC 전체 CPU 사용률을 모은다. 돌려준 함수를 부르면 멈추고 요약을 준다 */
export function watchCpu(intervalMs = 1000): () => CpuWatch {
  const samples: number[] = [];
  let prev = cpuTimes();
  const timer = setInterval(() => {
    const now = cpuTimes();
    samples.push(busyPercent(prev, now));
    prev = now;
  }, intervalMs);
  return () => {
    clearInterval(timer);
    return summarizeCpu(samples);
  };
}

/** 측정 환경(보고서용) */
export function machineInfo(): { cpu: string; logicalCpus: number; memoryGb: number; node: string; os: string } {
  const cpus = os.cpus();
  return {
    cpu: (cpus[0]?.model ?? '알 수 없음').trim(),
    logicalCpus: cpus.length,
    memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    node: process.version,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
  };
}

/** 숫자 목록의 p95(보고서용 재노출) */
export { percentile };

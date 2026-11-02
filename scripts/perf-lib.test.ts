// 이 파일이 하는 일: 성능 측정 부품(scripts/perf-lib.ts, phase-05-task-01)을 확인한다.
// 10배 데모 데이터 + 보충 데이터를 .tmp/unit/ 임시 폴더에 만들고 실제 서버(127.0.0.1 빈 포트)를 띄워
// 주요 목록 API p95 ≤ 300ms(AC1), 20개 동시 연결 짧은 부하에서 오류 0건(AC2)을 실제 HTTP로 본다(60초 본 측정은 `npm run perf`).
// 판정 함수(가장 나쁜 회차로 판정, 첫 화면 2초 기준 AC3)와 docs/PERF.md 기록 항목(AC4)도 확인한다. 첫 화면 실제 측정은 tests/e2e/perf-first-screen.spec.ts.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app.ts';
import { fixedClock } from '../server/lib/clock.ts';
import { makeTmpDir } from '../tests/helpers/tmp-dir.ts';
import {
  DATA_TARGETS,
  LIMITS,
  LIST_ENDPOINTS,
  LOAD_PATHS,
  PERF_NOW,
  busyPercent,
  judge,
  login,
  measureEndpoints,
  preparePerfData,
  runLoad,
  summarizeCpu,
  worstEndpoints,
  type DataCounts,
  type EndpointResult,
  type PerfAuth,
  type PerfRound,
} from './perf-lib.ts';

describe('10배 데이터 실제 서버 측정', () => {
  let app: FastifyInstance | null = null;
  let dir = '';
  let base = '';
  let auth: PerfAuth;
  let counts: DataCounts;

  beforeAll(async () => {
    dir = makeTmpDir('dentalax-perf-');
    counts = await preparePerfData(dir, { scale: 10 });
    app = await buildApp({ dataDir: dir, webDist: path.join(dir, 'no-web'), clock: fixedClock(PERF_NOW) });
    base = (await app.listen({ host: '127.0.0.1', port: 0 })).replace('127.0.0.1', 'localhost');
    auth = await login(base);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('phase-05-task-01 AC1: 측정 데이터가 품목 1,000·입출고 2만 건 이상이고 다른 목록도 채워진다', () => {
    expect(counts.items).toBeGreaterThanOrEqual(1000);
    expect(counts.stockMoves).toBeGreaterThanOrEqual(20000);
    for (const [k, min] of Object.entries(DATA_TARGETS)) expect(counts[k as keyof DataCounts], k).toBeGreaterThanOrEqual(min);
  });

  test('phase-05-task-01 AC1: 측정 대상에 재고 목록·입출고·발주서·공지·지출·감사 로그·도우미 질문·대시보드가 모두 들어 있다', () => {
    const paths = LIST_ENDPOINTS.map((e) => e.path);
    for (const p of ['/api/items', '/api/inventory/moves', '/api/orders', '/api/posts?kind=notice', '/api/expenses', '/api/audit', '/api/assistant/', '/api/dashboard']) {
      expect(paths.some((x) => x.startsWith(p)), p).toBe(true);
    }
  });

  test('phase-05-task-01 AC1: 주요 목록 API가 모두 200으로 답하고 p95가 300ms 이하다', async () => {
    const results = await measureEndpoints(base, auth, 20);
    expect(results).toHaveLength(LIST_ENDPOINTS.length);
    const over = results.filter((r) => r.p95 > LIMITS.apiP95Ms).map((r) => `${r.label} ${r.p95}ms`);
    expect(over).toEqual([]);
  }, 120000);

  test('phase-05-task-01 AC1: 목록 API가 실제로 10배 데이터를 읽는다(쪽 크기만큼 채워지고 전체 건수가 맞다)', async () => {
    const get = async (p: string) => {
      const r = await fetch(`${base}${p}`, { headers: { cookie: auth.cookie } });
      expect(r.status, p).toBe(200);
      return (await r.json()) as { data: unknown[]; total?: number };
    };
    const items = await get('/api/items?status=all&active=active&page=1&pageSize=100');
    expect(items.data).toHaveLength(100);
    expect(items.total).toBeGreaterThanOrEqual(1000);
    const moves = await get('/api/inventory/moves?page=1&pageSize=50');
    expect(moves.data).toHaveLength(50);
    expect(moves.total).toBe(counts.stockMoves);
    const audit = await get('/api/audit?page=1&pageSize=50');
    expect(audit.data).toHaveLength(50);
    expect(audit.total).toBeGreaterThanOrEqual(20000);
    const notices = await get('/api/posts?kind=notice&pageSize=200');
    expect(notices.data).toHaveLength(200);
  }, 60000);

  test('phase-05-task-01 AC2: 20개 동시 연결로 대시보드·목록을 섞어 불러도 오류·시간 초과가 0건이다(짧은 부하)', async () => {
    const r = await runLoad(base, auth, { connections: 20, durationSec: 3 });
    expect(r.requests).toBeGreaterThan(0);
    expect(r.errors).toBe(0);
    expect(r.non2xx).toBe(0);
    expect(r.timeouts).toBe(0);
    expect(LOAD_PATHS).toContain('/api/dashboard');
  }, 60000);
});

/** 판정 시험용 회차 */
function round(n: number, p95s: Record<string, number>, loadErrors: number, firstMs: number): PerfRound {
  const endpoints: EndpointResult[] = Object.entries(p95s).map(([key, p95]) => ({ key, label: key, method: 'GET', path: `/api/${key}`, count: 10, p50: p95 / 2, p95, max: p95, mean: p95 / 2 }));
  return {
    round: n,
    cpuBusyBefore: 10,
    endpoints,
    load: { connections: 20, durationSec: 60, requests: 1000, errors: loadErrors, timeouts: 0, non2xx: loadErrors, rps: 16, p50: 100, p97_5: 300, p99: 400, max: 500 },
    firstScreen: { loginToDashboard: [firstMs], openDashboard: [firstMs - 10], worst: firstMs },
  };
}

describe('판정(가장 나쁜 회차 기준)', () => {
  test('phase-05-task-01 AC1: API마다 회차 중 가장 큰 p95로 판정하고, 하나라도 300ms를 넘으면 실패다', () => {
    const rounds = [round(1, { items: 80, audit: 20 }, 0, 500), round(2, { items: 120, audit: 310 }, 0, 600), round(3, { items: 90, audit: 30 }, 0, 700)];
    const w = worstEndpoints(rounds);
    expect(w.find((e) => e.key === 'items')?.p95).toBe(120);
    expect(w.find((e) => e.key === 'audit')?.p95).toBe(310);
    const v = judge(rounds);
    expect(v.api.pass).toBe(false);
    expect(v.api.failed).toEqual(['audit p95 310ms']);
    expect(v.pass).toBe(false);
    expect(judge([round(1, { items: 300 }, 0, 500)]).api.pass).toBe(true);
  });

  test('phase-05-task-01 AC2: 어느 한 회차라도 오류가 1건이면 동시 연결 판정은 실패다', () => {
    expect(judge([round(1, { a: 10 }, 0, 500), round(2, { a: 10 }, 1, 500)]).load).toEqual({ pass: false, errors: 1 });
    expect(judge([round(1, { a: 10 }, 0, 500)]).load).toEqual({ pass: true, errors: 0 });
  });

  test('phase-05-task-01 AC3: 첫 화면은 가장 오래 걸린 값이 2,000ms 이내여야 통과다', () => {
    expect(judge([round(1, { a: 10 }, 0, 1999), round(2, { a: 10 }, 0, 2000)]).firstScreen).toEqual({ pass: true, worstMs: 2000 });
    expect(judge([round(1, { a: 10 }, 0, 800), round(2, { a: 10 }, 0, 2001)]).firstScreen).toEqual({ pass: false, worstMs: 2001 });
    expect(judge([round(1, { a: 10 }, 0, 800)]).pass).toBe(true);
  });

  test('phase-05-task-01 AC3: 재지 않은 항목이 있으면 통과로 보지 않는다', () => {
    const r = round(1, { a: 10 }, 0, 500);
    expect(judge([{ ...r, firstScreen: null }]).pass).toBe(false);
    expect(judge([{ ...r, load: null }]).pass).toBe(false);
    expect(judge([{ ...r, endpoints: [] }]).api.pass).toBe(false);
  });

  test('CPU 사용률은 두 시점의 바쁜 시간 / 전체 시간으로 구한다', () => {
    expect(busyPercent({ busy: 100, total: 1000 }, { busy: 350, total: 2000 })).toBe(25);
    expect(busyPercent({ busy: 0, total: 10 }, { busy: 0, total: 10 })).toBe(0);
    expect(summarizeCpu([10, 20, 60])).toEqual({ avg: 30, max: 60, samples: 3 });
    expect(summarizeCpu([])).toEqual({ avg: 0, max: 0, samples: 0 });
  });
});

describe('docs/PERF.md 기록', () => {
  const file = path.join(process.cwd(), 'docs', 'PERF.md');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

  test('phase-05-task-01 AC4: 측정 환경(CPU·메모리·Node 버전)·데이터 규모·명령·수치·판정을 적었다', () => {
    expect(text.length).toBeGreaterThan(0);
    for (const h of ['## 측정 환경', '## 데이터 규모', '## 측정 명령', '## 결과', '## 판정']) expect(text, h).toContain(h);
    expect(text).toMatch(/CPU/);
    expect(text).toMatch(/메모리/);
    expect(text).toMatch(/Node v24\.\d+\.\d+/);
    expect(text).toContain('npm run perf');
    expect(text).toMatch(/품목\s*\|?\s*1,?0\d\d/);
    expect(text).toMatch(/p95/);
  });

  test('phase-05-task-01 AC4: 세 기준(API p95·동시 연결 오류·첫 화면)의 판정이 모두 적혀 있고 통과다', () => {
    const verdict = text.slice(text.indexOf('## 판정'));
    for (const k of ['p95', '동시 연결', '첫 화면']) expect(verdict, k).toContain(k);
    expect(verdict).not.toMatch(/\bFAIL\b/);
    expect((verdict.match(/\bPASS\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});

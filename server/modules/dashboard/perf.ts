// 이 파일이 하는 일: 대시보드 API 응답 시간 측정 도구(phase-03-task-10 AC6, NFR-005 연결).
// measureDashboard(요청 함수, 횟수)로 여러 번 불러 p50·p95·최대(ms)를 구하고, runDashboardPerf()는 작업 사본 안 .tmp/에 임시 서버를 띄워
// 데모 데이터(scale 배율)를 넣은 뒤 실제 HTTP로 GET /api/dashboard를 재어 결과를 돌려준다. 명령줄 실행은 scripts/perf-dashboard.ts가 한다.
// 10배 데이터(scale=10) 측정과 판정 기록은 phase-05-task-01이 이 함수를 불러서 한다.
import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from '../../app.ts';
import { fixedClock } from '../../lib/clock.ts';
import { seedDemoAll } from '../../db/seed/registry.ts';
import { createSession } from '../../auth/sessions.ts';

/** 측정 결과(ms) */
export interface PerfResult {
  count: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

/** 정렬한 값에서 p번째 백분위수(가장 가까운 순위, 올림) */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('측정값이 없어요.');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] as number;
}

/** 요청 함수를 한 번 미리 부른 뒤(준비 운동) count번 차례로 불러 걸린 시간을 잰다 */
export async function measureDashboard(call: () => Promise<void>, count = 50): Promise<PerfResult> {
  await call();
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = performance.now();
    await call();
    times.push(performance.now() - t);
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    count: times.length,
    p50: round(percentile(times, 50)),
    p95: round(percentile(times, 95)),
    max: round(Math.max(...times)),
    mean: round(times.reduce((s, x) => s + x, 0) / times.length),
  };
}

/** 측정 조건 */
export interface DashboardPerfOptions {
  /** 데모 데이터 배율(1 = 기본, 10 = NFR-005 부하) */
  scale?: number;
  /** 요청 횟수 */
  count?: number;
  /** 기준 시각 */
  now?: string;
}

/**
 * 임시 데이터 폴더(.tmp/perf/)에 서버를 띄워(빈 포트, 127.0.0.1) 데모 데이터를 넣고, 관리자 세션으로 GET /api/dashboard를 실제 HTTP로 잰다.
 * 끝나면 서버를 닫고 폴더를 지운다.
 */
export async function runDashboardPerf(opts: DashboardPerfOptions = {}): Promise<PerfResult & { scale: number }> {
  const scale = opts.scale ?? 1;
  const base = path.join(process.cwd(), '.tmp', 'perf');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'dashboard-'));
  const clock = fixedClock(opts.now ?? '2026-11-02T09:00:00+09:00');
  const app = await buildApp({ dataDir: dir, webDist: path.join(dir, 'no-web'), clock });
  try {
    await seedDemoAll(app.db, { clock, scale });
    // 측정 전용 관리자 계정(로그인할 수 없는 비밀번호 값, 비밀번호 변경 요구 없음)을 넣고 세션을 연다
    const at = clock.now().toISOString();
    const admin = app.db.run(
      "INSERT INTO users (username, name, role, job_type, password_hash, must_change_pw, active, created_at, updated_at) VALUES ('perfadmin', '측정용 원장', 'admin', 'other', 'scrypt$x', 0, 1, ?, ?)",
      [at, at],
    );
    const session = createSession(app.db, clock, admin.lastInsertRowid, '127.0.0.1');
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const url = `${address}/api/dashboard`;
    const headers = { cookie: `sid=${session.token}` };
    const r = await measureDashboard(async () => {
      const res = await fetch(url, { headers });
      if (res.status !== 200) throw new Error(`대시보드 응답이 ${res.status}이에요.`);
      await res.arrayBuffer();
    }, opts.count ?? 100);
    return { ...r, scale };
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

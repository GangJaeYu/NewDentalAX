// 이 파일이 하는 일: 대시보드 API(GET /api/dashboard) 응답 시간 측정 명령(phase-03-task-10 AC6).
// 사용법: node --disable-warning=ExperimentalWarning scripts/perf-dashboard.ts [--scale 1] [--count 100]
// 작업 사본 안 .tmp/perf/에 임시 서버를 띄워 데모 데이터를 넣고 실제 HTTP로 재어 p50·p95·최대(ms)를 출력한다. p95가 300ms를 넘으면 종료 코드 1.
// 10배 데이터(--scale 10) 판정은 phase-05-task-01이 이 명령으로 한다.
import { runDashboardPerf } from '../server/modules/dashboard/perf.ts';

/** 인자에서 --name 숫자 값 읽기 */
function numArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  const v = i > 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const LIMIT_MS = 300;
const r = await runDashboardPerf({ scale: numArg('--scale', 1), count: numArg('--count', 100) });
console.log(`[perf:dashboard] scale=${r.scale} 요청 ${r.count}건 p50 ${r.p50}ms p95 ${r.p95}ms 최대 ${r.max}ms 평균 ${r.mean}ms (기준 p95 ≤ ${LIMIT_MS}ms)`);
if (r.p95 > LIMIT_MS) {
  console.error(`[perf:dashboard] FAIL: p95 ${r.p95}ms가 ${LIMIT_MS}ms를 넘었어요.`);
  process.exitCode = 1;
}

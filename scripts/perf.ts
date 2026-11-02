// 이 파일이 하는 일: 성능 측정(`npm run perf`)의 시작판. 임시 서버를 띄워 GET /api/health에 동시 연결 20개로 10초간 요청을 보내고
// 응답 시간 p95·오류 수를 출력한다. 10배 데모 데이터와 주요 목록 API 측정은 phase-05-task-01이 이 파일을 확장한다(NFR-005).
import { spawn } from 'node:child_process';
import autocannon from 'autocannon';

const PORT = Number(process.env.E2E_PORT || 18090);
const BASE = `http://localhost:${PORT}`;

/** 서버가 준비될 때까지 기다린다 */
async function waitReady(timeoutMs = 30000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // 아직 안 켜짐
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`테스트 서버(${BASE})가 준비되지 않았어요.`);
}

const server = spawn(process.execPath, ['scripts/e2e-server.ts'], { stdio: 'inherit', env: { ...process.env, E2E_PORT: String(PORT) } });
try {
  await waitReady();
  const result = await autocannon({ url: `${BASE}/api/health`, connections: 20, duration: 10 });
  const p975 = result.latency.p97_5;
  console.log(`[perf] /api/health 요청 ${result.requests.total}건, 오류 ${result.errors + result.non2xx}건, 평균 ${result.latency.average}ms, p97.5 ${p975}ms`);
} finally {
  server.kill();
}

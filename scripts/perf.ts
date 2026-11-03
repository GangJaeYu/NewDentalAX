// 이 파일이 하는 일: 성능 측정 명령(`npm run perf`, NFR-005, phase-05-task-01). 작업 사본 안 .tmp/perf/에 10배 데모 데이터(scale=10)와
// 측정용 보충 데이터를 만들고 별도 서버 프로세스(scripts/e2e-server.ts, 포트 PERF_PORT 기본 18190)를 띄워 세 가지를 잰다.
// ① 주요 목록 API·대시보드 p95(기준 300ms 이하) ② autocannon 20개 동시 연결 60초 시나리오(기준 오류 0건) ③ Playwright(Edge)로 로그인 뒤 대시보드 첫 화면(기준 2초 이내).
// 같은 측정을 --rounds번(기본 3) 하고 가장 나쁜 값으로 판정한다. 회차 직전 PC CPU가 높으면 잠시 기다리고, 재는 동안 평균 CPU가 높았던 회차는
// 다른 작업과 겹친 것으로 보고 기록을 남긴 채 다시 잰다(회차마다 최대 --retries번, 기본 3).
// 결과는 화면에 표로 찍고 artifacts/perf/perf-<시각>.json에 남긴다. 기준을 못 넘으면 종료 코드 1.
// 사용법: node --disable-warning=ExperimentalWarning scripts/perf.ts [--rounds 3] [--count 100] [--duration 60] [--connections 20] [--screens 5] [--scale 10]
//        node --disable-warning=ExperimentalWarning scripts/perf.ts --prepare <폴더>   (측정 데이터만 만들고 끝, E2E가 쓴다)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  DATA_TARGETS,
  LIMITS,
  judge,
  login,
  machineInfo,
  measureEndpoints,
  measureFirstScreen,
  preparePerfData,
  runLoad,
  sampleCpuBusy,
  watchCpu,
  worstEndpoints,
  worstFirstScreen,
  worstLoad,
  type DataCounts,
  type PerfRound,
} from './perf-lib.ts';
import { acquireHeavySlot } from './heavy-slot.ts';

const ROOT = process.cwd();

/** 인자에서 --name 숫자 값 읽기 */
function numArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  const v = i > 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 인자에서 --name 글자 값 읽기 */
function strArg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}

const log = (msg: string) => console.log(`[perf] ${msg}`);

/** --prepare <폴더>: 측정 데이터만 만들고 줄 수를 JSON으로 찍는다 */
const prepareDir = strArg('--prepare');
if (prepareDir) {
  const dir = path.resolve(prepareDir);
  if (!dir.startsWith(path.join(ROOT, '.tmp'))) throw new Error('측정 데이터 폴더는 작업 사본 안 .tmp/ 아래여야 해요.');
  fs.mkdirSync(dir, { recursive: true });
  const counts = await preparePerfData(dir, { scale: numArg('--scale', 10) });
  console.log(JSON.stringify(counts));
  process.exit(0);
}

const rounds = numArg('--rounds', 3);
const count = numArg('--count', 100);
const duration = numArg('--duration', 60);
const connections = numArg('--connections', 20);
const screens = numArg('--screens', 5);
const scale = numArg('--scale', 10);
const port = Number(process.env.PERF_PORT || 18190);
const base = `http://localhost:${port}`;
const CPU_BUSY_LIMIT = 50;
/** 회차를 재는 동안 PC 평균 CPU가 이보다 높으면 다른 작업과 겹친 회차로 보고 다시 잰다(이 측정의 서버·부하 도구 몫 약 10% 포함) */
const CPU_DISTURB_LIMIT = 65;
const retries = numArg('--retries', 3);

/** 화면 파일이 없으면 빌드한다(대시보드 첫 화면 측정에 필요) */
function ensureWebBuild(): void {
  if (fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html')) && !process.argv.includes('--build')) return;
  log('화면 파일(web/dist)을 빌드합니다...');
  const r = spawnSync('npm run build:web', { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('화면 빌드가 실패했어요.');
}

/** 서버가 준비될 때까지(GET /api/health가 ok) 기다린다 */
async function waitReady(child: ChildProcess, timeoutMs = 60000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`측정 서버가 바로 꺼졌어요(종료 코드 ${child.exitCode}).`);
    try {
      const r = await fetch(`${base}/api/health`);
      const body = (await r.json()) as { ok?: boolean; db?: string };
      if (r.ok && body.ok && body.db === 'ok') return;
    } catch {
      // 아직 안 켜짐
    }
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`측정 서버(${base})가 준비되지 않았어요.`);
}

/** 이 명령이 띄운 서버 자식 프로세스만 끈다 */
async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill();
  });
}

/** CPU 사용률이 기준 아래가 될 때까지 최대 tries번(15초 간격) 기다린다. 마지막 값을 돌려준다 */
async function waitCalm(tries = 8): Promise<number> {
  let busy = await sampleCpuBusy(2000);
  for (let i = 0; i < tries && busy > CPU_BUSY_LIMIT; i++) {
    log(`PC CPU 사용률 ${busy}% — ${CPU_BUSY_LIMIT}% 아래가 될 때까지 15초 기다립니다(${i + 1}/${tries}).`);
    await new Promise((res) => setTimeout(res, 15000));
    busy = await sampleCpuBusy(2000);
  }
  return busy;
}

/** 표 한 줄 */
const row = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`;

/** 결과를 사람이 읽는 표로 */
function report(env: ReturnType<typeof machineInfo>, counts: DataCounts, all: PerfRound[], discarded: PerfRound[]): string {
  const v = judge(all);
  const lines: string[] = [];
  lines.push(`측정 환경: ${env.cpu} · 논리 CPU ${env.logicalCpus}개 · 메모리 ${env.memoryGb}GB · Node ${env.node} · ${env.os}`);
  lines.push(`데이터: scale=${scale}, 품목 ${counts.items} · 입출고 ${counts.stockMoves} · 발주서 ${counts.orders} · 감사 기록 ${counts.audit} · 공지 ${counts.notices} · 지출 ${counts.expenses} · 도우미 질문·답 ${counts.assistantMessages} · 직원 ${counts.users}`);
  const cpuText = (r: PerfRound) => `${r.round}회 직전 ${r.cpuBusyBefore}% · 측정 중 평균 ${r.cpuDuring?.avg ?? '-'}%(최대 ${r.cpuDuring?.max ?? '-'}%)`;
  lines.push(`판정에 쓴 회차의 PC CPU 사용률: ${all.map(cpuText).join(', ')}`);
  if (discarded.length) {
    lines.push(`다른 작업과 겹쳐(측정 중 평균 CPU > ${CPU_DISTURB_LIMIT}%) 다시 잰 시도 ${discarded.length}개:`);
    for (const r of discarded) {
      const apiWorst = r.endpoints.length ? Math.max(...r.endpoints.map((e) => e.p95)) : '-';
      lines.push(`- ${cpuText(r)} → API 최악 p95 ${apiWorst}ms, 동시 연결 오류 ${r.load?.errors ?? '-'}건·시간 초과 ${r.load?.timeouts ?? '-'}건·p99 ${r.load?.p99 ?? '-'}ms, 첫 화면 최악 ${r.firstScreen?.worst ?? '-'}ms`);
    }
  }
  lines.push('');
  lines.push(`① 주요 목록 API (API마다 ${count}번 차례로, 회차 중 가장 나쁜 p95) — 기준 p95 ≤ ${LIMITS.apiP95Ms}ms`);
  lines.push(row(['화면', '주소', ...all.map((r) => `${r.round}회 p95`), '최악 p50', '최악 p95', '최악 최대', '판정']));
  lines.push(row(['---', '---', ...all.map(() => '---'), '---', '---', '---', '---']));
  for (const w of worstEndpoints(all)) {
    const per = all.map((r) => r.endpoints.find((e) => e.key === w.key)?.p95 ?? '-');
    lines.push(row([w.label, `${w.method} ${w.path}`, ...per.map((x) => `${x}ms`), `${w.p50}ms`, `${w.p95}ms`, `${w.max}ms`, w.p95 <= LIMITS.apiP95Ms ? 'PASS' : 'FAIL']));
  }
  lines.push('');
  lines.push(`② 동시 연결 ${connections}개 · ${duration}초 (대시보드·목록·알림 요약 섞기) — 기준 오류 0건`);
  lines.push(row(['회차', '요청', '초당', '오류(2xx 아님 포함)', '시간 초과', 'p50', 'p97.5', 'p99', '최대']));
  lines.push(row(['---', '---', '---', '---', '---', '---', '---', '---', '---']));
  for (const r of all) {
    const l = r.load;
    if (l) lines.push(row([`${r.round}회`, l.requests, l.rps, l.errors, l.timeouts, `${l.p50}ms`, `${l.p97_5}ms`, `${l.p99}ms`, `${l.max}ms`]));
  }
  lines.push('');
  lines.push(`③ 첫 화면(1440×900, 빈 캐시, 회차마다 ${screens}번) — 기준 ${LIMITS.firstScreenMs}ms 이내`);
  lines.push(row(['회차', '로그인 단추 → 대시보드 완성', '주소 / 열기 → 대시보드 완성', '회차 최악']));
  lines.push(row(['---', '---', '---', '---']));
  for (const r of all) {
    const f = r.firstScreen;
    if (f) lines.push(row([`${r.round}회`, f.loginToDashboard.map((x) => `${x}ms`).join(', '), f.openDashboard.map((x) => `${x}ms`).join(', '), `${f.worst}ms`]));
  }
  lines.push('');
  const wl = worstLoad(all);
  lines.push(
    `판정: API ${v.api.pass ? 'PASS' : 'FAIL'}(최악 p95 ${v.api.worstP95}ms${v.api.failed.length ? `, 넘은 곳: ${v.api.failed.join(', ')}` : ''}) · ` +
      `동시 연결 ${v.load?.pass ? 'PASS' : 'FAIL'}(오류 ${v.load?.errors ?? '측정 안 됨'}건, 최악 p99 ${wl?.p99 ?? '-'}ms) · ` +
      `첫 화면 ${v.firstScreen?.pass ? 'PASS' : 'FAIL'}(최악 ${worstFirstScreen(all) ?? '측정 안 됨'}ms) → ${v.pass ? 'PASS' : 'FAIL'}`,
  );
  return lines.join('\n');
}

ensureWebBuild();
const runDir = path.join(ROOT, '.tmp', 'perf', `run-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
log(`측정 데이터를 만듭니다(scale=${scale}, ${runDir})...`);
const t0 = Date.now();
const counts = await preparePerfData(runDir, { scale });
log(`데이터 준비 ${Math.round((Date.now() - t0) / 100) / 10}초: ${JSON.stringify(counts)}`);
for (const [k, min] of Object.entries(DATA_TARGETS)) {
  if (((counts as Record<string, number>)[k] ?? 0) < min) throw new Error(`측정 데이터 ${k}가 ${min}건보다 적어요.`);
}

// 재는 동안 다른 작업 사본의 e2e·스크린샷이 끼어들지 않게 PC 공용 무거운 검사 자리를 잡는다(05-01 검증에서 겹친 측정이 FAIL 수치를 냄)
const releaseSlot = await acquireHeavySlot('perf');
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/e2e-server.ts'], {
  cwd: ROOT,
  env: { ...process.env, E2E_PORT: String(port), E2E_DATA_DIR: runDir },
  stdio: 'ignore',
});
const all: PerfRound[] = [];
const discarded: PerfRound[] = [];
const env = machineInfo();
try {
  await waitReady(server);
  log(`측정 서버 준비: ${base} (pid ${server.pid})`);
  const auth = await login(base);
  for (let round = 1, attempt = 1; round <= rounds; ) {
    const cpuBusyBefore = await waitCalm();
    log(`${round}회차 시작(직전 CPU ${cpuBusyBefore}%, ${attempt}번째 시도)`);
    const stopWatch = watchCpu();
    const endpoints = await measureEndpoints(base, auth, count);
    log(`${round}회차 ① API: 최악 p95 ${Math.max(...endpoints.map((e) => e.p95))}ms`);
    const load = await runLoad(base, auth, { connections, durationSec: duration });
    log(`${round}회차 ② 동시 연결: 요청 ${load.requests}건, 오류 ${load.errors}건, 시간 초과 ${load.timeouts}건, p99 ${load.p99}ms`);
    const firstScreen = await measureFirstScreen(base, screens);
    log(`${round}회차 ③ 첫 화면: 최악 ${firstScreen.worst}ms`);
    const cpuDuring = stopWatch();
    const result: PerfRound = { round, cpuBusyBefore, cpuDuring, endpoints, load, firstScreen };
    if (cpuDuring.avg > CPU_DISTURB_LIMIT && attempt <= retries) {
      log(`${round}회차는 측정 중 PC 평균 CPU가 ${cpuDuring.avg}%라 다른 작업과 겹쳤어요. 기록만 남기고 다시 잽니다.`);
      discarded.push(result);
      attempt++;
      continue;
    }
    log(`${round}회차 완료(측정 중 PC 평균 CPU ${cpuDuring.avg}%, 최대 ${cpuDuring.max}%)`);
    all.push(result);
    round++;
    attempt = 1;
  }
} finally {
  await stopServer(server);
  releaseSlot();
  try {
    fs.rmSync(runDir, { recursive: true, force: true });
  } catch {
    // 파일을 아직 쥐고 있으면 남겨 둔다(.tmp는 git 제외)
  }
}

const text = report(env, counts, all, discarded);
console.log(`\n${text}`);
const outDir = path.join(ROOT, 'artifacts', 'perf');
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const verdict = judge(all);
const outFile = path.join(outDir, `perf-${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), env, options: { rounds, count, duration, connections, screens, scale, port }, counts, rounds: all, discarded, verdict }, null, 2));
fs.writeFileSync(path.join(outDir, `perf-${stamp}.txt`), `${text}\n`);
log(`결과 파일: ${path.relative(ROOT, outFile)}`);
if (!verdict.pass) {
  console.error('[perf] FAIL: NFR-005 기준을 넘지 못한 항목이 있어요.');
  process.exitCode = 1;
}

// 이 파일이 하는 일: 첫 화면 성능 E2E(phase-05-task-01 AC3, NFR-005). 이 파일 전용 격리 서버(fixtures.ts)의 데이터 폴더를
// 10배 데모 데이터 + 측정용 보충 데이터(품목 1,000·입출고 6만 건, `node scripts/perf.ts --prepare`)로 바꿔 다시 켠 뒤,
// 빈 캐시 브라우저로 로그인 단추를 누른 때부터 대시보드(카드 10개·서버 날짜·"불러오는 중" 없음)가 다 그려질 때까지,
// 그리고 로그인한 상태로 주소 /를 새로 열어 다 그려질 때까지를 3번씩 재어 모두 2,000ms 이내인지 본다. 본 측정(회차 3번)은 `npm run perf`가 한다.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from './fixtures.ts';
import { measureFirstScreen, PERF_USER } from '../../scripts/perf-browser.ts';

test('phase-05-task-01 AC3: 10배 데이터에서 로그인 뒤 대시보드 첫 화면이 2초 이내에 다 그려진다', async ({ isoServer, browser }) => {
  test.setTimeout(180000);
  // 서버를 끄고 빈 데이터 폴더에 측정 데이터를 만든 뒤 같은 포트로 다시 켠다
  await isoServer.stop();
  for (const name of fs.readdirSync(isoServer.dataDir)) fs.rmSync(path.join(isoServer.dataDir, name), { recursive: true, force: true });
  const prep = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/perf.ts', '--prepare', isoServer.dataDir], { cwd: process.cwd(), encoding: 'utf8' });
  expect(prep.status, prep.stderr).toBe(0);
  const counts = JSON.parse(prep.stdout.trim().split('\n').pop() ?? '{}') as { items: number; stockMoves: number };
  expect(counts.items).toBeGreaterThanOrEqual(1000);
  expect(counts.stockMoves).toBeGreaterThanOrEqual(20000);
  await isoServer.start();

  const r = await measureFirstScreen(isoServer.baseURL, 3, PERF_USER, browser);
  console.log(`[phase-05-task-01 AC3] 로그인 → 대시보드 ${r.loginToDashboard.join(', ')}ms / 주소 열기 → 대시보드 ${r.openDashboard.join(', ')}ms`);
  expect(r.loginToDashboard).toHaveLength(3);
  expect(r.openDashboard).toHaveLength(3);
  for (const ms of [...r.loginToDashboard, ...r.openDashboard]) expect(ms).toBeLessThanOrEqual(2000);
});

// 이 파일이 하는 일: start.bat·stop.bat을 한국어 Windows에서 더블클릭할 때와 같은 조건(새 콘솔, 코드 페이지 949)으로 실제 실행해
// 출력 첫 줄부터 깨진 글자나 "is not recognized" 같은 명령 오류가 없는지, 한국어 안내·원내 IP·health 응답·stop.bat 종료,
// 포트가 사용 중일 때(다른 프로그램이 [::]·0.0.0.0·127.0.0.1 중 어디를 쓰든)의 한국어 안내와 종료 코드 1을 확인한다(phase-01-task-01 AC3·AC4). Windows 전용.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';
import { lanAddresses } from '../../server/main.ts';

const ROOT = process.cwd();
const START_BAT = path.join(ROOT, 'start.bat');
const STOP_BAT = path.join(ROOT, 'stop.bat');
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** 운영체제가 골라 주는 빈 포트 번호를 하나 얻는다 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '0.0.0.0', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

/** 잠깐 기다린다 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * start.bat이 테스트 도중 npm ci를 다시 돌려 node_modules를 지우지 않게, 설치 표시 파일을 지금 잠금 파일 기준으로 맞춘다.
 * (node_modules는 이미 같은 package-lock.json으로 설치된 상태라 start.bat이 설치 뒤 남기는 내용과 같다)
 */
function ensureInstallStamp(): void {
  const r = spawnSync('certutil', ['-hashfile', 'package-lock.json', 'SHA256'], { cwd: ROOT, encoding: 'utf8' });
  const hash = (r.stdout ?? '').split(/\r?\n/).find((l) => !l.includes(':') && l.trim())?.replace(/ /g, '');
  if (!hash) throw new Error('package-lock.json 해시를 구하지 못했어요: ' + r.stdout);
  const stamp = path.join(ROOT, 'node_modules', '.install-stamp');
  const old = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').split(/\r?\n/)[0]?.trim() : '';
  if (old !== hash) fs.writeFileSync(stamp, hash + '\r\n');
}

interface FreshRun {
  /** 바깥 cmd가 끝날 때의 종료 코드 */
  exited: Promise<number | null>;
  /** 배치 파일 출력(표준 출력+오류)을 모은 로그 파일 */
  log: string;
  /** 배치 파일을 읽은 cmd가 시작할 때의 코드 페이지 기록(chcp 출력) */
  cpFile: string;
}

/** 새 콘솔(숨김 창)에서 cmd를 실행하는 PowerShell 명령. 경로는 환경 변수로 넘겨 따옴표 문제를 피한다 */
const PS_NEW_CONSOLE = [
  "$p = Start-Process -FilePath cmd.exe -ArgumentList @('/d', '/c', ('\"' + $env:BATCH_RUNNER + '\"'))",
  '-WindowStyle Hidden -PassThru;',
  '$null = $p.Handle;',
  'Set-Content -LiteralPath $env:BATCH_RUNNER_PID -Value $p.Id;',
  '$p.WaitForExit();',
  'exit $p.ExitCode',
].join(' ');

/**
 * 새 콘솔 창(숨김)을 열고, 그 안에서 코드 페이지를 949로 맞춘 뒤 새 cmd로 배치 파일을 실행한다.
 * 한국어 Windows에서 탐색기로 더블클릭하면 cmd가 949로 시작하는 것과 같은 조건이다.
 * (node의 detached 옵션은 콘솔이 없는 프로세스를 만들어 chcp가 동작하지 않으므로 PowerShell Start-Process를 쓴다)
 * 새 콘솔을 쓰므로 테스트를 돌리는 터미널의 코드 페이지는 바뀌지 않는다.
 */
function runInFreshConsole(bat: string, dir: string, tag: string, env: NodeJS.ProcessEnv): FreshRun {
  const log = path.join(dir, `${tag}.log`);
  const cpFile = path.join(dir, `${tag}-cp.txt`);
  const runner = path.join(dir, `${tag}-runner.cmd`);
  const pidFile = path.join(dir, `${tag}-runner.pid`);
  fs.writeFileSync(
    runner,
    [
      '@echo off',
      'chcp 949 >nul',
      `cmd /d /c chcp > "${cpFile}"`,
      `cmd /d /c "${bat}" < nul > "${log}" 2>&1`,
      'exit /b %ERRORLEVEL%',
      '',
    ].join('\r\n'),
  );
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_NEW_CONSOLE], {
    cwd: ROOT,
    env: { ...process.env, NO_BROWSER: '1', ...env, BATCH_RUNNER: runner, BATCH_RUNNER_PID: pidFile },
    windowsHide: true,
    stdio: 'ignore',
  });
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  cleanups.push(() => {
    // 이 테스트가 띄운 프로세스만 정리한다(새 콘솔의 cmd와 그 자식들)
    if (child.exitCode !== null || !fs.existsSync(pidFile)) return;
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (pid > 0) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
  });
  return { exited, log, cpFile };
}

/** 로그 파일을 UTF-8로 읽는다(없으면 빈 문자열) */
function readLog(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** 깨진 글자·cmd 명령 오류가 하나도 없는지, 첫 줄(빈 줄 제외)이 기대한 한국어 안내인지 확인한다 */
function expectCleanOutput(text: string, firstLine: string | RegExp): void {
  expect(text).not.toContain('�');
  expect(text).not.toMatch(/is not recognized|내부 또는 외부 명령|was unexpected|지금은 예상되지 않았습니다/);
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '');
  if (typeof firstLine === 'string') expect(first?.trim()).toBe(firstLine);
  else expect(first?.trim()).toMatch(firstLine);
}

/** health가 ok:true를 돌려줄 때까지 기다린다 */
async function waitHealthy(port: number, until: Promise<unknown>, ms = 60000): Promise<boolean> {
  let done = false;
  void until.then(() => (done = true));
  const end = Date.now() + ms;
  while (Date.now() < end && !done) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = (await res.json()) as { ok?: boolean };
      if (body.ok === true) return true;
    } catch {
      // 아직 켜지는 중
    }
    await wait(300);
  }
  return false;
}

/** 실행되는 줄(맨 처음 exit /b 줄까지)을 돌려준다 */
function executedLines(file: string): string[] {
  const lines = fs.readFileSync(file, 'utf8').split('\r\n');
  const end = lines.findIndex((l) => /^exit \/b/i.test(l));
  return lines.slice(0, end + 1);
}

describe.runIf(process.platform === 'win32')('start.bat·stop.bat 새 콘솔(코드 페이지 949) 실행', () => {
  test('phase-01-task-01 AC3 start.bat·stop.bat은 CRLF이고, 실행되는 줄은 영어(ASCII)만 쓰며 새 cmd로 한국어 본 스크립트를 실행한다', () => {
    for (const [bat, main] of [
      [START_BAT, 'start-main.cmd'],
      [STOP_BAT, 'stop-main.cmd'],
    ] as const) {
      const raw = fs.readFileSync(bat, 'utf8');
      expect(raw.replace(/\r\n/g, '')).not.toContain('\n');
      const lines = executedLines(bat);
      expect(lines.length).toBeGreaterThan(2);
      for (const l of lines) expect(l).toMatch(/^[\x20-\x7E]*$/);
      expect(lines).toContain('chcp 65001 >nul');
      expect(lines.some((l) => l.startsWith('cmd /d /s /c ') && l.includes(`scripts\\windows\\${main}`))).toBe(true);
      expect(fs.existsSync(path.join(ROOT, 'scripts', 'windows', main))).toBe(true);
    }
  });

  test('phase-01-task-01 AC3 새 콘솔(949)에서 start.bat을 실행하면 첫 줄부터 깨진 글자·명령 오류 없이 한국어 안내와 원내 IP가 나오고 health가 응답하며, stop.bat으로 꺼진다', async () => {
    ensureInstallStamp();
    const dir = makeTmpDir('startbat-');
    const dataDir = path.join(dir, 'data');
    const port = await freePort();
    const env = { PORT: String(port), DATA_DIR: dataDir };
    cleanups.push(() => {
      // 테스트가 중간에 실패해도 이 테스트가 띄운 서버는 끈다(PID 파일의 프로세스만)
      const pidFile = path.join(dataDir, 'server.pid');
      if (!fs.existsSync(pidFile)) return;
      const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      if (pid > 0) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
    });

    const start = runInFreshConsole(START_BAT, dir, 'start', env);
    const healthy = await waitHealthy(port, start.exited);
    expect(healthy, `health 응답 없음. 로그:\n${readLog(start.log)}`).toBe(true);
    expect(readLog(start.cpFile)).toContain('949');
    // 안내하는 localhost(::1로 먼저 감)·127.0.0.1·원내 IP 모두 이 서버가 받아야 한다
    for (const base of [`http://localhost:${port}`, `http://[::1]:${port}`, `http://127.0.0.1:${port}`, ...lanAddresses().map((ip) => `http://${ip}:${port}`)]) {
      const body = (await (await fetch(`${base}/api/health`)).json()) as { ok?: boolean };
      expect(body.ok, base).toBe(true);
    }

    const stop = runInFreshConsole(STOP_BAT, dir, 'stop', env);
    expect(await stop.exited).toBe(0);
    const startCode = await Promise.race([start.exited, wait(30000).then(() => 'timeout')]);
    expect(startCode).toBe(0);

    const startLog = readLog(start.log);
    expectCleanOutput(startLog, '하늘숲치과 원내 업무 서버를 켜는 중이에요...');
    expect(startLog).toContain('하늘숲치과 원내 업무 서버가 켜졌어요');
    expect(startLog).toContain(`http://localhost:${port}`);
    expect(startLog).toMatch(/이 PC의 원내 IP 주소: \d+\.\d+\.\d+\.\d+/);
    expect(startLog).toContain('stop.bat 요청으로 서버를 껐어요.');

    const stopLog = readLog(stop.log);
    expect(readLog(stop.cpFile)).toContain('949');
    expectCleanOutput(stopLog, /^서버\(PID \d+\)에 종료를 요청했어요\.\.\.$/);
    expect(stopLog).toContain('서버가 꺼졌어요.');
    expect(fs.existsSync(path.join(dataDir, 'server.pid'))).toBe(false);
    // 포트가 풀렸는지: 같은 포트로 다시 열 수 있어야 한다
    await new Promise<void>((resolve, reject) => {
      const s = net.createServer();
      s.once('error', reject);
      s.listen(port, '0.0.0.0', () => s.close(() => resolve()));
    });
  }, 120000);

  // 다른 프로그램이 포트를 쓰는 방식. 첫 번째는 Node listen(PORT)의 기본 동작으로 IPv6 전체 주소 [::]를 쓴다
  const blockers: Array<[string, string | undefined]> = [
    ['[::] 전체 주소(listen(PORT) 기본)', undefined],
    ['0.0.0.0', '0.0.0.0'],
    ['127.0.0.1', '127.0.0.1'],
  ];
  test.each(blockers)(
    'phase-01-task-01 AC4 새 콘솔(949)에서 다른 프로그램이 %s에서 포트를 쓰면 start.bat이 깨진 글자 없이 한국어 원인·해결 방법을 보여 주고 다시 시작하지 않고 종료 코드 1로 끝난다',
    async (_label, blockHost) => {
      ensureInstallStamp();
      const dir = makeTmpDir('startbat-busy-');
      const port = await freePort();
      const blocker = net.createServer();
      await new Promise<void>((resolve, reject) => {
        blocker.once('error', reject);
        if (blockHost === undefined) blocker.listen(port, () => resolve());
        else blocker.listen(port, blockHost, () => resolve());
      });
      cleanups.push(() => blocker.close());
      if (blockHost === undefined) expect((blocker.address() as net.AddressInfo).address).toBe('::');

      const run = runInFreshConsole(START_BAT, dir, 'busy', { PORT: String(port), DATA_DIR: path.join(dir, 'data') });
      const code = await Promise.race([run.exited, wait(60000).then(() => 'timeout')]);
      const text = readLog(run.log);
      expect(code, text).toBe(1);
      expect(readLog(run.cpFile)).toContain('949');
      expectCleanOutput(text, '하늘숲치과 원내 업무 서버를 켜는 중이에요...');
      expect(text).toContain('[원인]');
      expect(text).toContain(`포트 ${port}이(가) 이미 사용 중이에요`);
      expect(text).toContain('[해결 방법]');
      expect(text).toContain('[안내] 포트 문제는 다시 시작해도 해결되지 않아서 멈췄어요.');
      expect(text).not.toContain('다시 시작해요(');
      expect(text).not.toContain('서버가 켜졌어요');
    },
    90000,
  );
});

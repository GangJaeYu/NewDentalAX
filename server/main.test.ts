// 이 파일이 하는 일: 서버 진입점(main.ts)을 실제 프로세스로 띄워 확인한다 — 준비 상태 응답, PID 파일, 원내 IP 안내,
// stop.flag로 정상 종료, 포트가 이미 사용 중일 때 한국어 원인·해결 방법과 종료 코드 2(phase-01-task-01 AC2·AC3·AC4).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import { EXIT_PORT, isPrivateIPv4, lanAddresses, portProblemMessage, startupMessage } from './main.ts';
import { makeTmpDir } from '../tests/helpers/tmp-dir.ts';

const MAIN = path.join(process.cwd(), 'server', 'main.ts');
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

/** main.ts를 자식 프로세스로 띄우고 출력을 모은다 */
function runMain(env: NodeJS.ProcessEnv) {
  const child: ChildProcess = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN], {
    env: { ...process.env, NO_BROWSER: '1', OPEN_BROWSER: '0', NODE_ENV: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  cleanups.push(() => {
    if (child.exitCode === null) child.kill();
  });
  return { child, exited, output: () => out };
}

/** 서버가 준비될 때까지 /api/health를 확인한다 */
async function waitHealth(port: number, timeoutMs = 15000): Promise<{ ok: boolean; db: string; version: string }> {
  const until = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return (await r.json()) as { ok: boolean; db: string; version: string };
    } catch (e) {
      last = e;
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`서버가 준비되지 않음: ${String(last)}`);
}

describe('원내 IP 안내', () => {
  test('phase-01-task-01 AC3: 루프백·링크로컬을 빼고 사설망 IPv4를 앞에 둔다', () => {
    const fake = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      vpn: [{ address: '25.1.2.3', family: 'IPv4', internal: false }],
      wifi: [
        { address: '192.168.0.23', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
      apipa: [{ address: '169.254.10.1', family: 'IPv4', internal: false }],
    } as unknown as Parameters<typeof lanAddresses>[0];
    expect(lanAddresses(fake)).toEqual(['192.168.0.23', '25.1.2.3']);
    expect(isPrivateIPv4('172.20.1.1')).toBe(true);
    expect(isPrivateIPv4('172.32.1.1')).toBe(false);
    expect(isPrivateIPv4('10.0.0.5')).toBe(true);
  });

  test('phase-01-task-01 AC3: 시작 안내 문구에 이 PC 주소와 원내 IP 주소가 한국어로 들어간다', () => {
    const msg = startupMessage(8090, ['192.168.0.23'], '0.1.0');
    expect(msg).toContain('http://localhost:8090');
    expect(msg).toContain('http://192.168.0.23:8090');
    expect(msg).toContain('원내 IP 주소: 192.168.0.23');
    expect(msg).toContain('서버가 켜졌어요');
  });

  test('phase-01-task-01 AC4: 포트 문제 안내에 원인과 해결 방법이 한국어로 들어간다', () => {
    const msg = portProblemMessage(8090, 'EADDRINUSE');
    expect(msg).toContain('[원인] 포트 8090이(가) 이미 사용 중이에요');
    expect(msg).toContain('[해결 방법]');
    expect(msg).toContain('stop.bat');
    expect(msg).toContain('config.json');
  });
});

describe('main.ts 실제 실행', () => {
  test('phase-01-task-01 AC2/AC3: 서버가 켜지면 health가 ok이고 PID 파일·원내 IP 안내가 나오며, stop.flag로 정상 종료한다', async () => {
    const dataDir = makeTmpDir('main-run-');
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const port = await freePort();
    const run = runMain({ PORT: String(port), DATA_DIR: dataDir, BACKUP_DIR: path.join(dataDir, 'backups') });

    const health = await waitHealth(port);
    expect(health).toMatchObject({ ok: true, db: 'ok' });
    const pidFile = path.join(dataDir, 'server.pid');
    expect(fs.readFileSync(pidFile, 'utf8').trim()).toBe(String(run.child.pid));
    expect(run.output()).toContain('서버가 켜졌어요');
    expect(run.output()).toContain(`http://localhost:${port}`);
    for (const ip of lanAddresses()) expect(run.output()).toContain(`http://${ip}:${port}`);
    expect(fs.existsSync(path.join(dataDir, 'logs', 'server.log'))).toBe(true);

    fs.writeFileSync(path.join(dataDir, 'stop.flag'), 'stop');
    expect(await run.exited).toBe(0);
    expect(fs.existsSync(pidFile)).toBe(false);
    expect(run.output()).toContain('서버가 꺼졌어요');
  });

  test('phase-01-task-01 AC4: 포트가 이미 사용 중이면 한국어로 원인·해결 방법을 출력하고 종료 코드 2로 끝난다', async () => {
    const dataDir = makeTmpDir('main-busy-');
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '0.0.0.0', () => resolve()));
    cleanups.push(() => blocker.close());
    const port = (blocker.address() as net.AddressInfo).port;

    const run = runMain({ PORT: String(port), DATA_DIR: dataDir, BACKUP_DIR: path.join(dataDir, 'backups') });
    expect(await run.exited).toBe(EXIT_PORT);
    expect(run.output()).toContain(`포트 ${port}이(가) 이미 사용 중이에요`);
    expect(run.output()).toContain('[해결 방법]');
    expect(fs.existsSync(path.join(dataDir, 'server.pid'))).toBe(false);
  });

  test('phase-01-task-01 AC4: 설정이 잘못되면 한국어 원인을 출력하고 종료 코드 3으로 끝난다', async () => {
    const dataDir = makeTmpDir('main-badcfg-');
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const run = runMain({ PORT: '포트', DATA_DIR: dataDir });
    expect(await run.exited).toBe(3);
    expect(run.output()).toContain('설정을 읽지 못했어요');
  });
});

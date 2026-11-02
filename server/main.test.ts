// 이 파일이 하는 일: 서버 진입점(main.ts)을 실제 프로세스로 띄워 확인한다 — 준비 상태 응답, PID 파일, 원내 IP 안내, stop.flag로 정상 종료,
// 포트가 이미 사용 중일 때 한국어 원인·해결 방법과 종료 코드 2(phase-01-task-01 AC2·AC3·AC4).
// AC4는 다른 프로그램이 포트를 쓰는 다섯 방식((a) [::] 이중 스택 (b) 0.0.0.0 (c) 127.0.0.1 (d) [::] IPv6 전용 — Node ipv6Only와 .NET TcpListener
// (e) ::1)을 실제로 만들어, 미리 확인(①)을 켠 경우와 끈 경우(자기 확인 ②만) 모두 충돌을 찾는지 본다. 자기 확인의 판정 규칙도 따로 확인한다.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import {
  askInstance,
  EXIT_PORT,
  isPrivateIPv4,
  judgeSelfCheck,
  lanAddresses,
  listenCovers,
  localhostAddresses,
  planListen,
  portProblemMessage,
  probeTargets,
  selfCheck,
  selfCheckTargets,
  startupMessage,
  type ProbeResult,
  type SelfCheckOutcome,
  type SelfCheckTarget,
} from './main.ts';
import { makeTmpDir } from '../tests/helpers/tmp-dir.ts';

const MAIN = path.join(process.cwd(), 'server', 'main.ts');
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

/** 운영체제가 골라 주는 빈 포트 번호를 하나 얻는다(IPv4·IPv6 양쪽에서 비었는지 이중 스택으로 확인) */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '::', () => {
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
async function waitHealth(port: number, timeoutMs = 45000): Promise<{ ok: boolean; db: string; version: string }> {
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

/** 다른 프로그램이 포트를 쓰는 방식 */
type BlockerKind = 'dual-stack ::' | '0.0.0.0' | '127.0.0.1' | 'node :: ipv6Only' | 'dotnet IPv6Any' | '::1';

/**
 * "다른 프로그램"을 흉내 내 포트를 점유한다. Node 점유는 HTTP로 "OTHER"를 답하고(표식 없음),
 * .NET 점유는 PowerShell 자식 프로세스의 TcpListener(IPv6Any, Windows 기본 IPv6 전용)로 연결만 받고 아무 답도 하지 않는다.
 */
async function startBlocker(kind: BlockerKind, port: number): Promise<void> {
  if (kind === 'dotnet IPv6Any') {
    const script = `$l=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::IPv6Any, ${port}); $l.Start(); [Console]::Out.WriteLine('READY'); [Console]::Out.Flush(); Start-Sleep -Seconds 120`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    cleanups.push(() => {
      if (ps.exitCode === null) ps.kill();
    });
    await new Promise<void>((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`PowerShell 점유가 준비되지 않음: ${out}`)), 15000);
      const onData = (d: Buffer) => {
        out += d.toString();
        if (out.includes('READY')) {
          clearTimeout(timer);
          resolve();
        }
      };
      ps.stdout.on('data', onData);
      ps.stderr.on('data', onData);
      ps.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`PowerShell 점유가 끝남(${code}): ${out}`));
      });
    });
    return;
  }
  const blocker = http.createServer((_req, res) => res.end('OTHER'));
  const opts: net.ListenOptions =
    kind === 'dual-stack ::' ? { port } : kind === 'node :: ipv6Only' ? { port, host: '::', ipv6Only: true } : { port, host: kind };
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(opts, () => resolve());
  });
  if (kind === 'dual-stack ::') expect((blocker.address() as net.AddressInfo).address).toBe('::');
  cleanups.push(() => new Promise<void>((resolve) => {
    blocker.closeAllConnections();
    blocker.close(() => resolve());
  }));
}

/** 표식을 X-Instance 헤더로 답하는 작은 서버(main.ts의 서버 대신). 열지 못하면 null */
async function startSelf(port: number, host: string, instanceId: string): Promise<http.Server | null> {
  const s = http.createServer((_req, res) => {
    res.setHeader('x-instance', instanceId);
    res.end('{"ok":true}');
  });
  const ok = await new Promise<boolean>((resolve) => {
    s.once('error', () => resolve(false));
    s.listen({ port, host }, () => resolve(true));
  });
  if (!ok) return null;
  cleanups.push(() => new Promise<void>((resolve) => {
    s.closeAllConnections();
    s.close(() => resolve());
  }));
  return s;
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

describe('① 포트를 열기 전 확인(planListen)', () => {
  test('phase-01-task-01 AC4: IPv6 전체(이중 스택·IPv6 전용)·IPv4 전체·루프백·원내 IP를 모두 확인 대상으로 삼는다', () => {
    expect(probeTargets('::', ['192.168.0.23'])).toEqual([
      { host: '::', ipv6Only: false },
      { host: '::', ipv6Only: true },
      { host: '0.0.0.0', ipv6Only: false },
      { host: '127.0.0.1', ipv6Only: false },
      { host: '::1', ipv6Only: false },
      { host: '192.168.0.23', ipv6Only: false },
    ]);
    expect(probeTargets('127.0.0.1', []).map((t) => t.host)).toEqual(['127.0.0.1', '::', '::', '0.0.0.0', '::1']);
  });

  test('phase-01-task-01 AC4: 어느 한 주소라도 사용 중이면 그 주소와 오류 코드를 충돌로 돌려준다', async () => {
    for (const t of probeTargets('::', ['192.168.0.23'])) {
      const probe = async (_p: number, h: string, v6: boolean): Promise<ProbeResult> =>
        h === t.host && v6 === t.ipv6Only ? { state: 'busy', code: 'EADDRINUSE' } : { state: 'free' };
      const label = t.ipv6Only ? '::(IPv6 전용)' : t.host;
      expect(await planListen(8090, '::', ['192.168.0.23'], probe)).toEqual({ host: '::', conflict: { host: label, code: 'EADDRINUSE' } });
    }
  });

  test('phase-01-task-01 AC4: IPv6를 쓸 수 없는 PC에서는 0.0.0.0으로 열고, 그래도 다른 주소의 충돌은 놓치지 않는다', async () => {
    const noV6 = (busy: string | null) => async (_p: number, h: string): Promise<ProbeResult> => {
      if (h.includes(':')) return { state: 'unavailable', code: 'EAFNOSUPPORT' };
      return h === busy ? { state: 'busy', code: 'EADDRINUSE' } : { state: 'free' };
    };
    expect(await planListen(8090, '::', [], noV6(null))).toEqual({ host: '0.0.0.0', conflict: null });
    expect(await planListen(8090, '::', [], noV6('127.0.0.1'))).toEqual({ host: '0.0.0.0', conflict: { host: '127.0.0.1', code: 'EADDRINUSE' } });
    // 설정으로 정한 주소는 바꾸지 않는다
    expect(await planListen(8090, '127.0.0.1', [], noV6(null))).toEqual({ host: '127.0.0.1', conflict: null });
  });

  test('phase-01-task-01 AC4: 실제 포트에서 [::]를 IPv6 전용으로 쓰는 다른 프로그램(Node ipv6Only)도 미리 찾는다', async () => {
    const port = await freePort();
    expect(await planListen(port, '::')).toEqual({ host: '::', conflict: null });
    await startBlocker('node :: ipv6Only', port);
    expect((await planListen(port, '::')).conflict).toEqual({ host: '::(IPv6 전용)', code: 'EADDRINUSE' });
  });
});

describe('② 연 뒤 자기 확인(selfCheck)', () => {
  const t = (address: string, kind: SelfCheckTarget['kind'], covered = true): SelfCheckTarget => ({ address, label: address, kind, covered });
  const self: SelfCheckOutcome = { state: 'self' };
  const none: SelfCheckOutcome = { state: 'none', detail: 'ECONNREFUSED' };
  const other: SelfCheckOutcome = { state: 'other', detail: 'HTTP 200 응답, 표식 없음' };

  test('phase-01-task-01 AC4: 판정 규칙 — 다른 표식은 어디서든 충돌, 루프백 답 없음은 충돌, 원내 IP 답 없음은 경고만', () => {
    const all = [t('::1', 'loopback'), t('127.0.0.1', 'loopback'), t('192.168.0.23', 'lan')];
    expect(judgeSelfCheck(all.map((target) => ({ target, outcome: self })))).toEqual({ conflict: null, warnings: [] });
    // 루프백에서 다른 프로그램이 답함 / 답이 없음 → 충돌
    expect(judgeSelfCheck([{ target: all[0]!, outcome: other }, { target: all[1]!, outcome: self }]).conflict).toEqual({ label: '::1', detail: other.detail });
    expect(judgeSelfCheck([{ target: all[0]!, outcome: none }]).conflict).toEqual({ label: '::1', detail: 'ECONNREFUSED' });
    // 원내 IP에서 다른 표식 → 충돌, 답 없음 → 경고만
    expect(judgeSelfCheck([{ target: all[2]!, outcome: other }]).conflict?.label).toBe('192.168.0.23');
    expect(judgeSelfCheck([{ target: all[2]!, outcome: none }])).toEqual({ conflict: null, warnings: ['192.168.0.23: ECONNREFUSED'] });
    // 이 서버가 받지 않는 루프백(0.0.0.0으로 열었을 때 ::1)의 답 없음은 경고, 다른 프로그램의 답은 충돌
    expect(judgeSelfCheck([{ target: t('::1', 'loopback', false), outcome: none }]).conflict).toBeNull();
    expect(judgeSelfCheck([{ target: t('::1', 'loopback', false), outcome: other }]).conflict?.label).toBe('::1');
  });

  test('phase-01-task-01 AC4: 확인 대상은 localhost가 가리키는 주소·127.0.0.1·[::1]·원내 IP이고, 연 주소가 받는 곳을 표시한다', async () => {
    const list = selfCheckTargets('::', ['192.168.0.23'], ['::1', '127.0.0.1']);
    expect(list).toEqual([
      { address: '::1', label: 'localhost(::1)', kind: 'loopback', covered: true },
      { address: '127.0.0.1', label: 'localhost(127.0.0.1)', kind: 'loopback', covered: true },
      { address: '192.168.0.23', label: '192.168.0.23', kind: 'lan', covered: true },
    ]);
    expect(selfCheckTargets('0.0.0.0', [], []).map((x) => [x.address, x.covered])).toEqual([['127.0.0.1', true], ['::1', false]]);
    expect(listenCovers('127.0.0.1', '::1')).toBe(false);
    // 이 PC에서 localhost는 루프백 주소로 해석된다
    for (const a of await localhostAddresses()) expect(['::1', '127.0.0.1']).toContain(a);
  });

  test('phase-01-task-01 AC4: 주소에 직접 물어 같은 표식이면 self, 다른 프로그램이면 other, 아무도 없으면 none', async () => {
    const port = await freePort();
    expect((await askInstance('127.0.0.1', port, 'abc', 1000)).state).toBe('none');
    await startSelf(port, '127.0.0.1', 'abc');
    expect(await askInstance('127.0.0.1', port, 'abc', 1000)).toEqual({ state: 'self' });
    expect((await askInstance('127.0.0.1', port, 'xyz', 1000)).state).toBe('other');
    // HTTP가 아닌 답을 하는 프로그램도 다른 프로그램으로 본다
    const port2 = await freePort();
    const socks = new Set<net.Socket>();
    const raw = net.createServer((sock) => {
      socks.add(sock);
      sock.on('error', () => {});
      sock.end('NOT HTTP\r\n\r\n');
    });
    await new Promise<void>((resolve) => raw.listen(port2, '127.0.0.1', () => resolve()));
    cleanups.push(() => new Promise<void>((resolve) => {
      for (const s of socks) s.destroy();
      raw.close(() => resolve());
    }));
    expect((await askInstance('127.0.0.1', port2, 'abc', 1000)).state).toBe('other');
  });

  // 미리 확인(①)이 놓쳤던 IPv6 전용 점유: 이 서버(이중 스택 ::)는 열리지만 localhost(::1)는 다른 프로그램으로 간다 → 자기 확인이 찾아야 한다
  test.each<BlockerKind>(['node :: ipv6Only', 'dotnet IPv6Any'])(
    'phase-01-task-01 AC4: [::] IPv6 전용 점유(%s)가 있으면 이 서버가 열려도 자기 확인이 ::1 충돌을 찾는다',
    async (kind) => {
      const port = await freePort();
      await startBlocker(kind, port);
      const s = await startSelf(port, '::', 'me');
      expect(s, '이중 스택 ::는 IPv6 전용 점유와 함께 열린다(Windows)').not.toBeNull();
      const verdict = await selfCheck(port, selfCheckTargets('::', lanAddresses(), await localhostAddresses()), 'me', 1500);
      expect(verdict.conflict?.label).toMatch(/::1/);
    },
    30000,
  );
});

describe('main.ts 실제 실행', () => {
  test('phase-01-task-01 AC2/AC3/AC4: 점유가 없으면 켜지고 localhost·[::1]·127.0.0.1·원내 IP 모두 이 서버가 답하며, stop.flag로 정상 종료한다', async () => {
    const dataDir = makeTmpDir('main-run-');
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const port = await freePort();
    const run = runMain({ PORT: String(port), DATA_DIR: dataDir, BACKUP_DIR: path.join(dataDir, 'backups') });

    const health = await waitHealth(port);
    expect(health).toMatchObject({ ok: true, db: 'ok' });
    // 안내하는 localhost(::1로 먼저 감)·127.0.0.1·원내 IP 모두 같은 서버(같은 표식)가 받아야 한다
    const marks = new Set<string | null>();
    for (const base of [`http://localhost:${port}`, `http://[::1]:${port}`, `http://127.0.0.1:${port}`, ...lanAddresses().map((ip) => `http://${ip}:${port}`)]) {
      const r = await fetch(`${base}/api/health`);
      expect(((await r.json()) as { ok: boolean }).ok, base).toBe(true);
      marks.add(r.headers.get('x-instance'));
    }
    expect(marks.size).toBe(1);
    expect([...marks][0]).toMatch(/^[0-9a-f]{32}$/);
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
  }, 90000); // PC 부하가 클 때 기동 대기(최대 45초)를 고려(04-04 보고, 2026-11-03)

  // 다른 프로그램이 포트를 쓰는 다섯 방식((d)는 Node·.NET 두 가지) × 미리 확인 켬/끔(끄면 자기 확인만으로 찾아야 한다)
  const kinds: Array<[string, BlockerKind]> = [
    ['(a) [::] 이중 스택', 'dual-stack ::'],
    ['(b) 0.0.0.0', '0.0.0.0'],
    ['(c) 127.0.0.1', '127.0.0.1'],
    ['(d) [::] IPv6 전용(Node ipv6Only)', 'node :: ipv6Only'],
    ['(d) [::] IPv6 전용(.NET TcpListener IPv6Any)', 'dotnet IPv6Any'],
    ['(e) ::1', '::1'],
  ];
  const cases = kinds.flatMap(([label, kind]) => [
    [label, '미리 확인 켬', kind, false] as const,
    [label, '자기 확인만', kind, true] as const,
  ]);
  test.each(cases)(
    'phase-01-task-01 AC4: 다른 프로그램이 %s에서 포트를 쓰면(%s) 한국어로 원인·해결 방법을 출력하고 종료 코드 2로 끝난다',
    async (_label, _mode, kind, skipPrecheck) => {
      const dataDir = makeTmpDir('main-busy-');
      cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
      const port = await freePort();
      await startBlocker(kind, port);

      const run = runMain({
        PORT: String(port),
        DATA_DIR: dataDir,
        BACKUP_DIR: path.join(dataDir, 'backups'),
        ...(skipPrecheck ? { TEST_SKIP_PORT_PRECHECK: '1' } : {}),
      });
      expect(await run.exited, run.output()).toBe(EXIT_PORT);
      expect(run.output()).toContain(`[원인] 포트 ${port}이(가) 이미 사용 중이에요`);
      expect(run.output()).toContain('[해결 방법]');
      expect(run.output()).not.toContain('서버가 켜졌어요');
      expect(fs.existsSync(path.join(dataDir, 'server.pid'))).toBe(false);
      const log = fs.readFileSync(path.join(dataDir, 'logs', 'server.log'), 'utf8');
      expect(log).toMatch(/포트 사용 중|listen 실패/);
      // 미리 확인을 끄면 (a)는 listen 단계에서, 나머지는 자기 확인이 찾아야 한다(Windows 실측)
      if (skipPrecheck && kind !== 'dual-stack ::') expect(log).toContain('포트 사용 중(자기 확인)');
    },
    30000,
  );

  test('phase-01-task-01 AC4: 설정이 잘못되면 한국어 원인을 출력하고 종료 코드 3으로 끝난다', async () => {
    const dataDir = makeTmpDir('main-badcfg-');
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const run = runMain({ PORT: '포트', DATA_DIR: dataDir });
    expect(await run.exited).toBe(3);
    expect(run.output()).toContain('설정을 읽지 못했어요');
  });
});

// 이 파일이 하는 일: 마이그레이션이 번호 순서대로 한 번씩만 적용되는지 확인한다. 빈 폴더에서 서버(main.ts)를 실제로 두 번 켜서
// 첫 시작에 app.db가 생기고 schema_version이 최신이 되며, 두 번째 시작에는 다시 적용되지 않는지 본다(phase-01-task-02 AC1).
// 번호 겹침·이름 규칙·실패 시 되돌림·새 버전 DB 보호도 함께 확인한다.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import { appDbPath, openDb } from './index.ts';
import { currentVersion, latestVersion, listMigrations, migrate, openAppDb } from './migrate.ts';
import { fixedClock } from '../lib/clock.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';

const MAIN = path.join(process.cwd(), 'server', 'main.ts');
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function newTmp(prefix = 'dentalax-migrate-'): string {
  const tmp = makeTmpDir(prefix);
  cleanups.unshift(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
}

/** 운영체제가 골라 주는 빈 포트 번호 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

/**
 * main.ts를 자식 프로세스로 켜서 health가 ok가 되면 stop.flag로 끄고, 출력·종료 코드·health 응답을 돌려준다.
 * 빈 포트를 고른 뒤 자식이 그 포트를 열기 전에 다른 프로세스(병렬 테스트 등)가 먼저 잡으면 자식은 포트 문제(종료 코드 2)로 끝난다.
 * 이것은 시험 환경의 경쟁이라 새 포트로 최대 3번 다시 켠다(제품 판정 기준은 바꾸지 않음, 2026-11-02 조정자 — 03-09 보고의 간헐 실패).
 */
async function startAndStop(dataDir: string): Promise<{ code: number | null; output: string; health: { ok: boolean; db: string } }> {
  let last: Error | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await startAndStopOnce(dataDir);
    } catch (e) {
      last = e as Error;
      if (!(e instanceof PortRaceError)) throw e;
    }
  }
  throw last;
}

/** 자식이 포트 문제(종료 코드 2)로 끝났다는 표시 */
class PortRaceError extends Error {}

async function startAndStopOnce(dataDir: string): Promise<{ code: number | null; output: string; health: { ok: boolean; db: string } }> {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, BACKUP_DIR: path.join(dataDir, 'backups'), NO_BROWSER: '1', OPEN_BROWSER: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanups.push(() => {
    if (child.exitCode === null) child.kill();
  });
  let output = '';
  child.stdout?.on('data', (d: Buffer) => (output += d.toString('utf8')));
  child.stderr?.on('data', (d: Buffer) => (output += d.toString('utf8')));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (c) => resolve(c)));

  let health: { ok: boolean; db: string } | undefined;
  // 준비 대기는 45초(병렬 검증으로 CPU 부하가 높을 때 15초로는 모자랐다 — 04-06 검증 관찰, 2026-11-03). 기능 판정 기준은 그대로다.
  const until = Date.now() + 45000;
  while (!health && Date.now() < until && child.exitCode === null) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) health = (await r.json()) as { ok: boolean; db: string };
    } catch {
      await new Promise((res) => setTimeout(res, 200));
    }
  }
  if (!health && child.exitCode === 2) throw new PortRaceError(`포트 ${port}를 다른 프로세스가 먼저 잡음:
${output}`);
  if (!health) throw new Error(`서버가 준비되지 않음:\n${output}`);
  fs.writeFileSync(path.join(dataDir, 'stop.flag'), '');
  const code = await exited;
  return { code, output, health };
}

describe('서버 시작과 마이그레이션', () => {
  test('phase-01-task-02 AC1: 빈 폴더에서 서버를 켜면 app.db가 생기고 schema_version이 최신, 두 번째 시작에서는 다시 적용하지 않는다', async () => {
    const dataDir = path.join(newTmp(), 'data');
    expect(fs.existsSync(dataDir)).toBe(false);
    const latest = latestVersion();
    expect(latest).toBeGreaterThanOrEqual(1);

    const first = await startAndStop(dataDir);
    expect(first.code).toBe(0);
    expect(first.health).toMatchObject({ ok: true, db: 'ok' });
    expect(fs.existsSync(appDbPath(dataDir))).toBe(true);
    expect(first.output).toContain('데이터 구조를 준비했어요');

    const read = () => {
      const db = openDb(appDbPath(dataDir));
      try {
        return db.all<{ version: number; name: string; applied_at: string }>('SELECT version, name, applied_at FROM schema_version ORDER BY version');
      } finally {
        db.close();
      }
    };
    const afterFirst = read();
    expect(afterFirst.map((r) => r.version)).toEqual(listMigrations().map((f) => f.version));
    expect(afterFirst.at(-1)?.version).toBe(latest);
    expect(afterFirst[0]?.name).toBe('001_core.sql');

    const second = await startAndStop(dataDir);
    expect(second.code).toBe(0);
    expect(second.health).toMatchObject({ ok: true, db: 'ok' });
    expect(second.output).not.toContain('데이터 구조를 준비했어요');
    // 같은 줄 수, 같은 적용 시각 → 다시 적용되지 않았다
    expect(read()).toEqual(afterFirst);

    const log = fs.readFileSync(path.join(dataDir, 'logs', 'server.log'), 'utf8');
    expect(log).toContain('새로 적용: 001_core.sql');
    expect(log).toContain(`schema_version=${latest} (새로 적용한 것 없음)`);
  }, 150000); // 서버를 두 번 켜므로 준비 대기(최대 45초×2)와 포트 경쟁 재시도를 고려한다
});

describe('migrate()', () => {
  test('phase-01-task-02 AC1: 두 번째 migrate는 아무것도 적용하지 않고 버전이 그대로다', () => {
    const tmp = newTmp();
    const clock = fixedClock('2026-11-02T09:00:00+09:00');
    const first = openAppDb(tmp, { clock });
    expect(first.migration.applied).toEqual(listMigrations().map((f) => f.name));
    expect(first.migration.version).toBe(latestVersion());
    expect(first.db.get('SELECT applied_at FROM schema_version WHERE version = 1')).toEqual({ applied_at: '2026-11-02T00:00:00.000Z' });
    first.db.close();

    const second = openAppDb(tmp, { clock });
    expect(second.migration).toEqual({ applied: [], version: latestVersion() });
    second.db.close();
  });

  test('phase-01-task-02 AC1: 새 번호 파일이 생기면 그 파일만 적용한다', () => {
    const tmp = newTmp();
    const dir = path.join(tmp, 'mig');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
    const db = openDb(path.join(tmp, 'x.db'));
    cleanups.push(() => db.close());
    expect(migrate(db, { dir })).toEqual({ applied: ['001_a.sql'], version: 1 });
    fs.writeFileSync(path.join(dir, '002_b.sql'), 'CREATE TABLE b (id INTEGER PRIMARY KEY);');
    expect(migrate(db, { dir })).toEqual({ applied: ['002_b.sql'], version: 2 });
    expect(migrate(db, { dir })).toEqual({ applied: [], version: 2 });
  });

  test('phase-01-task-02 AC1: 중간에 실패한 파일은 통째로 되돌려지고 번호도 남지 않는다', () => {
    const tmp = newTmp();
    const dir = path.join(tmp, 'mig');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
    fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE b (id INTEGER PRIMARY KEY);\nTHIS IS NOT SQL;');
    const db = openDb(path.join(tmp, 'x.db'));
    cleanups.push(() => db.close());
    expect(() => migrate(db, { dir })).toThrow('데이터 구조 업데이트(002_bad.sql)를 적용하지 못했어요');
    expect(currentVersion(db)).toBe(1);
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 'b'")).toBeUndefined();
  });

  test('phase-01-task-02 AC1: 번호가 겹치거나 이름 규칙이 틀리면 한국어 오류', () => {
    const tmp = newTmp();
    const dup = path.join(tmp, 'dup');
    fs.mkdirSync(dup);
    fs.writeFileSync(path.join(dup, '001_a.sql'), '');
    fs.writeFileSync(path.join(dup, '001_b.sql'), '');
    expect(() => listMigrations(dup)).toThrow('겹쳐요');
    const bad = path.join(tmp, 'bad');
    fs.mkdirSync(bad);
    fs.writeFileSync(path.join(bad, '1_core.sql'), '');
    expect(() => listMigrations(bad)).toThrow('규칙과 달라요');
  });

  test('phase-01-task-02 AC1: DB가 프로그램보다 새 버전이면 적용하지 않고 멈춘다', () => {
    const tmp = newTmp();
    const { db } = openAppDb(tmp);
    cleanups.push(() => db.close());
    db.run("INSERT INTO schema_version (version, name, applied_at) VALUES (998, '998_future.sql', '2027-01-01T00:00:00Z')");
    expect(() => migrate(db)).toThrow('새 버전(998)');
  });

  test('phase-01-task-02 AC1: 실제 마이그레이션 파일은 core 예약 범위(001~009)에 001_core.sql이 있다', () => {
    const files = listMigrations();
    expect(files[0]).toMatchObject({ version: 1, name: '001_core.sql' });
  });
});

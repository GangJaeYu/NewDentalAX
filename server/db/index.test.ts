// 이 파일이 하는 일: DB 래퍼(server/db/index.ts)를 확인한다 — WAL·외래키 설정, 매개변수 바인딩(인젝션 문자열이 값으로만 저장됨),
// 트랜잭션 되돌림·중첩, 닫은 뒤 점검 실패. 그리고 /api/health가 실제 app.db를 점검하는지 확인한다(phase-01-task-02 AC1, TD-003).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { appDbPath, openDb, pingDb } from './index.ts';
import { openAppDb } from './migrate.ts';
import { buildApp } from '../app.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});
function newTmp(): string {
  const tmp = makeTmpDir('dentalax-db-');
  cleanups.unshift(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
}

describe('DB 래퍼', () => {
  test('phase-01-task-02 AC1: 파일 DB는 폴더까지 만들어 WAL 모드·외래키 켜짐으로 열린다', () => {
    const file = path.join(newTmp(), 'nested', 'app.db');
    const db = openDb(file);
    cleanups.push(() => db.close());
    expect(fs.existsSync(file)).toBe(true);
    expect(db.get('PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' });
    expect(db.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  test('phase-01-task-02 AC1: all/get/run은 배열·이름 매개변수를 바인딩하고, 인젝션 문자열은 값으로만 저장된다', () => {
    const db = openDb(':memory:');
    cleanups.push(() => db.close());
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, flag INTEGER)');
    const evil = "x'); DROP TABLE t; --";
    const r = db.run('INSERT INTO t (name, flag) VALUES (?, ?)', [evil, true]);
    expect(r).toEqual({ changes: 1, lastInsertRowid: 1 });
    db.run('INSERT INTO t (name, flag) VALUES (:name, :flag)', { name: '둘', flag: false });
    expect(db.get('SELECT name, flag FROM t WHERE id = ?', [1])).toEqual({ name: evil, flag: 1 });
    expect(db.all('SELECT name FROM t WHERE flag = $f', { f: 0 })).toEqual([{ name: '둘' }]);
    expect(db.get('SELECT * FROM t WHERE id = ?', [99])).toBeUndefined();
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM t')?.n).toBe(2);
  });

  test('phase-01-task-02 AC1: tx 안에서 오류가 나면 모두 되돌리고, 중첩 tx는 안쪽만 되돌릴 수 있다', () => {
    const db = openDb(path.join(newTmp(), 'x.db'));
    cleanups.push(() => db.close());
    db.exec('CREATE TABLE t (v INTEGER NOT NULL)');
    expect(() =>
      db.tx(() => {
        db.run('INSERT INTO t VALUES (1)');
        db.run('INSERT INTO t VALUES (NULL)');
      }),
    ).toThrow();
    expect(db.all('SELECT v FROM t')).toEqual([]);
    expect(db.inTransaction).toBe(false);

    const out = db.tx(() => {
      db.run('INSERT INTO t VALUES (1)');
      try {
        db.tx(() => {
          db.run('INSERT INTO t VALUES (2)');
          throw new Error('안쪽 실패');
        });
      } catch {
        // 안쪽만 되돌리고 바깥은 계속한다
      }
      db.run('INSERT INTO t VALUES (3)');
      return 'done';
    });
    expect(out).toBe('done');
    expect(db.all<{ v: number }>('SELECT v FROM t ORDER BY v').map((r) => r.v)).toEqual([1, 3]);
  });

  test('phase-01-task-02 AC1: tx에 async 함수를 넣으면 되돌리고 한국어 오류를 낸다', () => {
    const db = openDb(':memory:');
    cleanups.push(() => db.close());
    db.exec('CREATE TABLE t (v INTEGER)');
    expect(() => db.tx(() => {
      db.run('INSERT INTO t VALUES (1)');
      return Promise.resolve();
    })).toThrow('await를 쓸 수 없어요');
    expect(db.all('SELECT v FROM t')).toEqual([]);
  });

  test('phase-01-task-02 AC1: 외래키가 실제로 막는다', () => {
    const { db } = openAppDb(newTmp());
    cleanups.push(() => db.close());
    expect(() =>
      db.run("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at) VALUES ('h', 999, 'c', 'a', 'a', 'a')"),
    ).toThrow(/FOREIGN KEY/);
  });

  test('phase-01-task-02 AC1: pingDb는 열린 DB면 true, 닫으면 false(두 번 닫아도 괜찮다)', () => {
    const db = openDb(':memory:');
    expect(pingDb(db)).toBe(true);
    db.close();
    db.close();
    expect(db.isOpen).toBe(false);
    expect(pingDb(db)).toBe(false);
  });
});

describe('/api/health의 실제 DB 점검', () => {
  test('phase-01-task-02 AC1: buildApp이 dataDir/app.db를 만들고 마이그레이션해 health가 db:"ok", 닫으면 DB도 닫힌다', async () => {
    const dataDir = path.join(newTmp(), 'data');
    const app = await buildApp({ dataDir, webDist: path.join(dataDir, 'no-web') });
    expect(fs.existsSync(appDbPath(dataDir))).toBe(true);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, db: 'ok' });
    expect(app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'audit_log'")?.n).toBe(1);
    await app.close();
    expect(app.db.isOpen).toBe(false);
  });

  test('phase-01-task-02 AC1: 넣어 준 DB가 닫히거나 스키마가 최신이 아니면 health가 503 db:"error"', async () => {
    const tmp = newTmp();
    const { db } = openAppDb(tmp);
    const app = await buildApp({ dataDir: tmp, db, webDist: path.join(tmp, 'no-web') });
    cleanups.push(() => void app.close());
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ ok: true, db: 'ok' });

    // 스키마 번호를 지운 경우(최신 아님)
    db.exec('DELETE FROM schema_version');
    const behind = await app.inject({ method: 'GET', url: '/api/health' });
    expect(behind.statusCode).toBe(503);
    expect(behind.json()).toMatchObject({ ok: false, db: 'error' });

    // DB를 닫은 경우
    db.close();
    const closed = await app.inject({ method: 'GET', url: '/api/health' });
    expect(closed.statusCode).toBe(503);
    expect(closed.json()).toMatchObject({ ok: false, db: 'error' });
  });
});

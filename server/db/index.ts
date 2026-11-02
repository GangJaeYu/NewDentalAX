// 이 파일이 하는 일: 모든 DB 접근이 지나가는 단 하나의 래퍼(TD-003). Node 내장 SQLite(node:sqlite)로
// data/app.db를 WAL 모드·외래키 켜짐으로 열고, open/close/tx/all/get/run/exec만 밖에 내놓는다.
// SQL은 항상 매개변수 바인딩으로 실행한다(NFR-002 AC3). node:sqlite API가 바뀌면 이 파일만 고치면 된다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

/** SQL에 넣는 값 하나. boolean은 1/0으로, undefined는 NULL로 바꿔 넣는다 */
export type SqlValue = SQLInputValue | boolean | undefined;
/** SQL에 넣는 값: 순서대로(?) 넣는 배열이나, 이름(:name, @name, $name)으로 넣는 객체 */
export type SqlParams = readonly SqlValue[] | Readonly<Record<string, SqlValue>>;
/** 조회 결과 한 줄 */
export type Row = Record<string, SQLInputValue>;

/** run()의 결과: 바뀐 줄 수와 마지막으로 넣은 줄의 id */
export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/** DB 래퍼. 서비스 코드는 이 인터페이스만 쓴다 */
export interface Db {
  /** 연 파일 경로(메모리 DB면 ':memory:') */
  readonly file: string;
  /** 여러 줄 조회 */
  all<T = Row>(sql: string, params?: SqlParams): T[];
  /** 한 줄 조회(없으면 undefined) */
  get<T = Row>(sql: string, params?: SqlParams): T | undefined;
  /** 넣기·고치기·지우기 */
  run(sql: string, params?: SqlParams): RunResult;
  /** 매개변수 없는 SQL 여러 문장을 그대로 실행(마이그레이션 파일 전용) */
  exec(sql: string): void;
  /**
   * 함수 안의 작업을 한 트랜잭션으로 묶는다. 오류가 나면 모두 되돌린다.
   * 안에서 다시 tx를 부르면 SAVEPOINT로 처리한다. 함수는 동기여야 한다(await 금지).
   */
  tx<T>(fn: () => T): T;
  /** 트랜잭션 안인지 */
  readonly inTransaction: boolean;
  /** 열려 있는지 */
  readonly isOpen: boolean;
  /** 닫는다(두 번 불러도 괜찮다) */
  close(): void;
}

/** DB를 열 때 고를 수 있는 값 */
export interface OpenOptions {
  /** 기다릴 최대 시간(ms). 다른 연결이 쓰는 중이면 이만큼 기다린다(기본 5000) */
  busyTimeoutMs?: number;
}

/** 데이터 폴더 안 DB 파일 경로 */
export function appDbPath(dataDir: string): string {
  return path.join(dataDir, 'app.db');
}

/** 값을 node:sqlite에 넘길 수 있게 바꾼다(boolean → 0/1, undefined → NULL) */
function normalize(v: unknown): SQLInputValue {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SQLInputValue;
}

function bind(stmt: StatementSync, params: SqlParams | undefined, method: 'all' | 'get' | 'run'): unknown {
  if (params === undefined) return stmt[method]();
  if (Array.isArray(params)) return stmt[method](...params.map(normalize));
  const named: Record<string, SQLInputValue> = {};
  for (const [k, v] of Object.entries(params)) named[k] = normalize(v);
  return stmt[method](named);
}

/**
 * DB 파일을 연다. 파일이 없으면 폴더와 함께 새로 만든다.
 * file에 ':memory:'를 넣으면 메모리 DB(테스트용)를 연다.
 */
export function openDb(file: string, opts: OpenOptions = {}): Db {
  const memory = file === ':memory:';
  if (!memory) fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(opts.busyTimeoutMs ?? 5000))}`);
  if (!memory) raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA synchronous = NORMAL');

  // 같은 SQL은 한 번만 준비해 다시 쓴다(속도)
  const cache = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    let s = cache.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };

  let depth = 0;
  let open = true;

  const db: Db = {
    file,
    all<T>(sql: string, params?: SqlParams): T[] {
      return bind(prepare(sql), params, 'all') as T[];
    },
    get<T>(sql: string, params?: SqlParams): T | undefined {
      return bind(prepare(sql), params, 'get') as T | undefined;
    },
    run(sql: string, params?: SqlParams): RunResult {
      const r = bind(prepare(sql), params, 'run') as { changes: number | bigint; lastInsertRowid: number | bigint };
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    exec(sql: string): void {
      raw.exec(sql);
    },
    tx<T>(fn: () => T): T {
      const name = `sp${depth}`;
      raw.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
      depth++;
      try {
        const out = fn();
        if (out instanceof Promise) throw new Error('db.tx 안에서는 await를 쓸 수 없어요(동기 함수만 넣어 주세요).');
        depth--;
        raw.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
        return out;
      } catch (e) {
        depth--;
        if (depth === 0) {
          if (raw.isTransaction) raw.exec('ROLLBACK');
        } else {
          raw.exec(`ROLLBACK TO ${name}`);
          raw.exec(`RELEASE ${name}`);
        }
        throw e;
      }
    },
    get inTransaction() {
      return raw.isTransaction;
    },
    get isOpen() {
      return open;
    },
    close(): void {
      if (!open) return;
      open = false;
      cache.clear();
      raw.close();
    },
  };
  return db;
}

/**
 * DB가 응답하는지 확인한다(준비 상태 확인 /api/health용). 닫혔거나 오류가 나면 false.
 */
export function pingDb(db: Db): boolean {
  try {
    return db.isOpen && db.get<{ v: number }>('SELECT 1 AS v')?.v === 1;
  } catch {
    return false;
  }
}

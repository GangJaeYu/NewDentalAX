// 이 파일이 하는 일: 백업 복원 때 서버를 끄지 않고 DB 연결을 바꿔 끼울 수 있게 해 주는 "바꿔 끼우는 DB" 래퍼를 만든다(TD-014 복원 3~5단계).
// 서버 전체(app.db)는 이 래퍼를 쓰고, 래퍼는 안쪽의 실제 연결(server/db/index.ts의 Db)에 모든 일을 넘긴다.
// 복원은 안쪽 연결을 닫고 → 파일을 바꾸고 → 새로 연 연결을 swap()으로 넣는다. 모듈 코드는 바뀐 줄 모르고 계속 app.db를 쓰면 된다.
import type { Db, Row, RunResult, SqlParams } from '../../db/index.ts';

/** 안쪽 연결을 바꿔 끼울 수 있는 DB */
export interface SwappableDb extends Db {
  /** 지금 쓰는 실제 연결 */
  readonly current: Db;
  /** 한 번이라도 바꿔 끼웠는지(처음 받은 연결이 아닌지) */
  readonly swapped: boolean;
  /** 새 연결로 바꾼다. 옛 연결은 닫지 않으니 부른 쪽이 먼저 닫는다. 옛 연결을 돌려준다 */
  swap(next: Db): Db;
}

/** 이미 바꿔 끼우는 DB인지 */
export function isSwappableDb(db: Db): db is SwappableDb {
  return typeof (db as Partial<SwappableDb>).swap === 'function' && 'current' in db;
}

/**
 * 처음 연결을 받아 바꿔 끼우는 DB를 만든다. 이미 바꿔 끼우는 DB면 그대로 돌려준다.
 * close()는 지금 쓰는 연결을 닫는다(서버를 끌 때).
 */
export function makeSwappableDb(initial: Db): SwappableDb {
  if (isSwappableDb(initial)) return initial;
  let inner = initial;
  let swapped = false;
  const db: SwappableDb = {
    get file() {
      return inner.file;
    },
    all<T = Row>(sql: string, params?: SqlParams): T[] {
      return inner.all<T>(sql, params);
    },
    get<T = Row>(sql: string, params?: SqlParams): T | undefined {
      return inner.get<T>(sql, params);
    },
    run(sql: string, params?: SqlParams): RunResult {
      return inner.run(sql, params);
    },
    exec(sql: string): void {
      inner.exec(sql);
    },
    tx<T>(fn: () => T): T {
      return inner.tx(fn);
    },
    get inTransaction() {
      return inner.inTransaction;
    },
    get isOpen() {
      return inner.isOpen;
    },
    close(): void {
      inner.close();
    },
    get current() {
      return inner;
    },
    get swapped() {
      return swapped;
    },
    swap(next: Db): Db {
      const old = inner;
      inner = next;
      swapped = true;
      return old;
    },
  };
  return db;
}

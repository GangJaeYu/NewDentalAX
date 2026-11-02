// 이 파일이 하는 일: 모듈별 데모 데이터(seed) 파일이 지켜야 할 모양을 정한다.
// 각 모듈의 server/modules/<모듈>/seed.ts는 tables(그 모듈이 쓰는 테이블 이름)와 seedDemo(db, ctx)를 export한다.
// registry.ts와 모듈 seed 파일이 서로 import하며 꼬이지 않도록 타입만 따로 둔다.
import type { Db } from '../index.ts';
import type { Clock } from '../../lib/clock.ts';

/** seedDemo에 넘기는 값 */
export interface SeedContext {
  /** 기준 시각(테스트·E2E는 고정 시계) */
  clock: Clock;
  /** 데이터 양 배율. 1 = 기본 데모, 10 = 성능 측정용(NFR-005) */
  scale: number;
}

/** 모듈 seed 파일의 모양 */
export interface ModuleSeed {
  /** 이 모듈이 소유한 업무 테이블(초기화 때 비울 대상을 정하는 데 쓴다) */
  readonly tables: readonly string[];
  /** 데모 데이터를 넣는다. 사용자 계정은 admin 모듈이 먼저 넣는다 */
  seedDemo(db: Db, ctx: SeedContext): void | Promise<void>;
}

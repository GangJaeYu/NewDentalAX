// 이 파일이 하는 일: marketing 모듈(홍보·리뷰 답글·광고 점검)의 데모 데이터 자리. 아직 비어 있고, 이 모듈을 맡은 태스크가 채운다.
// 모양은 server/db/seed/types.ts의 ModuleSeed다: tables(이 모듈이 소유한 테이블)와 seedDemo(db, ctx)를 export한다.
// 등록은 server/db/seed/registry.ts가 이미 해 두었으니, 이 파일만 고치면 된다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';

/** 이 모듈이 소유한 업무 테이블(아직 없음) */
export const tables: readonly string[] = [];

/** 데모 데이터를 넣는다(아직 넣을 것이 없음) */
export function seedDemo(_db: Db, _ctx: SeedContext): void {}

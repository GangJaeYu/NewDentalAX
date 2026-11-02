// 이 파일이 하는 일: marketing 모듈(홍보·광고 점검)의 데모 데이터(database.md §11). 광고 점검 기본 규칙 사전이 모두 있는지 확인한다.
// 규칙 사전(ad_rules)은 업무 데이터가 아니라 데모 초기화 뒤에도 남는 표라서(demo-service KEEP_TABLES) tables에 넣지 않는다.
// 홍보 글 보관(saved_texts, kind=promo)은 phase-03-task-05의 보관함 표를 쓴다. 모양은 server/db/seed/types.ts의 ModuleSeed다. 환자 정보는 없다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { ensureAdRules } from '../../db/seed/ad-rules.ts';

/** 이 모듈이 소유한 업무 테이블(초기화 때 비울 것). 규칙 사전은 남기므로 없다 */
export const tables: readonly string[] = [];

/** 데모 데이터: 기본 규칙 사전을 채운다(이미 있으면 그대로 둔다) */
export function seedDemo(db: Db, ctx: SeedContext): void {
  ensureAdRules(db, ctx.clock);
}

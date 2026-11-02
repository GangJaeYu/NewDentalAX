// 이 파일이 하는 일: 모든 모듈의 데모 데이터(seed) 파일을 한곳에 등록하고, 등록 순서대로 seedDemo를 불러 데모 데이터를 넣는다.
// 등록 목록은 phase-01-task-02가 전 모듈을 미리 적어 두었다(plan_setup/PLAN.md §3). 모듈 태스크는 이 파일을 고치지 않고
// 자기 server/modules/<모듈>/seed.ts만 채운다. 순서: 직원 계정(admin)이 먼저, 그 계정을 쓰는 업무 모듈이 뒤.
import type { Db } from '../index.ts';
import type { ModuleSeed, SeedContext } from './types.ts';
import * as admin from '../../modules/admin/seed.ts';
import * as notifications from '../../modules/notifications/seed.ts';
import * as desk from '../../modules/desk/seed.ts';
import * as inventory from '../../modules/inventory/seed.ts';
import * as docs from '../../modules/docs/seed.ts';
import * as assistant from '../../modules/assistant/seed.ts';
import * as hr from '../../modules/hr/seed.ts';
import * as facility from '../../modules/facility/seed.ts';
import * as finance from '../../modules/finance/seed.ts';
import * as marketing from '../../modules/marketing/seed.ts';
import * as ai from '../../modules/ai/seed.ts';

export type { ModuleSeed, SeedContext } from './types.ts';

/** 등록된 모듈 이름(backend.md §3, PLAN.md §3) — 이 순서대로 seed를 넣는다 */
export const SEED_MODULES = ['admin', 'notifications', 'desk', 'inventory', 'docs', 'assistant', 'hr', 'facility', 'finance', 'marketing', 'ai'] as const;
export type SeedModuleName = (typeof SEED_MODULES)[number];

/** 모듈 이름 → seed 파일 */
export const SEED_REGISTRY: Readonly<Record<SeedModuleName, ModuleSeed>> = {
  admin,
  notifications,
  desk,
  inventory,
  docs,
  assistant,
  hr,
  facility,
  finance,
  marketing,
  ai,
};

/** 모든 모듈이 소유한 업무 테이블 이름(겹침 없이, 등록 순서대로) */
export function seedTables(): string[] {
  const out: string[] = [];
  for (const name of SEED_MODULES) for (const t of SEED_REGISTRY[name].tables) if (!out.includes(t)) out.push(t);
  return out;
}

/**
 * 등록된 모든 모듈의 데모 데이터를 순서대로 넣는다. 넣은 모듈 이름을 돌려준다.
 * 한 모듈에서 오류가 나면 어느 모듈인지 알려 주는 한국어 오류로 멈춘다.
 */
export async function seedDemoAll(db: Db, ctx: SeedContext): Promise<SeedModuleName[]> {
  const done: SeedModuleName[] = [];
  for (const name of SEED_MODULES) {
    try {
      await SEED_REGISTRY[name].seedDemo(db, ctx);
    } catch (e) {
      throw new Error(`데모 데이터를 넣다가 "${name}" 모듈에서 멈췄어요: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    done.push(name);
  }
  return done;
}

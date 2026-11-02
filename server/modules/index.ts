// 이 파일이 하는 일: 업무 모듈(backend.md §3) 11개의 API 플러그인(routes.ts)을 한곳에 등록한다.
// 모듈 이름과 순서는 seed 등록표(server/db/seed/registry.ts)와 같다. 각 모듈은 '/api' 앞붙임으로 등록된다.
// 모듈 태스크는 이 파일을 고치지 않고 자기 server/modules/<모듈>/routes.ts만 채운다(plan_setup/PLAN.md §3).
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import admin from './admin/routes.ts';
import notifications from './notifications/routes.ts';
import desk from './desk/routes.ts';
import inventory from './inventory/routes.ts';
import docs from './docs/routes.ts';
import assistant from './assistant/routes.ts';
import hr from './hr/routes.ts';
import facility from './facility/routes.ts';
import finance from './finance/routes.ts';
import marketing from './marketing/routes.ts';
import ai from './ai/routes.ts';

/** 등록할 모듈 이름(seed 등록표와 같은 순서) */
export const MODULES = ['admin', 'notifications', 'desk', 'inventory', 'docs', 'assistant', 'hr', 'facility', 'finance', 'marketing', 'ai'] as const;
export type ModuleName = (typeof MODULES)[number];

/** 모듈 이름 → API 플러그인 */
export const MODULE_ROUTES: Readonly<Record<ModuleName, FastifyPluginAsync>> = {
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

/** 모든 모듈 API를 '/api' 아래에 등록한다 */
export async function registerModules(app: FastifyInstance): Promise<void> {
  for (const name of MODULES) {
    await app.register(MODULE_ROUTES[name], { prefix: '/api' });
  }
}

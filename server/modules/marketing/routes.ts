// 이 파일이 하는 일: marketing 모듈 API(backend.md §3.10 adcheck·ad-rules, FR-120)를 등록한다. 경로는 '/api'가 붙은 채로 등록된다.
// - POST /adcheck {text, useAi} → {text, ruleHits[{start,end,phrase,severity,reason,suggestion}], ai?, aiError?, notice} (모든 로그인 사용자, cap:ai.adcheck)
// - GET /ad-rules → 규칙 사전(모든 로그인 사용자) / PUT /ad-rules {rules[]} → 사전 바꾸기(admin, cap:adrules.edit)
// - POST /hiring/check {text} → {text, hits[]} 채용 공고 차별 소지 표현 점검(cap:ai.hiring, AI는 쓰지 않음, phase-04-task-07). 글은 저장하지 않는다
// 주소별 권한은 server/auth/api-permissions.ts 표(API_RULES)와 server/auth/guard.ts가 먼저 확인한다. 서버가 켜질 때 빠진 기본 규칙(server/db/seed/ad-rules.ts)을 넣는다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ensureAdRules } from '../../db/seed/ad-rules.ts';
import { auditCtx, currentUser, requireCap } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { baseUrlsFromEnv, type AiOptions } from '../../ai/types.ts';
import type { AiCallContext } from '../../ai/gateway.ts';
import { adcheckSchema, listAdRules, putAdRulesSchema, replaceAdRules, runAdcheck } from './service.ts';
import { hiringCheckSchema, runHiringCheck } from './hiring-rules.ts';

/** 이 서버의 AI 실행 옵션(테스트가 buildApp에 넣은 값, 없으면 환경 변수 AI_BASE_URL_*) */
function aiOptions(app: FastifyInstance): AiOptions {
  return app.aiOptions ?? { baseUrls: baseUrlsFromEnv() };
}

/** 게이트웨이에 넘길 맥락 */
function callCtx(app: FastifyInstance, req: FastifyRequest): AiCallContext {
  return { db: app.db, clock: app.clock, dataDir: app.dataDir, options: aiOptions(app), user: currentUser(req) };
}

/** marketing 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  // DB 없이 등록만 시험하는 경우(server/modules/index.test.ts)는 건너뛴다
  if (app.hasDecorator('db') && app.hasDecorator('clock')) ensureAdRules(app.db, app.clock);

  // 광고 문구 점검(1차 규칙 + 2차 AI)
  app.post('/adcheck', async (req) => {
    const body = parseInput(adcheckSchema, req.body);
    return { data: await runAdcheck(callCtx(app, req), body) };
  });

  // 규칙 사전 보기
  app.get('/ad-rules', async () => ({ data: listAdRules(app.db) }));

  // 규칙 사전 바꾸기(admin)
  app.put('/ad-rules', async (req) => {
    const body = parseInput(putAdRulesSchema, req.body);
    return { data: replaceAdRules(app.db, app.clock, auditCtx(req, app), body) };
  });

  // 채용 공고 차별 소지 표현 점검(규칙 사전만, AI 비용 없음)
  app.post('/hiring/check', { preHandler: requireCap('ai.hiring') }, async (req) => {
    const body = parseInput(hiringCheckSchema, req.body);
    return { data: runHiringCheck(body.text) };
  });
}

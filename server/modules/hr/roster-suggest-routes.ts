// 이 파일이 하는 일: AI 근무표 배정 제안 API(FR-131, phase-06-task-02)를 등록한다. 처리 내용은 roster-suggest.ts에 있다. 경로는 '/api'가 붙은 채로 등록된다.
// - POST /roster/suggest {weekStart, minStaff, minByJob} → 미리보기(근무표는 바뀌지 않음). 실장 이상(roster.edit)이고, 게이트웨이가 AI 기능 켜짐·역할·예산을 다시 확인한다.
// - POST /roster/apply {weekStart, cells} → 그 주 근무표를 미리보기 칸으로 바꾼다. 실장 이상(기존 근무표 편집 권한과 같음). 감사 기록에 남긴다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit } from '../../lib/audit.ts';
import { auditCtx, currentUser, requireCap } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { baseUrlsFromEnv } from '../../ai/types.ts';
import type { AiCallContext } from '../../ai/gateway.ts';
import { rosterApplySchema, rosterSuggestSchema } from '../../../shared/schemas/roster-suggest.ts';
import { applyRoster, suggestRoster } from './roster-suggest.ts';

/** 게이트웨이에 넘길 맥락(테스트가 넣은 AI 옵션, 없으면 환경 변수 AI_BASE_URL_*) */
function callCtx(app: FastifyInstance, req: FastifyRequest): AiCallContext {
  return { db: app.db, clock: app.clock, dataDir: app.dataDir, options: app.aiOptions ?? { baseUrls: baseUrlsFromEnv() }, user: currentUser(req) };
}

/** AI 근무표 제안·적용 API를 등록한다 */
export function registerRosterSuggestRoutes(app: FastifyInstance): void {
  const edit = { preHandler: requireCap('roster.edit') };

  app.post('/roster/suggest', edit, async (req) => {
    const input = parseInput(rosterSuggestSchema, req.body);
    return { data: await suggestRoster(callCtx(app, req), input) };
  });

  app.post('/roster/apply', edit, async (req) => {
    const input = parseInput(rosterApplySchema, req.body);
    const result = applyRoster(app.db, input);
    audit(auditCtx(req), 'roster.ai_apply', 'roster', input.weekStart, { weekStart: input.weekStart, saved: result.saved, replaced: result.replaced, skipped: result.skipped });
    return { data: result };
  });
}

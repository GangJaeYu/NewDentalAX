// 이 파일이 하는 일: ai 모듈 API(backend.md §3.10). AI 실행(POST /ai/run), 스트림(POST /ai/stream, SSE), 내 AI 상태(GET /ai/status),
// 관리자용 설정(GET/PUT /ai/settings), 연결 확인(POST /ai/test), 모델·단가 표(GET/PUT /ai/models), 사용량(GET /ai/usage)을 둔다.
// 주소별 관리자 권한은 server/auth/api-permissions.ts 표가 먼저 막는다. 실행 API는 기능마다 권한이 달라 게이트웨이(server/ai/gateway.ts)가 확인한다.
// 키 원문은 어떤 응답에도 넣지 않는다(끝 4자리 가림만, FR-031). 설정·모델 변경과 연결 확인은 감사 로그에 남긴다(키 값은 넣지 않음).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.ts';
import { AppError, toErrorResponse } from '../../lib/errors.ts';
import { thisMonthKst } from '../../lib/dates.ts';
import { auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { AI_FEATURE_IDS, REAL_PROVIDERS } from '../../../shared/ai-features.ts';
import { can } from '../../../shared/roles.ts';
import { aiRunSchema, ClientAbortedError, prepareAiCall, runAi, runAiStream, testProvider, type AiCallContext } from '../../ai/gateway.ts';
import { openSse } from '../../ai/stream.ts';
import { budgetStatus } from '../../ai/budget.ts';
import { listModels, modelsPatchSchema, updateModels } from '../../ai/pricing.ts';
import { usageReport } from '../../ai/usage.ts';
import { aiSettingsPatchSchema, applyAiSettingsPatch, effectiveProvider, featureSettings, publicAiSettings, readAiSettings, writeAiSettings } from '../../ai/settings.ts';
import { baseUrlsFromEnv, type AiOptions } from '../../ai/types.ts';
import type { FastifyRequest } from 'fastify';

/** 이 서버의 AI 실행 옵션(테스트가 buildApp에 넣은 값, 없으면 환경 변수 AI_BASE_URL_*) */
function aiOptions(app: FastifyInstance): AiOptions {
  return app.aiOptions ?? { baseUrls: baseUrlsFromEnv() };
}

/** 게이트웨이에 넘길 맥락 */
function callCtx(app: FastifyInstance, req: FastifyRequest): AiCallContext {
  return { db: app.db, clock: app.clock, dataDir: app.dataDir, options: aiOptions(app), user: currentUser(req) };
}

const testSchema = z.object({ provider: z.enum(REAL_PROVIDERS, { error: '확인할 공급자를 골라 주세요.' }) }).strict();
const usageQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '월은 2026-11 형식으로 적어 주세요.').optional() });

/** ai 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  // AI 실행(한 번에 받기)
  app.post('/ai/run', async (req) => {
    const body = parseInput(aiRunSchema, req.body);
    return { data: await runAi(callCtx(app, req), body) };
  });

  // AI 실행(스트림). 권한·예산·개인정보 오류는 스트림을 열기 전에 일반 JSON 오류로 돌려준다
  app.post('/ai/stream', async (req, reply) => {
    const body = parseInput(aiRunSchema, req.body);
    const prepared = prepareAiCall(callCtx(app, req), body);
    const sse = openSse(req, reply);
    try {
      const result = await runAiStream(prepared, { delta: (text) => sse.send('delta', { text }) }, sse.signal);
      sse.send('done', result);
    } catch (e) {
      if (!(e instanceof ClientAbortedError)) {
        const { body: err } = toErrorResponse(e);
        sse.send('error', { code: err.error.code, message: err.error.message });
      }
    } finally {
      sse.end();
    }
  });

  // 내 AI 상태: 데모 여부, 기능별 사용 가능 여부, 예산 초과 여부(화면의 비활성 안내용)
  app.get('/ai/status', async (req) => {
    const user = currentUser(req);
    const s = readAiSettings(app.db);
    const provider = effectiveProvider(app.dataDir, s);
    const b = budgetStatus(app.db, app.clock, s);
    const features = AI_FEATURE_IDS.map((id) => {
      const f = featureSettings(s, id);
      return { id, label: f.label, enabled: f.enabled, allowed: f.enabled && f.roles.includes(user.role) && f.defaultRoles.includes(user.role), tier: f.tier, userTier: f.userTier };
    });
    return {
      data: {
        demo: provider === 'demo',
        provider,
        features,
        budget: { exceeded: b.exceeded, ...(can(user.role, 'ai.usage') ? { monthKrw: b.monthKrw, budgetKrw: b.budgetKrw, pct: b.pct, warnPct: b.warnPct } : {}) },
      },
    };
  });

  // 관리자: AI 설정 보기(키는 끝 4자리 가림만)
  app.get('/ai/settings', async () => ({ data: publicAiSettings(app.dataDir, readAiSettings(app.db)) }));

  // 관리자: AI 설정 바꾸기
  app.put('/ai/settings', async (req) => {
    const patch = parseInput(aiSettingsPatchSchema, req.body);
    const s = readAiSettings(app.db);
    const keysChanged = applyAiSettingsPatch(app.dataDir, s, patch);
    writeAiSettings(app.db, app.clock, s);
    audit(auditCtx(req, app), 'ai.settings_update', 'settings', 'ai', {
      provider: s.provider,
      keysChanged,
      monthlyBudgetKrw: s.monthlyBudgetKrw,
      warnPct: s.warnPct,
      fxKrwPerUsd: s.fxKrwPerUsd,
      featuresChanged: Object.keys(patch.features ?? {}),
    });
    return { data: publicAiSettings(app.dataDir, s) };
  });

  // 관리자: 연결 확인(아주 작은 요청)
  app.post('/ai/test', async (req) => {
    const { provider } = parseInput(testSchema, req.body);
    const user = currentUser(req);
    const r = await testProvider({ db: app.db, clock: app.clock, dataDir: app.dataDir, options: aiOptions(app), userId: user.id }, provider);
    audit(auditCtx(req, app), 'ai.test', 'ai_provider', provider, { ok: r.ok, code: r.code });
    return { data: { ok: r.ok, message: r.message } };
  });

  // 관리자: 모델·단가 표
  app.get('/ai/models', async () => {
    const s = readAiSettings(app.db);
    return { data: { models: listModels(app.db), fxKrwPerUsd: s.fxKrwPerUsd } };
  });

  app.put('/ai/models', async (req) => {
    const patch = parseInput(modelsPatchSchema, req.body);
    const changed = updateModels(app.db, patch);
    if (changed === 0) throw new AppError('VALIDATION', { fields: { models: '바꿀 모델을 찾지 못했습니다. 공급자와 등급을 확인해 주세요.' } });
    audit(auditCtx(req, app), 'ai.models_update', 'ai_models', null, { rows: patch.models.map((m) => `${m.provider}:${m.tier}`) });
    const s = readAiSettings(app.db);
    return { data: { models: listModels(app.db), fxKrwPerUsd: s.fxKrwPerUsd } };
  });

  // 관리자: 사용량 대시보드
  app.get('/ai/usage', async (req) => {
    const q = parseInput(usageQuery, req.query);
    const s = readAiSettings(app.db);
    return { data: usageReport(app.db, q.month ?? thisMonthKst(app.clock), { budgetKrw: s.monthlyBudgetKrw, warnPct: s.warnPct }) };
  });
}

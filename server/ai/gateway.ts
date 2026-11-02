// 이 파일이 하는 일: 모든 AI 호출이 지나가는 단 하나의 통로(overview §3.2, TD-009). 순서: ① 기능 켜짐·역할 → ② 월 예산 → ③ 프롬프트 만들기(병원 정보 채움)
// → ④ 보낼 글 개인정보 검사(차단이면 422, 가리기면 가린 글 사용) → ⑤ 등급→모델, 시간 초과, 공급자 호출(키 없으면 데모) → ⑥ 응답 글도 가리기
// → ⑦ ai_usage 기록(비용 계산)·예산 80% 알림. 실패한 호출도 status=error로 남기고, 공급자 오류는 한국어 오류 코드로 바꾼다.
// 스트림(runAiStream)은 같은 순서로 하되 글 조각을 sink로 넘기고, 사용자가 멈추면(signal) 공급자 요청도 끊는다.
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Clock } from '../lib/clock.ts';
import { AppError } from '../lib/errors.ts';
import { todayKst } from '../lib/dates.ts';
import type { AuthUser } from '../auth/sessions.ts';
import { filterText, filterTexts, findingsSummary, privacyNotice, type PiiFinding, type PrivacySettings } from '../privacy/filter.ts';
import { blockedMessage, PII_TYPES } from '../../shared/privacy-rules.ts';
import { can } from '../../shared/roles.ts';
import { AI_FEATURES, AI_TIERS, featureTimeoutMs, isAiFeatureId, type AiFeatureDef, type AiProvider, type AiTier } from '../../shared/ai-features.ts';
import { featureModule } from './features/index.ts';
import type { AiFeatureModule, BuiltPrompt, PromptContext } from './features/types.ts';
import { makeProvider } from './providers/index.ts';
import { demoStream } from './providers/demo.ts';
import { activeModel, costKrw, costUsd, estimateTokens, type AiModel } from './pricing.ts';
import { assertBudget, warnIfNearBudget } from './budget.ts';
import { recordUsage } from './usage.ts';
import { logAiEvent } from './log.ts';
import { apiKeyFor, effectiveProvider, featureSettings, readAiSettings, readClinic, readPrivacyForAi, type AiSettings } from './settings.ts';
import { DEFAULT_BASE_URLS, ProviderError, type AiOptions, type ProviderAdapter, type ProviderRequest, type ProviderUsage } from './types.ts';

/** 게이트웨이를 부르는 쪽이 넘기는 맥락 */
export interface AiCallContext {
  db: Db;
  clock: Clock;
  /** 데이터 폴더(secret.key·로그 위치) */
  dataDir: string;
  options: AiOptions;
  user: AuthUser;
}

/** POST /api/ai/run · /api/ai/stream 본문 */
export const aiRunSchema = z.object({
  feature: z.string({ error: 'AI 기능을 골라 주세요.' }).min(1, 'AI 기능을 골라 주세요.'),
  input: z.unknown().optional(),
  tier: z.enum(AI_TIERS, { error: '등급은 빠름·표준·고급 중에서 골라 주세요.' }).optional(),
});
export type AiRunRequest = z.output<typeof aiRunSchema>;

/** AI 결과(backend.md §1 AiResult + 기능별 extra) */
export interface AiResult {
  text: string;
  demo: boolean;
  usage: { inputTokens: number; outputTokens: number; costKrw: number; estimated: boolean };
  privacy: { findings: PiiFinding[]; redacted: boolean; notice: string | null; outputFindings: PiiFinding[] };
  requestId: number;
  feature: string;
  provider: AiProvider;
  model: string | null;
  tier: AiTier;
  /** JSON 기능의 검사된 결과 */
  extra?: unknown;
}

/** 호출 준비가 끝난 상태(①~⑤ 앞부분) */
export interface Prepared {
  ctx: AiCallContext;
  def: AiFeatureDef;
  mod: AiFeatureModule<unknown>;
  settings: AiSettings;
  privacySettings: PrivacySettings;
  tier: AiTier;
  provider: AiProvider;
  model: AiModel | null;
  adapter: ProviderAdapter | null;
  /** 가린 뒤 실제로 보낼 글 */
  system: string;
  user: string;
  images: BuiltPrompt['images'];
  /** 데모 응답(데모일 때만) */
  demoText: string | null;
  findings: PiiFinding[];
  redacted: boolean;
  timeoutMs: number;
  startedAt: number;
}

/** 공급자 오류 코드 → 응답 오류 */
function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ProviderError) {
    if (e.code === 'AI_ABORTED') return new AppError('AI_UNAVAILABLE');
    return new AppError(e.code);
  }
  return new AppError('AI_UNAVAILABLE');
}

/** 기록할 오류 코드 */
function errorCodeOf(e: unknown): string {
  if (e instanceof AppError || e instanceof ProviderError) return e.code;
  return 'AI_UNAVAILABLE';
}

/** ①~④: 권한·예산·프롬프트·개인정보 검사를 하고 호출 준비를 한다. 막히면 AppError를 던진다 */
export function prepareAiCall(ctx: AiCallContext, req: AiRunRequest): Prepared {
  const startedAt = Date.now();
  if (!isAiFeatureId(req.feature)) throw new AppError('VALIDATION', { fields: { feature: '알 수 없는 AI 기능입니다.' } });
  const def = AI_FEATURES[req.feature];
  // 권한 표의 기본 역할에 없으면 403 FORBIDDEN(예: staff의 월간 요약)
  if (!can(ctx.user.role, def.cap)) throw new AppError('FORBIDDEN');
  const settings = readAiSettings(ctx.db);
  const feat = featureSettings(settings, def.id);
  // ① 관리자가 껐거나 이 역할을 뺐으면 403 AI_DISABLED
  if (!feat.enabled || !feat.roles.includes(ctx.user.role)) throw new AppError('AI_DISABLED');

  const mod = featureModule(def.id);
  const parsed = mod.inputSchema.safeParse(req.input);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = ['input', ...issue.path.map(String)].join('.');
      if (!fields[key]) fields[key] = /[가-힣]/.test(issue.message) ? issue.message : '이 값을 확인해 주세요.';
    }
    throw new AppError('VALIDATION', { fields });
  }

  // ② 월 예산
  assertBudget(ctx.db, ctx.clock, settings);

  // 등급: 사용자가 고를 수 있는 기능만 요청의 tier를 쓴다
  const tier: AiTier = def.userTier && req.tier ? req.tier : feat.tier;
  const provider = effectiveProvider(ctx.dataDir, settings);
  let model: AiModel | null = null;
  let adapter: ProviderAdapter | null = null;
  if (provider !== 'demo') {
    model = activeModel(ctx.db, provider, tier);
    if (!model) throw new AppError('AI_DISABLED', { message: 'AI 모델이 설정되지 않았습니다. 관리자에게 AI 설정 확인을 요청하세요.' });
    if (def.images && !model.supportsImages) throw new AppError('AI_DISABLED', { message: '사진을 읽을 수 있는 AI 모델이 설정되지 않았습니다.' });
    const apiKey = apiKeyFor(ctx.dataDir, settings, provider) as string;
    adapter = makeProvider(provider, { apiKey, baseUrl: ctx.options.baseUrls?.[provider] ?? DEFAULT_BASE_URLS[provider] });
  }

  // ③ 프롬프트(병원 정보는 서버가 채움)
  const pctx: PromptContext = {
    clinic: readClinic(ctx.db),
    user: { name: ctx.user.name, role: ctx.user.role, jobType: ctx.user.jobType },
    today: todayKst(ctx.clock),
  };
  const prompt = mod.buildPrompt(parsed.data, pctx);

  // ④ 보낼 모든 글을 검사한다(데모여도 같은 규칙: 화면이 같은 안내를 보이게)
  const privacySettings = readPrivacyForAi(ctx.db);
  const scan = filterTexts([prompt.system, prompt.user], privacySettings);
  if (scan.blocked) {
    recordUsage(ctx.db, ctx.clock, {
      userId: ctx.user.id,
      feature: def.id,
      provider,
      model: model?.modelId ?? null,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costKrw: 0,
      estimated: false,
      demo: provider === 'demo',
      status: 'blocked',
      errorCode: 'AI_PII_BLOCKED',
      privacy: findingsSummary(scan.findings),
      durationMs: Date.now() - startedAt,
    });
    throw new AppError('AI_PII_BLOCKED', {
      message: blockedMessage(scan.blockedTypes),
      extra: { findings: scan.findings, blockedTypes: scan.blockedTypes },
    });
  }
  const [system = '', user = ''] = scan.redactedTexts;
  if (provider !== 'demo' && !user.trim() && !prompt.images?.length) {
    throw new AppError('VALIDATION', { fields: { input: '요청 내용을 적어 주세요.' } });
  }

  return {
    ctx,
    def,
    mod,
    settings,
    privacySettings,
    tier,
    provider,
    model,
    adapter,
    system,
    user,
    images: prompt.images,
    demoText: provider === 'demo' ? mod.demo(parsed.data, pctx) : null,
    findings: scan.findings,
    redacted: scan.redacted,
    timeoutMs: ctx.options.timeoutMs ?? featureTimeoutMs(def.id, tier),
    startedAt,
  };
}

/** 응답 글을 가린다(⑥). 응답은 막지 않고 모두 가리기로 처리한다 */
function redactOutput(p: Prepared, text: string) {
  const policy = Object.fromEntries(PII_TYPES.map((t) => [t, 'redact'])) as PrivacySettings['policy'];
  return filterText(text, { allowlist: p.privacySettings.allowlist, policy });
}

/** JSON 기능의 응답에서 JSON을 꺼내 검사한다. 실패하면 null */
export function extractJson(text: string, schema: z.ZodType): unknown {
  const s = text.replace(/```(?:json)?/gi, '');
  // 앞에 "[데모 응답]" 같은 글이 붙을 수 있어, 여는 괄호 자리마다 차례로 시도한다(앞에서부터 20곳까지)
  let tries = 0;
  for (let start = s.search(/[[{]/); start >= 0 && tries < 20; tries++) {
    const close = s[start] === '{' ? '}' : ']';
    const end = s.lastIndexOf(close);
    if (end > start) {
      try {
        const r = schema.safeParse(JSON.parse(s.slice(start, end + 1)));
        if (r.success) return r.data;
      } catch {
        // 이 자리는 JSON이 아니다. 다음 여는 괄호를 본다
      }
    }
    const next = s.slice(start + 1).search(/[[{]/);
    start = next < 0 ? -1 : start + 1 + next;
  }
  return null;
}

/** 공급자 요청 하나를 만든다(시간 초과·사용자 중지 신호 포함) */
function makeRequest(p: Prepared, signal: AbortSignal): ProviderRequest {
  return {
    model: p.model?.modelId ?? 'demo',
    system: p.system,
    messages: [{ role: 'user', content: p.user }],
    ...(p.images?.length ? { images: p.images } : {}),
    maxTokens: p.def.maxTokens,
    signal,
  };
}

/** 시간 초과와 바깥 중지 신호를 합친 신호를 만든다 */
function withTimeout(timeoutMs: number, outer?: AbortSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new ProviderError('AI_TIMEOUT')), timeoutMs);
  const onOuter = () => ctrl.abort(new ProviderError('AI_ABORTED'));
  if (outer) {
    if (outer.aborted) onOuter();
    else outer.addEventListener('abort', onOuter, { once: true });
  }
  return {
    signal: ctrl.signal,
    done() {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    },
  };
}

/** ⑦: 기록·알림을 하고 결과를 만든다 */
function finish(p: Prepared, rawText: string, usage: ProviderUsage | null, extraCalls: { input: number; output: number }): AiResult {
  const estimated = p.provider !== 'demo' && !usage;
  const inputTokens = p.provider === 'demo' ? 0 : (usage?.inputTokens ?? estimateTokens(p.system + p.user)) + extraCalls.input;
  const outputTokens = p.provider === 'demo' ? 0 : (usage?.outputTokens ?? estimateTokens(rawText)) + extraCalls.output;
  const usd = p.model ? costUsd(p.model, inputTokens, outputTokens) : 0;
  const krw = costKrw(usd, p.settings.fxKrwPerUsd);
  const out = redactOutput(p, rawText);
  let extra: unknown;
  if (p.def.output === 'json' && p.mod.outputSchema) {
    const parsed = extractJson(out.redactedText, p.mod.outputSchema);
    if (parsed === null) {
      recordError(p, new ProviderError('AI_BAD_OUTPUT'), { inputTokens, outputTokens });
      throw new AppError('AI_BAD_OUTPUT');
    }
    extra = parsed;
  }
  const requestId = recordUsage(p.ctx.db, p.ctx.clock, {
    userId: p.ctx.user.id,
    feature: p.def.id,
    provider: p.provider,
    model: p.model?.modelId ?? null,
    inputTokens,
    outputTokens,
    costUsd: usd,
    costKrw: krw,
    estimated,
    demo: p.provider === 'demo',
    status: 'ok',
    errorCode: null,
    privacy: findingsSummary(p.findings),
    durationMs: Date.now() - p.startedAt,
  });
  warnIfNearBudget(p.ctx.db, p.ctx.clock, p.settings);
  return {
    text: out.redactedText,
    demo: p.provider === 'demo',
    usage: { inputTokens, outputTokens, costKrw: krw, estimated },
    privacy: { findings: p.findings, redacted: p.redacted, notice: privacyNotice({ blocked: false, blockedTypes: [], findings: p.findings }), outputFindings: out.findings },
    requestId,
    feature: p.def.id,
    provider: p.provider,
    model: p.model?.modelId ?? null,
    tier: p.tier,
    ...(extra !== undefined ? { extra } : {}),
  };
}

/** 실패한 호출을 기록하고 로그에 한 줄 남긴다. 받은 글이 있으면(스트림 중단) 토큰을 어림해 비용도 남긴다 */
function recordError(p: Prepared, e: unknown, partial?: { inputTokens: number; outputTokens: number }): number {
  const code = errorCodeOf(e);
  const inputTokens = partial?.inputTokens ?? 0;
  const outputTokens = partial?.outputTokens ?? 0;
  const usd = p.model && (inputTokens || outputTokens) ? costUsd(p.model, inputTokens, outputTokens) : 0;
  const durationMs = Date.now() - p.startedAt;
  logAiEvent(p.ctx.dataDir, p.ctx.clock, {
    feature: p.def.id,
    provider: p.provider,
    model: p.model?.modelId ?? null,
    code,
    httpStatus: e instanceof ProviderError ? e.httpStatus : null,
    durationMs,
  });
  const id = recordUsage(p.ctx.db, p.ctx.clock, {
    userId: p.ctx.user.id,
    feature: p.def.id,
    provider: p.provider,
    model: p.model?.modelId ?? null,
    inputTokens,
    outputTokens,
    costUsd: usd,
    costKrw: costKrw(usd, p.settings.fxKrwPerUsd),
    estimated: usd > 0,
    demo: p.provider === 'demo',
    status: 'error',
    errorCode: code,
    privacy: findingsSummary(p.findings),
    durationMs,
  });
  if (usd > 0) warnIfNearBudget(p.ctx.db, p.ctx.clock, p.settings);
  return id;
}

/** 한 번에 받는 AI 호출(POST /api/ai/run) */
export async function runAi(ctx: AiCallContext, req: AiRunRequest): Promise<AiResult> {
  const p = prepareAiCall(ctx, req);
  if (p.provider === 'demo' || !p.adapter) return finish(p, p.demoText ?? '', null, { input: 0, output: 0 });
  const t = withTimeout(p.timeoutMs);
  try {
    let res = await p.adapter.generate(makeRequest(p, t.signal));
    const extra = { input: 0, output: 0 };
    // JSON 기능은 형식이 틀리면 한 번 더 요청한다(backend.md §4)
    if (p.def.output === 'json' && p.mod.outputSchema && extractJson(res.text, p.mod.outputSchema) === null) {
      extra.input = res.usage?.inputTokens ?? estimateTokens(p.system + p.user);
      extra.output = res.usage?.outputTokens ?? estimateTokens(res.text);
      res = await p.adapter.generate(makeRequest(p, t.signal));
    }
    t.done();
    return finish(p, res.text, res.usage, extra);
  } catch (e) {
    t.done();
    if (e instanceof AppError && e.code === 'AI_BAD_OUTPUT') throw e;
    recordError(p, e);
    throw toAppError(e);
  }
}

/** 스트림 글 조각을 받는 쪽 */
export interface StreamSink {
  /** 가린 글 조각 */
  delta(text: string): void;
}

/**
 * 스트림 중 개인정보를 가리기 위해 글을 조금 모아 두었다가 보낸다.
 * 끝에서 HOLD 글자는 아직 다 오지 않은 번호일 수 있어 남겨 두고, 그 앞의 줄바꿈·띄어쓰기 경계까지만 가려서 내보낸다.
 */
export class StreamRedactor {
  static readonly HOLD = 48;
  private buf = '';
  private readonly redact: (s: string) => string;

  constructor(redact: (s: string) => string) {
    this.redact = redact;
  }

  /** 조각을 넣고, 지금 보내도 되는 가린 글을 돌려준다(없으면 '') */
  push(text: string): string {
    this.buf += text;
    if (this.buf.length <= StreamRedactor.HOLD) return '';
    const limit = this.buf.length - StreamRedactor.HOLD;
    const head = this.buf.slice(0, limit);
    let cut = head.lastIndexOf('\n');
    if (cut < 0) cut = head.search(/\s\S*$/);
    if (cut < 0) return '';
    const ready = this.buf.slice(0, cut + 1);
    this.buf = this.buf.slice(cut + 1);
    return this.redact(ready);
  }

  /** 남은 글을 모두 가려서 돌려준다 */
  flush(): string {
    const rest = this.buf;
    this.buf = '';
    return rest ? this.redact(rest) : '';
  }
}

/** 사용자가 스트림을 멈췄을 때 던지는 오류(응답을 보낼 곳이 없으므로 라우트는 조용히 끝낸다) */
export class ClientAbortedError extends Error {
  constructor() {
    super('사용자가 AI 응답을 멈췄습니다.');
    this.name = 'ClientAbortedError';
  }
}

/**
 * 스트림 AI 호출(POST /api/ai/stream). prepared는 prepareAiCall 결과(그 단계 오류는 라우트가 일반 JSON 오류로 돌려준다).
 * 조각은 sink.delta로 보내고, 끝나면 AiResult(전체 글을 다시 가린 최종본 포함)를 돌려준다.
 * signal이 끊기면(사용자 중지) 공급자 요청도 끊고 ClientAbortedError를 던진다.
 */
export async function runAiStream(p: Prepared, sink: StreamSink, signal: AbortSignal): Promise<AiResult> {
  const redactor = new StreamRedactor((s) => redactOutput(p, s).redactedText);
  let raw = '';
  const usage: Partial<ProviderUsage> = {};
  const t = withTimeout(p.timeoutMs, signal);
  try {
    const chunks =
      p.provider === 'demo' || !p.adapter
        ? demoStream(p.demoText ?? '', p.ctx.options.demoStreamDelayMs ?? 30, t.signal)
        : p.adapter.stream(makeRequest(p, t.signal));
    for await (const c of chunks) {
      if (c.type === 'delta') {
        raw += c.text;
        const ready = redactor.push(c.text);
        if (ready) sink.delta(ready);
      } else {
        Object.assign(usage, c.usage);
      }
    }
    t.done();
    const rest = redactor.flush();
    if (rest) sink.delta(rest);
    const u = usage.inputTokens !== undefined || usage.outputTokens !== undefined ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 } : null;
    return finish(p, raw, u, { input: 0, output: 0 });
  } catch (e) {
    t.done();
    if (e instanceof AppError && e.code === 'AI_BAD_OUTPUT') throw e;
    const partial = raw
      ? { inputTokens: usage.inputTokens ?? estimateTokens(p.system + p.user), outputTokens: usage.outputTokens ?? estimateTokens(raw) }
      : undefined;
    recordError(p, e, p.provider === 'demo' ? undefined : partial);
    if (e instanceof ProviderError && e.code === 'AI_ABORTED') throw new ClientAbortedError();
    throw toAppError(e);
  }
}

/** 연결 확인(POST /api/ai/test): 아주 작은 요청으로 키가 맞는지 본다. 결과는 쉬운 말로 */
export async function testProvider(
  ctx: Omit<AiCallContext, 'user'> & { userId: number },
  provider: Exclude<AiProvider, 'demo'>,
): Promise<{ ok: boolean; code: string | null; message: string }> {
  const settings = readAiSettings(ctx.db);
  const apiKey = apiKeyFor(ctx.dataDir, settings, provider);
  if (!apiKey) return { ok: false, code: 'NO_KEY', message: '저장된 키가 없습니다. 키를 붙여 넣고 저장한 뒤 다시 확인해 주세요.' };
  const model = activeModel(ctx.db, provider, 'fast');
  if (!model) return { ok: false, code: 'NO_MODEL', message: '빠름 등급 모델이 설정되지 않았습니다. 모델 표를 확인해 주세요.' };
  const adapter = makeProvider(provider, { apiKey, baseUrl: ctx.options.baseUrls?.[provider] ?? DEFAULT_BASE_URLS[provider] });
  const t = withTimeout(ctx.options.timeoutMs ?? 15_000);
  const started = Date.now();
  try {
    const res = await adapter.generate({ model: model.modelId, system: '', messages: [{ role: 'user', content: 'ping' }], maxTokens: 16, signal: t.signal });
    t.done();
    const inTok = res.usage?.inputTokens ?? 1;
    const outTok = res.usage?.outputTokens ?? estimateTokens(res.text);
    const usd = costUsd(model, inTok, outTok);
    recordUsage(ctx.db, ctx.clock, {
      userId: ctx.userId,
      feature: 'connection_test',
      provider,
      model: model.modelId,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: usd,
      costKrw: costKrw(usd, settings.fxKrwPerUsd),
      estimated: !res.usage,
      demo: false,
      status: 'ok',
      errorCode: null,
      privacy: null,
      durationMs: Date.now() - started,
    });
    return { ok: true, code: null, message: '연결되었습니다. 이 키로 AI를 쓸 수 있습니다.' };
  } catch (e) {
    t.done();
    const err = toAppError(e);
    logAiEvent(ctx.dataDir, ctx.clock, { feature: 'connection_test', provider, model: model.modelId, code: err.code, httpStatus: e instanceof ProviderError ? e.httpStatus : null });
    recordUsage(ctx.db, ctx.clock, {
      userId: ctx.userId,
      feature: 'connection_test',
      provider,
      model: model.modelId,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costKrw: 0,
      estimated: false,
      demo: false,
      status: 'error',
      errorCode: err.code,
      privacy: null,
      durationMs: Date.now() - started,
    });
    return { ok: false, code: err.code, message: err.message };
  }
}

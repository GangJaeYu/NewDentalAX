// 이 파일이 하는 일: 회의 녹음 파일 → 받아쓴 글(FR-132, phase-06-task-03)의 서버 쪽 일을 한다. 받아쓴 글은 회의록 요약(minutes)의 입력이 된다.
// 순서: ① 권한(ai.minutes)·기능 켜짐 → ② "환자 이야기 없음" 확인 체크 → ③ 형식(m4a·mp3·wav·webm, 앞부분 바이트까지)·크기(20MB) 검사
// → ④ 월 예산 → ⑤ 공급자: 데모는 예시 글, OpenAI는 받아쓰기 API, Gemini는 오디오 입력, Anthropic은 음성 입력이 없어 비활성 안내
// → ⑥ 받아쓴 글의 개인정보를 모두 가림 → ⑦ ai_usage 기록(분 단위·토큰 단위 비용)·예산 80% 알림.
// 녹음은 디스크에 저장하지 않고 메모리에서만 다루며, 처리가 끝나면(성공·실패 모두) 바이트를 0으로 덮어 지운다. Gemini Files API로 올린 것도 끝나면 지운다.
import type { Db } from '../db/index.ts';
import type { Clock } from '../lib/clock.ts';
import { AppError } from '../lib/errors.ts';
import { MB } from '../lib/files.ts';
import { todayKst } from '../lib/dates.ts';
import { can, type Role } from '../../shared/roles.ts';
import { PII_LABELS, PII_TYPES } from '../../shared/privacy-rules.ts';
import { AI_FEATURES, AI_PROVIDER_LABELS, featureTimeoutMs, type AiProvider } from '../../shared/ai-features.ts';
import { filterText, findingsSummary, type PiiFinding, type PrivacySettings } from '../privacy/filter.ts';
import { transcribe as transcribeFeature, TRANSCRIBE_CONTEXT } from './features/transcribe.ts';
import { assertBudget, budgetStatus, warnIfNearBudget } from './budget.ts';
import { activeModel, costKrw, costUsd, estimateTokens, type AiModel } from './pricing.ts';
import { recordUsage } from './usage.ts';
import { logAiEvent } from './log.ts';
import { effectiveProvider, featureSettings, readAiSettings, readClinic, readPrivacyForAi } from './settings.ts';
import { callAudioProvider, type AiCallContext, type AudioResult } from './gateway.ts';
import { ProviderError } from './types.ts';

/** 녹음 파일 크기 상한(20MB). 화면도 같은 값으로 먼저 막는다 */
export const TRANSCRIBE_MAX_BYTES = 20 * MB;

/** 녹음 형식 하나: 공급자별로 알려 줄 MIME, 앞부분 바이트 검사 */
interface AudioKind {
  openaiMime: string;
  geminiMime: string;
  label: string;
  sniff(head: Buffer): boolean;
}

const at = (h: Buffer, bytes: number[] | string, offset = 0) => {
  const arr = typeof bytes === 'string' ? [...bytes].map((c) => c.charCodeAt(0)) : bytes;
  return arr.every((b, i) => h[offset + i] === b);
};

/**
 * 받는 녹음 형식(휴대폰 녹음 앱 파일). 두 공급자(OpenAI·Gemini)가 모두 받는 형식만 둔다.
 * m4a(아이폰 음성 메모·갤럭시 녹음): 4번째 바이트부터 'ftyp' / mp3: 'ID3' 또는 프레임 시작 0xFFE / wav: 'RIFF'…'WAVE' / webm: 1A 45 DF A3
 */
export const AUDIO_KINDS: Readonly<Record<string, AudioKind>> = {
  '.m4a': { openaiMime: 'audio/mp4', geminiMime: 'audio/m4a', label: 'M4A', sniff: (h) => at(h, 'ftyp', 4) },
  '.mp3': { openaiMime: 'audio/mpeg', geminiMime: 'audio/mp3', label: 'MP3', sniff: (h) => at(h, 'ID3') || (h[0] === 0xff && ((h[1] ?? 0) & 0xe0) === 0xe0) },
  '.wav': { openaiMime: 'audio/wav', geminiMime: 'audio/wav', label: 'WAV', sniff: (h) => at(h, 'RIFF') && at(h, 'WAVE', 8) },
  '.webm': { openaiMime: 'audio/webm', geminiMime: 'audio/webm', label: 'WEBM', sniff: (h) => at(h, [0x1a, 0x45, 0xdf, 0xa3]) },
};
/** 받는 확장자 */
export const AUDIO_EXTS = Object.keys(AUDIO_KINDS);
const AUDIO_LABEL = Object.values(AUDIO_KINDS)
  .map((k) => k.label)
  .join('·');

/** 확장자(점 포함, 소문자) */
function extOf(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/** 녹음 파일을 검사한다. 너무 크면 413, 형식이 틀리면 415, 비었으면 400 */
export function checkAudio(name: string, data: Buffer): { ext: string; kind: AudioKind } {
  if (data.length > TRANSCRIBE_MAX_BYTES) {
    throw new AppError('FILE_TOO_LARGE', { message: '녹음 파일이 너무 커요(최대 20MB). 회의를 나눠 녹음하거나 크기를 줄여서 올려 주세요.' });
  }
  const ext = extOf(name);
  const kind = AUDIO_KINDS[ext];
  if (!kind) throw new AppError('FILE_TYPE', { message: `올릴 수 없는 파일 형식이에요. 녹음 파일(${AUDIO_LABEL})만 올릴 수 있어요.` });
  if (data.length === 0) throw new AppError('VALIDATION', { message: '빈 파일이에요. 다른 녹음 파일을 골라 주세요.', fields: { file: '빈 파일이에요.' } });
  if (!kind.sniff(data.subarray(0, 64))) {
    throw new AppError('FILE_TYPE', { message: `파일 내용이 ${kind.label} 녹음 파일이 아니에요. 녹음 앱에서 저장한 파일을 그대로 올려 주세요.` });
  }
  return { ext, kind };
}

// ---- 가격표 ----

/** 받아쓰기 가격(공식 가격 페이지 확인값). 관리 화면 모델 표와 따로 둔다(받아쓰기 전용 모델·분 단위 가격이라서) */
export const TRANSCRIBE_PRICING = {
  openai: {
    /** 쓰는 받아쓰기 모델(공식 권장) */
    modelId: 'gpt-transcribe',
    /** 1분당 달러 */
    usdPerMinute: 0.0045,
    checkedOn: '2026-11-03',
    sourceUrl: 'https://developers.openai.com/api/docs/pricing',
  },
  gemini: {
    /** 오디오 입력 100만 토큰당 달러(모델별). 표에 없는 모델은 그 모델의 글 입력 단가를 쓴다(공식 표가 오디오를 따로 적지 않은 모델) */
    audioInputUsdPerM: { 'gemini-3.1-flash-lite': 0.5 } as Readonly<Record<string, number>>,
    /** 녹음 1초 = 32토큰 */
    tokensPerSecond: 32,
    checkedOn: '2026-11-03',
    sourceUrl: 'https://aistudio.google.com/docs/pricing',
  },
} as const;

/** 길이를 모를 때 쓰는 녹음 1초당 바이트(64kbps, 휴대폰 녹음 앱의 낮은 쪽 음질). 낮게 잡을수록 시간·비용을 넉넉히 어림한다 */
const ASSUMED_BYTES_PER_SECOND = 8000;

/** 녹음 길이(초)를 어림한다. WAV는 머리의 초당 바이트로 정확히, 나머지는 64kbps로 넉넉히 잡는다 */
export function estimateSeconds(ext: string, data: Buffer): number {
  if (ext === '.wav' && data.length >= 44) {
    const byteRate = data.readUInt32LE(28);
    if (byteRate > 0) return Math.max(1, Math.round((data.length - 44) / byteRate));
  }
  return Math.max(1, Math.round(data.length / ASSUMED_BYTES_PER_SECOND));
}

/** OpenAI 받아쓰기 비용(달러) = 분 × 분당 단가 */
export function openaiAudioCostUsd(seconds: number): number {
  return (seconds / 60) * TRANSCRIBE_PRICING.openai.usdPerMinute;
}

/** Gemini 받아쓰기 비용(달러) = 오디오 토큰 × 오디오 단가 + 글 입력·출력 토큰 × 모델 단가 */
export function geminiAudioCostUsd(model: Pick<AiModel, 'modelId' | 'inputUsdPerM' | 'outputUsdPerM' | 'longThresholdTokens' | 'longInputUsdPerM' | 'longOutputUsdPerM'>, t: { audioIn: number; textIn: number; output: number }): number {
  const audioPrice = TRANSCRIBE_PRICING.gemini.audioInputUsdPerM[model.modelId] ?? model.inputUsdPerM;
  return (t.audioIn * audioPrice) / 1_000_000 + costUsd(model, t.textIn, t.output);
}

// ---- 사용 가능 여부 ----

/** 화면에 미리 보여 줄 받아쓰기 상태 */
export interface TranscribeStatus {
  /** ready=쓸 수 있음, disabled=관리자가 끔(또는 권한 없음), unsupported=지금 공급자가 음성을 못 받음, no_model=모델 없음, budget=예산 다 씀 */
  state: 'ready' | 'disabled' | 'unsupported' | 'no_model' | 'budget';
  demo: boolean;
  provider: AiProvider;
  message: string | null;
  maxBytes: number;
  exts: string[];
}

/** 음성 미지원 안내 */
function unsupportedMessage(provider: AiProvider): string {
  return `지금 설정된 AI(${AI_PROVIDER_LABELS[provider]})는 음성을 지원하지 않아요. 회의 메모를 직접 적어 주세요. 녹음으로 받아쓰려면 관리자가 AI 설정에서 OpenAI나 Google Gemini를 골라야 해요.`;
}

/** 지금 이 역할이 녹음 받아쓰기를 쓸 수 있는지(실제 요청 때도 같은 검사를 다시 한다) */
export function transcribeStatus(db: Db, clock: Clock, dataDir: string, role: Role): TranscribeStatus {
  const s = readAiSettings(db);
  const f = featureSettings(s, 'transcribe');
  const provider = effectiveProvider(dataDir, s);
  const base = { demo: provider === 'demo', provider, maxBytes: TRANSCRIBE_MAX_BYTES, exts: AUDIO_EXTS };
  if (!can(role, AI_FEATURES.transcribe.cap) || !f.enabled || !f.roles.includes(role)) {
    return { ...base, state: 'disabled', message: '관리자가 녹음 받아쓰기를 꺼 두었습니다. 회의 메모를 직접 적어 주세요.' };
  }
  if (provider === 'anthropic') return { ...base, state: 'unsupported', message: unsupportedMessage(provider) };
  if (provider === 'gemini' && !activeModel(db, 'gemini', f.tier)) {
    return { ...base, state: 'no_model', message: 'AI 모델이 설정되지 않았습니다. 관리자에게 AI 설정 확인을 요청하세요.' };
  }
  if (budgetStatus(db, clock, s).exceeded) {
    return { ...base, state: 'budget', message: '이번 달 AI 예산을 모두 사용했습니다. 관리자에게 한도 조정을 요청하세요.' };
  }
  return { ...base, state: 'ready', message: null };
}

// ---- 받아쓰기 ----

/** POST /api/ai/transcribe 응답 */
export interface TranscribeResult {
  /** 받아쓴 글(개인정보는 가린 상태) */
  text: string;
  demo: boolean;
  provider: AiProvider;
  model: string | null;
  usage: { seconds: number | null; costKrw: number; estimated: boolean };
  privacy: { findings: PiiFinding[]; notice: string | null };
  requestId: number;
}

/** 시간 초과 신호 */
function timeoutSignal(ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new ProviderError('AI_TIMEOUT')), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

/** 받아쓴 글의 개인정보를 모두 가린다(관리자 정책이 "차단"이어도 받아쓴 글은 막지 않고 가린다. 허용 목록은 그대로) */
function redactTranscript(text: string, ps: PrivacySettings) {
  const policy = Object.fromEntries(PII_TYPES.map((t) => [t, 'redact'])) as PrivacySettings['policy'];
  return filterText(text, { allowlist: ps.allowlist, policy });
}

/** 받아쓴 글에서 가린 것 안내. 예: "받아쓴 글에서 전화번호 1건을 가렸어요." 없으면 null */
export function transcriptNotice(findings: readonly PiiFinding[]): string | null {
  if (!findings.length) return null;
  return `받아쓴 글에서 ${findings.map((f) => `${PII_LABELS[f.type]} ${f.count}건`).join(', ')}을 가렸어요.`;
}

/** 공급자 오류 → 응답 오류 */
function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof ProviderError) return new AppError(e.code === 'AI_ABORTED' ? 'AI_UNAVAILABLE' : e.code);
  return new AppError('AI_UNAVAILABLE');
}

/**
 * 녹음 파일을 받아쓴다. confirmed는 화면의 "환자 이야기가 들어간 녹음이 아니에요" 확인 체크.
 * 녹음 바이트는 저장하지 않고, 끝나면(성공·실패 모두) 0으로 덮어 지운다.
 */
export async function runTranscribe(ctx: AiCallContext, file: { name: string; data: Buffer; confirmed: boolean }): Promise<TranscribeResult> {
  const startedAt = Date.now();
  try {
    const def = AI_FEATURES.transcribe;
    if (!can(ctx.user.role, def.cap)) throw new AppError('FORBIDDEN');
    const settings = readAiSettings(ctx.db);
    const feat = featureSettings(settings, def.id);
    if (!feat.enabled || !feat.roles.includes(ctx.user.role)) throw new AppError('AI_DISABLED', { message: '관리자가 녹음 받아쓰기를 꺼 두었습니다.' });
    if (!file.confirmed) {
      throw new AppError('VALIDATION', {
        message: '환자 이야기가 들어간 녹음이 아닌지 확인하고 체크해 주세요.',
        fields: { confirmed: '환자 이야기가 들어간 녹음이 아닌지 확인해 주세요.' },
      });
    }
    const { ext, kind } = checkAudio(file.name, file.data);
    assertBudget(ctx.db, ctx.clock, settings);

    const provider = effectiveProvider(ctx.dataDir, settings);
    if (provider === 'anthropic') throw new AppError('AI_DISABLED', { message: unsupportedMessage(provider) });

    const pctx = {
      clinic: readClinic(ctx.db),
      user: { name: ctx.user.name, role: ctx.user.role, jobType: ctx.user.jobType },
      today: todayKst(ctx.clock),
    };
    const fileName = `meeting${ext}`;
    const input = { audio: file.data, mime: provider === 'gemini' ? kind.geminiMime : kind.openaiMime, name: fileName };
    const privacySettings = readPrivacyForAi(ctx.db);

    let raw: string;
    let modelId: string | null = null;
    let seconds: number | null = null;
    let usd = 0;
    let estimated = false;
    let inputTokens = 0;
    let outputTokens = 0;

    if (provider === 'demo') {
      raw = transcribeFeature.demo(input, pctx);
    } else {
      let model: AiModel | null = null;
      if (provider === 'gemini') {
        model = activeModel(ctx.db, 'gemini', feat.tier);
        if (!model) throw new AppError('AI_DISABLED', { message: 'AI 모델이 설정되지 않았습니다. 관리자에게 AI 설정 확인을 요청하세요.' });
      }
      modelId = provider === 'openai' ? TRANSCRIBE_PRICING.openai.modelId : (model as AiModel).modelId;
      const prompt = transcribeFeature.buildPrompt(input, pctx);
      const t = timeoutSignal(ctx.options.timeoutMs ?? featureTimeoutMs(def.id, feat.tier));
      let res: AudioResult;
      try {
        const req = { model: modelId, data: file.data, mime: input.mime, fileName, system: prompt.system, user: prompt.user, context: TRANSCRIBE_CONTEXT, maxTokens: def.maxTokens, signal: t.signal };
        res = await callAudioProvider(ctx, provider, req);
      } catch (e) {
        const code = e instanceof ProviderError || e instanceof AppError ? e.code : 'AI_UNAVAILABLE';
        const durationMs = Date.now() - startedAt;
        logAiEvent(ctx.dataDir, ctx.clock, { feature: def.id, provider, model: modelId, code, httpStatus: e instanceof ProviderError ? e.httpStatus : null, durationMs });
        recordUsage(ctx.db, ctx.clock, {
          userId: ctx.user.id,
          feature: def.id,
          provider,
          model: modelId,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          costKrw: 0,
          estimated: false,
          demo: false,
          status: 'error',
          errorCode: code,
          privacy: null,
          durationMs,
        });
        throw toAppError(e);
      } finally {
        t.done();
      }
      raw = res.text;
      if (!raw.trim()) {
        recordUsage(ctx.db, ctx.clock, { userId: ctx.user.id, feature: def.id, provider, model: modelId, inputTokens: 0, outputTokens: 0, costUsd: 0, costKrw: 0, estimated: false, demo: false, status: 'error', errorCode: 'AI_BAD_OUTPUT', privacy: null, durationMs: Date.now() - startedAt });
        throw new AppError('AI_BAD_OUTPUT', { message: '녹음에서 말소리를 찾지 못했어요. 회의 녹음이 맞는지 확인하고 다시 올려 주세요.' });
      }
      if (provider === 'openai') {
        seconds = res.seconds;
        if (seconds === null) {
          seconds = estimateSeconds(ext, file.data);
          estimated = true;
        }
        usd = openaiAudioCostUsd(seconds);
        inputTokens = res.tokens ? res.tokens.audioIn + res.tokens.textIn : 0;
        outputTokens = res.tokens?.output ?? estimateTokens(raw);
      } else {
        let tokens = res.tokens;
        if (!tokens) {
          estimated = true;
          tokens = { audioIn: estimateSeconds(ext, file.data) * TRANSCRIBE_PRICING.gemini.tokensPerSecond, textIn: estimateTokens(prompt.system + prompt.user), output: estimateTokens(raw) };
        }
        seconds = Math.round(tokens.audioIn / TRANSCRIBE_PRICING.gemini.tokensPerSecond);
        usd = geminiAudioCostUsd(model as AiModel, tokens);
        inputTokens = tokens.audioIn + tokens.textIn;
        outputTokens = tokens.output;
      }
    }

    // ⑥ 받아쓴 글은 모두 가린다. 요약(minutes)으로 넘길 때 게이트웨이가 한 번 더 검사한다
    const out = redactTranscript(raw, privacySettings);
    const krw = costKrw(usd, settings.fxKrwPerUsd);
    const requestId = recordUsage(ctx.db, ctx.clock, {
      userId: ctx.user.id,
      feature: def.id,
      provider,
      model: modelId,
      inputTokens,
      outputTokens,
      costUsd: usd,
      costKrw: krw,
      estimated,
      demo: provider === 'demo',
      status: 'ok',
      errorCode: null,
      privacy: findingsSummary(out.findings),
      durationMs: Date.now() - startedAt,
    });
    if (usd > 0) warnIfNearBudget(ctx.db, ctx.clock, settings);
    return {
      text: out.redactedText,
      demo: provider === 'demo',
      provider,
      model: modelId,
      usage: { seconds, costKrw: krw, estimated },
      privacy: { findings: out.findings, notice: transcriptNotice(out.findings) },
      requestId,
    };
  } finally {
    // 녹음은 서버에 남기지 않는다: 메모리의 바이트를 0으로 덮는다
    file.data.fill(0);
  }
}

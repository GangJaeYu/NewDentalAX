// 이 파일이 하는 일: AI 모델·단가 표(ai_models)를 읽고 고치며, 호출 비용을 계산한다(TD-009 비용, FR-036).
// 계산식: (입력 토큰 × 입력 단가 + 출력 토큰 × 출력 단가) ÷ 1,000,000 × 환율. 입력 토큰이 구간 기준을 넘으면 그 요청 전체에 긴 입력 단가를 쓴다.
// 공급자가 사용량을 주지 않으면 글자 수로 토큰을 어림하고 "추정"으로 표시한다.
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { AI_TIERS, REAL_PROVIDERS, type AiTier, type RealProvider } from '../../shared/ai-features.ts';

/** 모델 한 줄(API 응답 모양) */
export interface AiModel {
  id: number;
  provider: RealProvider;
  modelId: string;
  tier: AiTier;
  inputUsdPerM: number;
  outputUsdPerM: number;
  longThresholdTokens: number | null;
  longInputUsdPerM: number | null;
  longOutputUsdPerM: number | null;
  supportsImages: boolean;
  checkedOn: string | null;
  sourceUrl: string | null;
  active: boolean;
}

interface ModelRow {
  id: number;
  provider: RealProvider;
  model_id: string;
  tier: AiTier;
  input_usd_per_m: number;
  output_usd_per_m: number;
  long_threshold_tokens: number | null;
  long_input_usd_per_m: number | null;
  long_output_usd_per_m: number | null;
  supports_images: number;
  checked_on: string | null;
  source_url: string | null;
  active: number;
}

function toModel(r: ModelRow): AiModel {
  return {
    id: r.id,
    provider: r.provider,
    modelId: r.model_id,
    tier: r.tier,
    inputUsdPerM: r.input_usd_per_m,
    outputUsdPerM: r.output_usd_per_m,
    longThresholdTokens: r.long_threshold_tokens,
    longInputUsdPerM: r.long_input_usd_per_m,
    longOutputUsdPerM: r.long_output_usd_per_m,
    supportsImages: r.supports_images === 1,
    checkedOn: r.checked_on,
    sourceUrl: r.source_url,
    active: r.active === 1,
  };
}

/** 모델 표 전체(공급자·등급 순서) */
export function listModels(db: Db): AiModel[] {
  return db
    .all<ModelRow>(
      "SELECT * FROM ai_models ORDER BY provider, CASE tier WHEN 'fast' THEN 0 WHEN 'standard' THEN 1 ELSE 2 END, active DESC, id",
    )
    .map(toModel);
}

/** 공급자·등급의 활성 모델(없으면 null) */
export function activeModel(db: Db, provider: RealProvider, tier: AiTier): AiModel | null {
  const r = db.get<ModelRow>('SELECT * FROM ai_models WHERE provider = ? AND tier = ? AND active = 1', [provider, tier]);
  return r ? toModel(r) : null;
}

/** 이 요청에 쓸 단가(USD/100만 토큰). 입력이 구간 기준을 넘으면 긴 입력 단가 */
export function unitPrices(m: Pick<AiModel, 'inputUsdPerM' | 'outputUsdPerM' | 'longThresholdTokens' | 'longInputUsdPerM' | 'longOutputUsdPerM'>, inputTokens: number) {
  const long = m.longThresholdTokens !== null && inputTokens > m.longThresholdTokens;
  return {
    input: long && m.longInputUsdPerM !== null ? m.longInputUsdPerM : m.inputUsdPerM,
    output: long && m.longOutputUsdPerM !== null ? m.longOutputUsdPerM : m.outputUsdPerM,
  };
}

/** 비용(USD) */
export function costUsd(m: Parameters<typeof unitPrices>[0], inputTokens: number, outputTokens: number): number {
  const p = unitPrices(m, inputTokens);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** 비용(원) = USD × 환율 */
export function costKrw(usd: number, fxKrwPerUsd: number): number {
  return usd * fxKrwPerUsd;
}

/** 글자 수로 토큰을 어림한다(한글·영문 섞인 글 기준 약 2글자 = 1토큰) */
export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 2) : 0;
}

/** PUT /api/ai/models 입력: 공급자·등급으로 줄을 찾아 바꾼다 */
export const modelsPatchSchema = z
  .object({
    models: z
      .array(
        z
          .object({
            provider: z.enum(REAL_PROVIDERS),
            tier: z.enum(AI_TIERS),
            modelId: z.string().trim().min(1, '모델 이름을 적어 주세요.').max(100).regex(/^[A-Za-z0-9._:\-/]+$/, '모델 이름은 영문·숫자·.-_만 쓸 수 있습니다.').optional(),
            inputUsdPerM: z.number().min(0, '단가는 0 이상이어야 합니다.').max(1000).optional(),
            outputUsdPerM: z.number().min(0, '단가는 0 이상이어야 합니다.').max(1000).optional(),
            longThresholdTokens: z.number().int().positive().nullable().optional(),
            longInputUsdPerM: z.number().min(0).max(1000).nullable().optional(),
            longOutputUsdPerM: z.number().min(0).max(1000).nullable().optional(),
            supportsImages: z.boolean().optional(),
            checkedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '확인 날짜는 2026-11-02 형식으로 적어 주세요.').nullable().optional(),
            // http(s)만 받는다: javascript:·data: 주소가 화면 링크(href)로 들어가지 않게(phase-05-task-02 보안 점검)
            sourceUrl: z.url({ protocol: /^https?$/, error: '출처 주소는 https://로 시작하게 적어 주세요.' }).max(500).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export type ModelsPatch = z.output<typeof modelsPatchSchema>;

/** 모델 표를 고친다. 그 공급자·등급의 활성 줄이 없으면 새로 만든다(모델 이름·단가 필수). 바뀐 줄 수를 돌려준다 */
export function updateModels(db: Db, patch: ModelsPatch): number {
  let n = 0;
  db.tx(() => {
    for (const m of patch.models) {
      const cur = activeModel(db, m.provider, m.tier);
      if (!cur) {
        if (!m.modelId || m.inputUsdPerM === undefined || m.outputUsdPerM === undefined) continue;
        db.run(
          'INSERT INTO ai_models (provider, model_id, tier, input_usd_per_m, output_usd_per_m, long_threshold_tokens, long_input_usd_per_m, long_output_usd_per_m, supports_images, checked_on, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [m.provider, m.modelId, m.tier, m.inputUsdPerM, m.outputUsdPerM, m.longThresholdTokens ?? null, m.longInputUsdPerM ?? null, m.longOutputUsdPerM ?? null, m.supportsImages ?? false, m.checkedOn ?? null, m.sourceUrl ?? null],
        );
        n++;
        continue;
      }
      const next = {
        modelId: m.modelId ?? cur.modelId,
        inputUsdPerM: m.inputUsdPerM ?? cur.inputUsdPerM,
        outputUsdPerM: m.outputUsdPerM ?? cur.outputUsdPerM,
        longThresholdTokens: m.longThresholdTokens === undefined ? cur.longThresholdTokens : m.longThresholdTokens,
        longInputUsdPerM: m.longInputUsdPerM === undefined ? cur.longInputUsdPerM : m.longInputUsdPerM,
        longOutputUsdPerM: m.longOutputUsdPerM === undefined ? cur.longOutputUsdPerM : m.longOutputUsdPerM,
        supportsImages: m.supportsImages ?? cur.supportsImages,
        checkedOn: m.checkedOn === undefined ? cur.checkedOn : m.checkedOn,
        sourceUrl: m.sourceUrl === undefined ? cur.sourceUrl : m.sourceUrl,
      };
      n += db.run(
        'UPDATE ai_models SET model_id = ?, input_usd_per_m = ?, output_usd_per_m = ?, long_threshold_tokens = ?, long_input_usd_per_m = ?, long_output_usd_per_m = ?, supports_images = ?, checked_on = ?, source_url = ? WHERE id = ?',
        [next.modelId, next.inputUsdPerM, next.outputUsdPerM, next.longThresholdTokens, next.longInputUsdPerM, next.longOutputUsdPerM, next.supportsImages, next.checkedOn, next.sourceUrl, cur.id],
      ).changes;
    }
  });
  return n;
}

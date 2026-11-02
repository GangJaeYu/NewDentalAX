// 이 파일이 하는 일: AI 설정(settings 표의 'ai' 키, database.md §5)을 읽고 쓴다. 공급자, 암호화한 API 키, 월 예산, 경고 비율, 환율, 기능별 켜기·역할·등급.
// 키는 lib/crypto.ts로 암호화해 저장하고(TD-008), 밖으로는 끝 4자리 가림 표시(maskedKey)만 내보낸다. 병원 정보·개인정보 설정도 여기서 읽는다(프롬프트·필터용).
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import type { Clock } from '../lib/clock.ts';
import { decryptText, encryptText, isEncryptedValue, loadOrCreateSecretKey, maskSecret, type EncryptedValue } from '../lib/crypto.ts';
import { parsePrivacySettings, PRIVACY_SETTINGS_KEY, type PrivacySettings } from '../privacy/filter.ts';
import {
  AI_FEATURE_IDS,
  AI_PROVIDERS,
  AI_TIERS,
  effectiveFeature,
  REAL_PROVIDERS,
  type AiFeatureId,
  type AiFeatureOverride,
  type AiProvider,
  type EffectiveFeature,
  type RealProvider,
} from '../../shared/ai-features.ts';
import { ROLES } from '../../shared/roles.ts';
import type { PromptContext } from './features/types.ts';

export const AI_SETTINGS_KEY = 'ai';

/** 저장되는 AI 설정 */
export interface AiSettings {
  provider: AiProvider;
  keys: Partial<Record<RealProvider, EncryptedValue>>;
  monthlyBudgetKrw: number;
  warnPct: number;
  fxKrwPerUsd: number;
  features: Partial<Record<AiFeatureId, AiFeatureOverride>>;
  /** 프롬프트 원문 저장(기본 false, FR-034 AC1). 이 태스크에서는 저장 기능을 만들지 않는다 */
  storePrompts: boolean;
}

/** 기본값(database.md §5, TD-021) */
export const DEFAULT_AI_SETTINGS: Readonly<AiSettings> = Object.freeze({
  provider: 'demo',
  keys: {},
  monthlyBudgetKrw: 40000,
  warnPct: 80,
  fxKrwPerUsd: 1450,
  features: {},
  storePrompts: false,
});

const featureOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  roles: z.array(z.enum(ROLES as unknown as [string, ...string[]])).optional(),
  tier: z.enum(AI_TIERS).optional(),
});

/** settings 표의 JSON 값을 읽어 빠진 값은 기본값으로 채운다 */
function parseAiSettings(raw: unknown): AiSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const keys: AiSettings['keys'] = {};
  const rawKeys = (o.keys && typeof o.keys === 'object' ? o.keys : {}) as Record<string, unknown>;
  for (const p of REAL_PROVIDERS) if (isEncryptedValue(rawKeys[p])) keys[p] = rawKeys[p];
  const features: AiSettings['features'] = {};
  const rawFeatures = (o.features && typeof o.features === 'object' ? o.features : {}) as Record<string, unknown>;
  for (const id of AI_FEATURE_IDS) {
    const r = featureOverrideSchema.safeParse(rawFeatures[id]);
    if (r.success && rawFeatures[id]) features[id] = r.data as AiFeatureOverride;
  }
  const numOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  return {
    provider: (AI_PROVIDERS as readonly string[]).includes(o.provider as string) ? (o.provider as AiProvider) : DEFAULT_AI_SETTINGS.provider,
    keys,
    monthlyBudgetKrw: numOr(o.monthlyBudgetKrw, DEFAULT_AI_SETTINGS.monthlyBudgetKrw),
    warnPct: numOr(o.warnPct, DEFAULT_AI_SETTINGS.warnPct),
    fxKrwPerUsd: numOr(o.fxKrwPerUsd, DEFAULT_AI_SETTINGS.fxKrwPerUsd),
    features,
    storePrompts: o.storePrompts === true,
  };
}

/** settings 한 키의 JSON 값(없거나 깨졌으면 null) */
export function readSettingJson(db: Db, key: string): unknown {
  const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return null;
  }
}

/** AI 설정을 읽는다 */
export function readAiSettings(db: Db): AiSettings {
  return parseAiSettings(readSettingJson(db, AI_SETTINGS_KEY));
}

/** AI 설정을 저장한다(다른 settings 키는 건드리지 않는다) */
export function writeAiSettings(db: Db, clock: Clock, s: AiSettings): void {
  db.run(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [AI_SETTINGS_KEY, JSON.stringify(s), clock.now().toISOString()],
  );
}

/** 저장된 키를 풀어 돌려준다(없거나 풀 수 없으면 null). 이 값은 공급자 요청 헤더에만 쓴다 */
export function apiKeyFor(dataDir: string, s: AiSettings, provider: RealProvider): string | null {
  const enc = s.keys[provider];
  if (!enc) return null;
  return decryptText(loadOrCreateSecretKey(dataDir), enc);
}

/** 키 하나를 암호화해 설정에 넣는다. null이면 지운다 */
export function setApiKey(dataDir: string, s: AiSettings, provider: RealProvider, plain: string | null): void {
  if (plain === null) delete s.keys[provider];
  else s.keys[provider] = encryptText(loadOrCreateSecretKey(dataDir), plain);
}

/** 실제로 쓸 공급자: demo를 골랐거나 고른 공급자의 키가 없으면 demo */
export function effectiveProvider(dataDir: string, s: AiSettings): AiProvider {
  if (s.provider === 'demo') return 'demo';
  return apiKeyFor(dataDir, s, s.provider) ? s.provider : 'demo';
}

/** 기능 설정(관리자 변경 반영) */
export function featureSettings(s: AiSettings, id: AiFeatureId): EffectiveFeature {
  return effectiveFeature(id, s.features[id]);
}

/** 관리 화면에 보낼 설정(키 원문 없음, 끝 4자리 가림만) */
export interface PublicAiSettings {
  provider: AiProvider;
  effectiveProvider: AiProvider;
  demo: boolean;
  keys: Record<RealProvider, { saved: boolean; maskedKey: string | null }>;
  monthlyBudgetKrw: number;
  warnPct: number;
  fxKrwPerUsd: number;
  features: EffectiveFeature[];
}

/** 설정을 화면용으로 바꾼다 */
export function publicAiSettings(dataDir: string, s: AiSettings): PublicAiSettings {
  const keys = {} as PublicAiSettings['keys'];
  for (const p of REAL_PROVIDERS) {
    const plain = apiKeyFor(dataDir, s, p);
    keys[p] = { saved: !!s.keys[p], maskedKey: plain ? maskSecret(plain) : null };
  }
  const eff = effectiveProvider(dataDir, s);
  return {
    provider: s.provider,
    effectiveProvider: eff,
    demo: eff === 'demo',
    keys,
    monthlyBudgetKrw: s.monthlyBudgetKrw,
    warnPct: s.warnPct,
    fxKrwPerUsd: s.fxKrwPerUsd,
    features: AI_FEATURE_IDS.map((id) => featureSettings(s, id)),
  };
}

/** API 키 입력 검사: 앞뒤 공백 제거, 10~400자, 공백·줄바꿈 없음 */
const apiKeyInput = z
  .string()
  .trim()
  .min(10, 'API 키가 너무 짧습니다. 공급자 화면에서 복사한 키를 그대로 붙여 넣어 주세요.')
  .max(400, 'API 키가 너무 깁니다.')
  .regex(/^\S+$/, 'API 키에 띄어쓰기나 줄바꿈이 있으면 안 됩니다.');

/** PUT /api/ai/settings 입력. 모든 항목은 바꿀 때만 보낸다. keys의 값이 null이면 그 키를 지운다 */
export const aiSettingsPatchSchema = z
  .object({
    provider: z.enum(AI_PROVIDERS, { error: '공급자를 다시 골라 주세요.' }).optional(),
    keys: z
      .object({ anthropic: apiKeyInput.nullable().optional(), openai: apiKeyInput.nullable().optional(), gemini: apiKeyInput.nullable().optional() })
      .optional(),
    monthlyBudgetKrw: z.number({ error: '월 예산은 숫자로 적어 주세요.' }).int('월 예산은 원 단위 정수로 적어 주세요.').min(0, '월 예산은 0원 이상이어야 합니다.').max(100_000_000, '월 예산이 너무 큽니다.').optional(),
    budget: z.number().int().min(0).max(100_000_000).optional(),
    warnPct: z.number().int().min(1, '경고 비율은 1~100 사이로 적어 주세요.').max(100, '경고 비율은 1~100 사이로 적어 주세요.').optional(),
    fxKrwPerUsd: z.number({ error: '환율은 숫자로 적어 주세요.' }).min(100, '환율을 확인해 주세요.').max(10000, '환율을 확인해 주세요.').optional(),
    fx: z.number().min(100).max(10000).optional(),
    features: z.partialRecord(z.enum(AI_FEATURE_IDS), featureOverrideSchema).optional(),
  })
  .strict();

export type AiSettingsPatch = z.output<typeof aiSettingsPatchSchema>;

/** 설정에 바꿀 값을 반영한다. 바뀐 키 공급자 이름 목록을 돌려준다(감사 기록용, 키 값은 넣지 않음) */
export function applyAiSettingsPatch(dataDir: string, s: AiSettings, patch: AiSettingsPatch): RealProvider[] {
  if (patch.provider) s.provider = patch.provider;
  const budget = patch.monthlyBudgetKrw ?? patch.budget;
  if (budget !== undefined) s.monthlyBudgetKrw = budget;
  if (patch.warnPct !== undefined) s.warnPct = patch.warnPct;
  const fx = patch.fxKrwPerUsd ?? patch.fx;
  if (fx !== undefined) s.fxKrwPerUsd = fx;
  const changed: RealProvider[] = [];
  for (const p of REAL_PROVIDERS) {
    const v = patch.keys?.[p];
    if (v === undefined) continue;
    setApiKey(dataDir, s, p, v);
    changed.push(p);
  }
  for (const [id, f] of Object.entries(patch.features ?? {}) as [AiFeatureId, AiFeatureOverride][]) {
    s.features[id] = { ...(s.features[id] ?? {}), ...f };
  }
  return changed;
}

/** 개인정보 필터 설정. 병원 대표번호는 허용 목록에 자동으로 더한다(FR-032 AC3) */
export function readPrivacyForAi(db: Db): PrivacySettings {
  const p = parsePrivacySettings(readSettingJson(db, PRIVACY_SETTINGS_KEY));
  const phone = readClinic(db)?.phone;
  if (phone && !p.allowlist.includes(phone)) p.allowlist = [...p.allowlist, phone];
  return p;
}

/** 병원 기본 정보(settings.clinic) */
export function readClinic(db: Db): PromptContext['clinic'] {
  const v = readSettingJson(db, 'clinic');
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x : undefined);
  return {
    name: str(o.name),
    phone: str(o.phone),
    hours: o.hours ?? undefined,
    holidayNote: str(o.holidayNote),
    parking: str(o.parking),
    location: str(o.location),
    insuranceNote: str(o.insuranceNote),
  };
}

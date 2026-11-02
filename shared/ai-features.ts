// 이 파일이 하는 일: AI 기능 14개의 목록과 기본값(등급·허용 역할·시간 초과·최대 출력 토큰·출력 형식)을 한곳에 둔다(backend.md §4, TD-021).
// 서버 게이트웨이(server/ai/gateway.ts)와 관리 화면(AI 설정)이 이 표 하나를 함께 쓴다. 기능별 프롬프트·데모 본문은 server/ai/features/<id>.ts에 있다.
// 기본 허용 역할은 shared/roles.ts의 권한(ai.<id>)에서 가져온다. 관리자는 AI 설정에서 기능을 끄거나 역할을 줄일 수만 있다(늘릴 수는 없다).
import { CAPS, type Cap, type Role } from './roles.ts';

/** 모델 등급: 빠름·표준·고급(FR-033) */
export const AI_TIERS = ['fast', 'standard', 'premium'] as const;
export type AiTier = (typeof AI_TIERS)[number];
export const AI_TIER_LABELS: Record<AiTier, string> = { fast: '빠름', standard: '표준', premium: '고급' };

/** AI 공급자. demo는 키 없이 예시 응답을 돌려준다(FR-030) */
export const AI_PROVIDERS = ['demo', 'anthropic', 'openai', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
/** 실제로 호출하는 공급자(키가 필요한 것) */
export const REAL_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type RealProvider = (typeof REAL_PROVIDERS)[number];
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  demo: '데모(키 없음)',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
};

/** 기능 id(backend.md §4 표 순서) */
export const AI_FEATURE_IDS = [
  'quick',
  'script',
  'review_reply',
  'template',
  'doc_writer',
  'doc_revise',
  'minutes',
  'adcheck',
  'promo',
  'hiring',
  'onboarding',
  'assistant',
  'receipt',
  'monthly_summary',
] as const;
export type AiFeatureId = (typeof AI_FEATURE_IDS)[number];

/** 응답 모양: 그냥 글, 마크다운, JSON(zod로 검사) */
export type AiOutputKind = 'text' | 'markdown' | 'json';

/** 기능 하나의 기본값 */
export interface AiFeatureDef {
  id: AiFeatureId;
  /** 화면에 보여 줄 이름 */
  label: string;
  /** 어느 화면에서 쓰는지 */
  screen: string;
  /** 권한 표(shared/roles.ts)의 권한 이름. 기본 허용 역할이 여기서 나온다 */
  cap: Cap;
  /** 기본 등급 */
  tier: AiTier;
  /** 사용자가 요청마다 등급을 고를 수 있는지(문서 작성기) */
  userTier: boolean;
  /** 시간 초과(밀리초) */
  timeoutMs: number;
  /** 고급 등급일 때 시간 초과(없으면 timeoutMs) */
  premiumTimeoutMs?: number;
  /** 최대 출력 토큰 */
  maxTokens: number;
  /** 응답 모양 */
  output: AiOutputKind;
  /** 사진을 함께 보내는 기능인지(receipt) */
  images: boolean;
}

const S = 1000;

/** 14개 기능의 기본값(backend.md §4) */
export const AI_FEATURES: Readonly<Record<AiFeatureId, AiFeatureDef>> = {
  quick: { id: 'quick', label: '빠른 요청', screen: '대시보드', cap: 'ai.quick', tier: 'fast', userTier: false, timeoutMs: 30 * S, maxTokens: 1024, output: 'text', images: false },
  script: { id: 'script', label: '전화 응대 스크립트', screen: '데스크 > 스크립트', cap: 'ai.script', tier: 'fast', userTier: false, timeoutMs: 30 * S, maxTokens: 1500, output: 'text', images: false },
  review_reply: { id: 'review_reply', label: '리뷰 답글', screen: '마케팅 > 리뷰 답글', cap: 'ai.review_reply', tier: 'fast', userTier: false, timeoutMs: 30 * S, maxTokens: 1500, output: 'json', images: false },
  template: { id: 'template', label: '문자·안내문 템플릿', screen: '데스크 > 템플릿', cap: 'ai.template', tier: 'fast', userTier: false, timeoutMs: 30 * S, maxTokens: 1000, output: 'text', images: false },
  doc_writer: { id: 'doc_writer', label: 'AI 문서 작성', screen: '문서 > 새 문서', cap: 'ai.doc_writer', tier: 'standard', userTier: true, timeoutMs: 90 * S, premiumTimeoutMs: 120 * S, maxTokens: 4000, output: 'markdown', images: false },
  doc_revise: { id: 'doc_revise', label: '문서 부분 수정', screen: '문서 > 편집', cap: 'ai.doc_revise', tier: 'fast', userTier: false, timeoutMs: 60 * S, maxTokens: 2000, output: 'markdown', images: false },
  minutes: { id: 'minutes', label: '회의록 요약', screen: '문서 > 회의록', cap: 'ai.minutes', tier: 'fast', userTier: false, timeoutMs: 60 * S, maxTokens: 2000, output: 'json', images: false },
  adcheck: { id: 'adcheck', label: '의료광고 점검(AI 2차)', screen: '마케팅 > 광고 점검', cap: 'ai.adcheck', tier: 'fast', userTier: false, timeoutMs: 45 * S, maxTokens: 1500, output: 'json', images: false },
  promo: { id: 'promo', label: '홍보 글', screen: '마케팅 > 홍보 글', cap: 'ai.promo', tier: 'standard', userTier: false, timeoutMs: 90 * S, maxTokens: 2500, output: 'markdown', images: false },
  hiring: { id: 'hiring', label: '채용 공고·면접 질문', screen: '인사 > 채용', cap: 'ai.hiring', tier: 'standard', userTier: false, timeoutMs: 90 * S, maxTokens: 2500, output: 'json', images: false },
  onboarding: { id: 'onboarding', label: '온보딩 초안', screen: '인사 > 온보딩', cap: 'ai.onboarding', tier: 'standard', userTier: false, timeoutMs: 60 * S, maxTokens: 2000, output: 'json', images: false },
  assistant: { id: 'assistant', label: '원내 AI 도우미', screen: '원내 도우미', cap: 'ai.assistant', tier: 'standard', userTier: false, timeoutMs: 60 * S, maxTokens: 1500, output: 'text', images: false },
  receipt: { id: 'receipt', label: '명세서 사진 읽기', screen: '재고 > 명세서 입고', cap: 'ai.receipt', tier: 'standard', userTier: false, timeoutMs: 90 * S, maxTokens: 2000, output: 'json', images: true },
  monthly_summary: { id: 'monthly_summary', label: '월간 요약 문장', screen: '운영 > 월간 요약', cap: 'ai.monthly_summary', tier: 'fast', userTier: false, timeoutMs: 45 * S, maxTokens: 800, output: 'text', images: false },
};

/** 값이 기능 id인지 */
export function isAiFeatureId(value: unknown): value is AiFeatureId {
  return typeof value === 'string' && (AI_FEATURE_IDS as readonly string[]).includes(value);
}

/** 기능의 기본 허용 역할(권한 표 기준) */
export function defaultFeatureRoles(id: AiFeatureId): readonly Role[] {
  return CAPS[AI_FEATURES[id].cap].roles;
}

/** 기능·등급에 맞는 시간 초과(밀리초) */
export function featureTimeoutMs(id: AiFeatureId, tier: AiTier): number {
  const f = AI_FEATURES[id];
  return tier === 'premium' && f.premiumTimeoutMs ? f.premiumTimeoutMs : f.timeoutMs;
}

/** 관리자가 기능마다 바꾼 값(settings.ai.features.<id>) */
export interface AiFeatureOverride {
  enabled?: boolean;
  roles?: Role[];
  tier?: AiTier;
}

/** 관리자 설정을 반영한 기능 설정 */
export interface EffectiveFeature {
  id: AiFeatureId;
  label: string;
  enabled: boolean;
  /** 실제로 허용되는 역할(기본 역할 ∩ 관리자가 고른 역할) */
  roles: Role[];
  defaultRoles: Role[];
  tier: AiTier;
  defaultTier: AiTier;
  userTier: boolean;
}

/** 기본값과 관리자 설정을 합친다. 관리자가 고른 역할 중 기본 역할에 없는 것은 무시한다 */
export function effectiveFeature(id: AiFeatureId, override?: AiFeatureOverride | null): EffectiveFeature {
  const def = AI_FEATURES[id];
  const base = [...defaultFeatureRoles(id)];
  const roles = override?.roles ? base.filter((r) => override.roles?.includes(r)) : base;
  return {
    id,
    label: def.label,
    enabled: override?.enabled ?? true,
    roles,
    defaultRoles: base,
    tier: override?.tier ?? def.tier,
    defaultTier: def.tier,
    userTier: def.userTier,
  };
}

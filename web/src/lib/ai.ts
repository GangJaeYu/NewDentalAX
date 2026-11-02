// 이 파일이 하는 일: 화면에서 AI를 부를 때 쓰는 도우미(frontend.md §2 AiPanel, backend.md §3.10).
// - runAiStream: POST /api/ai/stream(SSE)을 받아 글 조각(delta)·완료(done)·오류(error)를 나눠 알려 준다(api.stream 래퍼, 중지는 AbortSignal).
// - estimateCostKrw: 입력 글 길이와 등급 단가로 예상 비용(원)을 어림한다(FR-033 AC2). 실제 비용은 서버가 공급자 사용량으로 계산한다.
// - aiErrorHelp: AI 오류 코드마다 다음에 할 일 안내를 붙인다(FR-037). 기술 오류 원문은 보여 주지 않고 서버의 한국어 문구를 쓴다.
import { AI_FEATURES, AI_TIER_LABELS, type AiFeatureId, type AiProvider, type AiTier, type RealProvider } from '../../../shared/ai-features.ts';
import type { PiiType } from '../../../shared/privacy-rules.ts';
import type { Role } from '../../../shared/roles.ts';
import { api, ApiError } from './api.ts';
import { formatNumber } from './format.ts';

/** 등급 하나의 단가(USD/100만 토큰) */
export interface TierPrice {
  modelId: string;
  inputUsdPerM: number;
  outputUsdPerM: number;
}

/** GET /api/ai/status 응답 */
export interface AiStatus {
  demo: boolean;
  provider: AiProvider;
  features: Array<{ id: AiFeatureId; label: string; enabled: boolean; allowed: boolean; tier: AiTier; userTier: boolean }>;
  budget: { exceeded: boolean; monthKrw?: number; budgetKrw?: number; pct?: number; warnPct?: number };
  /** 지금 공급자의 등급별 단가와 환율(데모면 null) */
  pricing?: { fxKrwPerUsd: number; tiers: Partial<Record<AiTier, TierPrice>> } | null;
}

/** 개인정보 감지 한 종류 */
export interface PiiFindingView {
  type: PiiType;
  count: number;
}

/** AI 결과(서버 AiResult, backend.md §1) */
export interface AiResultView {
  text: string;
  demo: boolean;
  usage: { inputTokens: number; outputTokens: number; costKrw: number; estimated: boolean };
  privacy: { findings: PiiFindingView[]; redacted: boolean; notice: string | null; outputFindings: PiiFindingView[] };
  requestId: number;
  feature: string;
  provider: AiProvider;
  model: string | null;
  tier: AiTier;
  extra?: unknown;
}

/** 관리자용 기능 설정 한 줄(GET /api/ai/settings features[]) */
export interface AiFeatureSetting {
  id: AiFeatureId;
  label: string;
  enabled: boolean;
  roles: Role[];
  defaultRoles: Role[];
  tier: AiTier;
  defaultTier: AiTier;
  userTier: boolean;
}

/** GET/PUT /api/ai/settings 응답(키 원문 없음, 끝 4자리 가림만) */
export interface AiSettingsView {
  provider: AiProvider;
  effectiveProvider: AiProvider;
  demo: boolean;
  keys: Record<RealProvider, { saved: boolean; maskedKey: string | null }>;
  monthlyBudgetKrw: number;
  warnPct: number;
  fxKrwPerUsd: number;
  features: AiFeatureSetting[];
}

/** 모델·단가 한 줄(GET /api/ai/models) */
export interface AiModelView {
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

/** GET /api/ai/usage 응답(FR-034 AC3) */
export interface AiUsageReport {
  month: string;
  monthKrw: number;
  budgetKrw: number;
  pct: number;
  warnPct: number;
  calls: number;
  byFeature: Array<{ feature: string; calls: number; errors: number; inputTokens: number; outputTokens: number; costKrw: number }>;
  byUser: Array<{ userId: number | null; name: string | null; calls: number; costKrw: number }>;
  byDay: Array<{ date: string; calls: number; costKrw: number }>;
  recent: Array<{
    id: number;
    at: string;
    userName: string | null;
    feature: string;
    provider: string;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    costKrw: number;
    costUsd: number;
    estimated: boolean;
    demo: boolean;
    status: string;
    errorCode: string | null;
    privacy: Record<string, number> | null;
    durationMs: number | null;
  }>;
}

/** 기능 id → 화면 이름(모르는 id는 그대로) */
export function featureLabel(id: string): string {
  return (AI_FEATURES as Record<string, { label: string } | undefined>)[id]?.label ?? id;
}

/** 'YYYY-MM'에서 n달 옮긴 달 */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** 'YYYY-MM' → "2026년 11월" */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}년 ${m}월`;
}

/** 예산 비율에 맞는 색(경고 비율 이상 주의, 100% 이상 위험) */
export function budgetTone(pct: number, warnPct: number): 'danger' | 'warn' | 'ok' {
  if (pct >= 100) return 'danger';
  if (pct >= warnPct) return 'warn';
  return 'ok';
}

/** AI 상태 불러오기(useApi 키: 'ai:status') */
export function fetchAiStatus(): Promise<AiStatus> {
  return api.get<AiStatus>('/api/ai/status');
}

/** 스트림 받는 쪽 */
export interface AiStreamHandlers {
  /** 글 조각이 올 때마다 */
  onDelta: (text: string) => void;
}

/**
 * AI 스트림을 실행한다. 다 끝나면 결과(AiResult 메타)를 돌려주고, 서버가 오류 사건을 보내면 ApiError로 던진다.
 * 권한·예산·개인정보 차단은 스트림이 열리기 전에 일반 오류(ApiError)로 온다. 중지(signal)하면 AbortError가 난다.
 */
export async function runAiStream(
  body: { feature: AiFeatureId; input: unknown; tier?: AiTier },
  handlers: AiStreamHandlers,
  signal?: AbortSignal,
): Promise<AiResultView> {
  let result: AiResultView | null = null;
  let failure: ApiError | null = null;
  await api.stream(
    '/api/ai/stream',
    body,
    (ev) => {
      let data: unknown;
      try {
        data = ev.data ? JSON.parse(ev.data) : null;
      } catch {
        data = null;
      }
      if (ev.event === 'delta') {
        const t = (data as { text?: unknown } | null)?.text;
        if (typeof t === 'string') handlers.onDelta(t);
      } else if (ev.event === 'done') {
        result = data as AiResultView;
      } else if (ev.event === 'error') {
        const e = (data ?? {}) as { code?: unknown; message?: unknown };
        failure = new ApiError(
          502,
          typeof e.code === 'string' ? e.code : 'AI_UNAVAILABLE',
          typeof e.message === 'string' && e.message ? e.message : 'AI 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
    },
    { signal },
  );
  if (failure) throw failure;
  if (!result) throw new ApiError(502, 'AI_UNAVAILABLE', 'AI 응답이 중간에 끊겼습니다. 다시 시도해 주세요.');
  return result;
}

/** 프롬프트 앞에 서버가 붙이는 안내(병원 정보 등) 몫으로 더하는 토큰 수(어림) */
const SYSTEM_TOKENS = 300;

/** 글자 수로 토큰을 어림한다(서버 pricing.estimateTokens와 같은 기준: 약 2글자 = 1토큰) */
export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 2) : 0;
}

/**
 * 예상 비용(원). 입력 = 글 길이 + 안내 몫, 출력 = 기능 최대 출력의 절반으로 어림한다.
 * 데모이거나 단가를 모르면 null(화면은 "데모라 0원" 등으로 따로 보여 준다).
 */
export function estimateCostKrw(text: string, feature: AiFeatureId, price: TierPrice | undefined | null, fxKrwPerUsd: number | undefined): number | null {
  if (!price || !fxKrwPerUsd) return null;
  const input = estimateTokens(text) + SYSTEM_TOKENS;
  const output = Math.ceil(AI_FEATURES[feature].maxTokens / 2);
  const usd = (input * price.inputUsdPerM + output * price.outputUsdPerM) / 1_000_000;
  return usd * fxKrwPerUsd;
}

/** 작은 금액도 알아보게 원으로 쓴다(1원 미만은 "1원 미만", 10원 미만은 소수 한 자리) */
export function formatSmallWon(krw: number): string {
  if (krw <= 0) return '0원';
  if (krw < 1) return '1원 미만';
  if (krw < 10) return `${formatNumber(krw, 1)}원`;
  return `${formatNumber(Math.round(krw))}원`;
}

/** 예상 비용 글(예: "약 9원", 데모면 "데모 0원", 단가를 모르면 "예상 비용 모름") */
export function costText(cost: number | null, demo: boolean, prefix = '약'): string {
  if (demo) return '데모 0원';
  if (cost === null) return '예상 비용 모름';
  return `${prefix} ${formatSmallWon(cost)}`;
}

/** 등급과 예상 비용을 한 줄로(예: "빠름 모델 · 예상 3원") */
export function tierCostLabel(tier: AiTier, cost: number | null, demo: boolean): string {
  return `${AI_TIER_LABELS[tier]} 모델 · ${costText(cost, demo, '예상')}`;
}

/** 오류 코드별 다음에 할 일(FR-037 AC1). 관리자 본인이면 직접 고칠 곳을 알려 준다 */
export function aiErrorHelp(code: string, isAdmin: boolean): string | null {
  switch (code) {
    case 'AI_BUDGET_EXCEEDED':
      return isAdmin ? 'AI 설정에서 월 예산을 올리면 바로 다시 쓸 수 있어요.' : '원장님(관리자)께 이번 달 AI 예산 조정을 문의해 주세요.';
    case 'AI_AUTH':
      return isAdmin ? 'AI 설정에서 API 키를 다시 저장하고 "연결 확인"을 눌러 보세요.' : '원장님(관리자)께 AI 키 확인을 요청해 주세요.';
    case 'AI_DISABLED':
      return isAdmin ? 'AI 설정의 "기능별 사용"에서 켤 수 있어요.' : '이 기능이 필요하면 원장님(관리자)께 문의해 주세요.';
    case 'AI_PII_BLOCKED':
      return '해당 부분을 지운 뒤 다시 실행해 주세요.';
    case 'AI_TIMEOUT':
      return '내용을 줄이거나 잠시 뒤 다시 시도해 주세요.';
    case 'AI_RATE_LIMIT':
      return '1분쯤 기다린 뒤 다시 시도해 주세요.';
    case 'AI_NETWORK':
    case 'NETWORK':
      return '서버 PC의 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
    case 'AI_UNAVAILABLE':
    case 'AI_BAD_OUTPUT':
      return '잠시 뒤 다시 시도해 주세요.';
    default:
      return null;
  }
}

// 이 파일이 하는 일: AI 게이트웨이와 공급자 어댑터(anthropic·openai·gemini·demo)가 함께 쓰는 타입과 실행 옵션을 정한다(TD-009).
// 어댑터는 모두 같은 generate(요청) → {text, usage} / stream(요청) → 조각들 인터페이스를 구현한다.
// 테스트는 AiOptions로 공급자 주소(가짜 LLM 서버)와 시간 초과를 바꿔 끼운다. 운영에서는 환경 변수 AI_BASE_URL_*만 본다(테스트 전용).
import type { RealProvider } from '../../shared/ai-features.ts';

/** 대화 한 줄(시스템 안내는 따로 둔다) */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 함께 보내는 사진(receipt) */
export interface AiImage {
  /** 예: 'image/jpeg' */
  mime: string;
  /** base64 본문 */
  data: string;
}

/** 공급자에게 보내는 요청 하나 */
export interface ProviderRequest {
  /** 공급자 모델 이름(예: claude-haiku-5-5) */
  model: string;
  system: string;
  messages: AiMessage[];
  images?: AiImage[];
  maxTokens: number;
  /** 시간 초과·사용자 중지 때 요청을 끊는 신호 */
  signal: AbortSignal;
}

/** 공급자가 알려 준 토큰 수 */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

/** 한 번에 받은 응답 */
export interface ProviderResult {
  text: string;
  /** 공급자가 사용량을 주지 않으면 null(글자 수로 추정한다) */
  usage: ProviderUsage | null;
}

/** 스트림 조각: 글 조각이나 사용량 */
export type StreamChunk = { type: 'delta'; text: string } | { type: 'usage'; usage: Partial<ProviderUsage> };

/** 공급자 어댑터 */
export interface ProviderAdapter {
  generate(req: ProviderRequest): Promise<ProviderResult>;
  stream(req: ProviderRequest): AsyncGenerator<StreamChunk>;
}

/** 어댑터를 만들 때 넘기는 값 */
export interface ProviderConfig {
  apiKey: string;
  /** 공급자 주소의 앞부분(예: https://api.anthropic.com). 테스트는 가짜 서버 주소를 넣는다 */
  baseUrl: string;
}

/** buildApp에 넣는 AI 실행 옵션(테스트용). 넣지 않으면 환경 변수와 기본값을 쓴다 */
export interface AiOptions {
  /** 공급자별 주소(가짜 LLM 서버) */
  baseUrls?: Partial<Record<RealProvider, string>>;
  /** 모든 기능의 시간 초과를 이 값(밀리초)으로 바꾼다(지연 응답 시험용) */
  timeoutMs?: number;
  /** 데모 스트림 조각 사이 쉬는 시간(밀리초, 기본 30) */
  demoStreamDelayMs?: number;
}

/** 공급자 공식 주소(TD-009) */
export const DEFAULT_BASE_URLS: Readonly<Record<RealProvider, string>> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

/** 환경 변수 AI_BASE_URL_ANTHROPIC/OPENAI/GEMINI(테스트 전용, overview §4)를 읽는다 */
export function baseUrlsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<Record<RealProvider, string>> {
  const out: Partial<Record<RealProvider, string>> = {};
  if (env.AI_BASE_URL_ANTHROPIC) out.anthropic = env.AI_BASE_URL_ANTHROPIC;
  if (env.AI_BASE_URL_OPENAI) out.openai = env.AI_BASE_URL_OPENAI;
  if (env.AI_BASE_URL_GEMINI) out.gemini = env.AI_BASE_URL_GEMINI;
  return out;
}

/** 공급자 오류를 한국어 오류 코드로 바꾸기 전 단계의 오류(gateway가 AppError로 바꾼다) */
export class ProviderError extends Error {
  readonly code: 'AI_AUTH' | 'AI_RATE_LIMIT' | 'AI_UNAVAILABLE' | 'AI_TIMEOUT' | 'AI_NETWORK' | 'AI_BAD_OUTPUT' | 'AI_ABORTED';
  /** 공급자가 돌려준 HTTP 상태(있으면) */
  readonly httpStatus: number | null;

  constructor(code: ProviderError['code'], httpStatus: number | null = null, message?: string) {
    super(message ?? code);
    this.name = 'ProviderError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

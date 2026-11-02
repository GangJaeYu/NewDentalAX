// 이 파일이 하는 일: API 오류를 한 가지 형식으로 다룬다. AppError(HTTP 상태·코드·한국어 문구·항목별 이유)와
// 오류 코드표(backend.md §2 공통 오류, §5 AI 오류)를 두고, 어떤 오류든 { error: { code, message, fields? } } 응답으로 바꾼다.
// 화면에 그대로 보여 줄 문구이므로 쉬운 한국어로 쓴다.

/** 오류 코드 → [HTTP 상태, 기본 문구] */
export const ERROR_CODES = {
  VALIDATION: [400, '입력값을 확인해 주세요.'],
  UNAUTHENTICATED: [401, '다시 로그인해 주세요.'],
  INVALID_LOGIN: [401, '아이디 또는 비밀번호가 맞지 않습니다.'],
  FORBIDDEN: [403, '이 기능을 사용할 권한이 없습니다.'],
  CSRF: [403, '보안 확인에 실패했습니다. 화면을 새로 고쳐 주세요.'],
  NETWORK_BLOCKED: [403, '원내 네트워크에서만 접속할 수 있습니다.'],
  PASSWORD_CHANGE_REQUIRED: [403, '새 비밀번호로 바꾼 뒤 이용할 수 있습니다.'],
  NOT_FOUND: [404, '찾는 항목이 없습니다.'],
  CONFLICT: [409, '다른 내용과 겹쳐서 처리하지 못했습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.'],
  SETUP_DONE: [409, '이미 첫 설정이 끝났습니다. 로그인해 주세요.'],
  LAST_ADMIN: [409, '마지막 관리자 계정은 바꾸거나 끌 수 없습니다. 다른 관리자를 먼저 만들어 주세요.'],
  FILE_TOO_LARGE: [413, '파일이 너무 큽니다(최대 20MB).'],
  FILE_TYPE: [415, '올릴 수 없는 파일 형식입니다.'],
  LOCKED: [423, '로그인을 5번 실패해 15분 동안 잠겼습니다. 잠시 뒤 다시 시도해 주세요.'],
  MAINTENANCE: [503, '백업 복원 중입니다. 잠시 후 다시 시도해 주세요.'],
  INTERNAL: [500, '예기치 못한 문제가 생겼습니다. 잠시 후 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.'],
  // AI 오류(backend.md §5)
  AI_DISABLED: [403, '관리자가 이 AI 기능을 꺼 두었습니다.'],
  AI_BUDGET_EXCEEDED: [402, '이번 달 AI 예산을 모두 사용했습니다. 관리자에게 한도 조정을 요청하세요.'],
  AI_PII_BLOCKED: [422, '주민등록번호로 보이는 내용이 있어 AI로 보내지 않았습니다. 해당 부분을 지우고 다시 시도해 주세요.'],
  AI_TIMEOUT: [504, 'AI 응답이 너무 오래 걸려 중단했습니다. 내용을 줄이거나 잠시 후 다시 시도해 주세요.'],
  AI_AUTH: [502, 'AI 키가 올바르지 않거나 만료되었습니다. 관리자에게 AI 설정 확인을 요청하세요.'],
  AI_RATE_LIMIT: [429, 'AI 서비스 요청이 많아 잠시 막혔습니다. 1분 뒤 다시 시도해 주세요.'],
  AI_UNAVAILABLE: [502, 'AI 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.'],
  AI_NETWORK: [502, '인터넷 연결을 확인해 주세요. 원내 서버 PC가 인터넷에 연결되어 있어야 AI를 쓸 수 있습니다.'],
  AI_BAD_OUTPUT: [502, 'AI 응답을 이해하지 못했습니다. 다시 시도해 주세요.'],
} as const satisfies Record<string, readonly [number, string]>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** API 오류 응답 본문(overview §2) */
export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; [extra: string]: unknown };
}

/**
 * 서비스·라우트가 던지는 오류. 라우트 오류 처리기가 HTTP 상태와 한국어 응답으로 바꾼다.
 * 예: throw new AppError('NOT_FOUND') / new AppError('VALIDATION', { fields: { name: '이름을 적어 주세요.' } })
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  /** 응답에 함께 실어 보낼 추가 값(예: LOCKED의 retryAfterSec, AI_PII_BLOCKED의 findings) */
  readonly extra?: Record<string, unknown>;

  constructor(code: ErrorCode, opts: { message?: string; fields?: Record<string, string>; extra?: Record<string, unknown>; cause?: unknown } = {}) {
    super(opts.message ?? ERROR_CODES[code][1], opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code][0];
    if (opts.fields) this.fields = opts.fields;
    if (opts.extra) this.extra = opts.extra;
  }

  /** 응답 본문으로 바꾼다 */
  toBody(): ApiErrorBody {
    const body: ApiErrorBody = { error: { ...(this.extra ?? {}), code: this.code, message: this.message } };
    if (this.fields) body.error.fields = this.fields;
    return body;
  }
}

/** 입력 오류(400). fields에 항목별 이유를 한국어로 적는다 */
export function validationError(fields: Record<string, string>, message?: string): AppError {
  return new AppError('VALIDATION', { fields, ...(message ? { message } : {}) });
}

/** 로그인 잠금(423) 문구: 남은 시간을 분 단위(올림)로 알려 준다 */
export function lockedError(retryAfterSec: number): AppError {
  const min = Math.max(1, Math.ceil(retryAfterSec / 60));
  return new AppError('LOCKED', {
    message: `로그인을 5번 실패해 15분 동안 잠겼습니다. 약 ${min}분 뒤 다시 시도해 주세요.`,
    extra: { retryAfterSec },
  });
}

/**
 * 어떤 오류든 HTTP 상태와 응답 본문으로 바꾼다.
 * AppError는 그대로, Fastify 입력 검증 오류는 400 VALIDATION, 그 밖의 오류는 500 INTERNAL(내부 내용은 숨김)로 바꾼다.
 */
export function toErrorResponse(err: unknown): { status: number; body: ApiErrorBody } {
  if (err instanceof AppError) return { status: err.status, body: err.toBody() };
  const e = err as { validation?: unknown; statusCode?: number; code?: string } | null;
  if (e && typeof e === 'object' && e.validation) {
    return { status: 400, body: new AppError('VALIDATION').toBody() };
  }
  // Fastify가 내는 4xx(본문 형식 오류·너무 큰 요청 등)는 상태를 살리고 한국어 문구로 바꾼다
  if (e && typeof e === 'object' && typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
    if (e.statusCode === 413) return { status: 413, body: new AppError('FILE_TOO_LARGE').toBody() };
    if (e.statusCode === 415) return { status: 415, body: new AppError('FILE_TYPE').toBody() };
    if (e.statusCode === 404) return { status: 404, body: new AppError('NOT_FOUND').toBody() };
    return { status: 400, body: new AppError('VALIDATION', { message: '요청 형식이 올바르지 않습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.' }).toBody() };
  }
  return { status: 500, body: new AppError('INTERNAL').toBody() };
}

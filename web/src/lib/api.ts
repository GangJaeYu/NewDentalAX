// 이 파일이 하는 일: 화면이 서버 API를 부르는 단일 통로(frontend.md §5). JSON을 주고받고, 상태를 바꾸는 요청에는 CSRF 헤더(X-CSRF-Token)를 자동으로 붙인다.
// 성공 응답 { data }는 data만 돌려주고, 실패 응답 { error: { code, message, fields? } }는 ApiError로 던진다(message는 서버의 한국어 문구 그대로).
// 서버에 닿지 못하면 연결 상태(connection.ts)에 알리고, 401을 받으면 등록된 처리기(로그인 화면으로 이동)를 부른다. SSE 스트림은 api.stream으로 받는다.
import { CSRF_HEADER } from '../../../shared/schemas/auth.ts';
import { connection } from './connection.ts';

/** 서버 오류를 화면에서 다루기 쉽게 담은 객체 */
export class ApiError extends Error {
  /** HTTP 상태 코드(서버에 닿지 못했으면 0) */
  readonly status: number;
  /** 서버 오류 코드(예: VALIDATION, UNAUTHENTICATED). 네트워크 오류는 NETWORK */
  readonly code: string;
  /** 입력 항목별 오류 문구(VALIDATION일 때) */
  readonly fields?: Record<string, string>;
  /** 잠금 등에서 다시 시도할 수 있을 때까지 남은 초 */
  readonly retryAfterSec?: number;
  /** 서버가 오류와 함께 보낸 그 밖의 값(예: 재고보다 많은 출고의 needsConfirm·stock) */
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: { fields?: Record<string, string>; retryAfterSec?: number; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (extra.fields) this.fields = extra.fields;
    if (extra.retryAfterSec !== undefined) this.retryAfterSec = extra.retryAfterSec;
    if (extra.details) this.details = extra.details;
  }
}

/** 네트워크 오류 문구 */
export const NETWORK_MESSAGE = '서버에 연결할 수 없어요. 원내 와이파이에 연결되어 있는지 확인해 주세요.';

let csrfToken: string | null = null;
let onUnauthorized: ((err: ApiError) => void) | null = null;

/** 로그인·세션 확인 뒤 받은 CSRF 토큰을 기억한다(로그아웃하면 null) */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** 401(로그인 필요)을 받았을 때 부를 함수를 등록한다 */
export function setUnauthorizedHandler(fn: ((err: ApiError) => void) | null): void {
  onUnauthorized = fn;
}

/** 401이 와도 로그인 화면으로 보내지 않는 API(로그인 시도·세션 확인 자체) */
const NO_REDIRECT_PATHS = ['/api/session', '/api/auth/login', '/api/setup'];

/** 실패 응답 본문을 ApiError로 바꾼다 */
export function toApiError(status: number, body: unknown): ApiError {
  const err = (body as { error?: { code?: unknown; message?: unknown; fields?: unknown; retryAfterSec?: unknown } } | null)?.error;
  const code = typeof err?.code === 'string' ? err.code : status >= 500 ? 'INTERNAL' : 'ERROR';
  const message =
    typeof err?.message === 'string' && err.message
      ? err.message
      : status >= 500
        ? '서버에서 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.'
        : '요청을 처리하지 못했어요. 다시 시도해 주세요.';
  const fields = err?.fields && typeof err.fields === 'object' ? (err.fields as Record<string, string>) : undefined;
  const retryAfterSec = typeof err?.retryAfterSec === 'number' ? err.retryAfterSec : undefined;
  const rest: Record<string, unknown> = {};
  if (err && typeof err === 'object') {
    for (const [k, v] of Object.entries(err)) if (!['code', 'message', 'fields', 'retryAfterSec'].includes(k)) rest[k] = v;
  }
  return new ApiError(status, code, message, { fields, retryAfterSec, details: Object.keys(rest).length ? rest : undefined });
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions {
  signal?: AbortSignal;
}

/** 요청 헤더를 만든다(본문이 있으면 JSON, 상태를 바꾸는 요청이면 CSRF) */
function headersFor(method: Method, hasBody: boolean): Record<string, string> {
  const h: Record<string, string> = { accept: 'application/json' };
  if (hasBody) h['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) h[CSRF_HEADER] = csrfToken;
  return h;
}

/** fetch를 부르고, 서버에 닿지 못하면 연결 상태에 알린 뒤 ApiError(NETWORK)를 던진다 */
async function send(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    connection.reportFailure();
    throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  }
  connection.reportSuccess();
  return res;
}

/** 실패 응답을 처리한다(401이면 처리기를 부른다) */
async function fail(path: string, res: Response): Promise<never> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 본문이 JSON이 아니면 기본 문구를 쓴다
  }
  const err = toApiError(res.status, body);
  if (res.status === 401 && onUnauthorized && !NO_REDIRECT_PATHS.includes(path.split('?')[0] ?? '')) onUnauthorized(err);
  throw err;
}

/** JSON 요청을 보내고 data를 돌려준다(204면 undefined) */
async function request<T>(method: Method, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const hasBody = body !== undefined;
  const res = await send(path, {
    method,
    headers: headersFor(method, hasBody),
    body: hasBody ? JSON.stringify(body) : undefined,
    signal: opts.signal,
  });
  if (!res.ok) return fail(path, res);
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as { data?: T } | null;
  return (json && 'data' in json ? json.data : json) as T;
}

/**
 * 쪽 나누기 목록(GET)을 받는다. 응답 본문 { data, total, ...그 밖의 값 }을 그대로 돌려준다(api.get은 data만 돌려줌).
 * 예: const { data, total } = await api.page<ItemRow>('/api/items?page=2')
 */
async function page<T, Extra extends object = object>(path: string, opts: RequestOptions = {}): Promise<{ data: T[]; total: number } & Extra> {
  const res = await send(path, { method: 'GET', headers: headersFor('GET', false), signal: opts.signal });
  if (!res.ok) return fail(path, res);
  const json = (await res.json().catch(() => null)) as ({ data?: T[]; total?: number } & Extra) | null;
  const data = Array.isArray(json?.data) ? json.data : [];
  return { ...(json ?? ({} as Extra)), data, total: typeof json?.total === 'number' ? json.total : data.length } as { data: T[]; total: number } & Extra;
}

/** SSE 한 사건 */
export interface SseEvent {
  /** 사건 이름(event: 줄, 없으면 'message') */
  event: string;
  /** data: 줄들을 줄바꿈으로 이은 값 */
  data: string;
}

/**
 * SSE 글 조각을 사건으로 나눈다. 다 끝나지 않은 마지막 조각은 rest로 돌려줘 다음 조각과 이어 붙인다.
 * 형식: "event: 이름\ndata: 값\n\n" (빈 줄로 사건 구분)
 */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      let value = idx === -1 ? '' : line.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0 || event !== 'message') events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

/**
 * POST로 SSE 스트림을 받는다. 사건이 올 때마다 onEvent를 부른다. 중지는 signal(AbortController)로 한다.
 * 실패 응답(4xx·5xx)은 스트림이 시작되기 전에 ApiError로 던진다.
 */
async function stream(path: string, body: unknown, onEvent: (ev: SseEvent) => void, opts: RequestOptions = {}): Promise<void> {
  const res = await send(path, {
    method: 'POST',
    headers: { ...headersFor('POST', true), accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) return fail(path, res);
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = parseSse(buf);
    buf = rest;
    for (const ev of events) onEvent(ev);
  }
  const tail = parseSse(`${buf}\n\n`);
  for (const ev of tail.events) onEvent(ev);
}

/** 서버 API 호출 모음 */
export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  page,
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, body ?? {}, opts),
  del: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
  stream,
};

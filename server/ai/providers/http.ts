// 이 파일이 하는 일: 공급자 어댑터가 함께 쓰는 HTTP 도구. fetch로 JSON을 보내고, HTTP 상태를 오류 코드로 바꾸고(401·403→AI_AUTH, 429→AI_RATE_LIMIT,
// 5xx→AI_UNAVAILABLE, 연결 실패→AI_NETWORK, 시간 초과→AI_TIMEOUT), 서버가 보내는 SSE(text/event-stream)를 한 이벤트씩 읽는다.
// 공급자 오류 본문은 읽지 않고 버린다(키 일부가 담길 수 있어 로그·화면에 남기지 않기 위해, TD-008).
import { ProviderError } from '../types.ts';

/** 끊긴 이유(signal.reason)를 오류 코드로 바꾼다. gateway가 시간 초과면 AI_TIMEOUT, 사용자 중지면 AI_ABORTED를 넣는다 */
function abortError(signal: AbortSignal): ProviderError {
  const reason: unknown = signal.reason;
  if (reason instanceof ProviderError) return reason;
  return new ProviderError('AI_ABORTED');
}

/** HTTP 상태 → 오류 코드 */
export function statusToCode(status: number): ProviderError['code'] {
  if (status === 401 || status === 403) return 'AI_AUTH';
  if (status === 429) return 'AI_RATE_LIMIT';
  return 'AI_UNAVAILABLE';
}

/**
 * JSON 본문으로 POST한다. 2xx가 아니면 ProviderError를 던진다(본문은 버린다).
 * 연결이 안 되면 AI_NETWORK, 신호로 끊기면 그 이유(AI_TIMEOUT·AI_ABORTED)를 던진다.
 */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal.aborted) throw abortError(signal);
    throw new ProviderError('AI_NETWORK');
  }
  if (!res.ok) {
    try {
      await res.body?.cancel();
    } catch {
      // 본문 버리기 실패는 무시한다
    }
    throw new ProviderError(statusToCode(res.status), res.status);
  }
  return res;
}

/** 응답 본문을 JSON으로 읽는다. 읽다가 끊기면 그 이유를, 형식이 틀리면 AI_BAD_OUTPUT을 던진다 */
export async function readJson(res: Response, signal: AbortSignal): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    if (signal.aborted) throw abortError(signal);
    throw new ProviderError('AI_NETWORK');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError('AI_BAD_OUTPUT');
  }
}

/** SSE 이벤트 하나 */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * SSE 응답 본문을 이벤트 단위로 읽는다(빈 줄로 구분, 'event:'·'data:' 줄).
 * 신호로 끊기면 그 이유를 던진다. 연결이 중간에 끊기면 AI_NETWORK를 던진다.
 */
export async function* readSse(res: Response, signal: AbortSignal): AsyncGenerator<SseEvent> {
  if (!res.body) throw new ProviderError('AI_BAD_OUTPUT');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const parse = (block: string): SseEvent | null => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return data.length ? { event, data: data.join('\n') } : null;
  };
  try {
    for (;;) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch {
        if (signal.aborted) throw abortError(signal);
        throw new ProviderError('AI_NETWORK');
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const ev = parse(block);
        if (ev) yield ev;
      }
    }
    const last = parse(buf);
    if (last) yield last;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 이미 닫혔으면 무시한다
    }
  }
}

/** JSON 글을 읽는다. 틀리면 null */
export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** 숫자면 그 값, 아니면 0 */
export function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// 이 파일이 하는 일: 브라우저로 AI 응답을 SSE(text/event-stream)로 흘려보낸다(FR-060 AC4, TD-009 스트리밍).
// 이벤트는 delta{text} … done{AiResult} 또는 error{code, message}다. 브라우저가 연결을 끊으면(중지 버튼) signal이 끊겨 공급자 요청도 함께 끊긴다.
// Fastify 응답을 직접 다루므로(hijack) 보안 헤더를 여기서 직접 붙인다.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SECURITY_HEADERS } from '../security/headers.ts';

/** 열린 SSE 연결 */
export interface SseChannel {
  /** 이벤트 하나를 보낸다(연결이 끊겼으면 아무 일도 하지 않는다) */
  send(event: string, data: unknown): void;
  /** 정상 종료 */
  end(): void;
  /** 브라우저가 끊으면 abort되는 신호 */
  readonly signal: AbortSignal;
  readonly closed: boolean;
}

/** SSE 응답을 시작한다. 이 뒤로는 reply.send를 쓰지 않는다 */
export function openSse(req: FastifyRequest, reply: FastifyReply): SseChannel {
  reply.hijack();
  const res = reply.raw;
  const ctrl = new AbortController();
  let ended = false;
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();
  // 응답을 다 쓰기 전에 연결이 닫히면 사용자가 멈춘 것이다
  const onClose = () => {
    if (!ended) ctrl.abort();
  };
  res.on('close', onClose);
  req.raw.on('aborted', onClose);
  return {
    send(event, data) {
      if (ended || res.destroyed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (ended) return;
      ended = true;
      if (!res.writableEnded) res.end();
    },
    signal: ctrl.signal,
    get closed() {
      return ended || ctrl.signal.aborted;
    },
  };
}

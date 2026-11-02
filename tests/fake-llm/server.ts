// 이 파일이 하는 일: 테스트용 가짜 LLM HTTP 서버(HARNESS §5). 실제 공급자 대신 Anthropic(/v1/messages)·OpenAI(/v1/responses)·
// Gemini(/v1beta/models/<모델>:generateContent·:streamGenerateContent) 주소에 공식 문서와 같은 모양으로 응답한다.
// 모드: ok(정상), 401·429·500(오류 상태), delay(응답 지연), stream은 요청 본문(stream:true)이나 주소로 자동 판단한다.
// 받은 요청(주소·헤더·본문)을 모두 기억하고, 스트림 중 상대가 연결을 끊으면 closedEarly로 알려 준다. 실제 키·외부 네트워크는 쓰지 않는다.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** 가짜 서버가 흉내 내는 공급자 */
export type FakeProvider = 'anthropic' | 'openai' | 'gemini';

/** 응답 방식 */
export type FakeMode = { kind: 'ok' } | { kind: 'status'; status: number } | { kind: 'delay'; ms: number };

/** 받은 요청 하나 */
export interface FakeRequest {
  provider: FakeProvider | null;
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  rawBody: string;
  stream: boolean;
}

/** 가짜 서버 손잡이 */
export interface FakeLlm {
  /** 예: http://127.0.0.1:12345 */
  url: string;
  requests: FakeRequest[];
  /** 응답 방식을 바꾼다 */
  setMode(mode: FakeMode): void;
  /** 정상 응답 글과 사용량을 바꾼다 */
  setReply(text: string, usage?: { input: number; output: number }): void;
  /** 스트림 조각 수와 조각 사이 시간(밀리초) */
  setStream(opts: { pieces?: number; gapMs?: number }): void;
  /** 스트림 도중 상대가 연결을 끊은 횟수 */
  readonly closedEarly: number;
  /** 스트림이 끊길 때까지 기다린다(시간 안에 안 끊기면 false) */
  waitClosedEarly(timeoutMs: number): Promise<boolean>;
  close(): Promise<void>;
}

/** 주소로 공급자를 알아낸다 */
function providerOf(url: string): FakeProvider | null {
  if (url.startsWith('/v1/messages')) return 'anthropic';
  if (url.startsWith('/v1/responses')) return 'openai';
  if (url.startsWith('/v1beta/models/')) return 'gemini';
  return null;
}

/** 오류 본문(공급자별 공식 모양을 흉내 냄). 키 일부를 담아, 서버가 오류 본문을 로그에 남기지 않는지도 확인할 수 있게 한다 */
function errorBody(provider: FakeProvider | null, status: number, keyHint: string): unknown {
  const message = `fake error ${status} for key ${keyHint}`;
  if (provider === 'anthropic') return { type: 'error', error: { type: status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : 'api_error', message } };
  if (provider === 'openai') return { error: { message, type: 'invalid_request_error', code: status === 401 ? 'invalid_api_key' : null } };
  return { error: { code: status, message, status: status === 401 ? 'UNAUTHENTICATED' : status === 429 ? 'RESOURCE_EXHAUSTED' : 'INTERNAL' } };
}

/** 한 번에 주는 정상 응답 */
function okBody(provider: FakeProvider, text: string, usage: { input: number; output: number }, model: string): unknown {
  if (provider === 'anthropic') {
    return {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: usage.input, output_tokens: usage.output },
    };
  }
  if (provider === 'openai') {
    return {
      id: 'resp_fake',
      object: 'response',
      status: 'completed',
      model,
      output: [{ type: 'message', id: 'msg_fake', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
      usage: { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.input + usage.output },
    };
  }
  return {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: usage.input, candidatesTokenCount: usage.output, totalTokenCount: usage.input + usage.output },
    modelVersion: model,
  };
}

/** 글을 n조각으로 */
function pieces(text: string, n: number): string[] {
  const size = Math.max(1, Math.ceil(text.length / n));
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** 스트림 이벤트(공급자별 SSE 모양) */
function streamEvents(provider: FakeProvider, text: string, usage: { input: number; output: number }, n: number, model: string): string[] {
  const parts = pieces(text, n);
  const sse = (event: string | null, data: unknown) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
  if (provider === 'anthropic') {
    return [
      sse('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', content: [], model, usage: { input_tokens: usage.input, output_tokens: 1 } } }),
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sse('ping', { type: 'ping' }),
      ...parts.map((t) => sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
      sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
      sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output } }),
      sse('message_stop', { type: 'message_stop' }),
    ];
  }
  if (provider === 'openai') {
    return [
      sse('response.created', { type: 'response.created', response: { id: 'resp_fake', status: 'in_progress' } }),
      ...parts.map((t) => sse('response.output_text.delta', { type: 'response.output_text.delta', item_id: 'msg_fake', output_index: 0, content_index: 0, delta: t })),
      sse('response.completed', { type: 'response.completed', response: { id: 'resp_fake', status: 'completed', usage: { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.input + usage.output } } }),
    ];
  }
  return parts.map((t, i) =>
    sse(null, {
      candidates: [{ content: { role: 'model', parts: [{ text: t }] }, ...(i === parts.length - 1 ? { finishReason: 'STOP' } : {}) }],
      usageMetadata: { promptTokenCount: usage.input, candidatesTokenCount: i === parts.length - 1 ? usage.output : 0, totalTokenCount: usage.input + (i === parts.length - 1 ? usage.output : 0) },
    }),
  );
}

/** 요청 헤더에서 키 끝 4자리(오류 본문 흉내용) */
function keyHint(h: http.IncomingHttpHeaders): string {
  const k = String(h['x-api-key'] ?? h['x-goog-api-key'] ?? h.authorization ?? '');
  return k.slice(-4);
}

/** 가짜 서버를 127.0.0.1의 빈 포트에 띄운다 */
export async function startFakeLlm(): Promise<FakeLlm> {
  let mode: FakeMode = { kind: 'ok' };
  let reply = { text: '가짜 공급자 응답입니다.', usage: { input: 1200, output: 340 } };
  let streamOpts = { pieces: 4, gapMs: 20 };
  let closedEarly = 0;
  const closeWaiters: (() => void)[] = [];
  const requests: FakeRequest[] = [];
  const sockets = new Set<import('node:net').Socket>();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = null;
      }
      const url = req.url ?? '/';
      const provider = providerOf(url);
      const b = (body ?? {}) as { stream?: boolean; model?: string };
      const stream = provider === 'gemini' ? url.includes(':streamGenerateContent') : b.stream === true;
      const model = provider === 'gemini' ? decodeURIComponent(url.split('/models/')[1]?.split(':')[0] ?? '') : (b.model ?? '');
      requests.push({ provider, method: req.method ?? 'GET', url, headers: req.headers, body, rawBody, stream });

      const json = (status: number, data: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (!provider) return json(404, { error: 'not found' });
      if (mode.kind === 'status') return json(mode.status, errorBody(provider, mode.status, keyHint(req.headers)));

      const respond = () => {
        if (res.destroyed) return;
        if (!stream) return json(200, okBody(provider, reply.text, reply.usage, model));
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const events = streamEvents(provider, reply.text, reply.usage, streamOpts.pieces, model);
        let i = 0;
        let finished = false;
        res.on('close', () => {
          if (!finished) {
            closedEarly++;
            for (const w of closeWaiters.splice(0)) w();
          }
        });
        const tick = () => {
          if (res.destroyed) return;
          if (i >= events.length) {
            finished = true;
            res.end();
            return;
          }
          res.write(events[i++]);
          setTimeout(tick, streamOpts.gapMs);
        };
        tick();
      };
      if (mode.kind === 'delay') setTimeout(respond, mode.ms);
      else respond();
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    setMode(m) {
      mode = m;
    },
    setReply(text, usage) {
      reply = { text, usage: usage ?? reply.usage };
    },
    setStream(opts) {
      streamOpts = { ...streamOpts, ...opts };
    },
    get closedEarly() {
      return closedEarly;
    },
    waitClosedEarly(timeoutMs) {
      if (closedEarly > 0) return Promise.resolve(true);
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), timeoutMs);
        closeWaiters.push(() => {
          clearTimeout(t);
          resolve(true);
        });
      });
    },
    close() {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

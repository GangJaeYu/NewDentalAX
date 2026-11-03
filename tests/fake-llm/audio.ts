// 이 파일이 하는 일: 녹음 받아쓰기 테스트용 가짜 공급자 HTTP 서버(phase-06-task-03). 실제 공급자 대신 공식 문서와 같은 모양으로 응답한다.
// - OpenAI POST /v1/audio/transcriptions(multipart) → {text, usage:{type:'duration', seconds}}
// - Gemini POST /v1beta/models/<모델>:generateContent → candidates + usageMetadata(promptTokensDetails에 AUDIO·TEXT)
// - Gemini Files API: POST /upload/v1beta/files(시작, x-goog-upload-url 헤더) → POST /upload-session/<id>(올리기·마침) → DELETE /v1beta/files/<id>
// 받은 요청(주소·헤더·본문 바이트)을 모두 기억한다. 실제 키·외부 네트워크는 쓰지 않는다.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** 받은 요청 하나 */
export interface FakeAudioRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** JSON 본문이면 읽은 값 */
  json: unknown;
}

/** 가짜 서버 손잡이 */
export interface FakeAudio {
  url: string;
  requests: FakeAudioRequest[];
  /** 받아쓴 글 */
  setText(text: string): void;
  /** OpenAI usage(null이면 보내지 않음) */
  setOpenaiUsage(usage: Record<string, unknown> | null): void;
  /** Gemini usageMetadata(null이면 보내지 않음) */
  setGeminiUsage(usage: Record<string, unknown> | null): void;
  /** 0이 아니면 그 HTTP 상태로 오류를 돌려준다 */
  setStatus(status: number): void;
  close(): Promise<void>;
}

/** 가짜 서버를 127.0.0.1 빈 포트에 띄운다 */
export async function startFakeAudio(): Promise<FakeAudio> {
  let text = '가짜 받아쓰기 글입니다.';
  let openaiUsage: Record<string, unknown> | null = { type: 'duration', seconds: 120 };
  let geminiUsage: Record<string, unknown> | null = {
    promptTokenCount: 3900,
    candidatesTokenCount: 500,
    totalTokenCount: 4400,
    promptTokensDetails: [
      { modality: 'AUDIO', tokenCount: 3840 },
      { modality: 'TEXT', tokenCount: 60 },
    ],
  };
  let status = 0;
  const requests: FakeAudioRequest[] = [];
  let base = '';

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      let json: unknown = null;
      if (String(req.headers['content-type'] ?? '').includes('application/json')) {
        try {
          json = JSON.parse(body.toString('utf8'));
        } catch {
          json = null;
        }
      }
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';
      requests.push({ method, url, headers: req.headers, body, json });
      const send = (code: number, data: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(code, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(data));
      };
      if (status) return send(status, { error: { code: status, message: 'fake audio error for key 7Qa1' } });
      if (method === 'POST' && url === '/v1/audio/transcriptions') return send(200, { text, ...(openaiUsage ? { usage: openaiUsage } : {}) });
      if (method === 'POST' && url.startsWith('/v1beta/models/') && url.endsWith(':generateContent')) {
        return send(200, { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], ...(geminiUsage ? { usageMetadata: geminiUsage } : {}) });
      }
      if (method === 'POST' && url === '/upload/v1beta/files') return send(200, {}, { 'x-goog-upload-url': `${base}/upload-session/s1` });
      if (method === 'POST' && url === '/upload-session/s1') {
        return send(200, { file: { name: 'files/fakeaudio1', uri: `${base}/v1beta/files/fakeaudio1`, mimeType: 'audio/m4a', state: 'ACTIVE' } });
      }
      if (method === 'DELETE' && url === '/v1beta/files/fakeaudio1') return send(200, {});
      return send(404, { error: 'not found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  return {
    url: base,
    requests,
    setText(t) {
      text = t;
    },
    setOpenaiUsage(u) {
      openaiUsage = u;
    },
    setGeminiUsage(u) {
      geminiUsage = u;
    },
    setStatus(s) {
      status = s;
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

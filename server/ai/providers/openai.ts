// 이 파일이 하는 일: OpenAI Responses API 어댑터(TD-009, OQ-009). 공식 문서가 텍스트 생성에 Chat Completions보다 Responses를 권장한다.
// POST {base}/v1/responses, 헤더 Authorization: Bearer <키>. 본문 {model, instructions, input, max_output_tokens, store:false, stream}.
// 응답 output[](type=message).content[](type=output_text).text와 usage.input_tokens·output_tokens를 읽는다.
// 스트림은 SSE: response.output_text.delta(delta) … response.completed(response.usage) / error·response.failed.
// 확인한 문서(2026-11-02): https://developers.openai.com/api/docs/guides/text , https://developers.openai.com/api/reference/resources/responses/methods/create ,
// https://developers.openai.com/api/docs/guides/streaming-responses
import type { ProviderAdapter, ProviderConfig, ProviderRequest, ProviderResult, StreamChunk } from '../types.ts';
import { ProviderError } from '../types.ts';
import { num, postJson, readJson, readSse, safeJson } from './http.ts';

/** OpenAI는 max_output_tokens 최솟값이 16이다 */
const MIN_OUTPUT_TOKENS = 16;

/** 요청 본문을 만든다. 시스템 안내는 instructions, 대화는 input 배열로 보낸다. 서버에 응답을 남기지 않게 store:false */
export function openaiBody(req: ProviderRequest, stream: boolean): Record<string, unknown> {
  const input = req.messages.map((m, i) => {
    if (i === 0 && m.role === 'user' && req.images?.length) {
      return {
        role: 'user',
        content: [
          { type: 'input_text', text: m.content },
          ...req.images.map((img) => ({ type: 'input_image', image_url: `data:${img.mime};base64,${img.data}` })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
  const body: Record<string, unknown> = { model: req.model, input, max_output_tokens: Math.max(MIN_OUTPUT_TOKENS, req.maxTokens), store: false };
  if (req.system) body.instructions = req.system;
  if (stream) body.stream = true;
  return body;
}

/** Responses 응답에서 글을 모은다 */
function outputText(json: { output?: unknown; output_text?: unknown }): string | null {
  if (typeof json.output_text === 'string') return json.output_text;
  if (!Array.isArray(json.output)) return null;
  const parts: string[] = [];
  for (const item of json.output as { type?: string; content?: { type?: string; text?: string }[] }[]) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const c of item.content) if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join('');
}

function usageOf(u: Record<string, unknown> | undefined | null) {
  return u ? { inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens) } : null;
}

/** OpenAI 어댑터를 만든다 */
export function openaiProvider(cfg: ProviderConfig): ProviderAdapter {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/responses`;
  const headers = { authorization: `Bearer ${cfg.apiKey}` };
  return {
    async generate(req): Promise<ProviderResult> {
      const res = await postJson(url, headers, openaiBody(req, false), req.signal);
      const json = (await readJson(res, req.signal)) as { output?: unknown; output_text?: unknown; usage?: Record<string, unknown> } | null;
      const text = json ? outputText(json) : null;
      if (text === null || !json) throw new ProviderError('AI_BAD_OUTPUT');
      return { text, usage: usageOf(json.usage) };
    },
    async *stream(req): AsyncGenerator<StreamChunk> {
      const res = await postJson(url, headers, openaiBody(req, true), req.signal);
      for await (const ev of readSse(res, req.signal)) {
        const d = safeJson(ev.data) as Record<string, unknown> | null;
        if (!d) continue;
        const type = d.type ?? ev.event;
        if (type === 'response.output_text.delta') {
          if (typeof d.delta === 'string' && d.delta) yield { type: 'delta', text: d.delta };
        } else if (type === 'response.completed') {
          const u = usageOf((d.response as { usage?: Record<string, unknown> } | undefined)?.usage);
          if (u) yield { type: 'usage', usage: u };
          return;
        } else if (type === 'error' || type === 'response.failed') {
          throw new ProviderError('AI_UNAVAILABLE');
        }
      }
    },
  };
}

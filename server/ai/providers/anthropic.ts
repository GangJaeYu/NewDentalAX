// 이 파일이 하는 일: Anthropic Messages API 어댑터(TD-009). POST {base}/v1/messages, 헤더 x-api-key·anthropic-version: 2023-06-01.
// 본문 {model, max_tokens, system, messages, stream}. 응답 content[].text와 usage.input_tokens·output_tokens를 읽는다.
// 스트림은 SSE: message_start(usage.input_tokens) → content_block_delta(delta.type=text_delta, delta.text) → message_delta(usage.output_tokens, 누적) → message_stop.
// 확인한 문서(2026-11-02): https://platform.claude.com/docs/en/api/messages , https://platform.claude.com/docs/en/build-with-claude/streaming
import type { ProviderAdapter, ProviderConfig, ProviderRequest, ProviderResult, StreamChunk } from '../types.ts';
import { ProviderError } from '../types.ts';
import { num, postJson, readJson, readSse, safeJson } from './http.ts';

export const ANTHROPIC_VERSION = '2023-06-01';

/** 요청 본문을 만든다(사진은 user 첫 메시지 앞에 image 블록으로 붙인다) */
export function anthropicBody(req: ProviderRequest, stream: boolean): Record<string, unknown> {
  const messages = req.messages.map((m, i) => {
    if (i === 0 && m.role === 'user' && req.images?.length) {
      return {
        role: 'user',
        content: [
          ...req.images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } })),
          { type: 'text', text: m.content },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
  const body: Record<string, unknown> = { model: req.model, max_tokens: req.maxTokens, messages };
  if (req.system) body.system = req.system;
  if (stream) body.stream = true;
  return body;
}

/** Anthropic 어댑터를 만든다 */
export function anthropicProvider(cfg: ProviderConfig): ProviderAdapter {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/messages`;
  const headers = { 'x-api-key': cfg.apiKey, 'anthropic-version': ANTHROPIC_VERSION };
  return {
    async generate(req): Promise<ProviderResult> {
      const res = await postJson(url, headers, anthropicBody(req, false), req.signal);
      const json = (await readJson(res, req.signal)) as { content?: { type?: string; text?: string }[]; usage?: Record<string, unknown> } | null;
      if (!json || !Array.isArray(json.content)) throw new ProviderError('AI_BAD_OUTPUT');
      const text = json.content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
      const usage = json.usage ? { inputTokens: num(json.usage.input_tokens), outputTokens: num(json.usage.output_tokens) } : null;
      return { text, usage };
    },
    async *stream(req): AsyncGenerator<StreamChunk> {
      const res = await postJson(url, headers, anthropicBody(req, true), req.signal);
      for await (const ev of readSse(res, req.signal)) {
        const d = safeJson(ev.data) as Record<string, unknown> | null;
        if (!d) continue;
        const type = d.type ?? ev.event;
        if (type === 'message_start') {
          const u = (d.message as { usage?: Record<string, unknown> } | undefined)?.usage;
          if (u) yield { type: 'usage', usage: { inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens) } };
        } else if (type === 'content_block_delta') {
          const delta = d.delta as { type?: string; text?: string } | undefined;
          if (delta?.type === 'text_delta' && delta.text) yield { type: 'delta', text: delta.text };
        } else if (type === 'message_delta') {
          const u = d.usage as Record<string, unknown> | undefined;
          if (u) yield { type: 'usage', usage: { outputTokens: num(u.output_tokens), ...(u.input_tokens !== undefined ? { inputTokens: num(u.input_tokens) } : {}) } };
        } else if (type === 'error') {
          const e = d.error as { type?: string } | undefined;
          throw new ProviderError(e?.type === 'rate_limit_error' ? 'AI_RATE_LIMIT' : e?.type === 'authentication_error' ? 'AI_AUTH' : 'AI_UNAVAILABLE');
        } else if (type === 'message_stop') {
          return;
        }
      }
    },
  };
}

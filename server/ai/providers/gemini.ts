// 이 파일이 하는 일: Google Gemini API 어댑터(TD-009). POST {base}/v1beta/models/<모델>:generateContent, 스트림은 :streamGenerateContent?alt=sse.
// 키는 x-goog-api-key 헤더로 보낸다(주소에 키를 넣지 않아 로그·기록에 남지 않게). 본문 {systemInstruction, contents[{role, parts[{text}]}], generationConfig.maxOutputTokens}.
// 응답 candidates[0].content.parts[].text와 usageMetadata.promptTokenCount·candidatesTokenCount(+thoughtsTokenCount는 출력에 더함)를 읽는다.
// 확인한 문서(2026-11-02): https://ai.google.dev/api/generate-content , https://ai.google.dev/gemini-api/docs/api-key
import type { ProviderAdapter, ProviderConfig, ProviderRequest, ProviderResult, StreamChunk } from '../types.ts';
import { ProviderError } from '../types.ts';
import { num, postJson, readJson, readSse, safeJson } from './http.ts';

/** 요청 본문을 만든다(assistant 역할은 Gemini에서 model이다) */
export function geminiBody(req: ProviderRequest): Record<string, unknown> {
  const contents = req.messages.map((m, i) => {
    const parts: Record<string, unknown>[] = [{ text: m.content }];
    if (i === 0 && m.role === 'user' && req.images?.length) {
      parts.unshift(...req.images.map((img) => ({ inlineData: { mimeType: img.mime, data: img.data } })));
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
  const body: Record<string, unknown> = { contents, generationConfig: { maxOutputTokens: req.maxTokens } };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  return body;
}

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  usageMetadata?: Record<string, unknown>;
  error?: unknown;
}

function textOf(j: GeminiChunk): string {
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
}

function usageOf(u: Record<string, unknown> | undefined) {
  return u ? { inputTokens: num(u.promptTokenCount), outputTokens: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount) } : null;
}

/** Gemini 어댑터를 만든다 */
export function geminiProvider(cfg: ProviderConfig): ProviderAdapter {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const headers = { 'x-goog-api-key': cfg.apiKey };
  return {
    async generate(req): Promise<ProviderResult> {
      const url = `${base}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
      const res = await postJson(url, headers, geminiBody(req), req.signal);
      const json = (await readJson(res, req.signal)) as GeminiChunk | null;
      if (!json || !Array.isArray(json.candidates)) throw new ProviderError('AI_BAD_OUTPUT');
      return { text: textOf(json), usage: usageOf(json.usageMetadata) };
    },
    async *stream(req): AsyncGenerator<StreamChunk> {
      const url = `${base}/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
      const res = await postJson(url, headers, geminiBody(req), req.signal);
      for await (const ev of readSse(res, req.signal)) {
        const d = safeJson(ev.data) as GeminiChunk | null;
        if (!d) continue;
        if (d.error) throw new ProviderError('AI_UNAVAILABLE');
        const t = textOf(d);
        if (t) yield { type: 'delta', text: t };
        // usageMetadata는 조각마다 누적값으로 올 수 있어 마지막 값이 남게 한다
        const u = usageOf(d.usageMetadata);
        if (u) yield { type: 'usage', usage: u };
      }
    },
  };
}

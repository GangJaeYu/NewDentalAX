// 이 파일이 하는 일: 녹음 파일 받아쓰기(phase-06-task-03, FR-132)를 공급자에게 요청한다. 오류는 http.ts와 같은 규칙으로 오류 코드로 바꾼다(본문은 버림, TD-008).
// - OpenAI: POST {base}/v1/audio/transcriptions, multipart(file, model, response_format=json, prompt, languages=ko). 응답 {text, usage?{type:'duration', seconds} | {type:'tokens', ...}}
//   확인한 문서(2026-11-03): https://developers.openai.com/api/docs/guides/speech-to-text , https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
// - Gemini: 작은 파일은 generateContent에 inlineData(base64)로 넣고, 요청이 20MB를 넘을 만큼 큰 파일은 Files API(resumable)로 올린 뒤 fileData로 가리키고, 끝나면 지운다.
//   확인한 문서(2026-11-03): https://aistudio.google.com/docs/audio (요청 전체 20MB, 1초 = 32토큰), https://aistudio.google.com/docs/files
// - Anthropic은 음성 입력이 없어서 여기 없다(server/ai/transcribe.ts가 "음성을 지원하지 않아요"로 막는다).
import { ProviderError } from '../types.ts';
import { num, readJson, statusToCode } from './http.ts';

/** 받아쓰기 요청 하나 */
export interface AudioRequest {
  /** 공급자 모델 이름 */
  model: string;
  /** 녹음 바이트 */
  data: Buffer;
  /** 공급자에게 알려 줄 형식(예: audio/m4a) */
  mime: string;
  /** 파일 이름표 */
  fileName: string;
  /** 받아쓰기 안내(Gemini 시스템 안내) */
  system: string;
  /** 사용자 글(Gemini) */
  user: string;
  /** 회의 맥락(OpenAI prompt) */
  context: string;
  maxTokens: number;
  signal: AbortSignal;
}

/** 받아쓰기 결과 */
export interface AudioResult {
  text: string;
  /** 공급자가 알려 준 녹음 길이(초). 모르면 null */
  seconds: number | null;
  /** 공급자가 알려 준 토큰 수(오디오 입력·글 입력·출력). 모르면 null */
  tokens: { audioIn: number; textIn: number; output: number } | null;
  /** Files API를 썼는지(Gemini 큰 파일) */
  uploaded: boolean;
}

/** Gemini에 inline으로 넣을 수 있는 녹음 크기 상한. 요청 전체 20MB 안에 base64(4/3배)와 안내 글이 들어가게 잡았다 */
export const GEMINI_INLINE_MAX_BYTES = 14 * 1024 * 1024;

/** 끊긴 이유를 오류 코드로(gateway가 시간 초과면 AI_TIMEOUT을 넣는다) */
function abortError(signal: AbortSignal): ProviderError {
  const reason: unknown = signal.reason;
  return reason instanceof ProviderError ? reason : new ProviderError('AI_ABORTED');
}

/** fetch를 부르고, 2xx가 아니면 본문을 버리고 오류 코드를 던진다 */
async function send(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
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

/** OpenAI 받아쓰기 */
export async function openaiTranscribe(cfg: { apiKey: string; baseUrl: string }, req: AudioRequest): Promise<AudioResult> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/v1/audio/transcriptions`;
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(req.data)], { type: req.mime }), req.fileName);
  form.set('model', req.model);
  form.set('response_format', 'json');
  form.set('prompt', req.context);
  form.append('languages[]', 'ko');
  const res = await send(url, { method: 'POST', headers: { authorization: `Bearer ${cfg.apiKey}` }, body: form }, req.signal);
  const json = (await readJson(res, req.signal)) as { text?: unknown; usage?: Record<string, unknown> | null; duration?: unknown } | null;
  if (!json || typeof json.text !== 'string') throw new ProviderError('AI_BAD_OUTPUT');
  const u = json.usage ?? null;
  let seconds: number | null = typeof json.duration === 'number' ? json.duration : null;
  let tokens: AudioResult['tokens'] = null;
  if (u?.type === 'duration' && typeof u.seconds === 'number') seconds = u.seconds;
  if (u?.type === 'tokens') {
    const d = (u.input_token_details ?? {}) as Record<string, unknown>;
    const audioIn = d.audio_tokens !== undefined ? num(d.audio_tokens) : num(u.input_tokens);
    tokens = { audioIn, textIn: Math.max(0, num(u.input_tokens) - audioIn), output: num(u.output_tokens) };
  }
  return { text: json.text, seconds, tokens, uploaded: false };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  usageMetadata?: Record<string, unknown>;
}

/** Gemini 사용량에서 오디오 입력·글 입력·출력 토큰을 나눈다 */
function geminiTokens(u: Record<string, unknown> | undefined): AudioResult['tokens'] {
  if (!u) return null;
  const prompt = num(u.promptTokenCount);
  const details = Array.isArray(u.promptTokensDetails) ? (u.promptTokensDetails as { modality?: string; tokenCount?: unknown }[]) : [];
  const audio = details.find((d) => d.modality === 'AUDIO');
  // 나눈 값이 없으면 입력 전체를 오디오로 본다(오디오 단가가 더 비싸서 비용을 적게 잡지 않는다)
  const audioIn = audio ? num(audio.tokenCount) : prompt;
  return { audioIn, textIn: Math.max(0, prompt - audioIn), output: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount) };
}

/** Files API로 올리고 {name, uri}를 돌려준다(resumable 두 번: 시작 → 올리기·마침) */
async function geminiUpload(base: string, apiKey: string, req: AudioRequest): Promise<{ name: string; uri: string }> {
  const start = await send(
    `${base}/upload/v1beta/files`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'x-goog-upload-protocol': 'resumable',
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(req.data.length),
        'x-goog-upload-header-content-type': req.mime,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'meeting-audio' } }),
    },
    req.signal,
  );
  const uploadUrl = start.headers.get('x-goog-upload-url');
  try {
    await start.body?.cancel();
  } catch {
    // 시작 응답 본문은 쓰지 않는다
  }
  if (!uploadUrl) throw new ProviderError('AI_BAD_OUTPUT');
  // 올리기 주소에는 키를 붙이지 않는다(주소 자체가 일회용 허가다)
  const done = await send(
    uploadUrl,
    {
      method: 'POST',
      headers: { 'content-length': String(req.data.length), 'x-goog-upload-offset': '0', 'x-goog-upload-command': 'upload, finalize' },
      body: new Uint8Array(req.data),
    },
    req.signal,
  );
  const json = (await readJson(done, req.signal)) as { file?: { name?: unknown; uri?: unknown } } | null;
  const name = json?.file?.name;
  const uri = json?.file?.uri;
  if (typeof name !== 'string' || typeof uri !== 'string' || !/^files\/[A-Za-z0-9_-]+$/.test(name)) throw new ProviderError('AI_BAD_OUTPUT');
  return { name, uri };
}

/** Files API에 올린 파일을 지운다(실패해도 받아쓰기 결과는 그대로 돌려준다. 공급자도 48시간 뒤 스스로 지운다) */
async function geminiDelete(base: string, apiKey: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(15_000) });
    await res.body?.cancel().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

/** Gemini 받아쓰기 */
export async function geminiTranscribe(cfg: { apiKey: string; baseUrl: string }, req: AudioRequest): Promise<AudioResult> {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const big = req.data.length > GEMINI_INLINE_MAX_BYTES;
  const file = big ? await geminiUpload(base, cfg.apiKey, req) : null;
  try {
    const audioPart = file ? { fileData: { mimeType: req.mime, fileUri: file.uri } } : { inlineData: { mimeType: req.mime, data: req.data.toString('base64') } };
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [audioPart, { text: req.user }] }],
      generationConfig: { maxOutputTokens: req.maxTokens },
    };
    const res = await send(
      `${base}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body: JSON.stringify(body) },
      req.signal,
    );
    const json = (await readJson(res, req.signal)) as GeminiResponse | null;
    if (!json || !Array.isArray(json.candidates)) throw new ProviderError('AI_BAD_OUTPUT');
    const parts = json.candidates[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('');
    return { text, seconds: null, tokens: geminiTokens(json.usageMetadata), uploaded: !!file };
  } finally {
    if (file) await geminiDelete(base, cfg.apiKey, file.name);
  }
}

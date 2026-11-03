// 이 파일이 하는 일: 회의록 화면의 "녹음 파일로 받아쓰기"(FR-132, phase-06-task-03)가 쓰는 값과 도구. 받는 형식·크기(서버와 같은 기준),
// 받아쓰기 상태·결과 모양, 녹음 올리기 요청(POST /api/ai/transcribe, multipart), 녹음 길이 글로 바꾸기를 둔다. 순수 함수는 단위 테스트한다.
import { toApiError } from '../../lib/api.ts';
import { CSRF_HEADER } from '../../../../shared/schemas/auth.ts';

/** 받는 녹음 형식(휴대폰 녹음 앱 파일). 서버 server/ai/transcribe.ts AUDIO_EXTS와 같다 */
export const RECORDING_ACCEPT = ['.m4a', '.mp3', '.wav', '.webm'] as const;
/** 녹음 파일 크기 상한(20MB). 서버 TRANSCRIBE_MAX_BYTES와 같다 */
export const RECORDING_MAX_BYTES = 20 * 1024 * 1024;

/** GET /api/ai/transcribe/status 응답 */
export interface TranscribeStatus {
  state: 'ready' | 'disabled' | 'unsupported' | 'no_model' | 'budget';
  demo: boolean;
  provider: string;
  message: string | null;
  maxBytes: number;
  exts: string[];
}

/** POST /api/ai/transcribe 응답 */
export interface TranscribeResult {
  text: string;
  demo: boolean;
  provider: string;
  model: string | null;
  usage: { seconds: number | null; costKrw: number; estimated: boolean };
  privacy: { findings: { type: string; count: number }[]; notice: string | null };
  requestId: number;
}

/** 녹음을 올려 받아쓴다(확인 체크 값 포함). 서버 오류 문구는 ApiError로 던진다 */
export async function uploadRecording(csrfToken: string | null, file: File, signal?: AbortSignal): Promise<TranscribeResult> {
  const fd = new FormData();
  fd.set('confirmed', 'true');
  fd.set('file', file, file.name);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  let res: Response;
  try {
    res = await fetch('/api/ai/transcribe', { method: 'POST', credentials: 'same-origin', headers, body: fd, signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw toApiError(0, { error: { code: 'NETWORK', message: '서버에 연결할 수 없어요. 원내 와이파이에 연결되어 있는지 확인해 주세요.' } });
  }
  const body = (await res.json().catch(() => null)) as { data?: TranscribeResult } | null;
  if (!res.ok || !body?.data) throw toApiError(res.status, body);
  return body.data;
}

/** 녹음 길이를 글로. 예: 95 → "약 1분 35초", 30 → "약 30초". 모르면 null */
export function durationText(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m === 0) return `약 ${rest}초`;
  return rest ? `약 ${m}분 ${rest}초` : `약 ${m}분`;
}

/** 받아쓴 글을 메모 칸에 넣을 때 맨 앞 데모 표시 줄은 그대로 둔다(데모라는 사실을 숨기지 않음). 앞뒤 빈 줄만 정리한다 */
export function transcriptToNotes(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

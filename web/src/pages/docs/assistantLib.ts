// 이 파일이 하는 일: "원내 AI 도우미" 화면(AssistantPage)이 쓰는 API 호출과 작은 계산을 모은다(FR-070·071).
// 자료 목록·원문 보기·올리기(파일 multipart 또는 서식 보관함 문서)·가리고 저장·지우기, 질문·대화 기록 API와, 상태 칩 색·개인정보 감지 문구·답 속 근거 번호 나누기를 둔다.
import { CSRF_HEADER } from '../../../../shared/schemas/auth.ts';
import { PII_LABELS, type PiiFinding } from '../../../../shared/privacy-rules.ts';
import type { AskResponse, AssistantMessage, KbDocDetail, KbDocItem, KbStatus, KbVisibility } from '../../../../shared/schemas/kb.ts';
import { api, NETWORK_MESSAGE, toApiError } from '../../lib/api.ts';
import type { Tone } from '../../components/Chip.tsx';

/** 올릴 수 있는 확장자(서버 PURPOSE_EXTS.kb와 같다) */
export const KB_ACCEPT = ['.txt', '.md', '.pdf', '.docx'] as const;
/** 파일 크기 상한(20MB) */
export const KB_MAX_BYTES = 20 * 1024 * 1024;

/** 질문 예시(처음 화면) */
export const EXAMPLE_QUESTIONS = ['멸균기 B&D 테스트는 언제 해?', '연차 신청은 며칠 전까지 해야 돼?', '유통기한 지난 재료는 어떻게 처리해?'] as const;

/** 상태 → 칩 색(색만으로 구분하지 않게 칩에는 늘 글자가 있다) */
export const STATUS_TONE: Readonly<Record<KbStatus, Tone>> = {
  processing: 'info',
  needs_review: 'warn',
  ready: 'ok',
  failed: 'danger',
};

/** 개인정보 감지 문구. 예: "전화번호 1건" */
export function findingsText(findings: readonly PiiFinding[]): string {
  return findings.map((f) => `${PII_LABELS[f.type]} ${f.count}건`).join(', ');
}

/** 답 글을 글 조각과 근거 번호([1])로 나눈다. 번호는 근거 카드로 가는 표시로 그린다 */
export function splitCitations(text: string): Array<{ text: string } | { n: number }> {
  const out: Array<{ text: string } | { n: number }> = [];
  let pos = 0;
  for (const m of text.matchAll(/\[(\d{1,2})\]/g)) {
    if (m.index > pos) out.push({ text: text.slice(pos, m.index) });
    out.push({ n: Number(m[1]) });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/** 원문 보기 주소(같은 화면에서 대화상자로 열린다) */
export function sourceHref(kbDocId: number, chunkId?: number): string {
  return `/docs/assistant?doc=${kbDocId}${chunkId ? `&chunk=${chunkId}` : ''}`;
}

/** 자료 목록 */
export function fetchKbDocs(): Promise<KbDocItem[]> {
  return api.get<KbDocItem[]>('/api/kb/docs');
}

/** 자료 상세(원문 보기) */
export function fetchKbDoc(id: number): Promise<KbDocDetail> {
  return api.get<KbDocDetail>(`/api/kb/docs/${id}`);
}

/** 파일로 자료 올리기(multipart). 처리 결과(완료·검토 필요·실패)를 돌려준다 */
export async function uploadKbFile(csrfToken: string | null, file: File, fields: { title: string; visibility: KbVisibility }): Promise<KbDocItem> {
  const fd = new FormData();
  fd.set('title', fields.title);
  fd.set('visibility', fields.visibility);
  fd.set('file', file, file.name);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  let res: Response;
  try {
    res = await fetch('/api/kb/docs', { method: 'POST', credentials: 'same-origin', headers, body: fd });
  } catch {
    throw toApiError(0, { error: { code: 'NETWORK', message: NETWORK_MESSAGE } });
  }
  const body = (await res.json().catch(() => null)) as { data?: KbDocItem } | null;
  if (!res.ok || !body?.data) throw toApiError(res.status, body);
  return body.data;
}

/** 서식 보관함 문서를 자료로 고르기 */
export function addKbFromDocument(input: { documentId: number; title: string; visibility: KbVisibility }): Promise<KbDocItem> {
  return api.post<KbDocItem>('/api/kb/docs', input);
}

/** 검토 필요 자료를 가리고 저장 */
export function confirmRedact(id: number): Promise<KbDocItem> {
  return api.post<KbDocItem>(`/api/kb/docs/${id}/confirm-redact`);
}

/** 자료 지우기(검토 취소도 이것) */
export function deleteKbDoc(id: number): Promise<unknown> {
  return api.del(`/api/kb/docs/${id}`);
}

/** 질문하기 */
export function askAssistant(question: string): Promise<AskResponse> {
  return api.post<AskResponse>('/api/assistant/ask', { question });
}

/** 내 대화 기록 */
export function fetchHistory(): Promise<AssistantMessage[]> {
  return api.get<AssistantMessage[]>('/api/assistant/history');
}

/** 내 대화 기록 지우기 */
export function clearHistory(): Promise<unknown> {
  return api.del('/api/assistant/history');
}

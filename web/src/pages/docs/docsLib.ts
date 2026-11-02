// 이 파일이 하는 일: 문서 화면들(AI 문서 작성·회의록 요약·서식 보관함·상세·인쇄)이 함께 쓰는 작은 도구 모음.
// - 서버 API 부르기(문서 목록·저장·고치기·버전, 서식 파일 올리기 multipart)
// - 순수 함수: AI 결과에서 "[데모 응답]" 줄 떼기, 첫 "# 제목" 뽑기, 고른 부분 바꿔 끼우기, 회의 할 일 → 인수인계 글, 파일 크기 글
// 순수 함수는 docsLib.test.ts가 확인한다.
import { CSRF_HEADER } from '../../../../shared/schemas/auth.ts';
import { DOC_KIND_LABELS, WRITER_KINDS, type DocDetail, type DocKind, type DocListResponse, type DocVersionView } from '../../../../shared/schemas/docs.ts';
import { api, toApiError } from '../../lib/api.ts';

/** AI 문서 작성 종류 고르기 목록 */
export const WRITER_KIND_OPTIONS = WRITER_KINDS.map((k) => ({ value: k, label: DOC_KIND_LABELS[k] }));

/** 서식 보관함 종류 거르기 목록(전체 포함) */
export const KIND_FILTER_OPTIONS: Array<{ value: '' | DocKind; label: string }> = [
  { value: '', label: '모든 종류' },
  ...(Object.keys(DOC_KIND_LABELS) as DocKind[]).map((k) => ({ value: k, label: DOC_KIND_LABELS[k] })),
];

/** 분량 고르기 */
export const LENGTH_OPTIONS = [
  { value: 'short', label: '짧게' },
  { value: 'medium', label: '보통' },
  { value: 'long', label: '자세히' },
] as const;
export type DocLength = (typeof LENGTH_OPTIONS)[number]['value'];

/** 말투 고르기 */
export const TONE_OPTIONS = [
  { value: '공손하고 쉬운 말', label: '공손하고 쉬운 말' },
  { value: '공식적이고 딱딱한 말', label: '공식적인 말' },
  { value: '친근하고 부드러운 말', label: '친근한 말' },
] as const;

/** 부분 수정 단추(FR-060 AC2) */
export const REVISE_PRESETS = [
  { label: '다시 쓰기', instruction: '같은 뜻으로 다시 써 주세요' },
  { label: '더 짧게', instruction: '더 짧게 줄여 주세요' },
  { label: '더 공손하게', instruction: '더 공손하게 고쳐 주세요' },
] as const;

/** 서식 보관함에 올릴 수 있는 파일(서버 server/lib/files.ts PURPOSE_EXTS.form과 같음) */
export const FORM_ACCEPT = ['.pdf', '.docx', '.xlsx', '.hwp', '.hwpx', '.jpg', '.jpeg', '.png'] as const;
/** 서식 파일 크기 상한(20MB) */
export const FORM_MAX_BYTES = 20 * 1024 * 1024;

/** 데모 응답 표시 */
export const DEMO_MARK = '[데모 응답]';

/** AI 결과 맨 앞의 "[데모 응답] ..." 한 줄을 뗀다. demo는 떼었는지 */
export function stripDemoMark(text: string): { text: string; demo: boolean } {
  if (!text.startsWith(DEMO_MARK)) return { text, demo: false };
  const nl = text.indexOf('\n');
  return { text: nl === -1 ? '' : text.slice(nl + 1).replace(/^\n+/, ''), demo: true };
}

/** 마크다운 첫 "# 제목" 줄을 뽑는다(없으면 null). 제목 줄은 본문에 남긴다 */
export function extractTitle(md: string): string | null {
  for (const line of md.split('\n')) {
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (m?.[1]) return m[1].slice(0, 200);
  }
  return null;
}

/** 미리보기용: 맨 앞의 "# 제목" 줄을 뗀다(종이 미리보기가 제목을 따로 가운데에 그리므로 두 번 나오지 않게) */
export function withoutTitleLine(md: string): string {
  const lines = md.split('\n');
  const i = lines.findIndex((l) => l.trim() !== '');
  if (i >= 0 && /^#\s+/.test(lines[i]?.trim() ?? '')) lines.splice(i, 1);
  return lines.join('\n').replace(/^\n+/, '');
}

/** start~end 부분을 바꿔 끼운다. 고른 부분이 없으면(start === end) 전체를 바꾼다 */
export function replaceRange(value: string, start: number, end: number, next: string): { value: string; start: number; end: number } {
  if (start === end) return { value: next, start: 0, end: next.length };
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(value.length, Math.max(start, end));
  return { value: `${value.slice(0, a)}${next}${value.slice(b)}`, start: a, end: a + next.length };
}

/** 회의록 할 일 하나 */
export interface MinutesTodo {
  text: string;
  role?: string | null;
  due?: string | null;
}

/** 회의록 정리 결과 */
export interface MinutesResult {
  decisions: string[];
  todos: MinutesTodo[];
  summary: string;
}

/** AI 결과의 extra가 회의록 모양인지 확인하고 꺼낸다(아니면 null) */
export function readMinutes(extra: unknown): MinutesResult | null {
  const v = extra as Partial<MinutesResult> | null;
  if (!v || !Array.isArray(v.decisions) || !Array.isArray(v.todos) || typeof v.summary !== 'string') return null;
  return {
    decisions: v.decisions.filter((d): d is string => typeof d === 'string'),
    todos: v.todos.filter((t): t is MinutesTodo => !!t && typeof (t as MinutesTodo).text === 'string'),
    summary: v.summary,
  };
}

/** "2026-11-06" → "11월 6일" */
export function dueLabel(due: string | null | undefined): string | null {
  const m = due ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(due) : null;
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : null;
}

/** 할 일 → 인수인계·공지 글(POST /api/posts 본문) */
export function todoToPost(todo: MinutesTodo, kind: 'handover' | 'notice', meetingTitle: string) {
  const due = dueLabel(todo.due);
  const lines = [`회의(${meetingTitle})에서 정한 할 일입니다.`, '', `- 할 일: ${todo.text}`];
  if (todo.role) lines.push(`- 담당: ${todo.role}`);
  if (due) lines.push(`- 기한: ${due}`);
  return { kind, category: '회의 할 일', title: todo.text.slice(0, 100), body: lines.join('\n') };
}

/** 회의록 정리 결과 → 보관함에 저장할 마크다운 */
export function minutesToMarkdown(title: string, r: MinutesResult): string {
  const todo = (t: MinutesTodo) => {
    const extra = [t.role, dueLabel(t.due) ? `${dueLabel(t.due)}까지` : null].filter(Boolean).join(', ');
    return `- ${t.text}${extra ? ` (${extra})` : ''}`;
  };
  return [
    `# ${title}`,
    '',
    '## 결정 사항',
    ...(r.decisions.length ? r.decisions.map((d) => `- ${d}`) : ['- 없음']),
    '',
    '## 할 일',
    ...(r.todos.length ? r.todos.map(todo) : ['- 없음']),
    '',
    '## 요약',
    r.summary,
  ].join('\n');
}

/** CSS content 글자로 안전하게(따옴표·역슬래시·줄바꿈·꺾쇠를 이스케이프, 최대 80자) */
export function cssString(s: string): string {
  // 제어 문자(코드 0~31, 127)는 띄어쓰기로 바꾼다
  const clean = [...s]
    .map((c) => (c.charCodeAt(0) <= 31 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('')
    .slice(0, 80);
  return `"${clean.replace(/[\\"<>]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
}

/** 인쇄 머리말(병원명·문서 제목)을 쪽마다 넣는 @page 규칙. 쪽 번호는 styles/print.css가 넣는다 */
export function printHeaderCss(clinic: string, title: string): string {
  return `@page { @top-left { content: ${cssString(clinic)}; font-size: 9pt; color: #586968; } @top-right { content: ${cssString(title)}; font-size: 9pt; color: #586968; } }`;
}

/** 바이트 → "1.2MB" */
export function sizeLabel(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, '')}MB`;
}

/** 쉼표로 나눈 태그 글 → 배열(앞뒤 공백·빈 값·중복 제거) */
export function parseTagText(s: string): string[] {
  return [...new Set(s.split(',').map((t) => t.trim()).filter(Boolean))];
}

/** 목록 조건 → 주소 쿼리 */
export function listQuery(f: { q?: string; kind?: string; folder?: string; tag?: string }): string {
  const p = new URLSearchParams();
  if (f.q?.trim()) p.set('q', f.q.trim());
  if (f.kind) p.set('kind', f.kind);
  if (f.folder) p.set('folder', f.folder);
  if (f.tag) p.set('tag', f.tag);
  p.set('pageSize', '200');
  return p.toString();
}

/** 문서 목록 불러오기(data·total·facets를 그대로 받는다) */
export async function fetchDocuments(query: string): Promise<DocListResponse> {
  const res = await fetch(`/api/documents?${query}`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const body = (await res.json().catch(() => null)) as DocListResponse | null;
  if (!res.ok || !body) throw toApiError(res.status, body);
  return body;
}

/** 문서 하나 */
export function fetchDocument(id: number): Promise<DocDetail> {
  return api.get<DocDetail>(`/api/documents/${id}`);
}

/** 버전 기록 */
export function fetchVersions(id: number): Promise<DocVersionView[]> {
  return api.get<DocVersionView[]>(`/api/documents/${id}/versions`);
}

/** 글 문서 저장(새로) */
export function createDocument(body: { kind: DocKind; title: string; body_md: string; folder: string; tags: string[]; source: 'ai' | 'manual' }): Promise<DocDetail> {
  return api.post<DocDetail>('/api/documents', body);
}

/** 문서 고치기 */
export function updateDocument(id: number, patch: Partial<{ kind: DocKind; title: string; body_md: string; folder: string; tags: string[] }>): Promise<DocDetail> {
  return api.patch<DocDetail>(`/api/documents/${id}`, patch);
}

/** 문서 지우기 */
export function deleteDocument(id: number): Promise<void> {
  return api.del<void>(`/api/documents/${id}`);
}

/** 서식 파일 올리기(multipart). 서버의 415·413 오류도 한국어 문구 그대로 ApiError로 던진다 */
export async function uploadForm(csrfToken: string | null, file: File, fields: { title: string; folder: string; tags: string }): Promise<DocDetail> {
  const fd = new FormData();
  fd.set('title', fields.title);
  fd.set('folder', fields.folder);
  fd.set('tags', fields.tags);
  fd.set('file', file, file.name);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  let res: Response;
  try {
    res = await fetch('/api/documents', { method: 'POST', credentials: 'same-origin', headers, body: fd });
  } catch {
    throw toApiError(0, { error: { code: 'NETWORK', message: '서버에 연결할 수 없어요. 원내 와이파이에 연결되어 있는지 확인해 주세요.' } });
  }
  const body = (await res.json().catch(() => null)) as { data?: DocDetail } | null;
  if (!res.ok || !body?.data) throw toApiError(res.status, body);
  return body.data;
}

// 이 파일이 하는 일: "채용 공고·면접 질문" 화면(FR-084)의 순수 도구. AI 결과(extra) 읽기, 면접 질문을 직무·태도·상황으로 나누기,
// 보관함(saved_texts kind=hiring)에 넣을 글 만들기(formatHiringBody)와 다시 열 때 공고·질문으로 되돌리기(parseHiringBody),
// 차별 소지 표현 하이라이트 조각 나누기, 점검 API(POST /api/hiring/check) 부르기를 둔다. 순수 함수는 hiringLib.test.ts로 단위 테스트한다.
import { api } from '../../lib/api.ts';
import { QUESTION_TYPES, type HiringCheckResponse, type HiringRiskHit, type InterviewQuestion, type QuestionType } from '../../../../shared/schemas/hiring.ts';

/** 보관 글에서 공고와 면접 질문을 나누는 제목 */
export const QUESTIONS_HEADING = '## 면접 질문';
/** 질문 구분 순서(기타는 AI가 구분을 안 붙였을 때) */
export const QUESTION_GROUPS = [...QUESTION_TYPES, '기타'] as const;
export type QuestionGroup = (typeof QUESTION_GROUPS)[number];

/** 공고 + 질문 초안 */
export interface HiringDraft {
  posting: string;
  questions: InterviewQuestion[];
}

/** 맨 앞의 "[데모 응답]" 표시를 뗀다 */
function stripDemoMark(text: string): string {
  return text.replace(/^\s*\[데모 응답\]\s*/, '');
}

/** "직무", "직무 질문", "[태도]" 같은 글에서 구분을 찾는다(없으면 null) */
function typeOf(label: string): QuestionType | null {
  return QUESTION_TYPES.find((t) => label.includes(t)) ?? null;
}

/** AI가 준 질문 하나를 {type, text}로. 글만 왔으면 앞의 "[직무]", "상황:" 표시를 읽는다 */
export function normalizeQuestion(raw: unknown): InterviewQuestion | null {
  if (typeof raw === 'string') {
    const m = /^\s*[[(（]?\s*(직무|태도|상황)(?:\s*질문)?\s*[\])）]?\s*[:：.\-·]?\s*/u.exec(raw);
    const text = stripDemoMark(m ? raw.slice(m[0].length) : raw).trim();
    if (!text) return null;
    return { type: (m?.[1] as QuestionType | undefined) ?? '기타', text };
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { type?: unknown; text?: unknown };
    if (typeof o.text !== 'string') return null;
    const text = stripDemoMark(o.text).trim();
    if (!text) return null;
    return { type: (typeof o.type === 'string' ? typeOf(o.type) : null) ?? '기타', text };
  }
  return null;
}

/** AI 결과(extra)에서 공고·질문을 꺼낸다(모양이 틀리면 null) */
export function readHiringResult(extra: unknown): HiringDraft | null {
  const o = extra as { posting?: unknown; questions?: unknown } | null | undefined;
  if (!o || typeof o.posting !== 'string' || !Array.isArray(o.questions)) return null;
  const questions = o.questions.map(normalizeQuestion).filter((q): q is InterviewQuestion => !!q);
  const posting = stripDemoMark(o.posting).trim();
  if (!posting) return null;
  return { posting, questions };
}

/** 질문을 구분별로 묶는다(빈 구분은 뺌, 순서는 직무 → 태도 → 상황 → 기타) */
export function groupQuestions(questions: readonly InterviewQuestion[]): Array<{ type: QuestionGroup; items: string[] }> {
  return QUESTION_GROUPS.map((type) => ({ type, items: questions.filter((q) => q.type === type).map((q) => q.text) })).filter((g) => g.items.length > 0);
}

/** 보관함에 넣을 글: 공고 + "## 면접 질문" + 구분별 "### 직무 질문" 목록 */
export function formatHiringBody(draft: HiringDraft): string {
  const parts = [draft.posting.trim()];
  const groups = groupQuestions(draft.questions);
  if (groups.length) {
    parts.push('', QUESTIONS_HEADING);
    for (const g of groups) parts.push('', `### ${g.type} 질문`, ...g.items.map((q) => `- ${q}`));
  }
  return parts.join('\n');
}

/** 보관한 글을 공고·질문으로 되돌린다. 질문 제목이 없으면 모두 공고로 본다 */
export function parseHiringBody(body: string): HiringDraft {
  const text = body.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const at = lines.lastIndexOf(QUESTIONS_HEADING);
  if (at < 0) return { posting: text.trim(), questions: [] };
  const posting = lines.slice(0, at).join('\n').trim();
  const questions: InterviewQuestion[] = [];
  let current: QuestionType | '기타' = '기타';
  for (const line of lines.slice(at + 1)) {
    const head = /^###\s+(.+)$/.exec(line.trim());
    if (head) {
      current = typeOf(head[1] ?? '') ?? '기타';
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line.trim());
    if (item?.[1]) questions.push({ type: current, text: item[1].trim() });
  }
  return { posting, questions };
}

/** 하이라이트 조각: hit이 있으면 표시할 부분(no는 목록 번호, 1부터) */
export interface RiskPiece {
  text: string;
  hit: HiringRiskHit | null;
  no: number;
}

/** 글을 하이라이트 조각으로 나눈다(hits는 앞쪽부터 늘어선 서버 결과). 겹치거나 글 밖이면 건너뛴다 */
export function splitRiskHighlights(text: string, hits: readonly HiringRiskHit[]): RiskPiece[] {
  const out: RiskPiece[] = [];
  let cursor = 0;
  hits.forEach((h, i) => {
    const start = Math.max(h.start, cursor);
    const end = Math.min(h.end, text.length);
    if (start >= end) return;
    if (start > cursor) out.push({ text: text.slice(cursor, start), hit: null, no: 0 });
    out.push({ text: text.slice(start, end), hit: h, no: i + 1 });
    cursor = end;
  });
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: null, no: 0 });
  return out;
}

/** 차별 소지 표현 점검(규칙 사전만, AI 비용 없음) */
export function checkHiringText(text: string): Promise<HiringCheckResponse> {
  return api.post<HiringCheckResponse>('/api/hiring/check', { text });
}

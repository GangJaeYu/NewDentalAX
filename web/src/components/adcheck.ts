// 이 파일이 하는 일: 의료광고 문구 점검(FR-120)의 화면 쪽 도구. 점검 API 부르기(POST /api/adcheck), 규칙 사전 읽기·저장(GET/PUT /api/ad-rules),
// 하이라이트용 글 조각 나누기(splitHighlights), 데모 표시 떼기, 위험·주의 개수 세기를 둔다. 순수 함수는 단위 테스트한다(adcheck.test.ts).
// 점검 결과 부품(AdCheckResult.tsx)과 점검·홍보 글 화면, 문서 작성기·리뷰 답글 화면의 "광고 문구 점검" 버튼이 함께 쓴다.
import { api } from '../lib/api.ts';
import type { AdcheckResponse, AdRule, AdRuleHit } from '../../../shared/schemas/adcheck.ts';

/** 글 조각: hit이 있으면 하이라이트할 부분(번호는 1부터) */
export interface HighlightPiece {
  text: string;
  hit: AdRuleHit | null;
  /** 결과 목록의 번호(1부터). 하이라이트가 아니면 0 */
  no: number;
}

/**
 * 글을 하이라이트 조각으로 나눈다. hits는 글 앞쪽부터 늘어선 결과(서버 순서)다.
 * 겹치는 표현은 앞 표현이 차지한 뒤의 부분만 하이라이트한다(같은 글자를 두 번 감싸지 않음). 위치가 글 밖이면 무시한다.
 */
export function splitHighlights(text: string, hits: readonly AdRuleHit[]): HighlightPiece[] {
  const out: HighlightPiece[] = [];
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

/** 위험·주의 개수 */
export function countSeverity(hits: readonly AdRuleHit[]): { high: number; medium: number } {
  return { high: hits.filter((h) => h.severity === 'high').length, medium: hits.filter((h) => h.severity === 'medium').length };
}

/** AI 결과 맨 앞의 "[데모 응답]" 표시를 뗀다 */
export function stripDemo(text: string): string {
  return text.replace(/^\s*\[데모 응답\]\s*/, '');
}

/** 점검 결과가 지금 글과 같은 글을 점검한 것인지(앞뒤 공백 무시) */
export function isSameText(result: AdcheckResponse | null, text: string): boolean {
  return !!result && result.text === text.trim();
}

/** 광고 문구 점검을 부른다 */
export function checkAdText(text: string, useAi = true): Promise<AdcheckResponse> {
  return api.post<AdcheckResponse>('/api/adcheck', { text, useAi });
}

/** 규칙 사전 */
export function fetchAdRules(): Promise<AdRule[]> {
  return api.get<AdRule[]>('/api/ad-rules');
}

/** 규칙 사전을 저장한다(admin). 보낸 목록이 새 사전이 된다 */
export function saveAdRules(rules: ReadonlyArray<Omit<AdRule, 'id' | 'ruleKey' | 'updatedAt'> & { id?: number }>): Promise<AdRule[]> {
  return api.put<AdRule[]>('/api/ad-rules', { rules });
}

/** 저장 요청에 넣을 모양으로 */
export function ruleToInput(r: AdRule): Omit<AdRule, 'ruleKey' | 'updatedAt'> {
  return { id: r.id, pattern: r.pattern, matchType: r.matchType, category: r.category, severity: r.severity, reason: r.reason, suggestion: r.suggestion, active: r.active };
}

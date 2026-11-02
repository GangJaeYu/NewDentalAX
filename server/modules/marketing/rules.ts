// 이 파일이 하는 일: 의료광고 1차 규칙 점검 엔진(FR-120 AC1). 규칙(낱말·정규식)으로 글에서 위험 표현의 위치·이유·대체 표현을 찾는다.
// - compileRule: 규칙 하나를 정규식으로 만든다(낱말은 글자 그대로 찾음, 대소문자 무시). 잘못된 정규식은 null(점검에서 빠짐)
// - checkPattern: admin이 적은 정규식이 쓸 수 있는지 확인한다(문법 오류, 오래 걸릴 수 있는 겹친 반복, 빈 글자와 맞음)
// - findRuleHits: 켜진 규칙을 모두 돌려 찾은 표현을 글 앞쪽부터 늘어놓는다. 다른 표현 안에 완전히 들어가는 것은 뺀다(같은 곳을 두 번 표시하지 않음)
// DB나 서버 없이 쓰는 순수 함수라 단위 테스트한다.
import type { AdMatchType, AdRuleCategory, AdRuleHit, AdSeverity } from '../../../shared/schemas/adcheck.ts';

/** 점검에 쓰는 규칙 모양(DB 줄에서 필요한 칸만) */
export interface RuleForCheck {
  id: number;
  pattern: string;
  matchType: AdMatchType;
  category: AdRuleCategory;
  severity: AdSeverity;
  reason: string;
  suggestion: string;
}

/** 한 번에 돌려줄 최대 표현 수 */
export const MAX_HITS = 200;

/** 정규식 특수 글자를 글자 그대로 찾도록 바꾼다 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 규칙 하나를 정규식으로 만든다. 잘못된 정규식이면 null */
export function compileRule(rule: Pick<RuleForCheck, 'pattern' | 'matchType'>): RegExp | null {
  const source = rule.matchType === 'word' ? escapeRegex(rule.pattern.trim()) : rule.pattern;
  if (!source) return null;
  try {
    return new RegExp(source, 'giu');
  } catch {
    return null;
  }
}

/** 겹친 반복(예: (a+)+, (\w*)*)처럼 아주 오래 걸릴 수 있는 모양인지 대략 본다 */
function hasNestedQuantifier(source: string): boolean {
  return /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d*,?\d*\})/.test(source) || /\((?:[^()\\]|\\.)*\{\d*,\d*\}(?:[^()\\]|\\.)*\)\s*[+*{]/.test(source);
}

/** admin이 적은 규칙이 쓸 수 있는지 확인한다. 문제가 있으면 쉬운 한국어 이유, 괜찮으면 null */
export function checkPattern(pattern: string, matchType: AdMatchType): string | null {
  const p = pattern.trim();
  if (!p) return '찾을 말을 적어 주세요.';
  if (matchType === 'word') return null;
  const re = compileRule({ pattern: p, matchType });
  if (!re) return '정규식 모양이 틀렸어요. 괄호와 특수 기호를 확인해 주세요.';
  if (hasNestedQuantifier(p)) return '반복 기호(+, *)를 겹쳐 쓴 정규식은 점검이 아주 느려질 수 있어 쓸 수 없어요.';
  re.lastIndex = 0;
  const m = re.exec('');
  if (m && m[0] === '') return '아무 글자 없이도 맞는 정규식이에요. 찾을 말을 한 글자 이상 넣어 주세요.';
  return null;
}

/** 글에서 규칙에 걸린 표현을 모두 찾는다 */
export function findRuleHits(text: string, rules: readonly RuleForCheck[]): AdRuleHit[] {
  const all: AdRuleHit[] = [];
  for (const rule of rules) {
    const re = compileRule(rule);
    if (!re) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null && guard < MAX_HITS) {
      guard += 1;
      if (m[0] === '') {
        // 빈 글자와 맞으면 한 칸 넘겨 끝없이 돌지 않게 한다
        re.lastIndex += 1;
        continue;
      }
      // 앞뒤 공백은 표시에서 뺀다(정규식의 \s* 때문에 붙은 것)
      const raw = m[0];
      const lead = raw.length - raw.trimStart().length;
      const phrase = raw.trim();
      if (!phrase) continue;
      const start = m.index + lead;
      all.push({ ruleId: rule.id, start, end: start + phrase.length, phrase, category: rule.category, severity: rule.severity, reason: rule.reason, suggestion: rule.suggestion });
    }
  }
  // 앞쪽부터, 같은 곳이면 긴 것·위험도 높은 것 먼저
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || sevRank(b.severity) - sevRank(a.severity) || a.ruleId - b.ruleId);
  const out: AdRuleHit[] = [];
  for (const h of all) {
    // 이미 고른 표현 안에 완전히 들어가면 뺀다
    if (out.some((o) => o.start <= h.start && h.end <= o.end)) continue;
    out.push(h);
    if (out.length >= MAX_HITS) break;
  }
  return out;
}

function sevRank(s: AdSeverity): number {
  return s === 'high' ? 2 : 1;
}

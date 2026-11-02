// 이 파일이 하는 일: 광고 문구 점검 화면 도구(adcheck.ts)의 순수 함수를 확인한다. 하이라이트 조각 나누기(번호·겹침·글 밖 위치), 위험·주의 개수, 데모 표시 떼기, 같은 글 판정.
import { describe, expect, test } from 'vitest';
import type { AdRuleHit } from '../../../shared/schemas/adcheck.ts';
import { countSeverity, isSameText, splitHighlights, stripDemo } from './adcheck.ts';

const hit = (start: number, end: number, phrase: string, severity: AdRuleHit['severity'] = 'high'): AdRuleHit => ({
  ruleId: start + 1,
  start,
  end,
  phrase,
  category: 'superlative',
  severity,
  reason: '이유',
  suggestion: '바꿀 말',
});

describe('광고 점검 하이라이트', () => {
  test('phase-04-task-06 AC1: 위험 표현마다 번호가 붙은 하이라이트 조각이 생기고, 나머지 글은 그대로 이어진다', () => {
    const text = '국내 최고 임플란트, 100% 성공, 지금 50% 할인';
    const hits = [hit(0, 5, '국내 최고'), hit(12, 16, '100%'), hit(24, 30, '50% 할인', 'high')];
    const pieces = splitHighlights(text, hits);
    expect(pieces.map((p) => p.text).join('')).toBe(text);
    expect(pieces.filter((p) => p.hit).map((p) => [p.text, p.no])).toEqual([
      ['국내 최고', 1],
      ['100%', 2],
      ['50% 할인', 3],
    ]);
    expect(countSeverity([...hits, hit(31, 32, 'x', 'medium')])).toEqual({ high: 3, medium: 1 });
  });

  test('phase-04-task-06 AC1: 겹치는 표현은 같은 글자를 두 번 감싸지 않고, 글 밖 위치는 무시한다', () => {
    const text = '파격 할인 특가';
    const pieces = splitHighlights(text, [hit(0, 5, '파격 할인'), hit(3, 8, '할인 특가'), hit(20, 25, '없음')]);
    expect(pieces.map((p) => p.text).join('')).toBe(text);
    expect(pieces.filter((p) => p.hit).map((p) => [p.text, p.no])).toEqual([
      ['파격 할인', 1],
      [' 특가', 2],
    ]);
    expect(splitHighlights('', [])).toEqual([]);
  });

  test('phase-04-task-06 AC4: 홍보 글 데모 표시를 떼고 점검하며, 글이 바뀌면 다시 점검이 필요하다고 본다', () => {
    expect(stripDemo('[데모 응답]\n## 제목\n본문')).toBe('## 제목\n본문');
    expect(stripDemo('본문')).toBe('본문');
    const r = { text: '본문', ruleHits: [], notice: '고지' };
    expect(isSameText(r, '  본문 ')).toBe(true);
    expect(isSameText(r, '본문 고침')).toBe(false);
    expect(isSameText(null, '본문')).toBe(false);
  });
});

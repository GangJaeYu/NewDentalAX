// 이 파일이 하는 일: 채용 공고 화면 도구(hiringLib.ts)의 순수 함수를 확인한다(phase-04-task-07 AC1·AC3).
// AI 결과에서 공고·질문 꺼내기(직무·태도·상황 구분), 보관 글 만들기와 다시 열기(왕복해도 같은 초안), 하이라이트 조각 나누기를 본다.
import { describe, expect, test } from 'vitest';
import type { HiringRiskHit } from '../../../../shared/schemas/hiring.ts';
import { formatHiringBody, groupQuestions, normalizeQuestion, parseHiringBody, readHiringResult, splitRiskHighlights } from './hiringLib.ts';

const EXTRA = {
  posting: '[데모 응답] ## 치과위생사 채용\n\n### 근무 조건\n- 주 5일',
  questions: [
    { type: '직무', text: '스케일링 순서를 말씀해 주세요.' },
    { type: '상황', text: '환자가 화를 내면 어떻게 하시겠어요?' },
    { type: '태도 질문', text: '동료와 일을 어떻게 나누시나요?' },
    '[직무] 소독 순서를 말씀해 주세요.',
    '이전 근무지 이야기를 해 주세요.',
    { type: '직무', text: '   ' },
    42,
  ],
};

describe('AI 결과 읽기와 질문 구분', () => {
  test('phase-04-task-07 AC1: 질문을 직무·태도·상황(·기타)으로 나누고 데모 표시를 뗀다', () => {
    const d = readHiringResult(EXTRA);
    expect(d?.posting.startsWith('## 치과위생사 채용')).toBe(true);
    expect(d?.questions).toHaveLength(5);
    const groups = groupQuestions(d!.questions);
    expect(groups.map((g) => [g.type, g.items.length])).toEqual([
      ['직무', 2],
      ['태도', 1],
      ['상황', 1],
      ['기타', 1],
    ]);
    expect(groups[0]!.items[1]).toBe('소독 순서를 말씀해 주세요.');
    expect(normalizeQuestion('상황: 급한 진료가 들어오면?')).toEqual({ type: '상황', text: '급한 진료가 들어오면?' });
    expect(readHiringResult({ posting: 1, questions: [] })).toBeNull();
    expect(readHiringResult(null)).toBeNull();
  });
});

describe('보관 글 만들기·다시 열기', () => {
  test('phase-04-task-07 AC3: 공고 + 질문을 보관 글로 만들었다가 다시 열면 같은 공고·질문(구분 포함)으로 돌아온다', () => {
    const draft = readHiringResult(EXTRA)!;
    const body = formatHiringBody(draft);
    expect(body).toContain('## 면접 질문');
    expect(body).toContain('### 직무 질문\n- 스케일링 순서를 말씀해 주세요.');
    const back = parseHiringBody(body);
    expect(back.posting).toBe(draft.posting);
    expect(groupQuestions(back.questions)).toEqual(groupQuestions(draft.questions));
    // 질문 제목이 없는 글은 모두 공고로 본다(직접 적은 보관 글)
    expect(parseHiringBody('그냥 공고 글\r\n둘째 줄')).toEqual({ posting: '그냥 공고 글\n둘째 줄', questions: [] });
    // 질문이 없으면 질문 제목도 붙이지 않는다
    expect(formatHiringBody({ posting: '공고', questions: [] })).toBe('공고');
  });
});

describe('하이라이트 조각', () => {
  test('phase-04-task-07 AC2: 찾은 표현 자리만 번호와 함께 나누고, 겹치거나 글 밖이면 건너뛴다', () => {
    const hit = (start: number, end: number): HiringRiskHit => ({ ruleKey: `r${start}`, start, end, phrase: '', category: 'age', severity: 'high', reason: '', suggestion: '' });
    const pieces = splitRiskHighlights('20대 여성 우대', [hit(0, 3), hit(1, 2), hit(4, 9), hit(20, 30)]);
    expect(pieces.map((p) => [p.text, p.no])).toEqual([
      ['20대', 1],
      [' ', 0],
      ['여성 우대', 3],
    ]);
  });
});

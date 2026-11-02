// 이 파일이 하는 일: 받침에 맞춰 조사를 고르는 함수(shared/josa.ts)를 확인한다(phase-04-task-07, 03-05 데모 답글 조사 오류 후속).
import { describe, expect, test } from 'vitest';
import { finalConsonant, josa, withJosa } from './josa.ts';

describe('받침 조사 고르기', () => {
  test('phase-04-task-07 조사: 받침이 있으면 을·이·은·과·으로, 없으면 를·가·는·와·로를 고른다', () => {
    expect(withJosa('직원 응대', '을/를')).toBe('직원 응대를');
    expect(withJosa('설명', '을/를')).toBe('설명을');
    expect(withJosa('하늘숲치과', '이/가')).toBe('하늘숲치과가');
    expect(withJosa('저희 병원', '이/가')).toBe('저희 병원이');
    expect(withJosa('청결', '은/는')).toBe('청결은');
    expect(withJosa('주차', '과/와')).toBe('주차와');
    expect(withJosa('치과', '이에요/예요')).toBe('치과예요');
    expect(withJosa('병원', '이에요/예요')).toBe('병원이에요');
    expect(withJosa('설명', '이나/나')).toBe('설명이나');
  });

  test('phase-04-task-07 조사: "으로/로"는 ㄹ 받침이면 "로"를 쓴다', () => {
    expect(withJosa('오전', '으로/로')).toBe('오전으로');
    expect(withJosa('종일', '으로/로')).toBe('종일로');
    expect(withJosa('오후', '으로/로')).toBe('오후로');
  });

  test('phase-04-task-07 조사: 숫자는 읽는 소리로, 끝 괄호 설명은 건너뛰고, 알 수 없으면 둘 다 적는다', () => {
    expect(withJosa('02-555-0100', '으로/로')).toBe('02-555-0100으로');
    expect(withJosa('02-123-4567', '으로/로')).toBe('02-123-4567로');
    expect(withJosa('3', '이/가')).toBe('3이');
    expect(withJosa('2', '이/가')).toBe('2가');
    expect(withJosa('대표번호(02-555-0100)', '으로/로')).toBe('대표번호(02-555-0100)로');
    expect(withJosa('“치과위생사 채용 공고”', '을/를')).toBe('“치과위생사 채용 공고”를');
    expect(josa('ABC', '을/를')).toBe('을(를)');
    expect(josa('ABC', '으로/로')).toBe('(으)로');
    expect(josa('', '이/가')).toBe('이(가)');
    expect(finalConsonant('닭')).toBe(9);
  });
});

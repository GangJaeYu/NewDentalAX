// 이 파일이 하는 일: 지출·월간 요약 화면의 순수 계산(financeLib.ts)과 공용 달 계산(shared/schemas/finance.ts)을 확인한다.
// 금액 입력 읽기(쉼표·"원" 허용, 소수·0·글자 거절), 증감 문구, 그래프 축 글자, 파일 크기 글자, CSV 주소, 달 옮기기·증감 비율이다.
import { describe, expect, test } from 'vitest';
import { changeRatio, shiftYearMonth } from '../../../../shared/schemas/finance.ts';
import { compareText, csvUrl, parseAmount, shortMonth, sizeText } from './financeLib.ts';

describe('지출 화면 계산', () => {
  test('금액 입력은 원 단위 정수만 받는다', () => {
    expect(parseAmount('120,000원')).toBe(120000);
    expect(parseAmount(' 412 000 ')).toBe(412000);
    expect(parseAmount('12.5')).toBeNull();
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('-3000')).toBeNull();
    expect(parseAmount('만원')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  test('phase-04-task-04 AC3: 전월 대비 문구는 늘었어요·줄었어요·같아요, 비교 달이 0원이면 비교할 수 없다는 안내', () => {
    expect(compareText({ month: '2026-09', total: 1000, diff: 250, diffRatio: 0.25 }, '지난달')).toEqual({ text: '지난달보다 25% 늘었어요', tone: 'up' });
    expect(compareText({ month: '2026-09', total: 1000, diff: -125, diffRatio: -0.125 }, '지난달')).toEqual({ text: '지난달보다 12.5% 줄었어요', tone: 'down' });
    expect(compareText({ month: '2026-09', total: 1000, diff: 0, diffRatio: 0 }, '지난달')).toEqual({ text: '지난달과 같아요', tone: 'same' });
    expect(compareText({ month: '2025-10', total: 0, diff: 500, diffRatio: null }, '전년 같은 달').tone).toBe('none');
  });

  test('축 글자·파일 크기·CSV 주소', () => {
    expect(shortMonth('2026-01')).toBe('1월');
    expect(shortMonth('2026-11')).toBe('11월');
    expect(sizeText(300)).toBe('1KB');
    expect(sizeText(2.5 * 1024 * 1024)).toBe('2.5MB');
    expect(csvUrl('2026-11', null)).toBe('/api/expenses?format=csv&month=2026-11');
    expect(csvUrl('2026-11', 3)).toBe('/api/expenses?format=csv&month=2026-11&categoryId=3');
  });

  test('달 옮기기와 증감 비율(해 넘김 포함)', () => {
    expect(shiftYearMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftYearMonth('2026-11', -11)).toBe('2025-12');
    expect(shiftYearMonth('2026-11', -12)).toBe('2025-11');
    expect(shiftYearMonth('2026-12', 1)).toBe('2027-01');
    expect(changeRatio(150, 100)).toBe(0.5);
    expect(changeRatio(100, 0)).toBeNull();
  });
});

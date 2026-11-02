// 이 파일이 하는 일: 휴가 일수 계산(shared/schemas/leave.ts의 countLeaveDays 등, phase-03-task-09 결정)을 순수 함수로 확인한다.
// 병원이 문을 여는 날만 세기(휴진 요일 빼기), 반차 0.5일·하루만, 해 넘김·60일 초과·잘못된 날짜 거부, 요일 이름, 일수 글자를 본다.
import { describe, expect, test } from 'vitest';
import { defaultClinic } from '../../../shared/schemas/admin.ts';
import { countLeaveDays, datesBetween, formatLeaveDays, isRealDate, weekdayKey } from '../../../shared/schemas/leave.ts';

const hours = defaultClinic('하늘숲치과').hours; // 평일·토요일 진료, 일요일 휴진
const weekdaysOnly = { ...hours, sat: null };

describe('휴가 일수 계산', () => {
  test('phase-03-task-09 AC1: 반차는 0.5일이고, 기간 연차는 휴진일을 빼고 영업일만 센다', () => {
    expect(countLeaveDays('half_am', '2026-11-06', '2026-11-06', hours)).toEqual({ dates: ['2026-11-06'], skipped: [], days: 0.5 });
    expect(countLeaveDays('half_pm', '2026-11-07', '2026-11-07', hours)).toMatchObject({ days: 0.5 });
    // 11/6(금)~11/9(월): 일요일 휴진 → 금·토·월 3일, 토요일까지 휴진이면 2일
    expect(countLeaveDays('annual', '2026-11-06', '2026-11-09', hours)).toEqual({ dates: ['2026-11-06', '2026-11-07', '2026-11-09'], skipped: ['2026-11-08'], days: 3 });
    expect(countLeaveDays('annual', '2026-11-06', '2026-11-09', weekdaysOnly)).toMatchObject({ days: 2, skipped: ['2026-11-07', '2026-11-08'] });
    expect(countLeaveDays('sick', '2026-11-02', '2026-11-02', hours)).toMatchObject({ days: 1 });
  });

  test('phase-03-task-09 AC1: 맞지 않는 기간은 오류 문구와 항목 이름을 돌려준다', () => {
    expect(countLeaveDays('annual', '2026-11-08', '2026-11-08', hours)).toEqual({ error: '고른 날은 모두 병원 휴진일이에요. 진료하는 날을 골라 주세요.', field: 'startOn' });
    expect(countLeaveDays('half_am', '2026-11-06', '2026-11-07', hours)).toEqual({ error: '반차는 하루만 신청할 수 있어요.', field: 'endOn' });
    expect(countLeaveDays('annual', '2026-11-09', '2026-11-06', hours)).toMatchObject({ field: 'endOn' });
    expect(countLeaveDays('annual', '2026-12-30', '2027-01-02', hours)).toMatchObject({ error: expect.stringContaining('나눠서 신청해 주세요') });
    expect(countLeaveDays('annual', '2026-01-01', '2026-03-31', hours)).toMatchObject({ error: '한 번에 60일까지 신청할 수 있어요. 나눠서 신청해 주세요.' });
    expect(countLeaveDays('annual', '2026-02-30', '2026-03-01', hours)).toMatchObject({ field: 'startOn' });
  });

  test('phase-03-task-09: 날짜 도우미(요일·날짜 목록·일수 글자)', () => {
    expect(weekdayKey('2026-11-02')).toBe('mon');
    expect(weekdayKey('2026-11-08')).toBe('sun');
    expect(weekdayKey('2024-02-29')).toBe('thu');
    expect(datesBetween('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(isRealDate('2026-11-31')).toBe(false);
    expect(isRealDate('2026-11-30')).toBe(true);
    expect(formatLeaveDays(0.5)).toBe('0.5일');
    expect(formatLeaveDays(14.5)).toBe('14.5일');
    expect(formatLeaveDays(15)).toBe('15일');
  });
});

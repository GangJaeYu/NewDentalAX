// 이 파일이 하는 일: 날짜 계산(lib/dates.ts)을 확인한다 — 월 더하기 말일 보정(2026-01-31+1개월), 윤년,
// KST 자정 경계(UTC 15:00), D-day(오늘=0, 지남=음수), 주기 더하기, 월 범위(phase-01-task-02 AC4).
import { describe, expect, test } from 'vitest';
import {
  addCycle, addDays, addMonths, daysBetween, daysInMonth, dday, ddayLabel, formatKoreanDate, isLeapYear, isValidDate,
  kstDate, kstDateTime, kstDayRangeUtc, kstMidnight, kstMonthStartUtc, monthRange, parseDate, todayKst, weekday,
} from './dates.ts';
import { fixedClock } from './clock.ts';

describe('월 더하기·주기', () => {
  test('phase-01-task-02 AC4: 2026-01-31 + 1개월은 2026-02-28(말일 보정)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', -2)).toBe('2025-11-30');
  });

  test('phase-01-task-02 AC4: 윤년 — 2028-01-31 + 1개월은 2028-02-29, 2028-02-29 + 12개월은 2029-02-28', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
  });

  test('phase-01-task-02 AC4: 주기 더하기(N개월·N일)와 연말 넘김', () => {
    expect(addCycle('2026-11-02', { months: 12 })).toBe('2027-11-02');
    expect(addCycle('2026-08-31', { months: 6 })).toBe('2027-02-28');
    expect(addCycle('2026-12-25', { days: 10 })).toBe('2027-01-04');
    expect(addCycle('2026-01-31', { months: 1, days: 1 })).toBe('2026-03-01');
    expect(addCycle('2026-11-02', {})).toBe('2026-11-02');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  test('phase-01-task-02 AC4: 형식이 틀리거나 없는 날짜는 한국어 오류', () => {
    expect(() => parseDate('2026/11/02')).toThrow('형식이 올바르지 않아요');
    expect(() => parseDate('2026-02-30')).toThrow('달력에 없는 날');
    expect(() => addMonths('2026-13-01', 1)).toThrow();
  });
});

describe('KST 자정 경계', () => {
  test('phase-01-task-02 AC4: UTC 14:59:59는 KST 전날, UTC 15:00은 KST 다음 날', () => {
    expect(kstDate(new Date('2026-11-01T14:59:59.999Z'))).toBe('2026-11-01');
    expect(kstDate(new Date('2026-11-01T15:00:00.000Z'))).toBe('2026-11-02');
    expect(kstDateTime(new Date('2026-11-01T15:00:00.000Z'))).toBe('2026-11-02 00:00');
    expect(kstDateTime(new Date('2026-11-01T14:59:00.000Z'))).toBe('2026-11-01 23:59');
    // 연말 경계
    expect(kstDate(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
  });

  test('phase-01-task-02 AC4: KST 날짜의 자정·하루 범위·이번 달 1일을 UTC로 바꾼다', () => {
    expect(kstMidnight('2026-11-02').toISOString()).toBe('2026-11-01T15:00:00.000Z');
    expect(kstDayRangeUtc('2026-11-02')).toEqual({ from: '2026-11-01T15:00:00.000Z', to: '2026-11-02T15:00:00.000Z' });
    // 11월 1일 00:30 KST(UTC로는 10월 31일)도 이번 달은 11월이다
    expect(kstMonthStartUtc(fixedClock('2026-11-01T00:30:00+09:00'))).toBe('2026-10-31T15:00:00.000Z');
    expect(kstMonthStartUtc(fixedClock('2026-10-31T23:59:00+09:00'))).toBe('2026-09-30T15:00:00.000Z');
  });

  test('phase-01-task-02 AC4: 시계 기준 오늘은 KST 날짜다', () => {
    expect(todayKst(fixedClock('2026-11-02T09:00:00+09:00'))).toBe('2026-11-02');
    expect(todayKst(fixedClock('2026-11-01T15:00:00Z'))).toBe('2026-11-02');
    expect(todayKst(fixedClock('2026-11-01T14:59:59Z'))).toBe('2026-11-01');
  });
});

describe('D-day', () => {
  test('phase-01-task-02 AC4: 오늘=0, 남으면 양수, 지나면 음수', () => {
    expect(dday('2026-11-02', '2026-11-02')).toBe(0);
    expect(dday('2026-11-05', '2026-11-02')).toBe(3);
    expect(dday('2026-11-01', '2026-11-02')).toBe(-1);
    expect(dday('2026-10-03', '2026-11-02')).toBe(-30);
    expect(dday('2027-11-02', '2026-11-02')).toBe(365);
  });

  test('phase-01-task-02 AC4: 시계를 넣으면 KST 오늘 기준(자정 직후 UTC 전날이어도 오늘=0)', () => {
    const justAfterMidnight = fixedClock('2026-11-02T00:05:00+09:00'); // UTC로는 11월 1일 15:05
    expect(dday('2026-11-02', justAfterMidnight)).toBe(0);
    expect(dday('2026-11-01', justAfterMidnight)).toBe(-1);
    const justBeforeMidnight = fixedClock('2026-11-01T23:59:00+09:00');
    expect(dday('2026-11-02', justBeforeMidnight)).toBe(1);
  });

  test('phase-01-task-02 AC4: 화면 표기 D-3 / D-day / D+2', () => {
    expect(ddayLabel(3)).toBe('D-3');
    expect(ddayLabel(0)).toBe('D-day');
    expect(ddayLabel(-2)).toBe('D+2');
  });
});

describe('요일·월 범위', () => {
  test('phase-01-task-02 AC4: 2026-11-02는 월요일, 2월 범위는 윤년을 따른다', () => {
    expect(weekday('2026-11-02')).toBe(1);
    expect(weekday('1970-01-01')).toBe(4);
    expect(weekday('2026-11-01')).toBe(0);
    expect(formatKoreanDate('2026-11-02')).toBe('2026년 11월 2일 (월)');
    expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(() => monthRange('2026-13')).toThrow('형식이 올바르지 않아요');
  });
});

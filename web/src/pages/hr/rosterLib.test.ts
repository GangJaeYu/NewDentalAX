// 이 파일이 하는 일: 근무표 화면 순수 로직(rosterLib.ts)을 확인한다. 칸 글자 규칙(하루 종일 휴가는 휴가 이름만, 반차는 근무와 함께), 주·달 이동, 조사 고르기, 인쇄 머리말.
import { describe, expect, test } from 'vitest';
import { cellParts, moveAnchor, rangeOf, rosterPrintCss, shiftMonth, withRo } from './rosterLib.ts';
import type { ShiftType } from '../../../../shared/schemas/roster.ts';

const T = (id: number, label: string): ShiftType => ({ id, code: `c${id}`, label, startTime: null, endTime: null, colorToken: 'info', countsAsWork: true, sort: id, active: true });
const types = new Map([
  [1, T(1, '종일')],
  [2, T(2, '오전')],
]);

describe('칸 글자', () => {
  test('phase-04-task-01 AC3: 하루 종일 휴가 칸은 "연차"만, 반차 칸은 근무와 반차를 함께, 빈칸은 빈 글자다', () => {
    expect(cellParts({ shiftTypeId: 1, leave: { type: 'annual', label: '연차', requestId: 3, fullDay: true } }, types).text).toBe('연차');
    expect(cellParts({ shiftTypeId: 2, leave: { type: 'half_pm', label: '반차(오후)', requestId: 4, fullDay: false } }, types).text).toBe('오전 · 반차(오후)');
    expect(cellParts({ shiftTypeId: 1 }, types).text).toBe('종일');
    expect(cellParts(undefined, types).text).toBe('');
  });
});

describe('기간 이동', () => {
  test('phase-04-task-01: 주간은 7일씩, 월간은 한 달씩 옮긴다(해 넘김 포함)', () => {
    expect(moveAnchor('week', '2026-11-04', -1)).toBe('2026-10-26');
    expect(moveAnchor('week', '2026-11-04', 1)).toBe('2026-11-09');
    expect(moveAnchor('month', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-20', -1)).toBe('2025-12-01');
    expect(rangeOf('month', '2026-11-02')).toEqual({ from: '2026-10-26', to: '2026-12-06', month: '2026-11' });
  });
});

describe('문구', () => {
  test('phase-04-task-01 AC1: 저장 안내의 조사가 받침에 맞는다', () => {
    expect(withRo('오전')).toBe('으로');
    expect(withRo('종일')).toBe('로');
    expect(withRo('오후')).toBe('로');
    expect(withRo('ABC')).toBe('(으)로');
  });

  test('phase-04-task-01: 인쇄 머리말은 A4 가로이고 병원명·기간을 따옴표 안에 안전하게 넣는다', () => {
    const css = rosterPrintCss('하늘숲"치과', '11월 2일 ~ 8일');
    expect(css).toContain('size: A4 landscape');
    expect(css).toContain('"하늘숲\\22 치과"');
    expect(css).toContain('"근무표 11월 2일 ~ 8일"');
  });
});

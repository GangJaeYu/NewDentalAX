// 이 파일이 하는 일: 대시보드 화면의 글자 계산(dashboardLib.ts)과 상단바 데모 배지 글자(demoBadgeDetail)를 확인한다(phase-03-task-10 AC2·AC4).
// 재고 경고 한 줄·칩, 점검 D-day, 이번 주 7칸, 입출고 한 줄, 요약 숫자 보조 문구, 머리말 요약, 휴가 제목을 본다. 브라우저 없이 Node에서 돈다.
import { describe, expect, test } from 'vitest';
import type { DashboardData, DashStockAlert } from '../../../shared/schemas/dashboard.ts';
import { demoBadgeDetail } from '../layout/TopBar.tsx';
import { addDays, checklistWindow, dueHint, dueLabel, leaveTitle, moveLine, shortDay, stockHint, stockLine, todaySummary, weekCells, weekdayOf, won } from './dashboardLib.ts';

const item = (over: Partial<DashStockAlert>): DashStockAlert => ({
  id: 1,
  name: '니트릴 글러브 M',
  unit: '박스',
  stock: 2,
  par: 6,
  status: 'low',
  nearestExpiry: null,
  dday: null,
  ...over,
});

describe('대시보드 글자 계산', () => {
  test('phase-03-task-10 AC2: 재고 경고 줄은 상태마다 설명과 글자 있는 칩을 만든다', () => {
    expect(stockLine(item({}))).toEqual({ detail: '남은 2박스 · 적정 6박스', chip: '부족', tone: 'danger' });
    expect(stockLine(item({ status: 'soon_low', stock: 3, par: 5, unit: '팩' }))).toEqual({ detail: '남은 3팩 · 적정 5팩', chip: '곧 부족', tone: 'warn' });
    expect(stockLine(item({ status: 'expiring', nearestExpiry: '2026-11-14', dday: 12 }))).toEqual({ detail: '유효기간 2026-11-14', chip: 'D-12', tone: 'warn' });
    expect(stockLine(item({ status: 'expired', nearestExpiry: '2026-10-30', dday: -3 }))).toEqual({ detail: '유효기간 2026-10-30 지남', chip: '만료', tone: 'danger' });
    expect(stockLine(item({ stock: 0.5, par: 1.25 })).detail).toBe('남은 0.5박스 · 적정 1.25박스');
  });

  test('phase-03-task-10 AC2: 점검 일정 남은 날은 지남·오늘·D-n(7일 안은 주의)으로 보인다', () => {
    expect(dueLabel(-18)).toEqual({ text: '지남', tone: 'danger' });
    expect(dueLabel(0)).toEqual({ text: '오늘', tone: 'danger' });
    expect(dueLabel(2)).toEqual({ text: 'D-2', tone: 'warn' });
    expect(dueLabel(7)).toEqual({ text: 'D-7', tone: 'warn' });
    expect(dueLabel(18)).toEqual({ text: 'D-18', tone: null });
    expect(dueLabel(null)).toEqual({ text: '-', tone: null });
  });

  test('phase-03-task-10 AC2: 이번 주 7칸은 월요일부터이고 오늘 칸과 그날 일정이 맞다', () => {
    const week: DashboardData['week'] = {
      start: '2026-11-02',
      end: '2026-11-08',
      events: [
        { date: '2026-11-04', kind: 'legal', title: '의료폐기물 보관시설 소독', link: '/facility/legal?view=due', tone: 'warn' },
        { date: '2026-11-04', kind: 'equipment', title: '1번 멸균기 정기 점검', link: '/facility/equipment?open=1', tone: 'warn' },
        { date: '2026-11-06', kind: 'leave', title: '오소담 연차', link: '/hr/leave', tone: null },
      ],
    };
    const cells = weekCells(week, '2026-11-02');
    expect(cells.map((c) => c.label)).toEqual(['월 2', '화 3', '수 4', '목 5', '금 6', '토 7', '일 8']);
    expect(cells.filter((c) => c.today).map((c) => c.date)).toEqual(['2026-11-02']);
    expect(cells[2]?.events.map((e) => e.title)).toEqual(['의료폐기물 보관시설 소독', '1번 멸균기 정기 점검']);
    expect(cells[4]?.events.map((e) => e.title)).toEqual(['오소담 연차']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekdayOf('2026-11-02')).toBe(1);
    expect(shortDay('2026-11-14')).toBe('11/14(토)');
  });

  test('phase-03-task-10 AC2: 입출고 줄은 종류 칩과 품목·수량을 보인다', () => {
    const base = { id: 1, itemId: 2, itemName: '석션 팁 (일회용)', unit: '봉', unitPrice: null, movedAt: '2026-11-01T23:47:00.000Z', userName: '정하늘' };
    expect(moveLine({ ...base, type: 'out', qty: 1 })).toEqual({ chip: '출고', tone: 'ghost', title: '석션 팁 (일회용) · 1봉' });
    expect(moveLine({ ...base, type: 'in', qty: 2 })).toEqual({ chip: '입고', tone: 'ok', title: '석션 팁 (일회용) · 2봉' });
    expect(moveLine({ ...base, type: 'adjust', qty: -2 }).title).toBe('석션 팁 (일회용) · −2봉');
  });

  test('phase-03-task-10 AC4: 요약 숫자 보조 문구는 0인 항목을 빼고, 모두 0이면 비었다고 말한다', () => {
    expect(stockHint({ total: 5, low: 2, expiring: 1, soonLow: 1, expired: 1 })).toBe('부족 2 · 유효기간 2 · 곧 부족 1');
    expect(stockHint({ total: 0, low: 0, expiring: 0, soonLow: 0, expired: 0 })).toBe('경고 없음');
    expect(dueHint({ total: 4, overdue: 1, today: 0, needCheck: 2, sterilizerFail: 0 })).toBe('기한 지남 1 · 확인 필요 2');
    expect(dueHint({ total: 3, overdue: 0, today: 0, needCheck: 0, sterilizerFail: 0 })).toBe('여유 있게 준비하세요');
    expect(dueHint({ total: 0, overdue: 0, today: 0, needCheck: 0, sterilizerFail: 0 })).toBe('30일 안 일정 없음');
    expect(dueHint({ total: 2, overdue: 0, today: 1, needCheck: 0, sterilizerFail: 1 })).toBe('멸균 불합격 1 · 오늘 1');
  });

  test('phase-03-task-10 AC2: 머리말 요약·휴가 제목·금액 글자', () => {
    expect(todaySummary({ date: '2026-11-02', rosterReady: false, working: [], onLeave: [] })).toBe('');
    expect(todaySummary({ date: '2026-11-02', rosterReady: false, working: [], onLeave: [{ userId: 3, name: '박서연', type: 'annual' }] })).toBe('휴가 1명(박서연)');
    expect(todaySummary({ date: '2026-11-02', rosterReady: true, working: [{ userId: 1, name: '최윤호', jobType: '원장', shift: '종일' }], onLeave: [] })).toBe('오늘 근무 1명');
    expect(leaveTitle({ name: '오소담', type: 'annual', startOn: '2026-11-06', endOn: '2026-11-06' })).toBe('오소담 연차 11/6(금)');
    expect(leaveTitle({ name: '조은솔', type: 'annual', startOn: '2026-11-12', endOn: '2026-11-13' })).toBe('조은솔 연차 11/12(목)~11/13(금)');
    expect(won(12400)).toBe('12,400원');
  });
});

describe('오늘 할 일 체크리스트 줄 고르기', () => {
  const items = (flags: string) => [...flags].map((f, i) => ({ id: i + 1, checked: f === 'x' }));
  test('phase-03-task-10 AC2: 처음 안 한 항목 바로 앞부터 보여 주어 방금 체크한 줄이 남아 있다', () => {
    expect(checklistWindow(items('......'), 3).map((i) => i.id)).toEqual([1, 2, 3]);
    expect(checklistWindow(items('x.....'), 3).map((i) => i.id)).toEqual([1, 2, 3]);
    expect(checklistWindow(items('xx....'), 3).map((i) => i.id)).toEqual([2, 3, 4]);
    expect(checklistWindow(items('xxxxx.'), 3).map((i) => i.id)).toEqual([4, 5, 6]);
    expect(checklistWindow(items('xxxxxx'), 3).map((i) => i.id)).toEqual([4, 5, 6]);
    expect(checklistWindow(items('x.'), 3).map((i) => i.id)).toEqual([1, 2]);
    expect(checklistWindow(items(''), 3)).toEqual([]);
  });
});

describe('상단바 데모 배지 글자', () => {
  test('phase-03-task-10 AC2: 가상 데이터와 AI 키 미설정을 구분해 보이고, 둘 다 아니면 배지가 없다', () => {
    expect(demoBadgeDetail(true, true)).toBe('가상 데이터 · AI 키 미설정');
    expect(demoBadgeDetail(true, false)).toBe('가상 데이터');
    expect(demoBadgeDetail(false, true)).toBe('AI 키 미설정');
    expect(demoBadgeDetail(false, false)).toBeNull();
  });
});

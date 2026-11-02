// 이 파일이 하는 일: 근무표 화면(/hr/roster)·근무표 인쇄(/print/roster)·대시보드 "오늘 근무" 카드가 함께 쓰는 데이터 key, 불러오기 함수, 날짜 이동 계산, 칸 글자를 둔다.
// 주간은 월~일 7일, 월간은 그 달 1일이 든 주 월요일부터 말일이 든 주 일요일까지(최대 6주)다. 날짜 계산은 shared/schemas/roster.ts와 같은 함수를 쓴다.
// 칸 글자 규칙: 하루 종일 휴가면 휴가 이름("연차")만, 반차면 근무 유형과 반차를 함께, 아무것도 없으면 빈칸이다.
import { api } from '../../lib/api.ts';
import { cssText } from '../inventory/ordersLib.ts';
import type { Tone } from '../../components/Chip.tsx';
import {
  monthGridRange,
  shiftDate,
  shiftTimeText,
  weekRange,
  type RosterCell,
  type RosterView,
  type ShiftColor,
  type ShiftType,
  type TodayRoster,
} from '../../../../shared/schemas/roster.ts';

/** 데이터 key 앞부분(저장하면 'hr:roster'로 모두 다시 불러온다) */
export const ROSTER_KEY = 'hr:roster';

export type RosterMode = 'week' | 'month';

/** 근무 유형 색 → 칩 색. 'accent'는 칩 tone에 없어서 roster.css의 .chip.accent로 그린다 */
export function shiftChipClass(color: ShiftColor): string {
  return `chip ${color}`;
}

/** 휴가 칩 색: 하루 종일 휴가는 주의(주황), 반차는 정보(청록) */
export function leaveTone(fullDay: boolean): Tone {
  return fullDay ? 'warn' : 'info';
}

/** 'YYYY-MM-DD'의 달을 n달 옮긴 1일 */
export function shiftMonth(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}

/** 화면이 볼 기간 */
export function rangeOf(mode: RosterMode, anchor: string): { from: string; to: string } {
  return mode === 'week' ? weekRange(anchor) : monthGridRange(anchor);
}

/** 이전·다음으로 옮긴 기준 날짜 */
export function moveAnchor(mode: RosterMode, anchor: string, dir: -1 | 1): string {
  return mode === 'week' ? shiftDate(weekRange(anchor).from, 7 * dir) : shiftMonth(anchor, dir);
}

/** 근무표를 불러온다. anchor가 없으면 서버 기준 오늘로 정한다(주간은 서버가 이번 주를 고른다) */
export async function fetchRoster(mode: RosterMode, anchor: string | null): Promise<RosterView> {
  if (!anchor && mode === 'week') return api.get<RosterView>('/api/roster');
  const a = anchor ?? (await fetchToday()).date;
  const r = rangeOf(mode, a);
  return api.get<RosterView>(`/api/roster?from=${r.from}&to=${r.to}`);
}

/** 오늘 근무자(대시보드 카드) */
export function fetchToday(): Promise<TodayRoster> {
  return api.get<TodayRoster>('/api/roster/today');
}

/** 칸에 보여 줄 글자들(화면 읽기·인쇄에도 쓴다) */
export function cellParts(cell: RosterCell | undefined, types: ReadonlyMap<number, ShiftType>): { shift: ShiftType | null; leave: RosterCell['leave'] | null; text: string } {
  const shift = cell?.shiftTypeId != null ? (types.get(cell.shiftTypeId) ?? null) : null;
  const leave = cell?.leave ?? null;
  if (leave?.fullDay) return { shift, leave, text: leave.label };
  const parts = [shift?.label, leave?.label].filter(Boolean);
  return { shift, leave, text: parts.join(' · ') };
}

/** 근무 유형 설명: '오전 09:30~13:00' */
export function shiftTitle(t: Pick<ShiftType, 'label' | 'startTime' | 'endTime'>): string {
  const time = shiftTimeText(t);
  return time ? `${t.label} ${time}` : t.label;
}

/** '2026-11-03' → '11/3' */
export function shortDate(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** 받침에 맞는 조사: '오전' → '으로', '종일'·'오후' → '로'(ㄹ 받침과 받침 없음은 '로') */
export function withRo(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return '(으)로';
  const jong = code % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}

/** 쪽마다 들어갈 머리말과 A4 가로 설정. 쪽 번호는 styles/print.css가 넣는다 */
export function rosterPrintCss(clinic: string, period: string): string {
  return `@page { size: A4 landscape; @top-left { content: ${cssText(clinic)}; font-size: 9pt; color: #586968; } @top-right { content: ${cssText(`근무표 ${period}`)}; font-size: 9pt; color: #586968; } }`;
}

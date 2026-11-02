// 이 파일이 하는 일: 대시보드 화면(DashboardPage)이 쓰는 순수 계산 함수 모음. 서버 응답(shared/schemas/dashboard.ts)을 화면 글자로 바꾼다.
// 요약 숫자 보조 문구, 재고 경고 한 줄 설명과 칩, 점검 일정 D-day, 이번 주 7일 칸, 입출고 한 줄, 머리말 요약을 만든다. 화면 없이 단위 시험할 수 있다.
import { STOCK_STATUS_LABELS } from '../../../shared/schemas/inventory.ts';
import { LEAVE_TYPE_LABELS } from '../../../shared/schemas/leave.ts';
import type { DashboardData, DashMove, DashStockAlert, DashWeekEvent } from '../../../shared/schemas/dashboard.ts';
import type { Tone } from '../components/Chip.tsx';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 숫자를 소수 셋째 자리까지(끝 0 없이) */
function num(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** 'YYYY-MM-DD' → 요일 번호(0=일) */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 'YYYY-MM-DD'에 n일 더하기 */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** '2026-11-14' → '11/14(금)' */
export function shortDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WEEKDAYS[weekdayOf(date)]})`;
}

/** 이번 주 7일 칸: 날짜, '월 2' 같은 머리글, 오늘인지, 그날 일정 */
export function weekCells(week: DashboardData['week'], today: string): Array<{ date: string; label: string; today: boolean; events: DashWeekEvent[] }> {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(week.start, i);
    return { date, label: `${WEEKDAYS[weekdayOf(date)]} ${Number(date.slice(8))}`, today: date === today, events: week.events.filter((e) => e.date === date) };
  });
}

/** 재고 경고 한 줄: 설명 글과 칩(색 + 글자) */
export function stockLine(i: DashStockAlert): { detail: string; chip: string; tone: Tone } {
  if (i.status === 'expired') return { detail: `유효기간 ${i.nearestExpiry ?? '-'} 지남`, chip: STOCK_STATUS_LABELS.expired, tone: 'danger' };
  if (i.status === 'expiring') return { detail: `유효기간 ${i.nearestExpiry ?? '-'}`, chip: i.dday !== null ? `D-${i.dday}` : STOCK_STATUS_LABELS.expiring, tone: 'warn' };
  return { detail: `남은 ${num(i.stock)}${i.unit} · 적정 ${num(i.par)}${i.unit}`, chip: STOCK_STATUS_LABELS[i.status], tone: i.status === 'low' ? 'danger' : 'warn' };
}

/** 점검·의무 일정 남은 날 표시: 기한 지남 / 오늘 / D-n(7일 안이면 주의 색) */
export function dueLabel(daysLeft: number | null): { text: string; tone: 'danger' | 'warn' | null } {
  if (daysLeft === null) return { text: '-', tone: null };
  if (daysLeft < 0) return { text: '지남', tone: 'danger' };
  if (daysLeft === 0) return { text: '오늘', tone: 'danger' };
  return { text: `D-${daysLeft}`, tone: daysLeft <= 7 ? 'warn' : null };
}

const MOVE_LABELS: Record<DashMove['type'], { label: string; tone: Tone }> = {
  out: { label: '출고', tone: 'ghost' },
  in: { label: '입고', tone: 'ok' },
  adjust: { label: '조정', tone: 'warn' },
};

/** 입출고 한 줄: 칩과 '품목 · 수량' 글 */
export function moveLine(m: DashMove): { chip: string; tone: Tone; title: string } {
  const sign = m.type === 'adjust' && m.qty > 0 ? '+' : m.type === 'adjust' && m.qty < 0 ? '−' : '';
  return { chip: MOVE_LABELS[m.type].label, tone: MOVE_LABELS[m.type].tone, title: `${m.itemName} · ${sign}${num(Math.abs(m.qty))}${m.unit}` };
}

/** 재고 경고 요약 숫자 보조 문구: '부족 2 · 유효기간 2 · 곧 부족 1'(0인 것은 뺀다) */
export function stockHint(s: DashboardData['kpis']['stock']): string {
  const parts = [s.low ? `부족 ${s.low}` : '', s.expired + s.expiring ? `유효기간 ${s.expired + s.expiring}` : '', s.soonLow ? `곧 부족 ${s.soonLow}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : '경고 없음';
}

/** 점검·의무 요약 숫자 보조 문구 */
export function dueHint(d: DashboardData['kpis']['due']): string {
  const parts = [d.overdue ? `기한 지남 ${d.overdue}` : '', d.today ? `오늘 ${d.today}` : '', d.needCheck ? `확인 필요 ${d.needCheck}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : d.total ? '여유 있게 준비하세요' : '30일 안 일정 없음';
}

/** 머리말 요약 끝부분: '휴가 1명(박서연)' (근무표가 생기면 '오늘 근무 7명'이 앞에 붙는다) */
export function todaySummary(today: DashboardData['today']): string {
  const parts: string[] = [];
  if (today.rosterReady) parts.push(`오늘 근무 ${today.working.length}명`);
  if (today.onLeave.length) parts.push(`휴가 ${today.onLeave.length}명(${today.onLeave.map((p) => p.name).join(', ')})`);
  return parts.join(' · ');
}

/** 휴가 신청 한 줄 제목: '오소담 연차 11/6(금)' 또는 기간이면 '11/12(목)~11/13(금)' */
export function leaveTitle(a: { name: string; type: keyof typeof LEAVE_TYPE_LABELS; startOn: string; endOn: string }): string {
  const when = a.startOn === a.endOn ? shortDay(a.startOn) : `${shortDay(a.startOn)}~${shortDay(a.endOn)}`;
  return `${a.name} ${LEAVE_TYPE_LABELS[a.type]} ${when}`;
}

/** 금액 '12,400원' */
export function won(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

/**
 * 오늘 할 일 카드에 보일 체크리스트 n줄. 처음 안 한 항목의 바로 앞(방금 체크한 항목)부터 보여 줘서,
 * 체크하자마자 줄이 사라지지 않고 줄 그어진 채 남아 있게 한다. 모두 끝났으면 마지막 n줄을 보인다.
 */
export function checklistWindow<T extends { checked: boolean }>(items: readonly T[], n: number): T[] {
  if (n <= 0) return [];
  const first = items.findIndex((i) => !i.checked);
  const from = first === -1 ? items.length - n : first - 1;
  const start = Math.max(0, Math.min(from, items.length - n));
  return items.slice(start, start + n);
}

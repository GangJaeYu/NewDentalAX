// 이 파일이 하는 일: 장비·멸균기 화면과 인쇄 화면이 함께 쓰는 순수 함수(상태 칩 글자·색, 정렬, 금액·주소 만들기)와 데이터 키를 둔다.
// 칩에는 늘 글자를 붙여 색만으로 상태를 구분하지 않는다(DESIGN §5-5). 화면 파일(EquipmentPage·SterilizerPage·Print*)이 import한다.
import type { Tone } from '../../components/Chip.tsx';
import { formatNumber } from '../../lib/format.ts';
import type { Equipment, EquipmentDueState, SterilizerLog } from '../../../../shared/schemas/equipment.ts';

/** useApi 키(바꾼 뒤 invalidate로 다시 부른다) */
export const EQUIPMENT_KEY = 'facility:equipment';
export const STERILIZER_KEY = 'facility:sterilizer';

/** 다음 점검 상태 칩(글자·색) */
export function equipmentDueChip(e: Pick<Equipment, 'dueState' | 'daysLeft'>): { text: string; tone: Tone } {
  const n = e.daysLeft ?? 0;
  switch (e.dueState) {
    case 'off':
      return { text: '사용 중지', tone: 'ghost' };
    case 'no_cycle':
      return { text: '정기 점검 없음', tone: 'ghost' };
    case 'first_needed':
      return { text: '첫 점검일 입력 필요', tone: 'warn' };
    case 'overdue':
      return { text: `점검 지남 ${-n}일`, tone: 'danger' };
    case 'today':
      return { text: '오늘 점검', tone: 'danger' };
    case 'soon':
      return { text: `D-${n}`, tone: 'warn' };
    case 'upcoming':
      return { text: `D-${n}`, tone: 'info' };
    default:
      return { text: `D-${n}`, tone: 'ok' };
  }
}

/** 급한 순서: 지남 → 오늘 → 7일 안 → 30일 안 → 첫 점검일 필요 → 여유 → 주기 없음 → 사용 중지 */
const RANK: Record<EquipmentDueState, number> = { overdue: 0, today: 1, soon: 2, upcoming: 3, first_needed: 4, ok: 5, no_cycle: 6, off: 7 };

/** 장비를 급한 순서로 정렬한다(같으면 남은 날 → 이름) */
export function sortEquipment(items: readonly Equipment[]): Equipment[] {
  return [...items].sort((a, b) => RANK[a.dueState] - RANK[b.dueState] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.name.localeCompare(b.name, 'ko'));
}

/** 금액 글(원). 없으면 '—' */
export function wonText(n: number | null): string {
  return n === null ? '—' : `${formatNumber(n)}원`;
}

/** 멸균 판정 칩: 합격 / 불합격(조치 전) / 불합격(조치함) */
export function sterilizerResultChip(l: Pick<SterilizerLog, 'result' | 'actionAt'>): { text: string; tone: Tone } {
  if (l.result === 'pass') return { text: '합격', tone: 'ok' };
  return l.actionAt ? { text: '불합격 · 조치함', tone: 'warn' } : { text: '불합격 · 조치 전', tone: 'danger' };
}

/** 기간·멸균기 조건을 주소 뒤 글(?from=…&to=…)로 */
export function rangeQuery(q: { from: string; to: string; equipmentId?: number | null }): string {
  const p = new URLSearchParams({ from: q.from, to: q.to });
  if (q.equipmentId) p.set('equipmentId', String(q.equipmentId));
  return `?${p.toString()}`;
}

/** 'YYYY-MM-DD' 모양인지 */
export function isDateText(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** 글 칸 값 → 숫자(빈칸이면 null, 숫자가 아니면 NaN) */
export function numOrNull(v: string): number | null {
  const t = v.replace(/,/g, '').trim();
  return t === '' ? null : Number(t);
}

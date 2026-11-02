// 이 파일이 하는 일: 화면에 숫자·금액·날짜·남은 날(D-n)을 같은 모양으로 보여 주는 함수 모음. 날짜는 한국 시간(Asia/Seoul) 기준이다.
// 표·카드·칩이 모두 이 함수를 써서 "12,400원", "2026년 11월 2일 월요일", "D-12", "오늘", "기한 지남"처럼 통일한다.

const TZ = 'Asia/Seoul';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 숫자에 천 단위 쉼표를 붙인다(1234 → "1,234"). 숫자가 아니면 "-" */
export function formatNumber(n: number | null | undefined, maxFraction = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: maxFraction });
}

/** 원 단위 금액(12400 → "12,400원") */
export function formatWon(n: number | null | undefined): string {
  const s = formatNumber(n === null || n === undefined ? n : Math.round(n));
  return s === '-' ? s : `${s}원`;
}

/** 백분율(0.314 → "31%") */
export function formatPercent(ratio: number | null | undefined, maxFraction = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '-';
  return `${formatNumber(ratio * 100, maxFraction)}%`;
}

/** 날짜 값(문자열·Date)을 Date로 바꾼다. 'YYYY-MM-DD'는 한국 날짜 자정으로 본다 */
export function toDate(v: string | Date): Date {
  if (v instanceof Date) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00+09:00`);
  return new Date(v);
}

/** 한국 시간 기준 날짜 부분 { y, m, d, wd(요일 0=일) } */
export function seoulParts(v: string | Date): { y: number; m: number; d: number; wd: number; hh: number; mm: number } {
  const date = toDate(v);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), wd: wdMap[get('weekday')] ?? 0, hh: Number(get('hour')), mm: Number(get('minute')) };
}

/** 'YYYY-MM-DD'(한국 날짜) */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '-';
  const p = seoulParts(v);
  if (!Number.isFinite(p.y)) return '-';
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** "2026년 11월 2일 월요일" */
export function formatDateLong(v: string | Date): string {
  const p = seoulParts(v);
  return `${p.y}년 ${p.m}월 ${p.d}일 ${WEEKDAYS[p.wd]}요일`;
}

/** "11/2 (월)" */
export function formatDateShort(v: string | Date): string {
  const p = seoulParts(v);
  return `${p.m}/${p.d} (${WEEKDAYS[p.wd]})`;
}

/** "11/2 18:40" */
export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '-';
  const p = seoulParts(v);
  return `${p.m}/${p.d} ${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

/** 두 날짜 사이 날 수(한국 날짜 기준, to - from). 2026-11-02 → 2026-11-14 = 12 */
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = seoulParts(from);
  const b = seoulParts(to);
  const ua = Date.UTC(a.y, a.m - 1, a.d);
  const ub = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((ub - ua) / 86400000);
}

/** 남은 날 표시와 상태: 0 → 오늘(위험), 1~7 → D-n(주의), 그 뒤 → D-n, 음수 → 기한 지남(위험) */
export function formatDDay(daysLeft: number, soonDays = 7): { text: string; tone: 'danger' | 'warn' | 'ghost' } {
  if (daysLeft < 0) return { text: `기한 지남 ${Math.abs(daysLeft)}일`, tone: 'danger' };
  if (daysLeft === 0) return { text: '오늘', tone: 'danger' };
  return { text: `D-${daysLeft}`, tone: daysLeft <= soonDays ? 'warn' : 'ghost' };
}

/** 시간대별 인사(대시보드 머리말) */
export function greeting(v: string | Date): string {
  const h = seoulParts(v).hh;
  if (h < 11) return '좋은 아침이에요';
  if (h < 17) return '좋은 오후예요';
  return '오늘도 수고 많으셨어요';
}

/** 이름에서 아바타 글자(뒤 두 글자, 영문은 첫 글자 두 개) */
export function initials(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  if (/^[가-힣]+$/.test(t)) return t.length >= 3 ? t.slice(-2) : t;
  return t.slice(0, 2).toUpperCase();
}

// 이 파일이 하는 일: 날짜 계산을 한곳에 모은다(TD-020). 한국 시간(KST, Asia/Seoul) 기준 "오늘", D-day,
// 월 경계(말일 보정), 주기 더하기(N개월·N일), 윤년, KST 자정을 UTC 시각으로 바꾸기를 제공한다.
// 날짜만 있는 값은 'YYYY-MM-DD' 문자열, 시각은 Date(저장할 때는 UTC ISO 문자열)로 다룬다. 날짜 라이브러리는 쓰지 않는다.
import type { Clock } from './clock.ts';

/** 서버와 화면이 함께 쓰는 시간대 */
export const TIME_ZONE = 'Asia/Seoul';
/**
 * KST의 UTC 차이(+9시간). 한국은 1988년 이후 일광 절약 시간을 쓰지 않아 늘 같다.
 * "KST 날짜 → UTC 시각" 변환에만 쓰고, "UTC 시각 → KST 날짜"는 Intl로 계산한다.
 */
const KST_OFFSET = '+09:00';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** 'YYYY-MM-DD'를 [연, 월, 일] 숫자로 바꾼다. 형식이 틀리거나 없는 날짜(2026-02-30 등)면 오류를 낸다 */
export function parseDate(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`날짜 "${date}"의 형식이 올바르지 않아요. 예: 2026-11-02`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) throw new RangeError(`날짜 "${date}"은(는) 달력에 없는 날이에요.`);
  return [y, mo, d];
}

/** 올바른 'YYYY-MM-DD' 날짜인지 */
export function isValidDate(date: string): boolean {
  try {
    parseDate(date);
    return true;
  } catch {
    return false;
  }
}

/** 윤년인지(4로 나눠지고, 100으로 나눠지면 400으로도 나눠져야 함) */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 그 달의 날 수(month는 1~12) */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** 연·월·일 숫자를 'YYYY-MM-DD'로 만든다 */
export function formatDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** 날짜를 "1970-01-01부터 며칠째"인 정수로 바꾼다(날짜끼리 빼기용) */
function toDayNumber(date: string): number {
  const [y, m, d] = parseDate(date);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** toDayNumber의 반대 */
function fromDayNumber(n: number): string {
  const t = new Date(n * 86_400_000);
  return formatDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// ── KST 변환 ────────────────────────────────────────────────

const kstFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** 시각을 KST 기준 연·월·일·시·분·초로 나눈다 */
export function kstParts(at: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts: Record<string, number> = {};
  for (const p of kstFormatter.formatToParts(at)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** 시각이 KST로 며칠인지 'YYYY-MM-DD'로 돌려준다(예: UTC 2026-11-01T15:00Z → '2026-11-02') */
export function kstDate(at: Date): string {
  const p = kstParts(at);
  return formatDate(p.year, p.month, p.day);
}

/** 시각을 KST 'YYYY-MM-DD HH:mm'으로 보여 준다 */
export function kstDateTime(at: Date): string {
  const p = kstParts(at);
  return `${formatDate(p.year, p.month, p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** 시계 기준 오늘(KST) 날짜 */
export function todayKst(clock: Clock): string {
  return kstDate(clock.now());
}

/** 시계 기준 이번 달(KST) 'YYYY-MM' */
export function thisMonthKst(clock: Clock): string {
  return todayKst(clock).slice(0, 7);
}

/** KST 날짜의 자정(00:00 KST)을 UTC 시각으로 돌려준다(예: '2026-11-02' → 2026-11-01T15:00:00.000Z) */
export function kstMidnight(date: string): Date {
  parseDate(date);
  return new Date(`${date}T00:00:00${KST_OFFSET}`);
}

/** KST 날짜 하루의 범위 [시작, 다음 날 시작)을 UTC ISO 문자열로 돌려준다(DB의 _at 열을 날짜로 거를 때) */
export function kstDayRangeUtc(date: string): { from: string; to: string } {
  return { from: kstMidnight(date).toISOString(), to: kstMidnight(addDays(date, 1)).toISOString() };
}

/** 이번 달 1일 00:00 KST를 UTC ISO 문자열로(AI 월 누적 비용 기준, database.md §10) */
export function kstMonthStartUtc(clock: Clock): string {
  return kstMidnight(`${thisMonthKst(clock)}-01`).toISOString();
}

// ── 날짜 더하기·빼기 ─────────────────────────────────────────

/** 날짜에 n일을 더한다(음수면 뺀다) */
export function addDays(date: string, n: number): string {
  return fromDayNumber(toDayNumber(date) + n);
}

/**
 * 날짜에 n개월을 더한다. 그 달에 같은 날이 없으면 말일로 맞춘다.
 * 예: 2026-01-31 + 1개월 → 2026-02-28, 2028-01-31 + 1개월 → 2028-02-29(윤년)
 */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = parseDate(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return formatDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** 주기(N개월과/또는 N일)를 더한다. 개월을 먼저 더하고 일을 더한다. 둘 다 없으면 그대로 돌려준다 */
export function addCycle(date: string, cycle: { months?: number | null; days?: number | null }): string {
  let out = date;
  if (cycle.months) out = addMonths(out, cycle.months);
  if (cycle.days) out = addDays(out, cycle.days);
  return out;
}

/** b − a 가 며칠인지(b가 뒤면 양수) */
export function daysBetween(a: string, b: string): number {
  return toDayNumber(b) - toDayNumber(a);
}

/**
 * D-day: 목표일까지 남은 날 수. 오늘이면 0, 지났으면 음수다.
 * today에는 'YYYY-MM-DD'나 시계를 넣는다(시계면 KST 오늘 기준).
 */
export function dday(target: string, today: string | Clock): number {
  const base = typeof today === 'string' ? today : todayKst(today);
  return daysBetween(base, target);
}

/** D-day 숫자를 화면 표기로 바꾼다: 3 → 'D-3', 0 → 'D-day', -2 → 'D+2' */
export function ddayLabel(n: number): string {
  if (n === 0) return 'D-day';
  return n > 0 ? `D-${n}` : `D+${-n}`;
}

/** 요일(0=일요일 … 6=토요일) */
export function weekday(date: string): number {
  return (((toDayNumber(date) + 4) % 7) + 7) % 7; // 1970-01-01은 목요일(4)
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 화면용 한국어 날짜: '2026-11-02' → '2026년 11월 2일 (월)' */
export function formatKoreanDate(date: string): string {
  const [y, m, d] = parseDate(date);
  return `${y}년 ${m}월 ${d}일 (${WEEKDAY_KO[weekday(date)] ?? ''})`;
}

/** 'YYYY-MM' 달의 첫날과 말일 */
export function monthRange(month: string): { start: string; end: string } {
  const m = MONTH_RE.exec(month);
  const y = Number(m?.[1]);
  const mo = Number(m?.[2]);
  if (!m || mo < 1 || mo > 12) throw new RangeError(`월 "${month}"의 형식이 올바르지 않아요. 예: 2026-11`);
  return { start: formatDate(y, mo, 1), end: formatDate(y, mo, daysInMonth(y, mo)) };
}

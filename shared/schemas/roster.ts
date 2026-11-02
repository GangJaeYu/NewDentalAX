// 이 파일이 하는 일: 근무표(FR-081, backend.md §3.7 roster·shift-types)의 입력 검사(zod), API 응답 모양, 날짜·주 계산과 휴가 표시 규칙을 서버와 화면이 함께 쓰게 둔다.
// 인원 합계 규칙(phase-04-task-01 결정): 그날 근무 유형이 "근무로 셈"(counts_as_work)이고, 하루 종일 휴가(연차·병가·기타)가 승인되지 않은 사람만 센다.
// 반차는 반나절은 일하므로 합계에서 빼지 않고, 칸에 "반차(오전)"처럼 함께 표시한다. 휴가는 roster 원본을 바꾸지 않고 조회 때 덧씌운다.
// shared 폴더는 다른 폴더를 import하지 않는다(같은 shared 안만 쓴다).
import { z } from 'zod';
import { isRealDate, LEAVE_TYPE_LABELS, datesBetween, type LeaveType } from './leave.ts';
import type { JobType } from '../enums.ts';
import type { Role } from '../roles.ts';

/** 근무 유형 칸 색(tokens.css의 의미 색 이름). 화면은 칩 색으로만 쓰고 글자도 함께 보여 준다 */
export const SHIFT_COLORS = ['accent', 'info', 'ok', 'warn', 'ghost'] as const;
export type ShiftColor = (typeof SHIFT_COLORS)[number];
export const SHIFT_COLOR_LABELS: Record<ShiftColor, string> = { accent: '청록', info: '연한 청록', ok: '초록', warn: '주황', ghost: '회색' };

/** 한 번에 볼 수 있는 가장 긴 기간(월간 달력 6주) */
export const MAX_ROSTER_SPAN_DAYS = 42;

/** 근무 유형 한 개 */
export interface ShiftType {
  id: number;
  code: string;
  label: string;
  startTime: string | null;
  endTime: string | null;
  colorToken: ShiftColor;
  countsAsWork: boolean;
  sort: number;
  active: boolean;
}

/** 칸에 덧씌우는 승인된 휴가 */
export interface RosterLeave {
  type: LeaveType;
  label: string;
  requestId: number;
  /** 하루 종일 휴가인지(반차가 아니면 true) */
  fullDay: boolean;
}

/** 칸 하나(직원 × 날짜) */
export interface RosterCell {
  shiftTypeId: number | null;
  leave?: RosterLeave;
}

/** 근무표에 나오는 직원 */
export interface RosterUser {
  id: number;
  name: string;
  role: Role;
  jobType: JobType;
}

/** 하루 */
export interface RosterDay {
  date: string;
  /** 병원이 문을 여는 날인지(settings.clinic 요일별 진료시간) */
  open: boolean;
  /** userId → 칸. 근무도 휴가도 없으면 키가 없다 */
  cells: Record<string, RosterCell>;
  /** 그날 근무 인원 */
  total: number;
}

/** GET /api/roster 응답 */
export interface RosterView {
  from: string;
  to: string;
  /** 서버 기준 오늘(KST). 화면의 '오늘' 표시와 이번 주 이동에 쓴다 */
  today: string;
  users: RosterUser[];
  shiftTypes: ShiftType[];
  days: RosterDay[];
  /** 날짜 → 근무 인원(days[].total과 같은 값) */
  totals: Record<string, number>;
}

/** 오늘 근무자 한 줄(대시보드 "오늘 근무" 카드) */
export interface TodayWorker {
  userId: number;
  name: string;
  jobType: JobType;
  shift: { id: number; label: string; colorToken: ShiftColor; startTime: string | null; endTime: string | null } | null;
  leave?: RosterLeave;
  /** 인원 합계에 들어가는지 */
  working: boolean;
}

/** GET /api/roster/today 응답 */
export interface TodayRoster {
  date: string;
  open: boolean;
  /** 근무 유형이 정해졌거나 휴가가 있는 직원만(근무하는 사람 → 휴가 → 휴무 순) */
  items: TodayWorker[];
  /** 근무 인원 */
  working: number;
  /** 하루 종일 휴가 인원 */
  onLeave: number;
}

/** PUT /api/roster/cell 응답 */
export interface RosterCellResult {
  userId: number;
  date: string;
  cell: RosterCell;
  total: number;
}

const dateField = (label: string) =>
  z
    .string({ error: `${label}를 확인해 주세요.` })
    .trim()
    .refine(isRealDate, { error: `${label}를 2026-11-02처럼 적어 주세요.` });

const idField = (label: string) => z.number({ error: `${label}를 확인해 주세요.` }).int({ error: `${label}를 확인해 주세요.` }).positive({ error: `${label}를 확인해 주세요.` });

/** GET /api/roster?from&to (둘 다 비우면 서버 기준 이번 주) */
export const rosterQuerySchema = z
  .object({ from: dateField('시작 날짜').optional(), to: dateField('끝 날짜').optional() })
  .refine((v) => (v.from === undefined) === (v.to === undefined), { error: '시작 날짜와 끝 날짜를 함께 적어 주세요.', path: ['to'] })
  .refine((v) => !v.from || !v.to || v.to >= v.from, { error: '끝 날짜가 시작 날짜보다 빨라요.', path: ['to'] })
  .refine((v) => !v.from || !v.to || v.to < v.from || datesBetween(v.from, v.to).length <= MAX_ROSTER_SPAN_DAYS, { error: `한 번에 ${MAX_ROSTER_SPAN_DAYS}일까지만 볼 수 있어요.`, path: ['to'] });

/** GET /api/roster/today?date= */
export const todayQuerySchema = z.object({ date: dateField('날짜').optional() });

/** PUT /api/roster/cell */
export const rosterCellSchema = z.object({
  userId: idField('직원'),
  date: dateField('날짜'),
  shiftTypeId: idField('근무 유형').nullable(),
});
export type RosterCellInput = z.infer<typeof rosterCellSchema>;

/** POST /api/roster/copy-week */
export const copyWeekSchema = z
  .object({ fromWeekStart: dateField('복사할 주'), toWeekStart: dateField('붙여 넣을 주') })
  .refine((v) => isMonday(v.fromWeekStart), { error: '복사할 주는 월요일 날짜로 적어 주세요.', path: ['fromWeekStart'] })
  .refine((v) => isMonday(v.toWeekStart), { error: '붙여 넣을 주는 월요일 날짜로 적어 주세요.', path: ['toWeekStart'] })
  .refine((v) => v.fromWeekStart !== v.toWeekStart, { error: '같은 주에는 복사할 수 없어요.', path: ['toWeekStart'] });
export type CopyWeekInput = z.infer<typeof copyWeekSchema>;

/** POST /api/roster/copy-week 응답 */
export interface CopyWeekResult {
  fromWeekStart: string;
  toWeekStart: string;
  /** 붙여 넣은 칸 수 */
  copied: number;
  /** 지운 이번 주 기존 칸 수 */
  replaced: number;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeField = (label: string) =>
  z
    .string({ error: `${label}을 확인해 주세요.` })
    .trim()
    .regex(TIME_RE, { error: `${label}은 09:30처럼 적어 주세요.` })
    .nullable();

/** 근무 유형 한 줄 입력(id가 없으면 새로 만든다) */
export const shiftTypeInputSchema = z
  .object({
    id: idField('근무 유형').optional(),
    label: z.string({ error: '이름을 적어 주세요.' }).trim().min(1, { error: '이름을 적어 주세요.' }).max(10, { error: '이름은 10자까지 적을 수 있어요.' }),
    startTime: timeField('시작 시각'),
    endTime: timeField('끝 시각'),
    colorToken: z.enum(SHIFT_COLORS, { error: '색을 목록에서 골라 주세요.' }),
    countsAsWork: z.boolean({ error: '근무 인원에 넣을지 골라 주세요.' }),
    active: z.boolean({ error: '사용 여부를 골라 주세요.' }),
  })
  .refine((v) => (v.startTime === null) === (v.endTime === null), { error: '시작 시각과 끝 시각을 함께 적거나 함께 비워 주세요.', path: ['endTime'] })
  .refine((v) => v.startTime === null || v.endTime === null || v.endTime > v.startTime, { error: '끝 시각이 시작 시각보다 늦어야 해요.', path: ['endTime'] });
export type ShiftTypeInput = z.infer<typeof shiftTypeInputSchema>;

/** PUT /api/shift-types: 화면에 보이는 순서대로 전체 목록을 보낸다. 지우지 않고 "사용 안 함"으로 숨긴다 */
export const saveShiftTypesSchema = z
  .object({ items: z.array(shiftTypeInputSchema, { error: '근무 유형 목록을 확인해 주세요.' }).min(1, { error: '근무 유형이 하나는 있어야 해요.' }).max(20, { error: '근무 유형은 20개까지 만들 수 있어요.' }) })
  .refine((v) => new Set(v.items.map((i) => i.label)).size === v.items.length, { error: '같은 이름의 근무 유형이 있어요.', path: ['items'] })
  .refine((v) => v.items.some((i) => i.active), { error: '사용하는 근무 유형이 하나는 있어야 해요.', path: ['items'] });
export type SaveShiftTypesInput = z.infer<typeof saveShiftTypesSchema>;

// ── 날짜·주 계산 ──────────────────────────────────────────────

/** 'YYYY-MM-DD' → UTC 기준 날 번호 */
function dayNo(v: string): number {
  const [y, m, d] = v.split('-').map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

/** 날 번호 → 'YYYY-MM-DD' */
function fromDayNo(n: number): string {
  const t = new Date(n * 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 날짜에 n일 더하기 */
export function shiftDate(date: string, n: number): string {
  return fromDayNo(dayNo(date) + n);
}

/** 요일 번호(0=일요일 … 6=토요일) */
export function dayOfWeek(date: string): number {
  return (((dayNo(date) + 4) % 7) + 7) % 7; // 1970-01-01은 목요일
}

/** 월요일인지 */
export function isMonday(date: string): boolean {
  return isRealDate(date) && dayOfWeek(date) === 1;
}

/** 그 날짜가 속한 주의 월요일(근무표 한 주 = 월~일) */
export function weekStart(date: string): string {
  return shiftDate(date, -((dayOfWeek(date) + 6) % 7));
}

/** 주간 범위: 월요일~일요일 */
export function weekRange(date: string): { from: string; to: string } {
  const from = weekStart(date);
  return { from, to: shiftDate(from, 6) };
}

/** 월간 달력 범위: 그 달 1일이 든 주의 월요일 ~ 말일이 든 주의 일요일(최대 6주) */
export function monthGridRange(date: string): { from: string; to: string; month: string } {
  const month = date.slice(0, 7);
  const first = `${month}-01`;
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = fromDayNo(Math.round(Date.UTC(y, m, 0) / 86_400_000));
  return { from: weekStart(first), to: shiftDate(weekStart(last), 6), month };
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 요일 한 글자 */
export function weekdayKo(date: string): string {
  return WEEKDAY_KO[dayOfWeek(date)] ?? '';
}

/** '2026-11-03' → '11월 3일(화)' */
export function rosterDateLabel(date: string): string {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일(${weekdayKo(date)})`;
}

/** 기간 글자: 같은 달이면 '11월 2일 ~ 8일', 아니면 '10월 27일 ~ 11월 2일' */
export function rosterPeriodLabel(from: string, to: string): string {
  const fm = Number(from.slice(5, 7));
  const tm = Number(to.slice(5, 7));
  const fd = Number(from.slice(8, 10));
  const td = Number(to.slice(8, 10));
  return fm === tm && from.slice(0, 4) === to.slice(0, 4) ? `${fm}월 ${fd}일 ~ ${td}일` : `${fm}월 ${fd}일 ~ ${tm}월 ${td}일`;
}

/** 근무 시간 글자: '09:30~18:30' 또는 '' */
export function shiftTimeText(t: { startTime: string | null; endTime: string | null }): string {
  return t.startTime && t.endTime ? `${t.startTime}~${t.endTime}` : '';
}

// ── 휴가 덧씌우기·인원 합계 ───────────────────────────────────

/** 하루 종일 휴가인지(반차가 아닌 연차·병가·기타) */
export function isFullDayLeave(type: LeaveType): boolean {
  return type !== 'half_am' && type !== 'half_pm';
}

/** 칸에 보여 줄 휴가 정보 */
export function rosterLeave(type: LeaveType, requestId: number): RosterLeave {
  return { type, label: LEAVE_TYPE_LABELS[type], requestId, fullDay: isFullDayLeave(type) };
}

/** 그 칸의 사람이 근무 인원에 들어가는지: 근무로 세는 유형이고, 하루 종일 휴가가 아니어야 한다 */
export function cellCountsAsWork(cell: RosterCell | undefined, types: ReadonlyMap<number, Pick<ShiftType, 'countsAsWork'>>): boolean {
  if (!cell || cell.shiftTypeId === null) return false;
  if (cell.leave?.fullDay) return false;
  return types.get(cell.shiftTypeId)?.countsAsWork ?? false;
}

/** 하루 근무 인원 */
export function dayTotal(cells: Record<string, RosterCell>, types: ReadonlyMap<number, Pick<ShiftType, 'countsAsWork'>>): number {
  return Object.values(cells).filter((c) => cellCountsAsWork(c, types)).length;
}

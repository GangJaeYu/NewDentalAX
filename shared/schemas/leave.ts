// 이 파일이 하는 일: 연차·휴가(FR-080, backend.md §3.7 leave)의 종류·상태 이름, 입력 검사(zod), API 응답 모양, 휴가 일수 계산을 서버와 화면이 함께 쓰게 둔다.
// 일수 계산 규칙(phase-03-task-09 결정): 기간 안에서 병원이 문을 여는 날(settings.clinic 요일별 진료시간이 null이 아닌 날)만 센다.
// 그래서 휴진 요일(예: 일요일)이 섞이면 빼고 세고, 반차(오전·오후)는 하루 안에서만 신청하며 0.5일이다. 공휴일 달력은 따로 없어서 세지 않는다.
// 잔여 일수에서 빠지는 것은 연차·반차뿐이고, 병가·기타는 일수만 기록한다. shared 폴더는 다른 폴더를 import하지 않는다(같은 shared 안만 쓴다).
import { z } from 'zod';
import { WEEKDAYS, type ClinicSettings, type Weekday } from './admin.ts';

/** 휴가 종류(database.md §7 CHECK와 같은 순서) */
export const LEAVE_TYPES = ['annual', 'half_am', 'half_pm', 'sick', 'other'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = { annual: '연차', half_am: '반차(오전)', half_pm: '반차(오후)', sick: '병가', other: '기타' };

/** 신청 상태 */
export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'canceled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = { pending: '승인 대기', approved: '승인', rejected: '반려', canceled: '취소' };

/** 잔여 일수에서 빠지는 종류(연차·반차) */
export const DEDUCTING_TYPES: readonly LeaveType[] = ['annual', 'half_am', 'half_pm'];

/** 반차인지 */
export function isHalfDay(type: LeaveType): boolean {
  return type === 'half_am' || type === 'half_pm';
}

/** settings.leave 기본값(database.md §5) */
export const DEFAULT_LEAVE_SETTINGS = { maxPerDay: 2, defaultAllowance: 15 } as const;

/** 한 번에 신청할 수 있는 가장 긴 기간(달력 날 수) */
export const MAX_LEAVE_SPAN_DAYS = 60;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD'가 실제 있는 날짜인지 */
export function isRealDate(v: string): boolean {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCFullYear() === Number(m[1]) && t.getUTCMonth() + 1 === Number(m[2]) && t.getUTCDate() === Number(m[3]);
}

/** 'YYYY-MM-DD' → UTC 기준 날 번호(1970-01-01 = 0) */
function dayNumber(v: string): number {
  const m = DATE_RE.exec(v);
  return Math.round(Date.UTC(Number(m?.[1]), Number(m?.[2]) - 1, Number(m?.[3])) / 86_400_000);
}

/** 날 번호 → 'YYYY-MM-DD' */
function fromDayNumber(n: number): string {
  const t = new Date(n * 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 날짜의 요일 이름('mon'…'sun') */
export function weekdayKey(date: string): Weekday {
  const js = (((dayNumber(date) + 4) % 7) + 7) % 7; // 0=일요일(1970-01-01은 목요일)
  return WEEKDAYS[(js + 6) % 7] as Weekday;
}

/** start부터 end까지(둘 다 포함) 모든 날짜 */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let n = dayNumber(start); n <= dayNumber(end); n += 1) out.push(fromDayNumber(n));
  return out;
}

/** 병원이 문을 여는 날인지(진료시간이 null이면 휴진) */
export function isClinicOpen(date: string, hours: ClinicSettings['hours']): boolean {
  return hours[weekdayKey(date)] !== null;
}

/** 일수 계산 결과: 실제로 세는 날짜들과 일수 */
export interface LeaveDayCount {
  /** 휴가로 세는 날짜(병원이 문을 여는 날만) */
  dates: string[];
  /** 일수(반차는 0.5) */
  days: number;
  /** 빼고 센 휴진일 */
  skipped: string[];
}

/**
 * 휴가 일수를 센다. 기간 안에서 병원이 문을 여는 날만 세고, 반차는 하루 0.5일이다.
 * 날짜가 틀렸거나, 반차가 하루를 넘거나, 센 날이 하나도 없으면 화면에 보여 줄 오류 문구를 돌려준다.
 */
export function countLeaveDays(type: LeaveType, startOn: string, endOn: string, hours: ClinicSettings['hours']): LeaveDayCount | { error: string; field: 'startOn' | 'endOn' } {
  if (!isRealDate(startOn)) return { error: '시작 날짜를 2026-11-02처럼 골라 주세요.', field: 'startOn' };
  if (!isRealDate(endOn)) return { error: '끝 날짜를 2026-11-02처럼 골라 주세요.', field: 'endOn' };
  if (endOn < startOn) return { error: '끝 날짜는 시작 날짜와 같거나 뒤여야 해요.', field: 'endOn' };
  if (isHalfDay(type) && endOn !== startOn) return { error: '반차는 하루만 신청할 수 있어요.', field: 'endOn' };
  if (startOn.slice(0, 4) !== endOn.slice(0, 4)) return { error: '해가 바뀌는 휴가는 12월 31일까지와 1월 1일부터로 나눠서 신청해 주세요.', field: 'endOn' };
  const all = datesBetween(startOn, endOn);
  if (all.length > MAX_LEAVE_SPAN_DAYS) return { error: `한 번에 ${MAX_LEAVE_SPAN_DAYS}일까지 신청할 수 있어요. 나눠서 신청해 주세요.`, field: 'endOn' };
  const dates = all.filter((d) => isClinicOpen(d, hours));
  const skipped = all.filter((d) => !isClinicOpen(d, hours));
  if (dates.length === 0) return { error: '고른 날은 모두 병원 휴진일이에요. 진료하는 날을 골라 주세요.', field: 'startOn' };
  return { dates, skipped, days: isHalfDay(type) ? 0.5 : dates.length };
}

const dateField = (label: string) =>
  z
    .string({ error: `${label}를 골라 주세요.` })
    .trim()
    .refine((v) => isRealDate(v), { error: `${label}는 2026-11-02처럼 골라 주세요.` });

/** 신청 입력(POST /api/leave). 반차는 endOn을 비워도 된다(시작 날짜와 같게 본다) */
export const createLeaveSchema = z.object({
  type: z.enum(LEAVE_TYPES, { error: '휴가 종류를 골라 주세요.' }),
  startOn: dateField('시작 날짜'),
  endOn: dateField('끝 날짜').optional(),
  reason: z.string({ error: '사유를 확인해 주세요.' }).trim().max(200, { error: '사유는 200자까지 적을 수 있어요.' }).optional(),
});
export type CreateLeaveInput = z.output<typeof createLeaveSchema>;

/** 승인·반려 입력(POST /api/leave/:id/decide). 반려는 사유가 꼭 있어야 한다 */
export const decideLeaveSchema = z
  .object({
    approve: z.boolean({ error: '승인 또는 반려를 골라 주세요.' }),
    reason: z.string({ error: '사유를 확인해 주세요.' }).trim().max(200, { error: '사유는 200자까지 적을 수 있어요.' }).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.approve && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: '반려 사유를 적어 주세요.' });
  });
export type DecideLeaveInput = z.output<typeof decideLeaveSchema>;

/** 일수 값(0.5일 단위) */
const halfStep = (label: string, max: number) =>
  z
    .number({ error: `${label}를 숫자로 적어 주세요.` })
    .min(0, { error: `${label}는 0 이상이어야 해요.` })
    .max(max, { error: `${label}는 ${max}일까지 적을 수 있어요.` })
    .refine((v) => Number.isInteger(v * 2), { error: `${label}는 0.5일 단위로 적어 주세요.` });

/** 부여 일수 저장 입력(PUT /api/leave/allowances, admin) */
export const saveAllowancesSchema = z.object({
  year: z.number({ error: '연도를 확인해 주세요.' }).int({ error: '연도를 확인해 주세요.' }).min(2000, { error: '연도를 확인해 주세요.' }).max(2100, { error: '연도를 확인해 주세요.' }),
  items: z
    .array(
      z.object({
        userId: z.number({ error: '직원을 확인해 주세요.' }).int({ error: '직원을 확인해 주세요.' }).positive({ error: '직원을 확인해 주세요.' }),
        days: halfStep('부여 일수', 365),
      }),
      { error: '직원별 일수를 확인해 주세요.' },
    )
    .max(500, { error: '한 번에 500명까지 저장할 수 있어요.' }),
});
export type SaveAllowancesInput = z.output<typeof saveAllowancesSchema>;

/** 연차 설정(settings.leave, GET/PUT /api/settings/leave) */
export const leaveSettingsSchema = z.object({
  maxPerDay: z
    .number({ error: '하루 최대 휴가 인원을 숫자로 적어 주세요.' })
    .int({ error: '하루 최대 휴가 인원은 정수로 적어 주세요.' })
    .min(1, { error: '하루 최대 휴가 인원은 1명 이상이어야 해요.' })
    .max(50, { error: '하루 최대 휴가 인원은 50명까지 적을 수 있어요.' }),
  defaultAllowance: halfStep('기본 부여 일수', 365),
});
export type LeaveSettings = z.output<typeof leaveSettingsSchema>;

/** 사람 한 명(이름만) */
export interface LeavePerson {
  id: number;
  name: string;
}

/** 신청 한 건(GET /api/leave 목록, POST 응답) */
export interface LeaveRequestItem {
  id: number;
  user: LeavePerson;
  type: LeaveType;
  startOn: string;
  endOn: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  decidedBy: LeavePerson | null;
  decidedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  /** 승인 대기 건을 승인하면 생길 경고(같은 날 인원 초과 등). 승인 권한이 있는 사람에게만 채운다 */
  warnings: string[];
}

/** 승인·반려 결과(POST /api/leave/:id/decide) */
export interface LeaveDecision {
  request: LeaveRequestItem;
  warnings: string[];
}

/** 직원 한 명의 올해 부여·사용·잔여(GET /api/leave/allowances) */
export interface LeaveAllowanceRow {
  userId: number;
  name: string;
  jobType: string;
  year: number;
  /** 부여 일수(admin이 정한 값, 없으면 기본값) */
  allowance: number;
  /** admin이 따로 정하지 않아 기본값을 쓰는지 */
  isDefault: boolean;
  /** 승인된 연차·반차 일수 */
  used: number;
  /** 승인 대기 중인 연차·반차 일수 */
  pending: number;
  /** 부여 − 사용 */
  remaining: number;
  /** 승인된 병가·기타 일수(잔여에서 빠지지 않음) */
  otherUsed: number;
}

/** 부여·잔여 표 응답 */
export interface LeaveAllowanceTable {
  year: number;
  defaultAllowance: number;
  rows: LeaveAllowanceRow[];
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → '11월 7일(토)' */
export function shortKoreanDate(date: string): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${m}월 ${d}일(${WEEKDAY_KO[(((dayNumber(date) + 4) % 7) + 7) % 7] ?? ''})`;
}

/** 기간 글자: 하루면 '11월 7일(토)', 여러 날이면 '11월 9일(월)~11월 11일(수)' */
export function periodLabel(startOn: string, endOn: string): string {
  return startOn === endOn ? shortKoreanDate(startOn) : `${shortKoreanDate(startOn)}~${shortKoreanDate(endOn)}`;
}

/** 일수를 화면 글자로: 1 → '1일', 0.5 → '0.5일', 14.5 → '14.5일' */
export function formatLeaveDays(days: number): string {
  return `${Number.isInteger(days) ? days : days.toFixed(1)}일`;
}

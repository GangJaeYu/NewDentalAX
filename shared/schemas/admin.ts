// 이 파일이 하는 일: 직원 계정·병원 기본 정보·활동 기록(감사 로그) API의 입력 모양(zod 스키마)과 응답 타입을 정한다(backend.md §3.2, FR-003·004·005·042).
// 서버는 이 스키마로 입력을 검사하고(틀리면 400 + 항목별 한국어 이유), 화면은 같은 스키마로 미리 검사한다.
// 직원 정보는 이름·아이디·역할·직무·입사일만 받는다(FR-004 AC1). 연락처·주소 같은 항목을 더하지 않는다.
import { z } from 'zod';
import { JOB_TYPES, USER_ROLE_VALUES, type JobType } from '../enums.ts';
import type { Role } from '../roles.ts';
import { USERNAME_RE, PASSWORD_MAX, PASSWORD_MIN } from './auth.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** YYYY-MM-DD가 실제 있는 날짜인지 */
function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const name = z
  .string({ error: '이름을 적어 주세요.' })
  .trim()
  .min(1, { error: '이름을 적어 주세요.' })
  .max(30, { error: '이름은 30자까지 적을 수 있어요.' });
const role = z.enum(USER_ROLE_VALUES, { error: '역할을 골라 주세요.' });
const jobType = z.enum(JOB_TYPES, { error: '직무를 골라 주세요.' });
/** 입사일: 비워 두면 null */
const hiredOn = z
  .union([z.string(), z.null()], { error: '입사일을 확인해 주세요.' })
  .transform((v) => (v === null || v.trim() === '' ? null : v.trim()))
  .refine((v) => v === null || isRealDate(v), { error: '입사일은 2026-03-02 같은 날짜로 적어 주세요.' });
/** 임시 비밀번호(적지 않으면 서버가 만든다) */
const tempPassword = z
  .string({ error: '임시 비밀번호를 확인해 주세요.' })
  .min(PASSWORD_MIN, { error: `임시 비밀번호는 ${PASSWORD_MIN}자 이상으로 적어 주세요.` })
  .max(PASSWORD_MAX, { error: `임시 비밀번호는 ${PASSWORD_MAX}자까지 적을 수 있어요.` });

/** POST /api/users 입력. 직원 추가 화면의 입력란도 이 다섯 개(이름·아이디·역할·직무·입사일)뿐이다 */
export const createUserSchema = z.strictObject(
  {
    name,
    username: z
      .string({ error: '아이디를 적어 주세요.' })
      .trim()
      .regex(USERNAME_RE, { error: '아이디는 영문과 숫자로 4~20자로 적어 주세요.' }),
    role,
    jobType,
    hiredOn: hiredOn.optional().default(null),
    tempPassword: tempPassword.optional(),
  },
  { error: '받을 수 없는 항목이 들어 있어요. 이름·아이디·역할·직무·입사일만 적어 주세요.' },
);
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** PATCH /api/users/:id 입력(바꿀 항목만). 아이디는 바꿀 수 없다 */
export const updateUserSchema = z
  .strictObject(
    {
      name: name.optional(),
      role: role.optional(),
      jobType: jobType.optional(),
      hiredOn: hiredOn.optional(),
      active: z.boolean({ error: '사용 여부를 확인해 주세요.' }).optional(),
    },
    { error: '바꿀 수 없는 항목이 들어 있어요. 이름·역할·직무·입사일·사용 여부만 바꿀 수 있어요.' },
  )
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: '바꿀 내용을 하나 이상 적어 주세요.' });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** POST /api/users/:id/reset-password 입력(비워 두면 서버가 임시 비밀번호를 만든다) */
export const resetPasswordSchema = z.object({ tempPassword: tempPassword.optional() });

/** 직원 목록 한 줄(GET /api/users) */
export interface UserRow {
  id: number;
  username: string;
  name: string;
  role: Role;
  jobType: JobType;
  hiredOn: string | null;
  active: boolean;
  mustChangePw: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 직원을 만들거나 비밀번호를 초기화한 결과: 직원에게 한 번만 알려 줄 임시 비밀번호 */
export interface TempPasswordResult {
  tempPassword: string;
}

/** POST /api/users 응답 */
export type CreatedUser = UserRow & TempPasswordResult;

/** 목록 응답 */
export interface PageResult<T> {
  data: T[];
  total: number;
}

// ── 병원 기본 정보(settings.clinic, database.md §5) ─────────────────────────────

/** 요일 키(월~일) */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };

const time = (label: string) => z.string({ error: `${label}을 적어 주세요.` }).regex(TIME_RE, { error: `${label}은 09:30 같은 24시간 형식으로 적어 주세요.` });

/** 하루 진료시간. 점심시간은 없을 수 있다. 휴진이면 이 자리에 null을 둔다 */
const dayHours = z
  .object({
    open: time('시작 시각'),
    close: time('끝 시각'),
    lunch: z
      .object({ start: time('점심 시작 시각'), end: time('점심 끝 시각') })
      .refine((l) => l.start < l.end, { error: '점심 끝 시각은 시작 시각보다 늦어야 해요.', path: ['end'] })
      .nullable()
      .optional()
      .default(null),
  })
  .refine((d) => d.open < d.close, { error: '진료 끝 시각은 시작 시각보다 늦어야 해요.', path: ['close'] })
  .refine((d) => !d.lunch || (d.lunch.start >= d.open && d.lunch.end <= d.close), {
    error: '점심시간은 진료시간 안에 있어야 해요.',
    path: ['lunch', 'start'],
  });
export type DayHours = z.infer<typeof dayHours>;

const text = (label: string, max: number) =>
  z
    .string({ error: `${label}을 확인해 주세요.` })
    .trim()
    .max(max, { error: `${label}은 ${max}자까지 적을 수 있어요.` });

/** PUT /api/settings/clinic 입력(병원 이름·대표번호·요일별 진료시간·휴진 안내·주차·위치·보험 일반 안내) */
export const clinicSchema = z.object({
  name: text('병원 이름', 50).min(1, { error: '병원 이름을 적어 주세요.' }),
  phone: text('대표번호', 20).refine((v) => v === '' || /^[0-9][0-9-]{6,18}$/.test(v), { error: '대표번호는 02-123-4567처럼 숫자와 -로 적어 주세요.' }),
  hours: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, dayHours.nullable()])) as Record<Weekday, z.ZodNullable<typeof dayHours>>, {
    error: '요일별 진료시간을 확인해 주세요.',
  }),
  holidayNote: text('휴진 안내', 300),
  parking: text('주차 안내', 500),
  location: text('위치·교통 안내', 500),
  insuranceNote: text('보험 일반 안내', 1000),
});
export type ClinicSettings = z.infer<typeof clinicSchema>;

/** 아직 저장한 적이 없을 때 화면에 채워 보여 줄 기본값(평일 09:30~18:30, 점심 13:00~14:00, 토 09:30~14:00, 일 휴진) */
export function defaultClinic(name = ''): ClinicSettings {
  const weekday: DayHours = { open: '09:30', close: '18:30', lunch: { start: '13:00', end: '14:00' } };
  return {
    name,
    phone: '',
    hours: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: { open: '09:30', close: '14:00', lunch: null }, sun: null },
    holidayNote: '',
    parking: '',
    location: '',
    insuranceNote: '',
  };
}

// ── 활동 기록(감사 로그) ──────────────────────────────────────────────────────

/** GET /api/audit 조건 */
export const auditQuerySchema = z.object({
  from: z
    .string()
    .refine(isRealDate, { error: '시작 날짜를 확인해 주세요.' })
    .optional(),
  to: z
    .string()
    .refine(isRealDate, { error: '끝 날짜를 확인해 주세요.' })
    .optional(),
  userId: z.coerce.number({ error: '사용자를 확인해 주세요.' }).int({ error: '사용자를 확인해 주세요.' }).positive({ error: '사용자를 확인해 주세요.' }).optional(),
  action: z
    .string()
    .trim()
    .max(60, { error: '행동 이름이 너무 길어요.' })
    .regex(/^[a-z_.]*$/, { error: '행동 이름을 확인해 주세요.' })
    .optional(),
  page: z.coerce.number().int().min(1, { error: '쪽 번호를 확인해 주세요.' }).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200, { error: '한 번에 200줄까지 볼 수 있어요.' }).optional().default(50),
  format: z.enum(['json', 'csv'], { error: '내려받기 형식을 확인해 주세요.' }).optional().default('json'),
}).refine((q) => !q.from || !q.to || q.from <= q.to, { error: '끝 날짜는 시작 날짜와 같거나 뒤여야 해요.', path: ['to'] });
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** 활동 기록 한 줄(GET /api/audit) */
export interface AuditEntry {
  id: number;
  at: string;
  userId: number | null;
  username: string | null;
  /** 지금 이름(사용자가 있으면) */
  userName: string | null;
  action: string;
  /** 행동의 한국어 이름 */
  actionLabel: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}

/** 행동 묶음(활동 기록 화면의 "행동" 필터). 값은 action 앞부분(예: 'auth.' → 로그인 관련 전부) */
export const AUDIT_ACTION_GROUPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'auth.', label: '로그인·로그아웃' },
  { value: 'user.', label: '직원 계정' },
  { value: 'settings.', label: '설정 변경' },
  { value: 'backup.', label: '백업·복원' },
  { value: 'ai.', label: 'AI 사용' },
  { value: 'setup.', label: '첫 설정' },
  { value: 'demo.', label: '데모 데이터' },
];

/** 자주 나오는 행동의 한국어 이름. 표에 없으면 action 그대로 보여 준다 */
export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'setup.complete': '첫 설정 완료',
  'auth.login': '로그인',
  'auth.login_failed': '로그인 실패',
  'auth.locked': '로그인 잠금',
  'auth.login_blocked': '잠긴 계정 로그인 시도',
  'auth.logout': '로그아웃',
  'auth.password_changed': '비밀번호 변경',
  'user.create': '직원 추가',
  'user.update': '직원 정보 수정',
  'user.deactivate': '직원 비활성화',
  'user.activate': '직원 다시 사용',
  'user.reset_password': '비밀번호 초기화',
  'settings.clinic.update': '병원 정보 수정',
  'audit.export': '활동 기록 내보내기',
  'demo.load': '데모 데이터 넣기',
  'demo.reset': '데모 데이터 초기화',
};

/** action의 한국어 이름 */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

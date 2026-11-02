// 이 파일이 하는 일: 교육 이수 기록(FR-082, backend.md §3.7 trainings)의 입력 검사(zod)·상태 이름·API 응답 모양을 서버와 화면이 함께 쓰게 둔다.
// 다음 예정일 = 가장 최근 이수일 + 주기(개월). 계산은 서버(server/lib/dates.ts)가 하고, 화면은 받은 값(nextDueOn·daysLeft·state)을 그대로 보여 준다.
// 상태: 기록 없음(none) → 이수 기록 필요, 주기 없음(once) → 한 번만 받으면 됨, 기한 지남(overdue)·오늘(today)·임박(soon, 알림 일수 안)·여유(ok).
// shared 폴더는 다른 폴더를 import하지 않는다.
import { z } from 'zod';

/** 직원별 교육 상태 */
export const TRAINING_STATES = ['none', 'once', 'overdue', 'today', 'soon', 'ok'] as const;
export type TrainingState = (typeof TRAINING_STATES)[number];
export const TRAINING_STATE_LABELS: Record<TrainingState, string> = {
  none: '이수 기록 필요',
  once: '이수 완료',
  overdue: '기한 지남',
  today: '오늘까지',
  soon: '예정 임박',
  ok: '여유 있음',
};

/** 주기 선택지(개월). 화면의 고르기 칸에 쓴다. null은 "한 번만" */
export const TRAINING_CYCLE_CHOICES: readonly (number | null)[] = [12, 24, 36, 6, 3, null];

/** 주기를 글로: 12 → '12개월마다', null → '한 번만' */
export function cycleLabel(months: number | null): string {
  if (months == null) return '한 번만';
  if (months % 12 === 0) return months === 12 ? '1년마다' : `${months / 12}년마다`;
  return `${months}개월마다`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD'가 달력에 있는 날짜인지 */
function realDate(v: string): boolean {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCFullYear() === Number(m[1]) && t.getUTCMonth() + 1 === Number(m[2]) && t.getUTCDate() === Number(m[3]);
}

/** 날짜 칸(YYYY-MM-DD) */
export function dateField(label: string) {
  return z
    .string({ error: `${label}을(를) 골라 주세요.` })
    .trim()
    .refine(realDate, { message: `${label}을(를) 2026-11-02 같은 날짜로 골라 주세요.` });
}

const cycleField = z
  .union([z.number(), z.null()], { error: '주기는 개월 수로 적어 주세요.' })
  .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 120), { message: '주기는 1~120개월 사이로 적어 주세요.' });

const nameField = z.string({ error: '교육 이름을 적어 주세요.' }).trim().min(1, '교육 이름을 적어 주세요.').max(100, '교육 이름은 100자 이하로 줄여 주세요.');
const descField = z.string().trim().max(1000, '설명은 1000자 이하로 줄여 주세요.');
const legalIdField = z.union([z.number().int().positive(), z.null()], { error: '법정 일정을 다시 골라 주세요.' });

/** POST /api/trainings 본문 */
export const createTrainingSchema = z.object({
  name: nameField,
  cycleMonths: cycleField.default(12),
  description: descField.default(''),
  legalTaskId: legalIdField.default(null),
});
export type CreateTrainingInput = z.input<typeof createTrainingSchema>;

/** PATCH /api/trainings/:id 본문(보낸 칸만 바꾼다) */
export const updateTrainingSchema = z
  .object({
    name: nameField.optional(),
    cycleMonths: cycleField.optional(),
    description: descField.optional(),
    legalTaskId: legalIdField.optional(),
    active: z.boolean({ error: '사용 여부를 확인해 주세요.' }).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: '바꿀 내용이 없어요.' });

/** POST /api/trainings/:id/records 글 칸(JSON 또는 multipart 글 칸). userId를 비우면 본인 */
export const createRecordSchema = z.object({
  userId: z.coerce.number({ error: '직원을 다시 골라 주세요.' }).int({ error: '직원을 다시 골라 주세요.' }).positive({ error: '직원을 다시 골라 주세요.' }).optional(),
  completedOn: dateField('이수일'),
  note: z.string().trim().max(500, '메모는 500자 이하로 줄여 주세요.').default(''),
});
export type CreateRecordInput = z.input<typeof createRecordSchema>;

/** 직원 한 명의 이 교육 상태 */
export interface TrainingStatus {
  userId: number;
  userName: string;
  jobType: string;
  /** 가장 최근 이수일(없으면 null) */
  lastCompletedOn: string | null;
  /** 다음 이수 예정일(주기가 없거나 기록이 없으면 null) */
  nextDueOn: string | null;
  /** 오늘부터 예정일까지 남은 날(지나면 음수, 예정일이 없으면 null) */
  daysLeft: number | null;
  state: TrainingState;
  recordCount: number;
}

/** 교육 항목 하나(GET /api/trainings의 trainings[]) */
export interface TrainingItem {
  id: number;
  name: string;
  cycleMonths: number | null;
  description: string;
  legalTask: { id: number; title: string } | null;
  active: boolean;
  /** 직원별 상태(직원은 본인 줄만) */
  statuses: TrainingStatus[];
}

/** GET /api/trainings 응답의 data */
export interface TrainingOverview {
  today: string;
  /** 임박으로 보는 일수(설정 legal.warnDays, 기본 30) */
  warnDays: number;
  trainings: TrainingItem[];
  /** 상태를 보여 줄 직원 목록(직원은 본인만) */
  people: { id: number; name: string; jobType: string }[];
}

/** 이수 기록 한 건(GET /api/trainings/:id/records) */
export interface TrainingRecordItem {
  id: number;
  trainingId: number;
  user: { id: number; name: string };
  completedOn: string;
  note: string;
  file: { id: number; name: string; size: number } | null;
  createdBy: { id: number; name: string } | null;
  createdAt: string;
}

/** POST /api/trainings/:id/records 응답의 data */
export interface TrainingRecordResult {
  record: TrainingRecordItem;
  status: TrainingStatus;
  /** 지금 바로 보낸 임박 알림 수 */
  notified: number;
}

// 이 파일이 하는 일: AI 근무표 배정 제안(FR-131, phase-06-task-02)의 입력 검사(zod)·응답 모양과, 제안을 규칙대로 고치는 순수 함수(repairPlan)를 서버·화면·데모가 함께 쓰게 둔다.
// 흐름: 실장이 조건(최소 인원·직무별 최소 인원)을 고름 → 서버가 직원 이름 대신 내부 번호(S1, S2…)로 AI에 보냄 → AI 제안을 서버가 다시 검사·수정 → 미리보기 → 적용/취소.
// repairPlan 규칙: ① 없는 직원·날짜(휴진일 포함)·근무 유형 칸은 뺀다 ② 승인된 하루 종일 휴가일의 근무는 뺀다 ③ 날마다 직무별 최소 인원 → 전체 최소 인원 순서로 모자라면
// 그날 쉬는 사람 중 이번 주 근무가 가장 적은 사람을 넣는다 ④ 넣을 사람이 없으면 경고로 남긴다. AI 품질과 상관없이 휴가일 배정·최소 인원 위반이 미리보기에 남지 않게 한다.
// shared 폴더는 다른 폴더를 import하지 않는다(같은 shared 안만 쓴다).
import { z } from 'zod';
import { JOB_TYPES, type JobType } from '../enums.ts';
import { isRealDate } from './leave.ts';
import { isMonday, type RosterView } from './roster.ts';

/** 한 날의 최소 인원으로 고를 수 있는 가장 큰 수 */
export const MAX_MIN_STAFF = 30;

const mondayField = z
  .string({ error: '제안받을 주를 골라 주세요.' })
  .trim()
  .refine((v) => isRealDate(v) && isMonday(v), { error: '제안받을 주는 월요일 날짜로 적어 주세요.' });

const countField = (label: string, max: number) =>
  z
    .number({ error: `${label}을 숫자로 적어 주세요.` })
    .int({ error: `${label}은 0 이상의 정수로 적어 주세요.` })
    .min(0, { error: `${label}은 0 이상으로 적어 주세요.` })
    .max(max, { error: `${label}은 ${max}명까지 적을 수 있어요.` });

/** 직무별 최소 인원(고르지 않은 직무는 0) */
export const minByJobSchema = z.partialRecord(z.enum(JOB_TYPES, { error: '직무를 목록에서 골라 주세요.' }), countField('직무별 최소 인원', 20));
export type MinByJob = z.infer<typeof minByJobSchema>;

/** POST /api/roster/suggest: 한 주(월~일) 제안 조건 */
export const rosterSuggestSchema = z
  .object({
    weekStart: mondayField,
    minStaff: countField('하루 최소 인원', MAX_MIN_STAFF),
    minByJob: minByJobSchema.default({}),
  })
  .strict();
export type RosterSuggestInput = z.infer<typeof rosterSuggestSchema>;

const idField = (label: string) => z.number({ error: `${label}를 확인해 주세요.` }).int({ error: `${label}를 확인해 주세요.` }).positive({ error: `${label}를 확인해 주세요.` });

/** 적용할 칸 하나(근무 유형이 있는 칸만 보낸다. 보내지 않은 칸은 비운다) */
export const rosterApplyCellSchema = z.object({
  userId: idField('직원'),
  date: z
    .string({ error: '날짜를 확인해 주세요.' })
    .trim()
    .refine(isRealDate, { error: '날짜를 2026-11-02처럼 적어 주세요.' }),
  shiftTypeId: idField('근무 유형'),
});

/** POST /api/roster/apply: 미리보기에서 확인한 한 주 칸을 근무표에 넣는다 */
export const rosterApplySchema = z
  .object({
    weekStart: mondayField,
    cells: z.array(rosterApplyCellSchema, { error: '적용할 칸 목록을 확인해 주세요.' }).max(7 * 300, { error: '적용할 칸이 너무 많아요.' }),
  })
  .strict()
  .refine((v) => new Set(v.cells.map((c) => `${c.userId}:${c.date}`)).size === v.cells.length, { error: '같은 직원·날짜 칸이 두 번 들어 있어요.', path: ['cells'] });
export type RosterApplyInput = z.infer<typeof rosterApplySchema>;

/** POST /api/roster/apply 응답 */
export interface RosterApplyResult {
  weekStart: string;
  /** 넣은 칸 수 */
  saved: number;
  /** 지운 그 주 기존 칸 수 */
  replaced: number;
  /** 미리보기 뒤에 휴가가 승인돼서 넣지 않은 칸 수 */
  skipped: number;
}

/** POST /api/roster/suggest 응답(미리보기). 근무표는 아직 바뀌지 않았다 */
export interface RosterSuggestion {
  weekStart: string;
  rules: { minStaff: number; minByJob: MinByJob };
  /** 제안을 덧씌운 한 주 근무표(승인된 휴가 표시·날짜별 인원 포함) */
  view: RosterView;
  /** "적용"할 때 보낼 칸 */
  cells: Array<{ userId: number; date: string; shiftTypeId: number }>;
  /** 서버가 규칙에 맞게 고친 내용(쉬운 한국어 문장) */
  fixes: string[];
  /** 고치지 못한 부족(쉬운 한국어 문장) */
  warnings: string[];
  /** 지금 근무표와 달라지는 칸 수 */
  changed: number;
  /** AI 호출 정보 */
  ai: { demo: boolean; costKrw: number; privacyNotice: string | null; note: string | null };
  /** AI에 보낸 직원 정보(내부 번호와 직무만) */
  sentStaff: Array<{ ref: string; jobType: JobType }>;
}

// ── 제안 고치기(순수 함수) ───────────────────────────────────

/** 계획에 들어가는 직원(key는 내부 번호 S1 또는 직원 id 글자) */
export interface PlanStaff {
  key: string;
  jobType: JobType;
  /** 승인된 하루 종일 휴가일 */
  leave: readonly string[];
}

/** 계획에 쓰는 근무 유형 */
export interface PlanShift {
  id: number;
  label: string;
  startTime: string | null;
  endTime: string | null;
  countsAsWork: boolean;
}

/** 진료하는 날 하루(진료 시작·끝 시각) */
export interface PlanDay {
  date: string;
  open: string;
  close: string;
}

/** 최소 인원 규칙 */
export interface PlanRules {
  minStaff: number;
  minByJob: MinByJob;
}

/** 칸 하나(직원 key·날짜·근무 유형 id) */
export interface PlanEntry {
  key: string;
  date: string;
  shiftId: number;
}

/** 고치면서 생긴 일 */
export type PlanIssue =
  | { kind: 'dropped'; count: number }
  | { kind: 'leave'; key: string; date: string; shiftId: number }
  | { kind: 'filled'; key: string; date: string; shiftId: number; job: JobType | null; need: number }
  | { kind: 'short'; date: string; job: JobType | null; need: number; have: number };

/** '09:30' → 분 */
function minutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 근무 시간 길이(분). 시간이 없으면 0 */
function spanOf(s: PlanShift): number {
  return s.startTime && s.endTime ? minutes(s.endTime) - minutes(s.startTime) : 0;
}

/**
 * 그날 진료 시간 안에 들어가는 가장 긴 "근무로 세는" 유형. 들어가는 것이 없으면 근무로 세는 첫 유형, 그것도 없으면 null.
 * 예: 평일 09:30~18:30 → "종일", 토요일 09:30~14:00 → "오전"
 */
export function bestShiftFor(day: PlanDay, shifts: readonly PlanShift[]): number | null {
  const work = shifts.filter((s) => s.countsAsWork);
  const fits = work.filter((s) => s.startTime && s.endTime && minutes(s.startTime) >= minutes(day.open) && minutes(s.endTime) <= minutes(day.close));
  const pick = [...fits].sort((a, b) => spanOf(b) - spanOf(a))[0] ?? work[0];
  return pick?.id ?? null;
}

/** 계획 표: key → 날짜 → 근무 유형 id */
export type Plan = Map<string, Map<string, number>>;

/** 그 칸이 근무 인원에 들어가는지 */
function isWork(plan: Plan, key: string, date: string, work: ReadonlySet<number>): boolean {
  const id = plan.get(key)?.get(date);
  return id !== undefined && work.has(id);
}

/** 이번 주에 그 사람이 근무하는 날 수 */
function workDays(plan: Plan, key: string, work: ReadonlySet<number>): number {
  let n = 0;
  for (const id of plan.get(key)?.values() ?? []) if (work.has(id)) n += 1;
  return n;
}

/**
 * AI 제안(entries)을 규칙에 맞게 고친다. 돌려주는 plan에는 휴가일 근무와 최소 인원 부족이 남지 않는다(넣을 사람이 없을 때만 short 경고).
 * fillShift: 모자란 자리에 넣을 근무 유형(날짜별). 없으면 그날 계획에서 가장 많이 쓴 근무 유형 → 진료 시간에 맞는 가장 긴 유형 순서로 고른다.
 */
export function repairPlan(input: {
  staff: readonly PlanStaff[];
  days: readonly PlanDay[];
  shifts: readonly PlanShift[];
  rules: PlanRules;
  entries: readonly PlanEntry[];
}): { plan: Plan; issues: PlanIssue[] } {
  const issues: PlanIssue[] = [];
  const staffBy = new Map(input.staff.map((s) => [s.key, s]));
  const dayBy = new Map(input.days.map((d) => [d.date, d]));
  const shiftBy = new Map(input.shifts.map((s) => [s.id, s]));
  const work = new Set(input.shifts.filter((s) => s.countsAsWork).map((s) => s.id));
  const leaveOf = new Map(input.staff.map((s) => [s.key, new Set(s.leave)]));
  const plan: Plan = new Map(input.staff.map((s) => [s.key, new Map<string, number>()]));

  // ① 없는 칸 빼기(같은 칸이 두 번이면 처음 것), ② 휴가일 근무 빼기
  let dropped = 0;
  for (const e of input.entries) {
    const row = plan.get(e.key);
    if (!row || !staffBy.has(e.key) || !dayBy.has(e.date) || !shiftBy.has(e.shiftId) || row.has(e.date)) {
      dropped += 1;
      continue;
    }
    if (leaveOf.get(e.key)?.has(e.date)) {
      // 휴무처럼 근무로 세지 않는 유형은 휴가 표시에 가려지므로 조용히 뺀다
      if (work.has(e.shiftId)) issues.push({ kind: 'leave', key: e.key, date: e.date, shiftId: e.shiftId });
      continue;
    }
    row.set(e.date, e.shiftId);
  }
  if (dropped > 0) issues.push({ kind: 'dropped', count: dropped });

  // ③ 날마다 최소 인원 맞추기
  const order = input.staff.map((s) => s.key);
  for (const day of input.days) {
    const fillShift = (): number | null => {
      const used = new Map<number, number>();
      for (const key of order) {
        const id = plan.get(key)?.get(day.date);
        if (id !== undefined && work.has(id)) used.set(id, (used.get(id) ?? 0) + 1);
      }
      const common = [...used.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return common ?? bestShiftFor(day, input.shifts);
    };
    const available = (job: JobType | null) =>
      order
        .filter((key) => (job === null || staffBy.get(key)?.jobType === job) && !leaveOf.get(key)?.has(day.date) && !isWork(plan, key, day.date, work))
        .sort((a, b) => workDays(plan, a, work) - workDays(plan, b, work) || order.indexOf(a) - order.indexOf(b));
    const working = (job: JobType | null) => order.filter((key) => (job === null || staffBy.get(key)?.jobType === job) && isWork(plan, key, day.date, work)).length;

    const needs: Array<[JobType | null, number]> = [
      ...JOB_TYPES.map((j): [JobType, number] => [j, input.rules.minByJob[j] ?? 0]).filter(([, n]) => n > 0),
      [null, input.rules.minStaff],
    ];
    for (const [job, need] of needs) {
      let have = working(job);
      while (have < need) {
        const key = available(job)[0];
        const shiftId = fillShift();
        if (!key || shiftId === null) break;
        plan.get(key)?.set(day.date, shiftId);
        issues.push({ kind: 'filled', key, date: day.date, shiftId, job, need });
        have += 1;
      }
      if (have < need) issues.push({ kind: 'short', date: day.date, job, need, have });
    }
  }
  return { plan, issues };
}

/** 계획 → 칸 목록(직원 순서 → 날짜 순서) */
export function planEntries(plan: Plan): PlanEntry[] {
  const out: PlanEntry[] = [];
  for (const [key, row] of plan) for (const [date, shiftId] of [...row.entries()].sort((a, b) => a[0].localeCompare(b[0]))) out.push({ key, date, shiftId });
  return out;
}

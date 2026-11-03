// 이 파일이 하는 일: AI 기능 "근무표 배정 제안"(FR-131, phase-06-task-02)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사.
// 입력은 서버(server/modules/hr/roster-suggest.ts)가 만든다: 직원은 이름 없이 내부 번호(S1, S2…)·직무·휴가일만, 진료하는 날·근무 유형·최소 인원 규칙.
// 응답 JSON {assignments:[{staff:'S1', date, shift(근무 유형 id)}], note?}. 서버가 응답을 그대로 믿지 않고 휴가일·최소 인원을 다시 검사해 고친다.
// 데모 응답은 규칙으로 만든다: 긴 진료일은 휴가가 아닌 사람 모두 진료 시간에 맞는 근무, 짧은 진료일(토요일 등)은 최소 인원만 돌아가며 근무하고 나머지는 휴무.
import { z } from 'zod';
import { JOB_TYPES, JOB_TYPE_LABELS } from '../../../shared/enums.ts';
import { bestShiftFor, minByJobSchema, planEntries, repairPlan, type PlanDay, type PlanEntry } from '../../../shared/schemas/roster-suggest.ts';
import { baseSystem, demoJson, jsonOnly, type AiFeatureModule } from './types.ts';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않아요.');
const timeText = z.string().regex(/^\d{2}:\d{2}$/, '시각 형식이 올바르지 않아요.');

/** 서버가 만든 입력(직원 이름은 없다. ref는 S1처럼 내부 번호만 받는다) */
const inputSchema = z.object({
  week: z.object({ from: dateText, to: dateText }),
  days: z.array(z.object({ date: dateText, weekday: z.string().max(2), open: timeText, close: timeText })).min(1, '진료하는 날이 없어요.').max(14),
  staff: z
    .array(
      z.object({
        ref: z.string().regex(/^S\d{1,3}$/, '직원은 내부 번호로만 보낼 수 있어요.'),
        jobType: z.enum(JOB_TYPES),
        leave: z.array(dateText).max(14).default([]),
        halfLeave: z.array(z.object({ date: dateText, part: z.enum(['오전', '오후']) })).max(14).default([]),
      }),
    )
    .min(1, '직원이 없어요.')
    .max(300),
  shifts: z
    .array(z.object({ id: z.number().int().positive(), label: z.string().max(10), startTime: timeText.nullable(), endTime: timeText.nullable(), countsAsWork: z.boolean() }))
    .min(1)
    .max(20),
  rules: z.object({ minStaff: z.number().int().min(0).max(30), minByJob: minByJobSchema.default({}) }),
});
type Input = z.output<typeof inputSchema>;

const outputSchema = z.object({
  assignments: z.array(z.object({ staff: z.string().max(10), date: z.string().max(10), shift: z.number().int() })).max(7 * 300),
  note: z.string().max(500).optional(),
});

/** 진료 시간 길이(분) */
function daySpan(d: PlanDay): number {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return m(d.close) - m(d.open);
}

/** 짧은 진료일 기준(6시간 미만이면 토요일처럼 일부만 나온다) */
const SHORT_DAY_MINUTES = 6 * 60;

/**
 * 데모 배정: 긴 진료일은 휴가가 아닌 모두가 그날 진료 시간에 맞는 근무, 짧은 진료일은 비워 두고 repairPlan이 최소 인원만 채운다(이번 주 근무가 적은 사람부터).
 * 짧은 진료일에 근무하지 않는 사람은 "근무로 세지 않는" 유형(휴무)이 있으면 그것으로 둔다.
 */
export function demoAssignments(input: Input): PlanEntry[] {
  const entries: PlanEntry[] = [];
  const longDays = input.days.filter((d) => daySpan(d) >= SHORT_DAY_MINUTES);
  for (const d of longDays) {
    const shiftId = bestShiftFor(d, input.shifts);
    if (shiftId === null) continue;
    for (const s of input.staff) if (!s.leave.includes(d.date)) entries.push({ key: s.ref, date: d.date, shiftId });
  }
  const { plan } = repairPlan({
    staff: input.staff.map((s) => ({ key: s.ref, jobType: s.jobType, leave: s.leave })),
    days: input.days,
    shifts: input.shifts,
    rules: input.rules,
    entries,
  });
  const off = input.shifts.find((s) => !s.countsAsWork);
  if (off) {
    for (const d of input.days) {
      if (daySpan(d) >= SHORT_DAY_MINUTES) continue;
      for (const s of input.staff) {
        const row = plan.get(s.ref);
        if (row && !row.has(d.date) && !s.leave.includes(d.date)) row.set(d.date, off.id);
      }
    }
  }
  return planEntries(plan);
}

/** 규칙 글(프롬프트용) */
function rulesText(input: Input): string {
  const jobs = JOB_TYPES.filter((j) => (input.rules.minByJob[j] ?? 0) > 0).map((j) => `${JOB_TYPE_LABELS[j]}(${j}) ${input.rules.minByJob[j]}명 이상`);
  return [`- 진료하는 날마다 근무 인원 ${input.rules.minStaff}명 이상`, jobs.length ? `- 직무별: ${jobs.join(', ')}` : '- 직무별 최소 인원 조건 없음'].join('\n');
}

export const roster_suggest: AiFeatureModule<Input> = {
  id: 'roster_suggest',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    const staffLines = input.staff.map((s) => {
      const leave = s.leave.length ? ` / 휴가(근무 불가): ${s.leave.join(', ')}` : '';
      const half = s.halfLeave.length ? ` / 반차: ${s.halfLeave.map((h) => `${h.date} ${h.part}`).join(', ')}` : '';
      return `- ${s.ref}: ${JOB_TYPE_LABELS[s.jobType]}(${s.jobType})${leave}${half}`;
    });
    const shiftLines = input.shifts.map((s) => `- id ${s.id}: ${s.label}${s.startTime && s.endTime ? ` ${s.startTime}~${s.endTime}` : ' (시간 없음)'}${s.countsAsWork ? '' : ' — 근무 인원에 세지 않음'}`);
    const dayLines = input.days.map((d) => `- ${d.date}(${d.weekday}) 진료 ${d.open}~${d.close}`);
    return {
      system: [
        baseSystem(ctx),
        '치과 한 주 근무표 배정안을 만듭니다. 직원은 내부 번호(S1, S2…)로만 부릅니다.',
        '지킬 것: 휴가일에는 근무를 넣지 않습니다. 날마다 최소 인원과 직무별 최소 인원을 맞춥니다. 진료 시간에 맞는 근무 유형을 고르고, 근무일이 한 사람에게 몰리지 않게 나눕니다.',
        '목록에 있는 날짜·직원 번호·근무 유형 id만 씁니다. 배정하지 않는 칸은 넣지 않습니다.',
        jsonOnly('{"assignments":[{"staff":"S1","date":"YYYY-MM-DD","shift":1}],"note":"한두 문장 설명"}'),
      ].join('\n'),
      user: [
        `기간: ${input.week.from} ~ ${input.week.to}`,
        `진료하는 날:\n${dayLines.join('\n')}`,
        `근무 유형:\n${shiftLines.join('\n')}`,
        `직원:\n${staffLines.join('\n')}`,
        `조건:\n${rulesText(input)}`,
      ].join('\n\n'),
    };
  },
  demo(input) {
    return demoJson({
      assignments: demoAssignments(input).map((e) => ({ staff: e.key, date: e.date, shift: e.shiftId })),
      note: `규칙으로 만든 예시 배정이에요. 휴가일은 비우고, 짧은 진료일은 최소 인원만 돌아가며 근무하게 했어요.`,
    });
  },
};

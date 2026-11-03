// 이 파일이 하는 일: AI 근무표 배정 제안(FR-131, phase-06-task-02)의 처리 함수. HTTP 등록은 roster-suggest-routes.ts가 한다.
// - 제안(suggestRoster): 한 주(월~일)의 재직 직원·근무 유형·진료일·승인된 휴가를 읽어, 직원 이름 대신 내부 번호(S1, S2…)와 직무만 AI 게이트웨이로 보낸다.
//   AI 응답은 그대로 믿지 않는다. repairPlan으로 휴가일 근무를 빼고 최소 인원을 채운 뒤, 서버에서 번호를 이름으로 되돌려 미리보기를 만든다. 근무표(roster)는 바꾸지 않는다.
// - 적용(applyRoster): 미리보기에서 확인한 칸으로 그 주 근무표를 바꾼다(그 주 재직 직원 칸을 지우고 새로 넣음). 그사이 승인된 하루 종일 휴가일의 근무는 넣지 않는다.
import type { Db } from '../../db/index.ts';
import { AppError } from '../../lib/errors.ts';
import { runAi, type AiCallContext } from '../../ai/gateway.ts';
import { readClinic } from '../admin/clinic.ts';
import { approvedLeaveDays } from './leave.ts';
import { listShiftTypes, readRoster, rosterUsers } from './roster.ts';
import { JOB_TYPE_LABELS, type JobType } from '../../../shared/enums.ts';
import { withJosa } from '../../../shared/josa.ts';
import { datesBetween, isClinicOpen, LEAVE_TYPE_LABELS, weekdayKey, type LeaveType } from '../../../shared/schemas/leave.ts';
import { dayTotal, isFullDayLeave, rosterDateLabel, rosterLeave, shiftDate, weekdayKo, type RosterCell, type RosterDay, type ShiftType } from '../../../shared/schemas/roster.ts';
import {
  planEntries,
  repairPlan,
  type PlanDay,
  type PlanIssue,
  type PlanStaff,
  type RosterApplyInput,
  type RosterApplyResult,
  type RosterSuggestInput,
  type RosterSuggestion,
} from '../../../shared/schemas/roster-suggest.ts';

/** AI 응답 JSON(roster_suggest outputSchema를 통과한 값) */
interface AiRosterOutput {
  assignments: Array<{ staff: string; date: string; shift: number }>;
  note?: string;
}

/** 그 주 승인된 휴가: 직원 id → 날짜 → 휴가(하루에 두 건이면 하루 종일 휴가를 먼저) */
function weekLeaves(db: Db, from: string, to: string): Map<number, Map<string, { type: LeaveType; requestId: number }>> {
  const out = new Map<number, Map<string, { type: LeaveType; requestId: number }>>();
  for (const l of approvedLeaveDays(db, from, to)) {
    let row = out.get(l.userId);
    if (!row) {
      row = new Map();
      out.set(l.userId, row);
    }
    const prev = row.get(l.date);
    if (prev && (isFullDayLeave(prev.type) || !isFullDayLeave(l.type))) continue;
    row.set(l.date, { type: l.type, requestId: l.requestId });
  }
  return out;
}

/** 근무 유형 → 계획용 */
function planShifts(types: readonly ShiftType[]) {
  return types.filter((t) => t.active).map((t) => ({ id: t.id, label: t.label, startTime: t.startTime, endTime: t.endTime, countsAsWork: t.countsAsWork }));
}

/** 이름에 붙일 조사 포함 날짜: '11월 3일(화)에는' */
function onDate(date: string): string {
  return `${rosterDateLabel(date)}에는`;
}

/**
 * 근무표 배정 제안(POST /roster/suggest). AI 게이트웨이가 기능 켜짐·역할·예산·개인정보 검사·사용 기록을 맡는다.
 * 돌려주는 값은 미리보기일 뿐이고, 근무표는 적용(applyRoster) 전까지 바뀌지 않는다.
 */
export async function suggestRoster(ai: AiCallContext, input: RosterSuggestInput): Promise<RosterSuggestion> {
  const db = ai.db;
  const from = input.weekStart;
  const to = shiftDate(from, 6);
  const users = rosterUsers(db);
  if (users.length === 0) throw new AppError('VALIDATION', { message: '근무표에 넣을 직원이 없어요. 관리 메뉴에서 직원을 먼저 등록해 주세요.' });
  const allTypes = listShiftTypes(db);
  const shifts = planShifts(allTypes);
  if (!shifts.some((s) => s.countsAsWork)) throw new AppError('VALIDATION', { message: '근무 인원에 세는 근무 유형이 없어요. "근무 유형"에서 하나 이상 켜 주세요.' });
  const hours = readClinic(db).hours;
  const days: PlanDay[] = datesBetween(from, to).flatMap((date) => {
    const h = hours[weekdayKey(date)];
    return h && isClinicOpen(date, hours) ? [{ date, open: h.open, close: h.close }] : [];
  });
  if (days.length === 0) throw new AppError('VALIDATION', { message: '이 주에는 진료하는 날이 없어요. 병원 정보의 진료 시간을 확인해 주세요.' });

  // 직원 이름 대신 내부 번호. 번호 ↔ 직원은 서버 안에서만 안다
  const refOf = new Map(users.map((u, i) => [u.id, `S${i + 1}`]));
  const userOfRef = new Map(users.map((u, i) => [`S${i + 1}`, u]));
  const leaves = weekLeaves(db, from, to);
  const staff: PlanStaff[] = users.map((u) => ({
    key: refOf.get(u.id) ?? '',
    jobType: u.jobType,
    leave: [...(leaves.get(u.id)?.entries() ?? [])].filter(([, l]) => isFullDayLeave(l.type)).map(([d]) => d),
  }));
  const aiInput = {
    week: { from, to },
    days: days.map((d) => ({ ...d, weekday: weekdayKo(d.date) })),
    staff: users.map((u, i) => ({
      ref: staff[i]?.key ?? '',
      jobType: u.jobType,
      leave: staff[i]?.leave ?? [],
      halfLeave: [...(leaves.get(u.id)?.entries() ?? [])].filter(([, l]) => !isFullDayLeave(l.type)).map(([date, l]) => ({ date, part: l.type === 'half_am' ? '오전' : '오후' })),
    })),
    shifts,
    rules: { minStaff: input.minStaff, minByJob: input.minByJob },
  };

  const r = await runAi(ai, { feature: 'roster_suggest', input: aiInput });
  const out = (r.extra ?? { assignments: [] }) as AiRosterOutput;
  const { plan, issues } = repairPlan({
    staff,
    days,
    shifts,
    rules: aiInput.rules,
    entries: out.assignments.map((a) => ({ key: a.staff, date: a.date, shiftId: a.shift })),
  });

  // 번호 → 직원으로 되돌려 미리보기 칸을 만든다(휴가는 근무표 조회와 같은 규칙으로 덧씌운다)
  const types = new Map(allTypes.map((t) => [t.id, t]));
  const cells: RosterSuggestion['cells'] = [];
  for (const e of planEntries(plan)) {
    const u = userOfRef.get(e.key);
    if (u) cells.push({ userId: u.id, date: e.date, shiftTypeId: e.shiftId });
  }
  const byDate = new Map<string, Record<string, RosterCell>>();
  for (const c of cells) {
    const row = byDate.get(c.date) ?? {};
    row[String(c.userId)] = { shiftTypeId: c.shiftTypeId };
    byDate.set(c.date, row);
  }
  for (const [userId, row] of leaves) {
    if (!refOf.has(userId)) continue;
    for (const [date, l] of row) {
      const day = byDate.get(date) ?? {};
      day[String(userId)] = { shiftTypeId: day[String(userId)]?.shiftTypeId ?? null, leave: rosterLeave(l.type, l.requestId) };
      byDate.set(date, day);
    }
  }
  const viewDays: RosterDay[] = datesBetween(from, to).map((date) => {
    const c = byDate.get(date) ?? {};
    return { date, open: isClinicOpen(date, hours), cells: c, total: dayTotal(c, types) };
  });
  const current = readRoster(db, from, to);
  let changed = 0;
  for (const d of viewDays) {
    const now = current.days.find((x) => x.date === d.date);
    for (const u of users) if ((d.cells[String(u.id)]?.shiftTypeId ?? null) !== (now?.cells[String(u.id)]?.shiftTypeId ?? null)) changed += 1;
  }

  const { fixes, warnings } = describeIssues(issues, userOfRef, types, leaves);
  return {
    weekStart: from,
    rules: aiInput.rules,
    view: { from, to, today: current.today, users, shiftTypes: allTypes, days: viewDays, totals: Object.fromEntries(viewDays.map((d) => [d.date, d.total])) },
    cells,
    fixes,
    warnings,
    changed,
    ai: { demo: r.demo, costKrw: r.usage.costKrw, privacyNotice: r.privacy.notice, note: out.note?.trim() || null },
    sentStaff: aiInput.staff.map((s) => ({ ref: s.ref, jobType: s.jobType })),
  };
}

/** 고친 내용·경고를 이름이 들어간 쉬운 한국어 문장으로(서버 안에서만 이름으로 바꾼다) */
function describeIssues(
  issues: readonly PlanIssue[],
  userOfRef: ReadonlyMap<string, { id: number; name: string }>,
  types: ReadonlyMap<number, ShiftType>,
  leaves: ReadonlyMap<number, ReadonlyMap<string, { type: LeaveType }>>,
): { fixes: string[]; warnings: string[] } {
  const fixes: string[] = [];
  const warnings: string[] = [];
  const nameOf = (key: string) => userOfRef.get(key)?.name ?? key;
  const shiftLabel = (id: number) => types.get(id)?.label ?? '근무';
  const jobLabel = (job: JobType | null) => (job ? JOB_TYPE_LABELS[job] : '근무 인원');
  for (const i of issues) {
    if (i.kind === 'dropped') fixes.push(`AI 제안 중 맞지 않는 칸 ${i.count}개(없는 직원·날짜·근무 유형, 휴진일, 겹친 칸)는 뺐어요.`);
    else if (i.kind === 'leave') {
      const u = userOfRef.get(i.key);
      const leave = u ? leaves.get(u.id)?.get(i.date) : undefined;
      const label = leave ? LEAVE_TYPE_LABELS[leave.type] : '휴가';
      fixes.push(`${nameOf(i.key)} ${onDate(i.date)} 승인된 ${withJosa(label, '이/가')} 있어서 AI가 넣은 "${shiftLabel(i.shiftId)}" 근무를 뺐어요.`);
    } else if (i.kind === 'filled') {
      const rule = i.job ? `${JOB_TYPE_LABELS[i.job]} 최소 ${i.need}명` : `하루 최소 인원 ${i.need}명`;
      fixes.push(`${rosterDateLabel(i.date)} ${rule}을 맞추려고 ${withJosa(nameOf(i.key), '을/를')} "${shiftLabel(i.shiftId)}"에 넣었어요.`);
    } else {
      warnings.push(`${onDate(i.date)} ${withJosa(jobLabel(i.job), '이/가')} 최소 ${i.need}명 필요한데, 근무할 수 있는 사람이 ${i.have}명뿐이에요.`);
    }
  }
  return { fixes, warnings };
}

/**
 * 제안 적용(POST /roster/apply). 그 주(월~일) 재직 직원 칸을 지우고 보낸 칸을 넣는다.
 * 없는 직원·사용 안 함 유형·주 밖 날짜는 막고(400·404), 그사이 승인된 하루 종일 휴가일의 근무 칸은 넣지 않고 skipped로 센다.
 */
export function applyRoster(db: Db, input: RosterApplyInput): RosterApplyResult {
  const from = input.weekStart;
  const to = shiftDate(from, 6);
  const week = new Set(datesBetween(from, to));
  const active = new Set(rosterUsers(db).map((u) => u.id));
  const types = new Map(listShiftTypes(db).map((t) => [t.id, t]));
  input.cells.forEach((c, idx) => {
    if (!week.has(c.date)) throw new AppError('VALIDATION', { fields: { [`cells.${idx}.date`]: '제안받은 주 밖의 날짜예요.' }, message: '제안받은 주 밖의 날짜가 들어 있어요. 다시 제안받아 주세요.' });
    if (!active.has(c.userId)) throw new AppError('NOT_FOUND', { message: '근무표에 없는 직원이 들어 있어요. 다시 제안받아 주세요.' });
    const t = types.get(c.shiftTypeId);
    if (!t) throw new AppError('NOT_FOUND', { message: '없는 근무 유형이 들어 있어요. 다시 제안받아 주세요.' });
    if (!t.active) throw new AppError('VALIDATION', { fields: { [`cells.${idx}.shiftTypeId`]: '사용하지 않는 근무 유형이에요.' }, message: '사용하지 않는 근무 유형이 들어 있어요. 다시 제안받아 주세요.' });
  });
  const leaves = weekLeaves(db, from, to);
  return db.tx(() => {
    const replaced = db.run('DELETE FROM roster WHERE date BETWEEN ? AND ? AND user_id IN (SELECT id FROM users WHERE active = 1)', [from, to]).changes;
    let saved = 0;
    let skipped = 0;
    for (const c of input.cells) {
      const l = leaves.get(c.userId)?.get(c.date);
      if (l && isFullDayLeave(l.type) && types.get(c.shiftTypeId)?.countsAsWork) {
        skipped += 1;
        continue;
      }
      db.run('INSERT INTO roster (user_id, date, shift_type_id) VALUES (?, ?, ?)', [c.userId, c.date, c.shiftTypeId]);
      saved += 1;
    }
    return { weekStart: from, saved, replaced, skipped };
  });
}

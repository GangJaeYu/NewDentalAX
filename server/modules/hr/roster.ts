// 이 파일이 하는 일: 근무표·근무 유형(FR-081, backend.md §3.7 roster)의 처리 함수를 둔다. HTTP 등록은 roster-routes.ts가 한다.
// - 조회: 기간(최대 6주)의 직원 × 날짜 칸을 읽고, 승인된 휴가(leave.ts approvedLeaveDays)를 칸에 덧씌운 뒤 날짜별 근무 인원을 센다(roster 원본은 바꾸지 않음).
// - 칸 저장: 직원·날짜·근무 유형을 한 칸에 넣거나(같은 칸이면 바꿈) 비운다. 사용 안 함 유형·없는 직원은 막는다.
// - 지난주 복사: 붙여 넣을 주의 칸을 모두 지우고 복사할 주의 칸을 요일대로 옮긴다. 휴가는 roster에 없으므로 복사되지 않는다.
// - 근무 유형: 목록 읽기·전체 저장(id 있으면 고치고, 없으면 새로 만듦). 대시보드는 todayRoster()로 오늘 근무자를 읽는다(phase-03-task-10).
import type { Db } from '../../db/index.ts';
import { AppError } from '../../lib/errors.ts';
import { readClinic } from '../admin/clinic.ts';
import { approvedLeaveDays } from './leave.ts';
import { datesBetween, isClinicOpen } from '../../../shared/schemas/leave.ts';
import {
  cellCountsAsWork,
  dayTotal,
  rosterLeave,
  shiftDate,
  type CopyWeekInput,
  type CopyWeekResult,
  type RosterCell,
  type RosterCellInput,
  type RosterCellResult,
  type RosterDay,
  type RosterUser,
  type RosterView,
  type SaveShiftTypesInput,
  type ShiftColor,
  type ShiftType,
  type TodayRoster,
  type TodayWorker,
} from '../../../shared/schemas/roster.ts';
import type { JobType } from '../../../shared/enums.ts';
import type { Role } from '../../../shared/roles.ts';

interface ShiftRow {
  id: number;
  code: string;
  label: string;
  start_time: string | null;
  end_time: string | null;
  color_token: ShiftColor;
  counts_as_work: number;
  sort: number;
  active: number;
}

/** DB 줄 → 근무 유형 */
function toShiftType(r: ShiftRow): ShiftType {
  return {
    id: r.id,
    code: r.code,
    label: r.label,
    startTime: r.start_time,
    endTime: r.end_time,
    colorToken: r.color_token,
    countsAsWork: r.counts_as_work === 1,
    sort: r.sort,
    active: r.active === 1,
  };
}

/** 근무 유형 목록(사용 안 함 포함, 정렬 순서대로) */
export function listShiftTypes(db: Db): ShiftType[] {
  return db.all<ShiftRow>('SELECT id, code, label, start_time, end_time, color_token, counts_as_work, sort, active FROM shift_types ORDER BY sort, id').map(toShiftType);
}

/** 근무 유형 전체 저장. 목록 순서가 곧 정렬 순서다. 목록에 없는 기존 유형은 그대로 둔다(지우지 않고 사용 안 함으로 숨긴다) */
export function saveShiftTypes(db: Db, input: SaveShiftTypesInput): ShiftType[] {
  db.tx(() => {
    const known = new Set(db.all<{ id: number }>('SELECT id FROM shift_types').map((r) => r.id));
    // 이름 UNIQUE가 아니어도, 같은 이름이 남아 있으면 헷갈리므로 목록 밖 유형과의 이름 겹침도 막는다
    const outside = db.all<{ id: number; label: string }>('SELECT id, label FROM shift_types').filter((r) => !input.items.some((i) => i.id === r.id));
    input.items.forEach((item, idx) => {
      if (outside.some((o) => o.label === item.label)) {
        throw new AppError('VALIDATION', { fields: { [`items.${idx}.label`]: '같은 이름의 근무 유형이 이미 있어요.' }, message: `"${item.label}" 근무 유형이 이미 있어요.` });
      }
    });
    input.items.forEach((item, idx) => {
      const sort = idx + 1;
      const values = [item.label, item.startTime, item.endTime, item.colorToken, item.countsAsWork ? 1 : 0, sort, item.active ? 1 : 0];
      if (item.id !== undefined) {
        if (!known.has(item.id)) throw new AppError('NOT_FOUND', { message: '고치려는 근무 유형이 없어요. 화면을 새로 고쳐 주세요.' });
        db.run('UPDATE shift_types SET label = ?, start_time = ?, end_time = ?, color_token = ?, counts_as_work = ?, sort = ?, active = ? WHERE id = ?', [...values, item.id]);
      } else {
        // 관리자가 더한 유형의 코드: custom-<아직 쓰지 않은 가장 작은 번호>
        let n = (db.get<{ m: number }>('SELECT COALESCE(MAX(id), 0) AS m FROM shift_types')?.m ?? 0) + 1;
        while (db.get('SELECT 1 AS x FROM shift_types WHERE code = ?', [`custom-${n}`])) n += 1;
        db.run('INSERT INTO shift_types (code, label, start_time, end_time, color_token, counts_as_work, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [`custom-${n}`, ...values]);
      }
    });
  });
  return listShiftTypes(db);
}

const JOB_ORDER = "CASE job_type WHEN 'doctor' THEN 0 WHEN 'hygienist' THEN 1 WHEN 'assistant' THEN 2 WHEN 'desk' THEN 3 ELSE 4 END";

/** 근무표에 나오는 직원(재직 중, 직무 순서 → 가입 순) */
export function rosterUsers(db: Db): RosterUser[] {
  return db
    .all<{ id: number; name: string; role: Role; job_type: JobType }>(`SELECT id, name, role, job_type FROM users WHERE active = 1 ORDER BY ${JOB_ORDER}, id`)
    .map((u) => ({ id: u.id, name: u.name, role: u.role, jobType: u.job_type }));
}

/** 기간의 칸을 읽어 휴가를 덧씌운다. userIds가 있으면 그 직원만 */
function readCells(db: Db, from: string, to: string, userIds: ReadonlySet<number>): Map<string, Record<string, RosterCell>> {
  const byDate = new Map<string, Record<string, RosterCell>>();
  const cellsOf = (date: string) => {
    let c = byDate.get(date);
    if (!c) {
      c = {};
      byDate.set(date, c);
    }
    return c;
  };
  for (const r of db.all<{ user_id: number; date: string; shift_type_id: number }>('SELECT user_id, date, shift_type_id FROM roster WHERE date BETWEEN ? AND ? ORDER BY date, user_id', [from, to])) {
    if (!userIds.has(r.user_id)) continue;
    cellsOf(r.date)[String(r.user_id)] = { shiftTypeId: r.shift_type_id };
  }
  for (const l of approvedLeaveDays(db, from, to)) {
    if (!userIds.has(l.userId)) continue;
    const cells = cellsOf(l.date);
    const key = String(l.userId);
    const leave = rosterLeave(l.type, l.requestId);
    const prev = cells[key];
    // 같은 날 휴가가 두 건이면(오전 반차 + 오후 반차 등) 하루 종일 휴가를 먼저 보여 준다
    if (prev?.leave && (prev.leave.fullDay || !leave.fullDay)) continue;
    cells[key] = { shiftTypeId: prev?.shiftTypeId ?? null, leave };
  }
  return byDate;
}

/** 근무 유형 id → 유형 */
function typeMap(types: readonly ShiftType[]): Map<number, ShiftType> {
  return new Map(types.map((t) => [t.id, t]));
}

/** 근무표 조회(GET /roster). from~to는 이미 검사한 날짜(최대 42일), today는 서버 기준 오늘 */
export function readRoster(db: Db, from: string, to: string, today = from): RosterView {
  const users = rosterUsers(db);
  const shiftTypes = listShiftTypes(db);
  const types = typeMap(shiftTypes);
  const hours = readClinic(db).hours;
  const byDate = readCells(db, from, to, new Set(users.map((u) => u.id)));
  const days: RosterDay[] = datesBetween(from, to).map((date) => {
    const cells = byDate.get(date) ?? {};
    return { date, open: isClinicOpen(date, hours), cells, total: dayTotal(cells, types) };
  });
  return { from, to, today, users, shiftTypes, days, totals: Object.fromEntries(days.map((d) => [d.date, d.total])) };
}

/** 칸 하나 저장(PUT /roster/cell). shiftTypeId가 null이면 칸을 비운다 */
export function saveCell(db: Db, input: RosterCellInput): RosterCellResult {
  const user = db.get<{ id: number; active: number }>('SELECT id, active FROM users WHERE id = ?', [input.userId]);
  if (!user || user.active !== 1) throw new AppError('NOT_FOUND', { message: '그 직원을 찾지 못했어요. 화면을 새로 고쳐 주세요.' });
  if (input.shiftTypeId === null) {
    db.run('DELETE FROM roster WHERE user_id = ? AND date = ?', [input.userId, input.date]);
  } else {
    const type = db.get<{ active: number }>('SELECT active FROM shift_types WHERE id = ?', [input.shiftTypeId]);
    if (!type) throw new AppError('NOT_FOUND', { message: '그 근무 유형을 찾지 못했어요. 화면을 새로 고쳐 주세요.' });
    if (type.active !== 1) throw new AppError('VALIDATION', { fields: { shiftTypeId: '사용하지 않는 근무 유형이에요.' }, message: '사용하지 않는 근무 유형이에요. 다른 유형을 골라 주세요.' });
    db.run('INSERT INTO roster (user_id, date, shift_type_id) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET shift_type_id = excluded.shift_type_id', [
      input.userId,
      input.date,
      input.shiftTypeId,
    ]);
  }
  const day = readRoster(db, input.date, input.date).days[0];
  const cell = day?.cells[String(input.userId)] ?? { shiftTypeId: null };
  return { userId: input.userId, date: input.date, cell, total: day?.total ?? 0 };
}

/** 지난주 복사(POST /roster/copy-week): 붙여 넣을 주(월~일)의 칸을 비우고, 복사할 주의 칸을 요일대로 옮긴다(재직 중 직원만) */
export function copyWeek(db: Db, input: CopyWeekInput): CopyWeekResult {
  const toEnd = shiftDate(input.toWeekStart, 6);
  const fromEnd = shiftDate(input.fromWeekStart, 6);
  const offset = Math.round((Date.parse(`${input.toWeekStart}T00:00:00Z`) - Date.parse(`${input.fromWeekStart}T00:00:00Z`)) / 86_400_000);
  return db.tx(() => {
    const replaced = db.run('DELETE FROM roster WHERE date BETWEEN ? AND ? AND user_id IN (SELECT id FROM users WHERE active = 1)', [input.toWeekStart, toEnd]).changes;
    const rows = db.all<{ user_id: number; date: string; shift_type_id: number }>(
      'SELECT r.user_id, r.date, r.shift_type_id FROM roster r JOIN users u ON u.id = r.user_id JOIN shift_types t ON t.id = r.shift_type_id WHERE u.active = 1 AND t.active = 1 AND r.date BETWEEN ? AND ?',
      [input.fromWeekStart, fromEnd],
    );
    for (const r of rows) {
      db.run('INSERT INTO roster (user_id, date, shift_type_id) VALUES (?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET shift_type_id = excluded.shift_type_id', [
        r.user_id,
        shiftDate(r.date, offset),
        r.shift_type_id,
      ]);
    }
    return { fromWeekStart: input.fromWeekStart, toWeekStart: input.toWeekStart, copied: rows.length, replaced };
  });
}

/** 줄 순서: 근무하는 사람(유형 정렬 순) → 휴가 → 휴무 등 근무로 세지 않는 유형 */
function workerRank(w: TodayWorker, types: ReadonlyMap<number, ShiftType>): number {
  if (w.working) return 0 + (w.shift ? (types.get(w.shift.id)?.sort ?? 0) / 1000 : 0);
  if (w.leave) return 1;
  return 2;
}

/**
 * 오늘(또는 date) 근무자 목록. 대시보드 "오늘 근무" 카드와 요약 숫자(phase-03-task-10)가 쓴다.
 * 근무 유형이 정해졌거나 승인된 휴가가 있는 직원만 넣고, working은 인원 합계와 같은 규칙으로 센다.
 */
export function todayRoster(db: Db, date: string): TodayRoster {
  const view = readRoster(db, date, date);
  const day = view.days[0];
  const types = typeMap(view.shiftTypes);
  const items: TodayWorker[] = [];
  for (const u of view.users) {
    const cell = day?.cells[String(u.id)];
    if (!cell) continue;
    const t = cell.shiftTypeId === null ? undefined : types.get(cell.shiftTypeId);
    items.push({
      userId: u.id,
      name: u.name,
      jobType: u.jobType,
      shift: t ? { id: t.id, label: t.label, colorToken: t.colorToken, startTime: t.startTime, endTime: t.endTime } : null,
      ...(cell.leave ? { leave: cell.leave } : {}),
      working: cellCountsAsWork(cell, types),
    });
  }
  const order = new Map(view.users.map((u, i) => [u.id, i]));
  items.sort((a, b) => workerRank(a, types) - workerRank(b, types) || (order.get(a.userId) ?? 0) - (order.get(b.userId) ?? 0));
  return {
    date,
    open: day?.open ?? false,
    items,
    working: day?.total ?? 0,
    onLeave: items.filter((i) => i.leave?.fullDay).length,
  };
}

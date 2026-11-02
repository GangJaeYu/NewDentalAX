// 이 파일이 하는 일: 연차·휴가(FR-080, overview §3.6, backend.md §3.7 leave)의 처리 함수를 둔다. HTTP 등록은 leave-routes.ts가 한다.
// - 신청: 병원이 문을 여는 날만 세어 일수를 정하고(반차 0.5), 본인 기간이 겹치면 막는다. 저장 뒤 실장 이상(본인 제외)에게 leave_requested 알림.
// - 결정: 승인 대기 건만 승인·반려한다(반려 사유 필수). 결과는 신청자에게 leave_result 알림. 같은 날 승인 인원이 settings.leave.maxPerDay를 넘으면 warnings를 돌려준다(승인은 된다).
// - 부여·잔여: 직원별 해마다 부여 일수(없으면 settings.leave.defaultAllowance)와 승인된 연차·반차 합계로 잔여를 계산한다. 병가·기타는 잔여에서 빼지 않는다.
// 근무표(phase-04-task-01)는 approvedLeaveDays()로 승인된 휴가 날짜를 읽어 덧씌워 보여 준다(roster 원본은 바꾸지 않음).
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError } from '../../lib/errors.ts';
import { emitNotification, resolveRecipients } from '../notifications/emit.ts';
import { readClinic } from '../admin/clinic.ts';
import { can, type Role } from '../../../shared/roles.ts';
import {
  countLeaveDays,
  DEDUCTING_TYPES,
  DEFAULT_LEAVE_SETTINGS,
  datesBetween,
  formatLeaveDays,
  isClinicOpen,
  isHalfDay,
  leaveSettingsSchema,
  periodLabel,
  shortKoreanDate,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  type CreateLeaveInput,
  type DecideLeaveInput,
  type LeaveAllowanceRow,
  type LeaveAllowanceTable,
  type LeaveDecision,
  type LeaveRequestItem,
  type LeaveSettings,
  type LeaveStatus,
  type LeaveType,
  type SaveAllowancesInput,
} from '../../../shared/schemas/leave.ts';

/** 요청한 사람(세션의 사용자) */
export interface LeaveActor {
  id: number;
  name: string;
  role: Role;
}

interface LeaveRow {
  id: number;
  user_id: number;
  user_name: string | null;
  type: LeaveType;
  start_on: string;
  end_on: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  decided_by: number | null;
  decider_name: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

const SELECT_LEAVE = `SELECT l.id, l.user_id, u.name AS user_name, l.type, l.start_on, l.end_on, l.days, l.reason, l.status,
  l.decided_by, d.name AS decider_name, l.decided_at, l.reject_reason, l.created_at
  FROM leave_requests l
  LEFT JOIN users u ON u.id = l.user_id
  LEFT JOIN users d ON d.id = l.decided_by`;

/** DB 줄 → 응답 모양 */
function toItem(r: LeaveRow, warnings: string[] = []): LeaveRequestItem {
  return {
    id: r.id,
    user: { id: r.user_id, name: r.user_name ?? '알 수 없음' },
    type: r.type,
    startOn: r.start_on,
    endOn: r.end_on,
    days: r.days,
    reason: r.reason,
    status: r.status,
    decidedBy: r.decided_by === null ? null : { id: r.decided_by, name: r.decider_name ?? '알 수 없음' },
    decidedAt: r.decided_at,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    warnings,
  };
}

/** 신청 한 건을 읽는다(없으면 404) */
function getRow(db: Db, id: number): LeaveRow {
  const row = db.get<LeaveRow>(`${SELECT_LEAVE} WHERE l.id = ?`, [id]);
  if (!row) throw new AppError('NOT_FOUND', { message: '휴가 신청을 찾을 수 없어요. 화면을 새로 고쳐 주세요.' });
  return row;
}

/** settings.leave를 읽는다. 없거나 형식이 틀린 항목은 기본값(maxPerDay 2, defaultAllowance 15)을 쓴다 */
export function readLeaveSettings(db: Db): LeaveSettings {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'leave'");
  let raw: Record<string, unknown> = {};
  try {
    const v: unknown = row ? JSON.parse(row.value) : {};
    if (v && typeof v === 'object' && !Array.isArray(v)) raw = v as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const out: LeaveSettings = { ...DEFAULT_LEAVE_SETTINGS };
  const max = leaveSettingsSchema.shape.maxPerDay.safeParse(raw.maxPerDay);
  if (max.success) out.maxPerDay = max.data;
  const def = leaveSettingsSchema.shape.defaultAllowance.safeParse(raw.defaultAllowance);
  if (def.success) out.defaultAllowance = def.data;
  return out;
}

/** settings.leave를 저장한다(이 화면이 모르는 다른 항목은 남겨 둔다) */
export function saveLeaveSettings(db: Db, clock: Clock, next: LeaveSettings): LeaveSettings {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'leave'");
  let prev: Record<string, unknown> = {};
  try {
    const v: unknown = row ? JSON.parse(row.value) : {};
    if (v && typeof v === 'object' && !Array.isArray(v)) prev = v as Record<string, unknown>;
  } catch {
    prev = {};
  }
  db.run(
    "INSERT INTO settings (key, value, updated_at) VALUES ('leave', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [JSON.stringify({ ...prev, ...next }), clock.now().toISOString()],
  );
  return readLeaveSettings(db);
}

/** 두 신청이 같은 시간을 차지하는지(같은 날 오전 반차와 오후 반차는 겹치지 않는다) */
function overlaps(a: { type: LeaveType; start_on: string; end_on: string }, b: { type: LeaveType; startOn: string; endOn: string }): boolean {
  if (a.start_on > b.endOn || a.end_on < b.startOn) return false;
  if (isHalfDay(a.type) && isHalfDay(b.type) && a.type !== b.type) return false;
  return true;
}

/**
 * 휴가를 신청한다(FR-080 AC1). 일수는 병원이 문을 여는 날만 세고 반차는 0.5일이다.
 * 본인의 승인 대기·승인 신청과 겹치면 막는다. 저장 뒤 실장 이상(본인 제외)에게 알림을 보낸다.
 */
export function createLeave(db: Db, clock: Clock, actor: LeaveActor, input: CreateLeaveInput): LeaveRequestItem {
  const startOn = input.startOn;
  const endOn = input.endOn ?? startOn;
  const counted = countLeaveDays(input.type, startOn, endOn, readClinic(db).hours);
  if ('error' in counted) throw new AppError('VALIDATION', { message: counted.error, fields: { [counted.field]: counted.error } });

  const mine = db.all<{ id: number; type: LeaveType; start_on: string; end_on: string; status: LeaveStatus }>(
    "SELECT id, type, start_on, end_on, status FROM leave_requests WHERE user_id = ? AND status IN ('pending', 'approved') AND start_on <= ? AND end_on >= ?",
    [actor.id, endOn, startOn],
  );
  const clash = mine.find((r) => overlaps(r, { type: input.type, startOn, endOn }));
  if (clash) {
    const msg = `이미 ${periodLabel(clash.start_on, clash.end_on)} ${LEAVE_TYPE_LABELS[clash.type]} 신청이 있어요(${LEAVE_STATUS_LABELS[clash.status]}). 날짜를 바꾸거나 먼저 취소해 주세요.`;
    throw new AppError('VALIDATION', { message: msg, fields: { startOn: msg } });
  }

  const now = clock.now().toISOString();
  const id = db.tx(() => {
    const r = db.run(
      "INSERT INTO leave_requests (user_id, type, start_on, end_on, days, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      [actor.id, input.type, startOn, endOn, counted.days, input.reason ?? '', now],
    );
    return r.lastInsertRowid;
  });

  // 실장 이상에게 알림(본인이 실장이면 본인은 빼고 다른 결정권자에게)
  const recipients = resolveRecipients(db, { type: 'leave_requested' }).filter((uid) => uid !== actor.id);
  emitNotification(
    db,
    {
      userIds: recipients,
      type: 'leave_requested',
      title: `${actor.name} 님이 휴가를 신청했어요`,
      body: `${LEAVE_TYPE_LABELS[input.type]} · ${periodLabel(startOn, endOn)} · ${formatLeaveDays(counted.days)}${input.reason ? ` · 사유: ${input.reason}` : ''}`,
      link: '/hr/leave',
      dedupeKey: `leave:req:${id}`,
    },
    clock,
  );
  return toItem(getRow(db, id));
}

/** 본인 신청을 취소한다(승인 대기일 때만) */
export function cancelLeave(db: Db, actor: LeaveActor, id: number): LeaveRequestItem {
  const row = getRow(db, id);
  if (row.user_id !== actor.id) throw new AppError('FORBIDDEN', { message: '본인이 낸 신청만 취소할 수 있어요.' });
  if (row.status !== 'pending') throw new AppError('CONFLICT', { message: '승인 대기 중인 신청만 취소할 수 있어요. 이미 처리된 신청은 실장님께 말씀해 주세요.' });
  db.run("UPDATE leave_requests SET status = 'canceled' WHERE id = ? AND status = 'pending'", [id]);
  return toItem(getRow(db, id));
}

/**
 * 이 신청을 승인하면 생길 경고를 만든다(FR-080 AC4).
 * - 같은 날 이미 승인된 휴가자(본인 제외) 수 + 1이 하루 최대 인원(maxPerDay)을 넘는 날
 * - 연차·반차인데 승인하면 잔여 일수가 0보다 작아지는 경우
 */
export function approvalWarnings(db: Db, row: Pick<LeaveRow, 'id' | 'user_id' | 'type' | 'start_on' | 'end_on' | 'days'>, settings = readLeaveSettings(db)): string[] {
  const hours = readClinic(db).hours;
  const others = db.all<{ user_id: number; start_on: string; end_on: string }>(
    "SELECT user_id, start_on, end_on FROM leave_requests WHERE status = 'approved' AND id <> ? AND user_id <> ? AND start_on <= ? AND end_on >= ?",
    [row.id, row.user_id, row.end_on, row.start_on],
  );
  const warnings: string[] = [];
  for (const date of datesBetween(row.start_on, row.end_on)) {
    if (!isClinicOpen(date, hours)) continue;
    const people = new Set(others.filter((o) => o.start_on <= date && o.end_on >= date).map((o) => o.user_id));
    if (people.size + 1 > settings.maxPerDay) {
      warnings.push(`${shortKoreanDate(date)}에 이미 ${people.size}명이 휴가예요. 승인하면 하루 최대 ${settings.maxPerDay}명을 넘어요.`);
    }
  }
  if (DEDUCTING_TYPES.includes(row.type)) {
    const year = Number(row.start_on.slice(0, 4));
    const allowance = allowanceFor(db, row.user_id, year, settings);
    const used = usedDays(db, row.user_id, year, row.id);
    const after = allowance - used - row.days;
    if (after < 0) warnings.push(`승인하면 ${year}년 잔여 연차가 ${formatLeaveDays(after)}이 돼요(부여 ${formatLeaveDays(allowance)}).`);
  }
  return warnings;
}

/**
 * 승인 또는 반려한다(FR-080 AC2·AC4). 승인 대기 건만 처리하고, 반려는 사유가 꼭 있어야 한다(입력 검사에서 먼저 막음).
 * 실장은 본인 신청을 직접 결정할 수 없다(원장 admin은 결정할 사람이 없으므로 가능). 결과는 신청자에게 알림으로 간다.
 * 같은 날 인원 초과 같은 경고가 있어도 승인은 되고, 경고는 응답의 warnings로 돌려준다.
 */
export function decideLeave(db: Db, clock: Clock, actor: LeaveActor, id: number, input: DecideLeaveInput): LeaveDecision {
  const row = getRow(db, id);
  if (row.user_id === actor.id && actor.role !== 'admin') throw new AppError('FORBIDDEN', { message: '본인 신청은 다른 관리자가 승인하거나 반려해요.' });
  if (row.status !== 'pending') throw new AppError('CONFLICT', { message: `이미 ${LEAVE_STATUS_LABELS[row.status]} 처리된 신청이에요. 화면을 새로 고쳐 주세요.` });
  const reason = input.reason?.trim() ?? '';
  if (!input.approve && !reason) throw new AppError('VALIDATION', { message: '반려 사유를 적어 주세요.', fields: { reason: '반려 사유를 적어 주세요.' } });

  const warnings = input.approve ? approvalWarnings(db, row) : [];
  const now = clock.now().toISOString();
  const changed = db.run(
    "UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = ?, reject_reason = ? WHERE id = ? AND status = 'pending'",
    [input.approve ? 'approved' : 'rejected', actor.id, now, input.approve ? null : reason, id],
  );
  if (changed.changes === 0) throw new AppError('CONFLICT', { message: '다른 사람이 먼저 처리했어요. 화면을 새로 고쳐 주세요.' });

  const period = periodLabel(row.start_on, row.end_on);
  emitNotification(
    db,
    {
      userIds: [row.user_id],
      type: 'leave_result',
      title: `${period} ${LEAVE_TYPE_LABELS[row.type]} 신청이 ${input.approve ? '승인됐어요' : '반려됐어요'}`,
      body: input.approve ? `${actor.name} 님이 승인했어요 · ${formatLeaveDays(row.days)}` : `반려 사유: ${reason}`,
      link: '/hr/leave',
      dedupeKey: `leave:result:${id}`,
    },
    clock,
  );
  return { request: toItem(getRow(db, id)), warnings };
}

/** 목록 조건 */
export interface LeaveListQuery {
  mine?: boolean;
  status?: LeaveStatus;
  year?: number;
}

/**
 * 신청 목록. 승인 권한(leave.approve)이 없으면 늘 본인 것만 보인다.
 * 승인 권한이 있는 사람에게는 승인 대기 건마다 승인하면 생길 경고를 함께 준다.
 */
export function listLeave(db: Db, actor: LeaveActor, q: LeaveListQuery): LeaveRequestItem[] {
  const approver = can(actor.role, 'leave.approve');
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q.mine || !approver) {
    where.push('l.user_id = ?');
    params.push(actor.id);
  }
  if (q.status) {
    where.push('l.status = ?');
    params.push(q.status);
  }
  if (q.year) {
    where.push("substr(l.start_on, 1, 4) = ?");
    params.push(String(q.year));
  }
  const rows = db.all<LeaveRow>(
    `${SELECT_LEAVE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE l.status WHEN 'pending' THEN 0 ELSE 1 END, l.start_on DESC, l.id DESC LIMIT 500`,
    params,
  );
  const settings = readLeaveSettings(db);
  return rows.map((r) => toItem(r, approver && r.status === 'pending' ? approvalWarnings(db, r, settings) : []));
}

/** 승인 대기 건수(대시보드 "승인 대기"에서 쓸 수 있다) */
export function pendingLeaveCount(db: Db): number {
  return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'")?.n ?? 0;
}

/** 직원의 그해 부여 일수(admin이 정하지 않았으면 기본값) */
function allowanceFor(db: Db, userId: number, year: number, settings: LeaveSettings): number {
  return db.get<{ days: number }>('SELECT days FROM leave_allowances WHERE user_id = ? AND year = ?', [userId, year])?.days ?? settings.defaultAllowance;
}

/** 그해 승인된 연차·반차 합계(exceptId는 빼고) */
function usedDays(db: Db, userId: number, year: number, exceptId = 0): number {
  const marks = DEDUCTING_TYPES.map(() => '?').join(', ');
  return (
    db.get<{ n: number | null }>(
      `SELECT SUM(days) AS n FROM leave_requests WHERE user_id = ? AND status = 'approved' AND substr(start_on, 1, 4) = ? AND id <> ? AND type IN (${marks})`,
      [userId, String(year), exceptId, ...DEDUCTING_TYPES],
    )?.n ?? 0
  );
}

/**
 * 직원별 부여·사용·잔여 표(FR-080 AC3). 직원 목록 권한(users.view, 실장 이상)이 없으면 본인 줄만 준다.
 * 법정 연차 자동 계산은 하지 않고, admin이 정한 일수(없으면 기본값)를 쓴다.
 */
export function allowanceTable(db: Db, actor: LeaveActor, year: number): LeaveAllowanceTable {
  const settings = readLeaveSettings(db);
  const everyone = can(actor.role, 'users.view');
  const users = db.all<{ id: number; name: string; job_type: string }>(
    everyone ? 'SELECT id, name, job_type FROM users WHERE active = 1 ORDER BY name, id' : 'SELECT id, name, job_type FROM users WHERE id = ?',
    everyone ? [] : [actor.id],
  );
  const given = new Map(db.all<{ user_id: number; days: number }>('SELECT user_id, days FROM leave_allowances WHERE year = ?', [year]).map((r) => [r.user_id, r.days]));
  const sums = db.all<{ user_id: number; status: LeaveStatus; deducting: number; n: number }>(
    `SELECT user_id, status, CASE WHEN type IN ('annual', 'half_am', 'half_pm') THEN 1 ELSE 0 END AS deducting, SUM(days) AS n
     FROM leave_requests WHERE substr(start_on, 1, 4) = ? AND status IN ('pending', 'approved') GROUP BY user_id, status, deducting`,
    [String(year)],
  );
  const rows: LeaveAllowanceRow[] = users.map((u) => {
    const pick = (status: LeaveStatus, deducting: number) => sums.find((s) => s.user_id === u.id && s.status === status && s.deducting === deducting)?.n ?? 0;
    const allowance = given.get(u.id) ?? settings.defaultAllowance;
    const used = pick('approved', 1);
    return {
      userId: u.id,
      name: u.name,
      jobType: u.job_type,
      year,
      allowance,
      isDefault: !given.has(u.id),
      used,
      pending: pick('pending', 1),
      remaining: allowance - used,
      otherUsed: pick('approved', 0),
    };
  });
  return { year, defaultAllowance: settings.defaultAllowance, rows };
}

/** 직원별 부여 일수를 저장한다(admin). 없는 직원이 섞여 있으면 저장하지 않는다. 저장한 줄 수를 돌려준다 */
export function saveAllowances(db: Db, input: SaveAllowancesInput): number {
  const ids = [...new Set(input.items.map((i) => i.userId))];
  if (ids.length !== input.items.length) throw new AppError('VALIDATION', { message: '같은 직원이 두 번 들어 있어요.' });
  if (ids.length) {
    const marks = ids.map(() => '?').join(', ');
    const found = db.all<{ id: number }>(`SELECT id FROM users WHERE id IN (${marks})`, ids).length;
    if (found !== ids.length) throw new AppError('VALIDATION', { message: '목록에 없는 직원이 있어요. 화면을 새로 고친 뒤 다시 저장해 주세요.' });
  }
  db.tx(() => {
    for (const it of input.items) {
      db.run('INSERT INTO leave_allowances (user_id, year, days) VALUES (?, ?, ?) ON CONFLICT(user_id, year) DO UPDATE SET days = excluded.days', [it.userId, input.year, it.days]);
    }
  });
  return input.items.length;
}

/** 근무표용: 기간 안의 승인된 휴가 날짜(병원이 문을 여는 날만). phase-04-task-01이 roster 조회에 덧씌운다 */
export function approvedLeaveDays(db: Db, from: string, to: string): Array<{ userId: number; date: string; type: LeaveType; requestId: number }> {
  const hours = readClinic(db).hours;
  const rows = db.all<{ id: number; user_id: number; type: LeaveType; start_on: string; end_on: string }>(
    "SELECT id, user_id, type, start_on, end_on FROM leave_requests WHERE status = 'approved' AND start_on <= ? AND end_on >= ? ORDER BY start_on, id",
    [to, from],
  );
  const out: Array<{ userId: number; date: string; type: LeaveType; requestId: number }> = [];
  for (const r of rows) {
    for (const date of datesBetween(r.start_on > from ? r.start_on : from, r.end_on < to ? r.end_on : to)) {
      if (isClinicOpen(date, hours)) out.push({ userId: r.user_id, date, type: r.type, requestId: r.id });
    }
  }
  return out;
}

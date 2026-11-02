// 이 파일이 하는 일: 교육 이수 기록(FR-082)의 처리 함수. 교육 항목(이름·주기·법정 일정 연결) 만들기·고치기, 직원별 이수 기록(증빙 파일 선택) 쌓기,
// 직원별 다음 예정일·남은 날·상태 계산을 맡는다. 다음 예정일 = 가장 최근 이수일 + 주기(개월, server/lib/dates.ts의 addMonths, 말일 보정).
// 권한: 교육 항목 관리와 다른 직원의 기록 입력은 trainings.manage(실장 이상), 본인 기록은 누구나. 직원은 본인 상태·기록만 본다.
// 임박 알림(D-30·D-7·당일·지남, 받는 사람: 해당 직원 + manager 이상)은 training-notify.ts가 만들고, 기록을 저장한 직후에도 그 짝만 바로 확인한다.
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { addMonths, dday, todayKst } from '../../lib/dates.ts';
import { AppError } from '../../lib/errors.ts';
import { getFile, saveUpload, type FileRow } from '../../lib/files.ts';
import { can, type Role } from '../../../shared/roles.ts';
import type { z } from 'zod';
import type {
  createRecordSchema,
  createTrainingSchema,
  TrainingItem,
  TrainingOverview,
  TrainingRecordItem,
  TrainingState,
  TrainingStatus,
  updateTrainingSchema,
} from '../../../shared/schemas/training.ts';
import { legalWarnDays } from '../facility/legal.ts';

/** 요청한 사람 */
export interface TrainingActor {
  id: number;
  role: Role;
}

/** trainings 한 줄 */
interface TrainingRow {
  id: number;
  name: string;
  cycle_months: number | null;
  description: string;
  legal_task_id: number | null;
  legal_title: string | null;
  active: number;
}

/** 직원 한 명 */
interface PersonRow {
  id: number;
  name: string;
  job_type: string;
}

/** (교육, 직원)별 최근 이수일과 건수 */
interface LastRow {
  training_id: number;
  user_id: number;
  last_on: string;
  n: number;
}

const TRAINING_SELECT = `SELECT t.id, t.name, t.cycle_months, t.description, t.legal_task_id, l.title AS legal_title, t.active
  FROM trainings t LEFT JOIN legal_tasks l ON l.id = t.legal_task_id`;

/** 다음 예정일: 최근 이수일 + 주기(개월). 둘 중 하나라도 없으면 null */
export function trainingNextDue(lastCompletedOn: string | null, cycleMonths: number | null): string | null {
  if (!lastCompletedOn || !cycleMonths) return null;
  return addMonths(lastCompletedOn, cycleMonths);
}

/** 상태 정하기: 기록 없음 → none, 주기 없음 → once, 지남 → overdue, 0일 → today, 알림 일수 안 → soon, 그 밖 → ok */
export function trainingState(input: { lastCompletedOn: string | null; cycleMonths: number | null; daysLeft: number | null }, warnDays: number): TrainingState {
  if (!input.lastCompletedOn) return 'none';
  if (!input.cycleMonths || input.daysLeft === null) return 'once';
  if (input.daysLeft < 0) return 'overdue';
  if (input.daysLeft === 0) return 'today';
  if (input.daysLeft <= warnDays) return 'soon';
  return 'ok';
}

/** 직원 한 명의 상태 한 줄을 만든다 */
export function buildStatus(person: PersonRow, cycleMonths: number | null, last: { last_on: string; n: number } | undefined, today: string, warnDays: number): TrainingStatus {
  const lastCompletedOn = last?.last_on ?? null;
  const nextDueOn = trainingNextDue(lastCompletedOn, cycleMonths);
  const daysLeft = nextDueOn ? dday(nextDueOn, today) : null;
  return {
    userId: person.id,
    userName: person.name,
    jobType: person.job_type,
    lastCompletedOn,
    nextDueOn,
    daysLeft,
    state: trainingState({ lastCompletedOn, cycleMonths, daysLeft }, warnDays),
    recordCount: last?.n ?? 0,
  };
}

/** 교육 항목 하나를 읽는다(없으면 404) */
function trainingRow(db: Db, id: number): TrainingRow {
  const row = db.get<TrainingRow>(`${TRAINING_SELECT} WHERE t.id = ?`, [id]);
  if (!row) throw new AppError('NOT_FOUND', { message: '찾는 교육 항목이 없어요.' });
  return row;
}

/** 상태를 볼 직원들: 실장 이상은 사용 중인 모든 직원, 직원은 본인만 */
function peopleFor(db: Db, actor: TrainingActor): PersonRow[] {
  if (can(actor.role, 'trainings.manage')) {
    return db.all<PersonRow>(
      "SELECT id, name, job_type FROM users WHERE active = 1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, name, id",
    );
  }
  return db.all<PersonRow>('SELECT id, name, job_type FROM users WHERE id = ?', [actor.id]);
}

/** (교육, 직원)별 최근 이수일 표 */
function lastRecords(db: Db, userIds: readonly number[] | null): Map<string, LastRow> {
  const where = userIds ? `WHERE user_id IN (${userIds.map(() => '?').join(', ') || 'NULL'})` : '';
  const rows = db.all<LastRow>(
    `SELECT training_id, user_id, MAX(completed_on) AS last_on, COUNT(*) AS n FROM training_records ${where} GROUP BY training_id, user_id`,
    userIds ? [...userIds] : [],
  );
  return new Map(rows.map((r) => [`${r.training_id}:${r.user_id}`, r]));
}

/** 교육 항목 한 줄을 화면 모양으로 */
function toItem(row: TrainingRow, people: readonly PersonRow[], last: Map<string, LastRow>, today: string, warnDays: number): TrainingItem {
  return {
    id: row.id,
    name: row.name,
    cycleMonths: row.cycle_months,
    description: row.description,
    legalTask: row.legal_task_id && row.legal_title ? { id: row.legal_task_id, title: row.legal_title } : null,
    active: row.active === 1,
    statuses: people.map((p) => buildStatus(p, row.cycle_months, last.get(`${row.id}:${p.id}`), today, warnDays)),
  };
}

/** GET /trainings: 교육 항목과 직원별 상태(직원은 본인 줄만). 끈 항목은 실장 이상에게만 보인다 */
export function listTrainings(db: Db, clock: Clock, actor: TrainingActor): TrainingOverview {
  const today = todayKst(clock);
  const warnDays = legalWarnDays(db);
  const manager = can(actor.role, 'trainings.manage');
  const people = peopleFor(db, actor);
  const last = lastRecords(db, manager ? null : people.map((p) => p.id));
  const rows = db.all<TrainingRow>(`${TRAINING_SELECT} ${manager ? '' : 'WHERE t.active = 1'} ORDER BY t.active DESC, t.name, t.id`);
  return {
    today,
    warnDays,
    trainings: rows.map((r) => toItem(r, people, last, today, warnDays)),
    people: people.map((p) => ({ id: p.id, name: p.name, jobType: p.job_type })),
  };
}

/** 법정 일정 번호가 있는지 확인한다(없으면 400) */
function checkLegalTask(db: Db, legalTaskId: number | null | undefined): void {
  if (legalTaskId == null) return;
  if (!db.get('SELECT 1 AS x FROM legal_tasks WHERE id = ?', [legalTaskId])) {
    throw new AppError('VALIDATION', { message: '연결할 법정 일정을 찾지 못했어요. 다시 골라 주세요.', fields: { legalTaskId: '법정 일정을 다시 골라 주세요.' } });
  }
}

/** 사용 중인 같은 이름 항목이 있으면 409 */
function checkDuplicateName(db: Db, name: string, exceptId: number | null): void {
  const dup = db.get('SELECT 1 AS x FROM trainings WHERE active = 1 AND lower(name) = lower(?) AND id <> ?', [name, exceptId ?? 0]);
  if (dup) throw new AppError('CONFLICT', { message: `"${name}" 교육 항목이 이미 있어요.`, fields: { name: '같은 이름의 교육 항목이 있어요.' } });
}

/** 한 항목의 화면 모양(요청한 사람 기준) */
export function getTrainingItem(db: Db, clock: Clock, actor: TrainingActor, id: number): TrainingItem {
  const row = trainingRow(db, id);
  const people = peopleFor(db, actor);
  const last = lastRecords(db, people.map((p) => p.id));
  return toItem(row, people, last, todayKst(clock), legalWarnDays(db));
}

/** POST /trainings: 교육 항목 만들기(실장 이상) */
export function createTraining(db: Db, clock: Clock, actor: TrainingActor, input: z.output<typeof createTrainingSchema>): TrainingItem {
  checkLegalTask(db, input.legalTaskId);
  checkDuplicateName(db, input.name, null);
  const now = clock.now().toISOString();
  const r = db.run('INSERT INTO trainings (name, cycle_months, description, legal_task_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)', [
    input.name,
    input.cycleMonths,
    input.description,
    input.legalTaskId,
    now,
    now,
  ]);
  return getTrainingItem(db, clock, actor, r.lastInsertRowid);
}

/** PATCH /trainings/:id: 보낸 칸만 바꾼다(실장 이상). active=false면 목록에서 끈다(기록은 남김) */
export function updateTraining(db: Db, clock: Clock, actor: TrainingActor, id: number, input: z.output<typeof updateTrainingSchema>): TrainingItem {
  const row = trainingRow(db, id);
  if (input.legalTaskId !== undefined) checkLegalTask(db, input.legalTaskId);
  const name = input.name ?? row.name;
  const active = input.active ?? row.active === 1;
  if (active) checkDuplicateName(db, name, id);
  db.run('UPDATE trainings SET name = ?, cycle_months = ?, description = ?, legal_task_id = ?, active = ?, updated_at = ? WHERE id = ?', [
    name,
    input.cycleMonths !== undefined ? input.cycleMonths : row.cycle_months,
    input.description ?? row.description,
    input.legalTaskId !== undefined ? input.legalTaskId : row.legal_task_id,
    active ? 1 : 0,
    clock.now().toISOString(),
    id,
  ]);
  return getTrainingItem(db, clock, actor, id);
}

/** 이수 기록 한 줄(조인 결과) */
interface RecordRow {
  id: number;
  training_id: number;
  user_id: number;
  user_name: string;
  completed_on: string;
  note: string;
  file_id: number | null;
  file_name: string | null;
  file_size: number | null;
  created_by: number | null;
  creator_name: string | null;
  created_at: string;
}

const RECORD_SELECT = `SELECT r.id, r.training_id, r.user_id, u.name AS user_name, r.completed_on, r.note, r.file_id, f.original_name AS file_name, f.size AS file_size,
    r.created_by, c.name AS creator_name, r.created_at
  FROM training_records r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN files f ON f.id = r.file_id
  LEFT JOIN users c ON c.id = r.created_by`;

function toRecord(r: RecordRow): TrainingRecordItem {
  return {
    id: r.id,
    trainingId: r.training_id,
    user: { id: r.user_id, name: r.user_name },
    completedOn: r.completed_on,
    note: r.note,
    file: r.file_id && r.file_name ? { id: r.file_id, name: r.file_name, size: r.file_size ?? 0 } : null,
    createdBy: r.created_by && r.creator_name ? { id: r.created_by, name: r.creator_name } : null,
    createdAt: r.created_at,
  };
}

/** GET /trainings/:id/records: 이수 기록(최근 것부터). 직원은 본인 것만, 실장 이상은 userId로 고를 수 있다 */
export function listRecords(db: Db, actor: TrainingActor, trainingId: number, userId?: number): TrainingRecordItem[] {
  trainingRow(db, trainingId);
  const manager = can(actor.role, 'trainings.manage');
  const who = manager ? userId : actor.id;
  const rows = db.all<RecordRow>(
    `${RECORD_SELECT} WHERE r.training_id = ? ${who !== undefined ? 'AND r.user_id = ?' : ''} ORDER BY r.completed_on DESC, r.id DESC`,
    who !== undefined ? [trainingId, who] : [trainingId],
  );
  return rows.map(toRecord);
}

/** 기록 한 건(없으면 404) */
export function getRecord(db: Db, id: number): TrainingRecordItem {
  const row = db.get<RecordRow>(`${RECORD_SELECT} WHERE r.id = ?`, [id]);
  if (!row) throw new AppError('NOT_FOUND', { message: '찾는 이수 기록이 없어요.' });
  return toRecord(row);
}

/** 기록을 남길 직원을 정한다: 비우면 본인, 다른 사람이면 실장 이상만. 사용 중인 직원이어야 한다 */
function recordTarget(db: Db, actor: TrainingActor, userId: number | undefined): PersonRow {
  const target = userId ?? actor.id;
  if (target !== actor.id && !can(actor.role, 'trainings.manage')) {
    throw new AppError('FORBIDDEN', { message: '다른 직원의 이수 기록은 실장님 이상만 입력할 수 있어요.' });
  }
  const person = db.get<PersonRow>('SELECT id, name, job_type FROM users WHERE id = ? AND active = 1', [target]);
  if (!person) throw new AppError('VALIDATION', { message: '기록할 직원을 찾지 못했어요. 다시 골라 주세요.', fields: { userId: '직원을 다시 골라 주세요.' } });
  return person;
}

/** 저장에 필요한 값 */
export interface TrainingEnv {
  db: Db;
  clock: Clock;
  dataDir: string;
}

/**
 * POST /trainings/:id/records: 이수 기록을 남긴다. file이 있으면 증빙 파일(purpose training)로 검사·저장한다.
 * 이수일은 오늘보다 뒤일 수 없다. 끈 교육 항목에는 기록하지 않는다. 돌려준 status는 저장 뒤의 그 직원 상태다.
 */
export function createRecord(
  env: TrainingEnv,
  actor: TrainingActor,
  trainingId: number,
  input: z.output<typeof createRecordSchema>,
  file?: { name: string; data: Buffer } | null,
): { record: TrainingRecordItem; status: TrainingStatus; training: { id: number; name: string; cycleMonths: number | null } } {
  const { db, clock } = env;
  const row = trainingRow(db, trainingId);
  if (row.active !== 1) throw new AppError('CONFLICT', { message: '사용하지 않는 교육 항목이에요. 실장님께 다시 켜 달라고 요청해 주세요.' });
  const person = recordTarget(db, actor, input.userId);
  const today = todayKst(clock);
  if (input.completedOn > today) {
    throw new AppError('VALIDATION', { message: '이수일은 오늘이나 그 전 날짜로 골라 주세요.', fields: { completedOn: '오늘이나 그 전 날짜로 골라 주세요.' } });
  }
  const id = db.tx(() => {
    const saved: FileRow | null = file ? saveUpload(env, { name: file.name, data: file.data, purpose: 'training', userId: actor.id }) : null;
    const r = db.run('INSERT INTO training_records (training_id, user_id, completed_on, file_id, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      trainingId,
      person.id,
      input.completedOn,
      saved?.id ?? null,
      input.note,
      actor.id,
      clock.now().toISOString(),
    ]);
    return r.lastInsertRowid;
  });
  const last = lastRecords(db, [person.id]).get(`${trainingId}:${person.id}`);
  return {
    record: getRecord(db, id),
    status: buildStatus(person, row.cycle_months, last, today, legalWarnDays(db)),
    training: { id: row.id, name: row.name, cycleMonths: row.cycle_months },
  };
}

/** DELETE /trainings/records/:id: 잘못 넣은 기록 지우기(본인 기록 또는 실장 이상). 증빙 파일 줄은 남긴다(백업과 함께 정리) */
export function deleteRecord(db: Db, actor: TrainingActor, id: number): TrainingRecordItem {
  const rec = getRecord(db, id);
  if (rec.user.id !== actor.id && !can(actor.role, 'trainings.manage')) {
    throw new AppError('FORBIDDEN', { message: '다른 직원의 이수 기록은 실장님 이상만 지울 수 있어요.' });
  }
  db.run('DELETE FROM training_records WHERE id = ?', [id]);
  return rec;
}

/** 증빙 파일 줄(기록에 딸린 것만). 직원은 본인 기록의 파일만 */
export function recordFile(db: Db, actor: TrainingActor, recordId: number): FileRow {
  const rec = getRecord(db, recordId);
  if (rec.user.id !== actor.id && !can(actor.role, 'trainings.manage')) throw new AppError('FORBIDDEN');
  const row = rec.file ? getFile(db, rec.file.id) : undefined;
  if (!row) throw new AppError('NOT_FOUND', { message: '이 기록에는 증빙 파일이 없어요.' });
  return row;
}

/** 임박 알림 대상 한 줄(scanner가 쓴다) */
export interface TrainingDue {
  trainingId: number;
  trainingName: string;
  userId: number;
  userName: string;
  nextDueOn: string;
  daysLeft: number;
}

/**
 * 다음 예정일이 알림 일수 안이거나 지난 (교육, 직원) 목록. 사용 중인 교육·직원만, 주기가 있는 교육만 본다.
 * only를 주면 그 짝만 확인한다(기록 저장 직후 바로 알릴 때).
 */
export function listTrainingDue(db: Db, clock: Clock, only?: { trainingId: number; userId: number }): TrainingDue[] {
  const today = todayKst(clock);
  const warnDays = legalWarnDays(db);
  const rows = db.all<{ training_id: number; name: string; cycle_months: number; user_id: number; user_name: string; last_on: string }>(
    `SELECT t.id AS training_id, t.name, t.cycle_months, u.id AS user_id, u.name AS user_name, MAX(r.completed_on) AS last_on
       FROM training_records r
       JOIN trainings t ON t.id = r.training_id AND t.active = 1 AND t.cycle_months IS NOT NULL
       JOIN users u ON u.id = r.user_id AND u.active = 1
      ${only ? 'WHERE r.training_id = ? AND r.user_id = ?' : ''}
      GROUP BY t.id, u.id
      ORDER BY t.id, u.id`,
    only ? [only.trainingId, only.userId] : [],
  );
  const out: TrainingDue[] = [];
  for (const r of rows) {
    const nextDueOn = addMonths(r.last_on, r.cycle_months);
    const daysLeft = dday(nextDueOn, today);
    if (daysLeft <= warnDays) out.push({ trainingId: r.training_id, trainingName: r.name, userId: r.user_id, userName: r.user_name, nextDueOn, daysLeft });
  }
  return out;
}

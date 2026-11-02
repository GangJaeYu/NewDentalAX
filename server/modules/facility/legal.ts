// 이 파일이 하는 일: 법정 의무 일정 API(backend.md §3.8, FR-100)와 그 처리 함수를 둔다.
// - GET /legal-tasks : 모든 항목(기본 템플릿 22개 + 직접 추가한 것)과 다음 예정일·D-day·상태. 모든 로그인 사용자
// - GET /legal-tasks/:id/logs : 수행 이력. 모든 로그인 사용자
// - POST /legal-tasks : 항목 추가(admin, legal.edit) / PATCH /legal-tasks/:id : 주기·확인 상태·적용 여부("해당 없음") 등 수정(admin)
// - POST /legal-tasks/:id/done : 수행 기록 { doneOn, note?, fileId? } (manager 이상, legal.done) → 최근 수행일·다음 예정일이 바뀐다
// 다음 예정일 = 최근 수행일 + 주기(개월·일). 꺼진 항목("해당 없음")은 대시보드용 목록(listLegalDue)과 알림에서 빠진다. 바꾼 내용은 감사 로그에 남긴다.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { addCycle, dday, isValidDate, todayKst } from '../../lib/dates.ts';
import { AppError } from '../../lib/errors.ts';
import { assertCan, auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { ensureLegalTemplates } from '../../db/seed/legal-templates.ts';
import {
  cycleLabel,
  LEGAL_APPLICABILITIES,
  LEGAL_CATEGORIES,
  LEGAL_VERIFY_STATUSES,
  LEGAL_WARN_DAYS_DEFAULT,
  type LegalApplicability,
  type LegalCategory,
  type LegalDueState,
  type LegalTask,
  type LegalTaskList,
  type LegalTaskLog,
  type LegalVerifyStatus,
} from '../../../shared/schemas/legal.ts';

/** DB 한 줄 */
interface LegalRow {
  id: number;
  template_key: string | null;
  title: string;
  category: LegalCategory;
  cycle_months: number | null;
  cycle_days: number | null;
  cycle_text: string | null;
  basis: string;
  source_url: string | null;
  verify_status: LegalVerifyStatus;
  applicability: LegalApplicability;
  applies_text: string | null;
  guidance: string | null;
  enabled: number;
  equipment_id: number | null;
  last_done_on: string | null;
  note: string | null;
  checked_on: string | null;
  updated_at: string;
}

const COLS =
  'id, template_key, title, category, cycle_months, cycle_days, cycle_text, basis, source_url, verify_status, applicability, applies_text, guidance, enabled, equipment_id, last_done_on, note, checked_on, updated_at';

// ---- 입력 검사 ----
const dateSchema = (what: string) =>
  z.string({ error: `${what}을 적어 주세요.` }).refine((v) => isValidDate(v), { error: `${what}은 2026-11-02처럼 적어 주세요.` });
const textOrNull = (max: number, what: string) =>
  z
    .string({ error: `${what}을 글자로 적어 주세요.` })
    .trim()
    .max(max, { error: `${what}은 ${max}자까지 적을 수 있어요.` })
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));
const cycleMonths = z
  .number({ error: '주기(개월)는 숫자로 적어 주세요.' })
  .int({ error: '주기(개월)는 정수로 적어 주세요.' })
  .min(1, { error: '주기(개월)는 1~120 사이로 적어 주세요.' })
  .max(120, { error: '주기(개월)는 1~120 사이로 적어 주세요.' })
  .nullable()
  .optional();
const cycleDays = z
  .number({ error: '주기(일)는 숫자로 적어 주세요.' })
  .int({ error: '주기(일)는 정수로 적어 주세요.' })
  .min(1, { error: '주기(일)는 1~3650 사이로 적어 주세요.' })
  .max(3650, { error: '주기(일)는 1~3650 사이로 적어 주세요.' })
  .nullable()
  .optional();
/** 출처 주소: http(s)만 받는다(누르면 다른 프로그램이 열리는 주소를 막음) */
const sourceUrl = z
  .string({ error: '출처 주소를 글자로 적어 주세요.' })
  .trim()
  .max(500, { error: '출처 주소는 500자까지 적을 수 있어요.' })
  .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), { error: '출처 주소는 https://로 시작하게 적어 주세요.' })
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const editableFields = {
  title: z.string({ error: '항목 이름을 적어 주세요.' }).trim().min(1, { error: '항목 이름을 적어 주세요.' }).max(80, { error: '항목 이름은 80자까지 적을 수 있어요.' }),
  category: z.enum(LEGAL_CATEGORIES, { error: '분류를 목록에서 골라 주세요.' }),
  cycleMonths,
  cycleDays,
  cycleText: textOrNull(100, '주기 설명'),
  basis: z.string({ error: '근거를 글자로 적어 주세요.' }).trim().max(200, { error: '근거는 200자까지 적을 수 있어요.' }),
  sourceUrl,
  verifyStatus: z.enum(LEGAL_VERIFY_STATUSES, { error: '확인 상태를 목록에서 골라 주세요.' }),
  applicability: z.enum(LEGAL_APPLICABILITIES, { error: '적용 조건을 목록에서 골라 주세요.' }),
  appliesText: textOrNull(100, '적용 조건 설명'),
  guidance: textOrNull(500, '설명'),
  enabled: z.boolean({ error: '적용 여부를 확인해 주세요.' }),
  note: textOrNull(500, '메모'),
};

/** 항목 추가 입력 */
export const createLegalSchema = z.object({
  title: editableFields.title,
  category: editableFields.category.default('other'),
  cycleMonths: editableFields.cycleMonths,
  cycleDays: editableFields.cycleDays,
  cycleText: editableFields.cycleText,
  basis: editableFields.basis.optional().default(''),
  sourceUrl: editableFields.sourceUrl,
  verifyStatus: editableFields.verifyStatus.default('needs_check'),
  applicability: editableFields.applicability.default('always'),
  appliesText: editableFields.appliesText,
  guidance: editableFields.guidance,
  note: editableFields.note,
  lastDoneOn: dateSchema('최근 수행일').nullable().optional(),
});

/** 항목 수정 입력(보낸 칸만 바꾼다) */
export const updateLegalSchema = z
  .object({
    title: editableFields.title.optional(),
    category: editableFields.category.optional(),
    cycleMonths: editableFields.cycleMonths,
    cycleDays: editableFields.cycleDays,
    cycleText: editableFields.cycleText,
    basis: editableFields.basis.optional(),
    sourceUrl: editableFields.sourceUrl,
    verifyStatus: editableFields.verifyStatus.optional(),
    applicability: editableFields.applicability.optional(),
    appliesText: editableFields.appliesText,
    guidance: editableFields.guidance,
    enabled: editableFields.enabled.optional(),
    note: editableFields.note,
  });

/** 수정할 수 없는 칸(예: 최근 수행일 — 수행 기록으로만 바뀐다)이 들어 있으면 그 칸마다 이유를 붙여 400 */
function rejectUnknownKeys(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const allowed = new Set(Object.keys(updateLegalSchema.shape));
  const bad = Object.keys(body).filter((k) => !allowed.has(k));
  if (bad.length) throw new AppError('VALIDATION', { fields: Object.fromEntries(bad.map((k) => [k, '바꿀 수 없는 칸이에요.'])) });
}

/** 수행 기록 입력 */
export const doneSchema = z.object({
  doneOn: dateSchema('수행일'),
  note: textOrNull(500, '메모'),
  fileId: z.number({ error: '첨부 파일 번호를 확인해 주세요.' }).int({ error: '첨부 파일 번호를 확인해 주세요.' }).positive({ error: '첨부 파일 번호를 확인해 주세요.' }).nullable().optional(),
});

const idParams = z.object({ id: z.coerce.number({ error: '항목 번호를 확인해 주세요.' }).int({ error: '항목 번호를 확인해 주세요.' }).positive({ error: '항목 번호를 확인해 주세요.' }) });

// ---- 계산 ----

/** 알림을 미리 보내는 일수(settings.legal.warnDays, 없거나 이상하면 30) */
export function legalWarnDays(db: Db): number {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'legal'");
  if (!row) return LEGAL_WARN_DAYS_DEFAULT;
  try {
    const v = (JSON.parse(row.value) as { warnDays?: unknown }).warnDays;
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 365 ? v : LEGAL_WARN_DAYS_DEFAULT;
  } catch {
    return LEGAL_WARN_DAYS_DEFAULT;
  }
}

/** 다음 예정일: 최근 수행일 + 주기. 주기나 수행일이 없으면 null */
export function nextDueOn(lastDoneOn: string | null, months: number | null, days: number | null): string | null {
  if (!lastDoneOn || (!months && !days)) return null;
  return addCycle(lastDoneOn, { months, days });
}

/** 남은 날로 일정 상태를 정한다 */
export function dueStateOf(input: { enabled: boolean; hasCycle: boolean; lastDoneOn: string | null; daysLeft: number | null }, warnDays: number): LegalDueState {
  if (!input.enabled) return 'off';
  if (!input.hasCycle) return 'no_cycle';
  if (!input.lastDoneOn || input.daysLeft === null) return 'first_needed';
  if (input.daysLeft < 0) return 'overdue';
  if (input.daysLeft === 0) return 'today';
  if (input.daysLeft <= 7) return 'soon';
  if (input.daysLeft <= warnDays) return 'upcoming';
  return 'ok';
}

/** DB 줄을 API 모양으로 바꾼다 */
function toTask(r: LegalRow, today: string, warnDays: number): LegalTask {
  const enabled = r.enabled === 1;
  const hasCycle = !!(r.cycle_months || r.cycle_days);
  const due = enabled ? nextDueOn(r.last_done_on, r.cycle_months, r.cycle_days) : null;
  const daysLeft = due ? dday(due, today) : null;
  return {
    id: r.id,
    templateKey: r.template_key,
    title: r.title,
    category: r.category,
    cycleMonths: r.cycle_months,
    cycleDays: r.cycle_days,
    cycleText: r.cycle_text || cycleLabel(r.cycle_months, r.cycle_days),
    basis: r.basis,
    sourceUrl: r.source_url,
    verifyStatus: r.verify_status,
    applicability: r.applicability,
    appliesText: r.applies_text,
    guidance: r.guidance,
    enabled,
    equipmentId: r.equipment_id,
    lastDoneOn: r.last_done_on,
    note: r.note,
    checkedOn: r.checked_on,
    nextDueOn: due,
    daysLeft,
    dueState: dueStateOf({ enabled, hasCycle, lastDoneOn: r.last_done_on, daysLeft }, warnDays),
    updatedAt: r.updated_at,
  };
}

/** 항목 하나를 읽는다(없으면 404) */
function getRow(db: Db, id: number): LegalRow {
  const r = db.get<LegalRow>(`SELECT ${COLS} FROM legal_tasks WHERE id = ?`, [id]);
  if (!r) throw new AppError('NOT_FOUND', { message: '찾는 법정 일정이 없어요. 화면을 새로 고쳐 주세요.' });
  return r;
}

/** 항목 하나를 API 모양으로 */
export function getLegalTask(db: Db, clock: Clock, id: number): LegalTask {
  return toTask(getRow(db, id), todayKst(clock), legalWarnDays(db));
}

/** 전체 목록(템플릿 순서 → 직접 추가한 순서). 빠진 템플릿이 있으면 먼저 채운다 */
export function listLegalTasks(db: Db, clock: Clock): LegalTaskList {
  ensureLegalTemplates(db, clock);
  const today = todayKst(clock);
  const warnDays = legalWarnDays(db);
  const rows = db.all<LegalRow>(`SELECT ${COLS} FROM legal_tasks ORDER BY id`);
  return { today, warnDays, items: rows.map((r) => toTask(r, today, warnDays)) };
}

/**
 * 대시보드·알림용: 켜진 항목 중 기한이 지났거나 알림 일수(기본 30일) 안에 든 것. 남은 날이 적은 순서.
 * "해당 없음"으로 끈 항목은 빠진다(FR-100 AC3, phase-03-task-08 AC3). 대시보드(phase-03-task-10)는 이 함수를 부른다.
 */
export function listLegalDue(db: Db, clock: Clock): LegalTask[] {
  const today = todayKst(clock);
  const warnDays = legalWarnDays(db);
  return db
    .all<LegalRow>(`SELECT ${COLS} FROM legal_tasks WHERE enabled = 1 AND last_done_on IS NOT NULL AND (cycle_months IS NOT NULL OR cycle_days IS NOT NULL)`)
    .map((r) => toTask(r, today, warnDays))
    .filter((t) => t.daysLeft !== null && t.daysLeft <= warnDays)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.id - b.id);
}

/** 수행 이력(최근 것부터) */
export function listLegalLogs(db: Db, id: number): LegalTaskLog[] {
  getRow(db, id);
  return db
    .all<{ id: number; done_on: string; note: string | null; file_id: number | null; user_id: number | null; user_name: string | null; created_at: string }>(
      `SELECT l.id, l.done_on, l.note, l.file_id, l.user_id, u.name AS user_name, l.created_at
       FROM legal_task_logs l LEFT JOIN users u ON u.id = l.user_id
       WHERE l.legal_task_id = ? ORDER BY l.done_on DESC, l.id DESC`,
      [id],
    )
    .map((r) => ({ id: r.id, doneOn: r.done_on, note: r.note, fileId: r.file_id, user: r.user_id === null ? null : { id: r.user_id, name: r.user_name ?? '알 수 없음' }, createdAt: r.created_at }));
}

/** 날짜가 오늘보다 뒤이면 400 */
function notFuture(date: string, clock: Clock, field: string): void {
  if (date > todayKst(clock)) throw new AppError('VALIDATION', { message: '앞으로의 날짜는 수행일로 적을 수 없어요.', fields: { [field]: '오늘이나 지난 날짜를 적어 주세요.' } });
}

/** 항목을 추가한다(admin). 최근 수행일을 함께 주면 이력 한 줄도 남긴다 */
export function createLegalTask(ctx: AuditContext & { user: { id: number; username: string } }, input: z.output<typeof createLegalSchema>): LegalTask {
  const { db, clock } = ctx;
  if (input.lastDoneOn) notFuture(input.lastDoneOn, clock, 'lastDoneOn');
  const now = clock.now().toISOString();
  const id = db.tx(() => {
    const r = db.run(
      `INSERT INTO legal_tasks (template_key, title, category, cycle_months, cycle_days, cycle_text, basis, source_url, verify_status, applicability, applies_text, guidance, enabled, last_done_on, note, checked_on, created_at, updated_at)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?)`,
      [
        input.title,
        input.category,
        input.cycleMonths ?? null,
        input.cycleDays ?? null,
        input.cycleText ?? null,
        input.basis,
        input.sourceUrl ?? null,
        input.verifyStatus,
        input.applicability,
        input.appliesText ?? null,
        input.guidance ?? null,
        input.lastDoneOn ?? null,
        input.note ?? null,
        now,
        now,
      ],
    );
    const newId = r.lastInsertRowid;
    if (input.lastDoneOn) {
      db.run('INSERT INTO legal_task_logs (legal_task_id, done_on, note, file_id, user_id, created_at) VALUES (?, ?, ?, NULL, ?, ?)', [newId, input.lastDoneOn, '항목을 추가할 때 적은 최근 수행일', ctx.user.id, now]);
    }
    return newId;
  });
  const task = getLegalTask(db, clock, id);
  audit(ctx, 'legal.create', 'legal_task', id, { title: task.title, cycleMonths: task.cycleMonths, cycleDays: task.cycleDays, verifyStatus: task.verifyStatus, nextDueOn: task.nextDueOn });
  return task;
}

/** API 칸 이름 → DB 열 이름 */
const FIELD_COLUMNS: Record<keyof z.output<typeof updateLegalSchema>, keyof LegalRow> = {
  title: 'title',
  category: 'category',
  cycleMonths: 'cycle_months',
  cycleDays: 'cycle_days',
  cycleText: 'cycle_text',
  basis: 'basis',
  sourceUrl: 'source_url',
  verifyStatus: 'verify_status',
  applicability: 'applicability',
  appliesText: 'applies_text',
  guidance: 'guidance',
  enabled: 'enabled',
  note: 'note',
};

/**
 * 항목을 고친다(admin). 보낸 칸만 바꾸고, 주기를 바꾸면 다음 예정일을 다시 계산한다(phase-03-task-08 AC4).
 * 주기 숫자만 바꾸고 주기 설명을 보내지 않으면, 예전 설명이 틀리지 않게 설명을 비워 숫자로 보여 준다.
 * 감사 로그(legal.update)에 바뀐 칸의 전·후 값과 다음 예정일 전·후를 남긴다. 바뀐 것이 없으면 그대로 돌려준다.
 */
export function updateLegalTask(ctx: AuditContext, id: number, input: z.output<typeof updateLegalSchema>): LegalTask {
  const { db, clock } = ctx;
  const before = getRow(db, id);
  const beforeTask = getLegalTask(db, clock, id);
  const patch: Partial<Record<keyof LegalRow, unknown>> = {};
  for (const [k, v] of Object.entries(input) as Array<[keyof typeof FIELD_COLUMNS, unknown]>) {
    if (v === undefined) continue;
    const col = FIELD_COLUMNS[k];
    const value = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    if (before[col] !== value) patch[col] = value;
  }
  const cycleChanged = 'cycle_months' in patch || 'cycle_days' in patch;
  if (cycleChanged && input.cycleText === undefined && before.cycle_text !== null) patch.cycle_text = null;
  const cols = Object.keys(patch) as Array<keyof LegalRow>;
  if (cols.length === 0) return beforeTask;
  db.run(`UPDATE legal_tasks SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [
    ...cols.map((c) => patch[c] as string | number | null),
    clock.now().toISOString(),
    id,
  ]);
  const after = getLegalTask(db, clock, id);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const c of cols) changes[c] = { from: before[c], to: patch[c] };
  audit(ctx, 'legal.update', 'legal_task', id, { title: after.title, changes, nextDueOn: { from: beforeTask.nextDueOn, to: after.nextDueOn } });
  return after;
}

/**
 * 수행 기록을 남긴다(manager 이상). 최근 수행일은 기록 중 가장 늦은 날로 둔다(예전 기록을 늦게 적어도 예정일이 뒤로 가지 않음).
 * "해당 없음"으로 끈 항목이나 앞으로의 날짜는 받지 않는다. 첨부 파일 번호는 있는 파일이어야 한다.
 */
export function recordLegalDone(ctx: AuditContext & { user: { id: number; username: string } }, id: number, input: z.output<typeof doneSchema>): LegalTask {
  const { db, clock } = ctx;
  const row = getRow(db, id);
  if (row.enabled !== 1) throw new AppError('CONFLICT', { message: '"해당 없음"으로 끈 항목이에요. 관리자가 다시 켠 뒤 기록해 주세요.' });
  notFuture(input.doneOn, clock, 'doneOn');
  if (input.fileId != null && !db.get('SELECT id FROM files WHERE id = ?', [input.fileId])) {
    throw new AppError('VALIDATION', { fields: { fileId: '첨부 파일을 찾을 수 없어요. 다시 올려 주세요.' } });
  }
  const now = clock.now().toISOString();
  const beforeDue = getLegalTask(db, clock, id).nextDueOn;
  db.tx(() => {
    db.run('INSERT INTO legal_task_logs (legal_task_id, done_on, note, file_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, input.doneOn, input.note ?? null, input.fileId ?? null, ctx.user.id, now]);
    const last = row.last_done_on && row.last_done_on > input.doneOn ? row.last_done_on : input.doneOn;
    db.run('UPDATE legal_tasks SET last_done_on = ?, updated_at = ? WHERE id = ?', [last, now, id]);
  });
  const after = getLegalTask(db, clock, id);
  audit(ctx, 'legal.done', 'legal_task', id, { title: after.title, doneOn: input.doneOn, nextDueOn: { from: beforeDue, to: after.nextDueOn } });
  return after;
}

/** 법정 일정 API를 등록한다(routes.ts가 부른다) */
export function registerLegalRoutes(app: FastifyInstance): void {
  app.get('/legal-tasks', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { data: listLegalTasks(app.db, app.clock) };
  });

  app.get('/legal-tasks/:id/logs', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    reply.header('cache-control', 'no-store');
    return { data: listLegalLogs(app.db, id) };
  });

  app.post('/legal-tasks', async (req, reply) => {
    assertCan(req, 'legal.edit');
    const input = parseInput(createLegalSchema, req.body);
    const ctx = auditCtx(req);
    const task = createLegalTask({ ...ctx, user: { id: currentUser(req).id, username: currentUser(req).username } }, input);
    reply.code(201);
    return { data: task };
  });

  app.patch('/legal-tasks/:id', async (req) => {
    assertCan(req, 'legal.edit');
    const { id } = parseInput(idParams, req.params);
    rejectUnknownKeys(req.body);
    const input = parseInput(updateLegalSchema, req.body);
    return { data: updateLegalTask(auditCtx(req), id, input) };
  });

  app.post('/legal-tasks/:id/done', async (req) => {
    assertCan(req, 'legal.done');
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(doneSchema, req.body);
    const u = currentUser(req);
    return { data: recordLegalDone({ ...auditCtx(req), user: { id: u.id, username: u.username } }, id, input) };
  });
}

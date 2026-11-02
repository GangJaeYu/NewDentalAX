// 이 파일이 하는 일: 장비 점검·유지보수 API(backend.md §3.8, FR-101)와 그 처리 함수를 둔다.
// - GET /equipment : 장비 목록과 마지막 점검일·다음 점검일·D-day·상태(모든 로그인 사용자)
// - GET /equipment/:id : 장비 하나 + 점검·수리 이력 + 연결된 법정 일정(장비 대장 인쇄에도 씀, 모든 로그인 사용자)
// - POST /equipment · PATCH /equipment/:id : 장비 등록·수정(manager 이상, equipment.manage — 주소별 권한 표가 먼저 막음)
// - GET/POST /equipment/:id/logs : 점검·수리 이력 보기·남기기(모든 로그인 사용자). POST는 JSON 또는 multipart(첨부 파일 1개, purpose equipment)
// 다음 점검일 = 마지막 점검일(점검 기록이 없으면 설치일) + 점검 주기(개월). 대시보드(phase-03-task-10)는 listEquipmentDue를 부른다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { addCycle, dday, isValidDate, todayKst } from '../../lib/dates.ts';
import { AppError } from '../../lib/errors.ts';
import { readUpload, saveUpload } from '../../lib/files.ts';
import { auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import {
  EQUIPMENT_KINDS,
  EQUIPMENT_LOG_KINDS,
  EQUIPMENT_WARN_DAYS,
  type Equipment,
  type EquipmentDetail,
  type EquipmentDueState,
  type EquipmentKind,
  type EquipmentLegalLink,
  type EquipmentList,
  type EquipmentLog,
  type EquipmentLogKind,
} from '../../../shared/schemas/equipment.ts';

/** DB 한 줄(장비 + 이력 요약) */
interface EquipmentRow {
  id: number;
  name: string;
  kind: EquipmentKind;
  installed_on: string | null;
  vendor_name: string | null;
  inspect_cycle_months: number | null;
  memo: string | null;
  active: number;
  updated_at: string;
  last_inspection_on: string | null;
  last_repair_on: string | null;
  log_count: number;
  repair_cost_total: number | null;
}

const SELECT_EQUIPMENT = `
  SELECT e.id, e.name, e.kind, e.installed_on, e.vendor_name, e.inspect_cycle_months, e.memo, e.active, e.updated_at,
    (SELECT MAX(l.date) FROM equipment_logs l WHERE l.equipment_id = e.id AND l.kind = 'inspection') AS last_inspection_on,
    (SELECT MAX(l.date) FROM equipment_logs l WHERE l.equipment_id = e.id AND l.kind = 'repair') AS last_repair_on,
    (SELECT COUNT(*) FROM equipment_logs l WHERE l.equipment_id = e.id) AS log_count,
    (SELECT SUM(l.cost) FROM equipment_logs l WHERE l.equipment_id = e.id AND l.kind = 'repair') AS repair_cost_total
  FROM equipment e`;

// ---- 입력 검사 ----
const dateSchema = (what: string) =>
  z.string({ error: `${what}를 적어 주세요.` }).refine((v) => isValidDate(v), { error: `${what}는 2026-11-02처럼 적어 주세요.` });
const textOrNull = (max: number, what: string) =>
  z
    .string({ error: `${what}을 글자로 적어 주세요.` })
    .trim()
    .max(max, { error: `${what}은 ${max}자까지 적을 수 있어요.` })
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));
const cycleMonths = z
  .number({ error: '점검 주기(개월)는 숫자로 적어 주세요.' })
  .int({ error: '점검 주기(개월)는 정수로 적어 주세요.' })
  .min(1, { error: '점검 주기(개월)는 1~120 사이로 적어 주세요.' })
  .max(120, { error: '점검 주기(개월)는 1~120 사이로 적어 주세요.' })
  .nullable()
  .optional();
const nameSchema = z.string({ error: '장비 이름을 적어 주세요.' }).trim().min(1, { error: '장비 이름을 적어 주세요.' }).max(60, { error: '장비 이름은 60자까지 적을 수 있어요.' });
const kindSchema = z.enum(EQUIPMENT_KINDS, { error: '장비 종류를 목록에서 골라 주세요.' });

/** 장비 등록 입력 */
export const createEquipmentSchema = z.object({
  name: nameSchema,
  kind: kindSchema,
  installedOn: dateSchema('설치일').nullable().optional(),
  vendorName: textOrNull(60, '업체 이름'),
  inspectCycleMonths: cycleMonths,
  memo: textOrNull(500, '메모'),
});

/** 장비 수정 입력(보낸 칸만 바꾼다) */
export const updateEquipmentSchema = z.strictObject(
  {
    name: nameSchema.optional(),
    kind: kindSchema.optional(),
    installedOn: dateSchema('설치일').nullable().optional(),
    vendorName: textOrNull(60, '업체 이름'),
    inspectCycleMonths: cycleMonths,
    memo: textOrNull(500, '메모'),
    active: z.boolean({ error: '사용 여부를 확인해 주세요.' }).optional(),
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? '바꿀 수 없는 칸이 들어 있어요.' : undefined) },
);

/** 숫자 칸: JSON 숫자 또는 multipart 글자('12000')를 받는다. 빈칸이면 null */
const looseInt = (what: string, max: number) =>
  z
    .union([z.number(), z.string(), z.null()], { error: `${what}은 숫자로 적어 주세요.` })
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === null || v === '') return null;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
      if (!Number.isInteger(n) || n < 0 || n > max) {
        ctx.addIssue({ code: 'custom', message: `${what}은 0 이상 정수로 적어 주세요.` });
        return z.NEVER;
      }
      return n;
    });

/** 점검·수리 이력 입력 */
export const equipmentLogSchema = z.object({
  date: dateSchema('일자'),
  kind: z.enum(EQUIPMENT_LOG_KINDS, { error: '점검인지 수리인지 골라 주세요.' }),
  content: z.string({ error: '내용을 적어 주세요.' }).trim().min(1, { error: '내용을 적어 주세요.' }).max(500, { error: '내용은 500자까지 적을 수 있어요.' }),
  cost: looseInt('비용', 1_000_000_000),
  vendorName: textOrNull(60, '업체 이름'),
  fileId: looseInt('첨부 파일 번호', Number.MAX_SAFE_INTEGER),
});

const idParams = z.object({ id: z.coerce.number({ error: '장비 번호를 확인해 주세요.' }).int({ error: '장비 번호를 확인해 주세요.' }).positive({ error: '장비 번호를 확인해 주세요.' }) });

// ---- 계산 ----

/** 다음 점검일: 기준일(마지막 점검일, 없으면 설치일) + 주기(개월). 주기나 기준일이 없으면 null */
export function nextInspectionOn(lastInspectionOn: string | null, installedOn: string | null, cycleMonths: number | null): { base: 'inspection' | 'installed' | null; next: string | null } {
  if (!cycleMonths) return { base: null, next: null };
  if (lastInspectionOn) return { base: 'inspection', next: addCycle(lastInspectionOn, { months: cycleMonths }) };
  if (installedOn) return { base: 'installed', next: addCycle(installedOn, { months: cycleMonths }) };
  return { base: null, next: null };
}

/** 남은 날로 점검 상태를 정한다 */
export function equipmentDueState(input: { active: boolean; hasCycle: boolean; daysLeft: number | null }, warnDays = EQUIPMENT_WARN_DAYS): EquipmentDueState {
  if (!input.active) return 'off';
  if (!input.hasCycle) return 'no_cycle';
  if (input.daysLeft === null) return 'first_needed';
  if (input.daysLeft < 0) return 'overdue';
  if (input.daysLeft === 0) return 'today';
  if (input.daysLeft <= 7) return 'soon';
  if (input.daysLeft <= warnDays) return 'upcoming';
  return 'ok';
}

/** DB 줄을 API 모양으로 바꾼다 */
function toEquipment(r: EquipmentRow, today: string): Equipment {
  const active = r.active === 1;
  const { base, next } = nextInspectionOn(r.last_inspection_on, r.installed_on, r.inspect_cycle_months);
  const daysLeft = next ? dday(next, today) : null;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    installedOn: r.installed_on,
    vendorName: r.vendor_name,
    inspectCycleMonths: r.inspect_cycle_months,
    memo: r.memo,
    active,
    lastInspectionOn: r.last_inspection_on,
    lastRepairOn: r.last_repair_on,
    dueBase: base,
    nextInspectionOn: next,
    daysLeft,
    dueState: equipmentDueState({ active, hasCycle: !!r.inspect_cycle_months, daysLeft }),
    logCount: r.log_count,
    repairCostTotal: r.repair_cost_total ?? 0,
    updatedAt: r.updated_at,
  };
}

/** 장비 줄을 읽는다(없으면 404) */
function getRow(db: Db, id: number): EquipmentRow {
  const r = db.get<EquipmentRow>(`${SELECT_EQUIPMENT} WHERE e.id = ?`, [id]);
  if (!r) throw new AppError('NOT_FOUND', { message: '찾는 장비가 없어요. 화면을 새로 고쳐 주세요.' });
  return r;
}

/** 장비 하나를 API 모양으로 */
export function getEquipment(db: Db, clock: Clock, id: number): Equipment {
  return toEquipment(getRow(db, id), todayKst(clock));
}

/** 장비 목록(사용 중 → 이름 순). 사용 중지한 장비도 함께 돌려준다(화면에서 거른다) */
export function listEquipment(db: Db, clock: Clock): EquipmentList {
  const today = todayKst(clock);
  const rows = db.all<EquipmentRow>(`${SELECT_EQUIPMENT} ORDER BY e.active DESC, e.name, e.id`);
  return { today, warnDays: EQUIPMENT_WARN_DAYS, items: rows.map((r) => toEquipment(r, today)) };
}

/**
 * 대시보드·알림용: 사용 중인 장비 중 다음 점검일이 지났거나 30일 안에 든 것. 남은 날이 적은 순서.
 * 대시보드(phase-03-task-10)의 "다가오는 점검·의무 일정" 카드가 이 함수를 부른다.
 */
export function listEquipmentDue(db: Db, clock: Clock, warnDays = EQUIPMENT_WARN_DAYS): Equipment[] {
  const today = todayKst(clock);
  return db
    .all<EquipmentRow>(`${SELECT_EQUIPMENT} WHERE e.active = 1 AND e.inspect_cycle_months IS NOT NULL`)
    .map((r) => toEquipment(r, today))
    .filter((e) => e.daysLeft !== null && e.daysLeft <= warnDays)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.id - b.id);
}

/** 점검·수리 이력(최근 것부터) */
export function listEquipmentLogs(db: Db, id: number): EquipmentLog[] {
  getRow(db, id);
  return db
    .all<{
      id: number;
      equipment_id: number;
      date: string;
      kind: EquipmentLogKind;
      content: string;
      cost: number | null;
      vendor_name: string | null;
      file_id: number | null;
      file_name: string | null;
      user_id: number | null;
      user_name: string | null;
      created_at: string;
    }>(
      `SELECT l.id, l.equipment_id, l.date, l.kind, l.content, l.cost, l.vendor_name, l.file_id, f.original_name AS file_name, l.user_id, u.name AS user_name, l.created_at
       FROM equipment_logs l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN files f ON f.id = l.file_id
       WHERE l.equipment_id = ? ORDER BY l.date DESC, l.id DESC`,
      [id],
    )
    .map((r) => ({
      id: r.id,
      equipmentId: r.equipment_id,
      date: r.date,
      kind: r.kind,
      content: r.content,
      cost: r.cost,
      vendorName: r.vendor_name,
      file: r.file_id === null ? null : { id: r.file_id, name: r.file_name ?? '첨부 파일' },
      user: r.user_id === null ? null : { id: r.user_id, name: r.user_name ?? '알 수 없음' },
      createdAt: r.created_at,
    }));
}

/** 이 장비에 연결된 법정 일정(legal_tasks.equipment_id). 다음 예정일 = 최근 수행일 + 주기 */
export function listEquipmentLegal(db: Db, id: number): EquipmentLegalLink[] {
  return db
    .all<{ id: number; title: string; last_done_on: string | null; cycle_months: number | null; cycle_days: number | null }>(
      'SELECT id, title, last_done_on, cycle_months, cycle_days FROM legal_tasks WHERE equipment_id = ? AND enabled = 1 ORDER BY id',
      [id],
    )
    .map((r) => ({
      id: r.id,
      title: r.title,
      lastDoneOn: r.last_done_on,
      nextDueOn: r.last_done_on && (r.cycle_months || r.cycle_days) ? addCycle(r.last_done_on, { months: r.cycle_months, days: r.cycle_days }) : null,
    }));
}

/** 장비 상세(장비 + 이력 + 법정 일정) */
export function getEquipmentDetail(db: Db, clock: Clock, id: number): EquipmentDetail {
  return { today: todayKst(clock), equipment: getEquipment(db, clock, id), logs: listEquipmentLogs(db, id), legalTasks: listEquipmentLegal(db, id) };
}

/** 날짜가 오늘보다 뒤이면 400 */
function notFuture(date: string, clock: Clock, field: string, what: string): void {
  if (date > todayKst(clock)) throw new AppError('VALIDATION', { message: `앞으로의 날짜는 ${what}로 적을 수 없어요.`, fields: { [field]: '오늘이나 지난 날짜를 적어 주세요.' } });
}

/** 장비를 등록한다(manager 이상) */
export function createEquipment(ctx: AuditContext, input: z.output<typeof createEquipmentSchema>): Equipment {
  const { db, clock } = ctx;
  if (input.installedOn) notFuture(input.installedOn, clock, 'installedOn', '설치일');
  const now = clock.now().toISOString();
  const r = db.run(
    'INSERT INTO equipment (name, kind, installed_on, vendor_name, inspect_cycle_months, memo, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [input.name, input.kind, input.installedOn ?? null, input.vendorName ?? null, input.inspectCycleMonths ?? null, input.memo ?? null, now, now],
  );
  const eq = getEquipment(db, clock, r.lastInsertRowid);
  audit(ctx, 'equipment.create', 'equipment', eq.id, { name: eq.name, kind: eq.kind, inspectCycleMonths: eq.inspectCycleMonths });
  return eq;
}

/** API 칸 이름 → DB 열 이름 */
const FIELD_COLUMNS = {
  name: 'name',
  kind: 'kind',
  installedOn: 'installed_on',
  vendorName: 'vendor_name',
  inspectCycleMonths: 'inspect_cycle_months',
  memo: 'memo',
  active: 'active',
} as const satisfies Record<keyof z.output<typeof updateEquipmentSchema>, keyof EquipmentRow>;

/** 장비를 고친다(manager 이상). 보낸 칸만 바꾸고, 바뀐 칸의 전·후 값을 감사 로그에 남긴다 */
export function updateEquipment(ctx: AuditContext, id: number, input: z.output<typeof updateEquipmentSchema>): Equipment {
  const { db, clock } = ctx;
  const before = getRow(db, id);
  if (input.installedOn) notFuture(input.installedOn, clock, 'installedOn', '설치일');
  const patch: Partial<Record<keyof EquipmentRow, string | number | null>> = {};
  for (const [k, v] of Object.entries(input) as Array<[keyof typeof FIELD_COLUMNS, unknown]>) {
    if (v === undefined) continue;
    const col = FIELD_COLUMNS[k];
    const value = typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null);
    if (before[col] !== value) patch[col] = value;
  }
  const cols = Object.keys(patch) as Array<keyof EquipmentRow>;
  if (cols.length === 0) return getEquipment(db, clock, id);
  db.run(`UPDATE equipment SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...cols.map((c) => patch[c] ?? null), clock.now().toISOString(), id]);
  const after = getEquipment(db, clock, id);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const c of cols) changes[c] = { from: before[c], to: patch[c] };
  audit(ctx, 'equipment.update', 'equipment', id, { name: after.name, changes });
  return after;
}

/** 점검·수리 이력을 남긴다(모든 로그인 사용자). 앞으로의 날짜는 받지 않는다. 첨부 파일 번호는 장비용으로 올린 파일이어야 한다 */
export function addEquipmentLog(ctx: AuditContext & { user: { id: number; username: string } }, id: number, input: z.output<typeof equipmentLogSchema>): EquipmentLog {
  const { db, clock } = ctx;
  const eq = getRow(db, id);
  notFuture(input.date, clock, 'date', '일자');
  if (input.fileId != null && !db.get("SELECT id FROM files WHERE id = ? AND purpose = 'equipment'", [input.fileId])) {
    throw new AppError('VALIDATION', { fields: { fileId: '첨부 파일을 찾을 수 없어요. 다시 올려 주세요.' } });
  }
  const now = clock.now().toISOString();
  const r = db.run(
    'INSERT INTO equipment_logs (equipment_id, date, kind, content, cost, vendor_name, file_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.date, input.kind, input.content, input.cost, input.vendorName ?? null, input.fileId ?? null, ctx.user.id, now],
  );
  db.run('UPDATE equipment SET updated_at = ? WHERE id = ?', [now, id]);
  const after = getEquipment(db, clock, id);
  audit(ctx, 'equipment.log', 'equipment', id, { name: eq.name, kind: input.kind, date: input.date, cost: input.cost, nextInspectionOn: after.nextInspectionOn });
  const log = listEquipmentLogs(db, id).find((l) => l.id === r.lastInsertRowid);
  if (!log) throw new AppError('INTERNAL');
  return log;
}

/** 요청한 사람(감사 기록 + 기록자) */
function actorCtx(req: FastifyRequest) {
  const u = currentUser(req);
  return { ...auditCtx(req), user: { id: u.id, username: u.username } };
}

/** 장비 API를 등록한다(routes.ts가 부른다). 파일 받기(multipart)는 routes.ts가 이 플러그인 범위에 건다 */
export function registerEquipmentRoutes(app: FastifyInstance): void {
  app.get('/equipment', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { data: listEquipment(app.db, app.clock) };
  });

  app.get('/equipment/:id', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    reply.header('cache-control', 'no-store');
    return { data: getEquipmentDetail(app.db, app.clock, id) };
  });

  app.post('/equipment', async (req, reply) => {
    const input = parseInput(createEquipmentSchema, req.body);
    reply.code(201);
    return { data: createEquipment(auditCtx(req), input) };
  });

  app.patch('/equipment/:id', async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(updateEquipmentSchema, req.body);
    return { data: updateEquipment(auditCtx(req), id, input) };
  });

  app.get('/equipment/:id/logs', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    reply.header('cache-control', 'no-store');
    return { data: listEquipmentLogs(app.db, id) };
  });

  app.post('/equipment/:id/logs', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const ctx = actorCtx(req);
    let body: unknown = req.body;
    if (req.isMultipart()) {
      // 첨부 파일과 글 칸을 함께 받는다. 장비가 없으면 파일을 저장하기 전에 404
      getRow(app.db, id);
      const part = await readUpload(req);
      const fields = parseInput(equipmentLogSchema.omit({ fileId: true }), part.fields);
      notFuture(fields.date, app.clock, 'date', '일자');
      const file = saveUpload({ db: app.db, clock: app.clock, dataDir: app.dataDir }, { name: part.name, data: part.data, purpose: 'equipment', userId: ctx.user.id });
      body = { ...part.fields, fileId: file.id };
    }
    const input = parseInput(equipmentLogSchema, body);
    reply.code(201);
    return { data: addEquipmentLog(ctx, id, input) };
  });
}

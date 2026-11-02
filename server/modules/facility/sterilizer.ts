// 이 파일이 하는 일: 멸균기 점검 기록 API(backend.md §3.8, FR-102)와 그 처리 함수를 둔다.
// - GET /sterilizer-logs?equipmentId&from&to : 기간 기록 + 기간과 관계없이 조치 전인 불합격 기록 + 멸균기 목록(모든 로그인 사용자)
// - POST /sterilizer-logs : 기록 남기기(B&D·BI·CI·사이클, 온도·압력·시간, 판정). "불합격"이면 manager 이상에게 즉시 알림(sterilizer_fail)
// - POST /sterilizer-logs/:id/action : 불합격 조치 내용 기록 { actionTaken } → 조치 전 경고에서 빠진다
// - GET /sterilizer-logs/export?equipmentId&from&to : 기간 기록 CSV(UTF-8 BOM, 수식 주입 방지)
// 입력 칸에 환자 관련 칸은 없다(FR-102 AC1). 대시보드(phase-03-task-10)는 listOpenSterilizerFailures를 불러 조치 전 불합격을 경고로 보여 준다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { addDays, daysBetween, isValidDate, todayKst } from '../../lib/dates.ts';
import { AppError } from '../../lib/errors.ts';
import { csvDownloadHeaders, toCsv } from '../../lib/csv.ts';
import { auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { emitNotification } from '../notifications/emit.ts';
import {
  STERILIZER_DEFAULT_DAYS,
  STERILIZER_MAX_RANGE_DAYS,
  STERILIZER_RESULT_LABELS,
  STERILIZER_RESULTS,
  STERILIZER_TEST_LABELS,
  STERILIZER_TEST_TYPES,
  type SterilizerLog,
  type SterilizerLogList,
  type SterilizerOption,
  type SterilizerResult,
  type SterilizerTestType,
} from '../../../shared/schemas/equipment.ts';

/** DB 한 줄(+ 장비 이름·사람 이름) */
interface LogRow {
  id: number;
  equipment_id: number;
  equipment_name: string;
  date: string;
  test_type: SterilizerTestType;
  cycle_no: string | null;
  temp_c: number | null;
  pressure_kpa: number | null;
  minutes: number | null;
  result: SterilizerResult;
  action_taken: string | null;
  action_at: string | null;
  action_user_id: number | null;
  action_user_name: string | null;
  user_id: number | null;
  user_name: string | null;
  created_at: string;
}

const SELECT_LOG = `
  SELECT s.id, s.equipment_id, e.name AS equipment_name, s.date, s.test_type, s.cycle_no, s.temp_c, s.pressure_kpa, s.minutes, s.result,
    s.action_taken, s.action_at, s.action_user_id, au.name AS action_user_name, s.user_id, u.name AS user_name, s.created_at
  FROM sterilizer_logs s
  JOIN equipment e ON e.id = s.equipment_id
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN users au ON au.id = s.action_user_id`;

/** DB 줄을 API 모양으로 */
function toLog(r: LogRow): SterilizerLog {
  return {
    id: r.id,
    equipmentId: r.equipment_id,
    equipmentName: r.equipment_name,
    date: r.date,
    testType: r.test_type,
    cycleNo: r.cycle_no,
    tempC: r.temp_c,
    pressureKpa: r.pressure_kpa,
    minutes: r.minutes,
    result: r.result,
    actionTaken: r.action_taken,
    actionAt: r.action_at,
    actionUser: r.action_user_id === null ? null : { id: r.action_user_id, name: r.action_user_name ?? '알 수 없음' },
    user: r.user_id === null ? null : { id: r.user_id, name: r.user_name ?? '알 수 없음' },
    createdAt: r.created_at,
  };
}

// ---- 입력 검사 ----
const dateSchema = z.string({ error: '날짜를 적어 주세요.' }).refine((v) => isValidDate(v), { error: '날짜는 2026-11-02처럼 적어 주세요.' });
/** 숫자 칸(빈칸이면 null). 범위를 벗어나면 이유를 붙인다 */
const measure = (what: string, unit: string, min: number, max: number) =>
  z
    .number({ error: `${what}는 숫자로 적어 주세요.` })
    .min(min, { error: `${what}는 ${min}~${max}${unit} 사이로 적어 주세요.` })
    .max(max, { error: `${what}는 ${min}~${max}${unit} 사이로 적어 주세요.` })
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? null : v));
const actionText = z
  .string({ error: '조치 내용을 글자로 적어 주세요.' })
  .trim()
  .max(500, { error: '조치 내용은 500자까지 적을 수 있어요.' })
  .nullable()
  .optional()
  .transform((v) => (v === undefined || v === null || v === '' ? null : v));

/**
 * 멸균 기록 입력. 칸 목록은 shared STERILIZER_INPUT_FIELDS와 같다(환자 관련 칸 없음, FR-102 AC1).
 * 모르는 칸(예: 환자 이름)이 들어오면 저장하지 않고 400으로 돌려보낸다.
 */
export const sterilizerLogSchema = z.strictObject(
  {
    equipmentId: z.number({ error: '멸균기를 골라 주세요.' }).int({ error: '멸균기를 골라 주세요.' }).positive({ error: '멸균기를 골라 주세요.' }),
    date: dateSchema,
    testType: z.enum(STERILIZER_TEST_TYPES, { error: '검사 종류를 골라 주세요.' }),
    cycleNo: z
      .string({ error: '사이클 번호를 글자로 적어 주세요.' })
      .trim()
      .max(30, { error: '사이클 번호는 30자까지 적을 수 있어요.' })
      .nullable()
      .optional()
      .transform((v) => (v === undefined || v === null || v === '' ? null : v)),
    tempC: measure('온도', '℃', 0, 200),
    pressureKpa: measure('압력', 'kPa', -110, 400),
    minutes: measure('시간', '분', 0, 600),
    result: z.enum(STERILIZER_RESULTS, { error: '판정(합격·불합격)을 골라 주세요.' }),
    actionTaken: actionText,
  },
  { error: (iss) => (iss.code === 'unrecognized_keys' ? '멸균 기록에 없는 칸이 들어 있어요. 환자 정보는 적지 않아요.' : undefined) },
);

/** 조치 기록 입력 */
export const actionSchema = z.object({
  actionTaken: z.string({ error: '조치 내용을 적어 주세요.' }).trim().min(1, { error: '조치 내용을 적어 주세요.' }).max(500, { error: '조치 내용은 500자까지 적을 수 있어요.' }),
});

/** 조회 조건(기간·멸균기) */
export const listQuerySchema = z.object({
  equipmentId: z.coerce.number({ error: '멸균기 번호를 확인해 주세요.' }).int({ error: '멸균기 번호를 확인해 주세요.' }).positive({ error: '멸균기 번호를 확인해 주세요.' }).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

const idParams = z.object({ id: z.coerce.number({ error: '기록 번호를 확인해 주세요.' }).int({ error: '기록 번호를 확인해 주세요.' }).positive({ error: '기록 번호를 확인해 주세요.' }) });

/** 조회 기간을 정한다. 없으면 오늘 포함 지난 30일, 거꾸로거나 너무 길면 400 */
export function resolveRange(q: { from?: string; to?: string }, clock: Clock): { from: string; to: string } {
  const today = todayKst(clock);
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -(STERILIZER_DEFAULT_DAYS - 1));
  if (from > to) throw new AppError('VALIDATION', { message: '시작일이 끝일보다 늦어요.', fields: { from: '시작일을 끝일보다 앞으로 골라 주세요.' } });
  if (daysBetween(from, to) + 1 > STERILIZER_MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION', { message: `한 번에 ${STERILIZER_MAX_RANGE_DAYS}일까지 볼 수 있어요.`, fields: { from: '기간을 줄여 주세요.' } });
  }
  return { from, to };
}

// ---- 조회 ----

/** 멸균기 목록(종류가 멸균기인 장비, 사용 중 먼저) */
export function listSterilizers(db: Db): SterilizerOption[] {
  return db
    .all<{ id: number; name: string; active: number }>("SELECT id, name, active FROM equipment WHERE kind = 'sterilizer' ORDER BY active DESC, name, id")
    .map((r) => ({ id: r.id, name: r.name, active: r.active === 1 }));
}

/** 기간 기록(날짜 → 입력 순서). 인쇄·CSV가 같은 함수를 쓴다 */
export function listSterilizerLogs(db: Db, range: { from: string; to: string }, equipmentId?: number | null): SterilizerLog[] {
  const where = ['s.date >= ?', 's.date <= ?'];
  const params: Array<string | number> = [range.from, range.to];
  if (equipmentId) {
    where.push('s.equipment_id = ?');
    params.push(equipmentId);
  }
  return db.all<LogRow>(`${SELECT_LOG} WHERE ${where.join(' AND ')} ORDER BY s.date, s.id`, params).map(toLog);
}

/**
 * 조치 전인 불합격 기록(result = fail AND action_at IS NULL), 오래된 것부터.
 * 대시보드(phase-03-task-10)가 경고 카드로 쓴다. 조치를 기록하면 이 목록에서 빠진다(FR-102 AC2).
 */
export function listOpenSterilizerFailures(db: Db): SterilizerLog[] {
  return db.all<LogRow>(`${SELECT_LOG} WHERE s.result = 'fail' AND s.action_at IS NULL ORDER BY s.date, s.id`).map(toLog);
}

/** 기록 하나(없으면 404) */
export function getSterilizerLog(db: Db, id: number): SterilizerLog {
  const r = db.get<LogRow>(`${SELECT_LOG} WHERE s.id = ?`, [id]);
  if (!r) throw new AppError('NOT_FOUND', { message: '찾는 멸균 기록이 없어요. 화면을 새로 고쳐 주세요.' });
  return toLog(r);
}

/** 화면용 목록 응답 */
export function sterilizerLogList(db: Db, clock: Clock, q: z.output<typeof listQuerySchema>): SterilizerLogList {
  const range = resolveRange(q, clock);
  return {
    today: todayKst(clock),
    from: range.from,
    to: range.to,
    equipmentId: q.equipmentId ?? null,
    items: listSterilizerLogs(db, range, q.equipmentId),
    openFailures: listOpenSterilizerFailures(db),
    sterilizers: listSterilizers(db),
  };
}

// ---- 기록 ----

/** 불합격 알림 내용(manager 이상, 즉시). 같은 기록은 한 번만 간다 */
function notifyFailure(db: Db, clock: Clock, log: SterilizerLog): number {
  return emitNotification(
    db,
    {
      type: 'sterilizer_fail',
      role: 'manager',
      title: `${log.equipmentName} ${STERILIZER_TEST_LABELS[log.testType]} 불합격이에요`,
      body: `${log.date}${log.cycleNo ? ` · 사이클 ${log.cycleNo}` : ''} · 기록 ${log.user?.name ?? '-'}. 조치 내용을 기록해 주세요.`,
      link: `/facility/sterilizer?focus=${log.id}`,
      dedupeKey: `sterilizer-fail:${log.id}`,
    },
    clock,
  );
}

/**
 * 멸균 기록을 남긴다(모든 로그인 사용자, 담당자 = 기록한 사람). 멸균기는 사용 중인 "멸균기" 종류 장비여야 한다.
 * 불합격이면 manager 이상에게 바로 알림을 보낸다. 조치 내용을 함께 적으면 조치도 바로 기록된다.
 */
export function addSterilizerLog(ctx: AuditContext & { user: { id: number; username: string } }, input: z.output<typeof sterilizerLogSchema>): { log: SterilizerLog; notified: number } {
  const { db, clock } = ctx;
  const eq = db.get<{ id: number; kind: string; active: number }>('SELECT id, kind, active FROM equipment WHERE id = ?', [input.equipmentId]);
  if (!eq || eq.kind !== 'sterilizer') throw new AppError('VALIDATION', { fields: { equipmentId: '멸균기를 목록에서 골라 주세요.' } });
  if (eq.active !== 1) throw new AppError('VALIDATION', { fields: { equipmentId: '사용 중지한 멸균기예요. 다른 멸균기를 골라 주세요.' } });
  if (input.date > todayKst(clock)) throw new AppError('VALIDATION', { message: '앞으로의 날짜는 기록할 수 없어요.', fields: { date: '오늘이나 지난 날짜를 적어 주세요.' } });
  const now = clock.now().toISOString();
  const action = input.result === 'fail' ? input.actionTaken : null;
  const r = db.run(
    `INSERT INTO sterilizer_logs (equipment_id, date, test_type, cycle_no, temp_c, pressure_kpa, minutes, result, action_taken, action_at, action_user_id, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.equipmentId, input.date, input.testType, input.cycleNo, input.tempC, input.pressureKpa, input.minutes, input.result, action, action ? now : null, action ? ctx.user.id : null, ctx.user.id, now],
  );
  const log = getSterilizerLog(db, r.lastInsertRowid);
  audit(ctx, 'sterilizer.log', 'sterilizer_log', log.id, { equipment: log.equipmentName, date: log.date, testType: log.testType, result: log.result });
  const notified = log.result === 'fail' ? notifyFailure(db, clock, log) : 0;
  return { log, notified };
}

/** 불합격 기록에 조치 내용을 남긴다. 합격 기록이나 이미 조치한 기록이면 409 */
export function recordSterilizerAction(ctx: AuditContext & { user: { id: number; username: string } }, id: number, input: z.output<typeof actionSchema>): SterilizerLog {
  const { db, clock } = ctx;
  const before = getSterilizerLog(db, id);
  if (before.result !== 'fail') throw new AppError('CONFLICT', { message: '합격한 기록에는 조치를 적지 않아요.' });
  if (before.actionAt) throw new AppError('CONFLICT', { message: '이미 조치를 기록했어요. 화면을 새로 고쳐 주세요.' });
  db.run('UPDATE sterilizer_logs SET action_taken = ?, action_at = ?, action_user_id = ? WHERE id = ?', [input.actionTaken, clock.now().toISOString(), ctx.user.id, id]);
  const after = getSterilizerLog(db, id);
  audit(ctx, 'sterilizer.action', 'sterilizer_log', id, { equipment: after.equipmentName, date: after.date, testType: after.testType });
  return after;
}

// ---- CSV ----

/** CSV 열 이름 */
export const STERILIZER_CSV_HEADER = ['날짜', '멸균기', '검사 종류', '사이클 번호', '온도(℃)', '압력(kPa)', '시간(분)', '판정', '담당자', '조치 내용', '조치 시각', '조치한 사람'] as const;

/** 기간 기록을 CSV 글로 만든다 */
export function sterilizerCsv(logs: readonly SterilizerLog[]): string {
  return toCsv([
    STERILIZER_CSV_HEADER,
    ...logs.map((l) => [
      l.date,
      l.equipmentName,
      STERILIZER_TEST_LABELS[l.testType],
      l.cycleNo,
      l.tempC,
      l.pressureKpa,
      l.minutes,
      STERILIZER_RESULT_LABELS[l.result],
      l.user?.name ?? '',
      l.actionTaken,
      l.actionAt,
      l.actionUser?.name ?? '',
    ]),
  ]);
}

/** 요청한 사람(감사 기록 + 기록자) */
function actorCtx(req: FastifyRequest) {
  const u = currentUser(req);
  return { ...auditCtx(req), user: { id: u.id, username: u.username } };
}

/** 멸균기 기록 API를 등록한다(routes.ts가 부른다) */
export function registerSterilizerRoutes(app: FastifyInstance): void {
  app.get('/sterilizer-logs', async (req, reply) => {
    const q = parseInput(listQuerySchema, req.query);
    reply.header('cache-control', 'no-store');
    return { data: sterilizerLogList(app.db, app.clock, q) };
  });

  app.get('/sterilizer-logs/export', async (req, reply) => {
    const q = parseInput(listQuerySchema, req.query);
    const range = resolveRange(q, app.clock);
    const logs = listSterilizerLogs(app.db, range, q.equipmentId);
    const name = `멸균기록_${range.from}_${range.to}.csv`;
    audit(auditCtx(req), 'sterilizer.export', 'sterilizer_log', null, { from: range.from, to: range.to, rows: logs.length });
    reply.headers(csvDownloadHeaders(`sterilizer-logs_${range.from}_${range.to}.csv`, name));
    return reply.send(sterilizerCsv(logs));
  });

  app.post('/sterilizer-logs', async (req, reply) => {
    const input = parseInput(sterilizerLogSchema, req.body);
    const { log, notified } = addSterilizerLog(actorCtx(req), input);
    reply.code(201);
    return { data: log, notified };
  });

  app.post('/sterilizer-logs/:id/action', async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(actionSchema, req.body);
    return { data: recordSterilizerAction(actorCtx(req), id, input) };
  });
}

// 이 파일이 하는 일: 연차·휴가 API(backend.md §3.7 leave, FR-080)를 등록한다. 처리 내용은 leave.ts에 있다.
// - GET /leave?mine=1&status=&year= : 목록(직원은 늘 본인 것만) · POST /leave : 본인 신청
// - POST /leave/:id/decide {approve, reason?} : 승인·반려(실장 이상, 주소별 권한 표 leave.approve가 먼저 막는다) → {request, warnings}
// - POST /leave/:id/cancel : 본인 신청 취소(승인 대기일 때만)
// - GET /leave/allowances?year= : 부여·사용·잔여(직원은 본인 줄만) · PUT /leave/allowances : 부여 일수 저장(admin) · GET/PUT /settings/leave(admin)
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.ts';
import { todayKst } from '../../lib/dates.ts';
import { assertCan, auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { createLeaveSchema, decideLeaveSchema, LEAVE_STATUSES, leaveSettingsSchema, saveAllowancesSchema } from '../../../shared/schemas/leave.ts';
import { allowanceTable, cancelLeave, createLeave, decideLeave, listLeave, readLeaveSettings, saveAllowances, saveLeaveSettings, type LeaveActor } from './leave.ts';

const idParams = z.object({ id: z.coerce.number({ error: '신청 번호를 확인해 주세요.' }).int({ error: '신청 번호를 확인해 주세요.' }).positive({ error: '신청 번호를 확인해 주세요.' }) });

const yearField = z.coerce.number({ error: '연도를 확인해 주세요.' }).int({ error: '연도를 확인해 주세요.' }).min(2000, { error: '연도를 확인해 주세요.' }).max(2100, { error: '연도를 확인해 주세요.' });

const listQuery = z.object({
  mine: z.enum(['0', '1'], { error: 'mine은 0 또는 1이에요.' }).optional(),
  status: z.enum(LEAVE_STATUSES, { error: '상태를 목록에서 골라 주세요.' }).optional(),
  year: yearField.optional(),
});

const yearQuery = z.object({ year: yearField.optional() });

/** 세션 사용자 → 처리 함수에 넘길 모양 */
function actorOf(req: FastifyRequest): LeaveActor {
  const u = currentUser(req);
  return { id: u.id, name: u.name, role: u.role };
}

/** 연차·휴가 API를 등록한다 */
export function registerLeaveRoutes(app: FastifyInstance): void {
  app.get('/leave', async (req) => {
    const q = parseInput(listQuery, req.query);
    return { data: listLeave(app.db, actorOf(req), { mine: q.mine === '1', status: q.status, year: q.year }) };
  });

  app.post('/leave', async (req, reply) => {
    assertCan(req, 'leave.request');
    const input = parseInput(createLeaveSchema, req.body);
    const item = createLeave(app.db, app.clock, actorOf(req), input);
    audit(auditCtx(req), 'leave.request', 'leave_request', item.id, { type: item.type, startOn: item.startOn, endOn: item.endOn, days: item.days });
    reply.code(201);
    return { data: item };
  });

  app.post('/leave/:id/decide', async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(decideLeaveSchema, req.body);
    const result = decideLeave(app.db, app.clock, actorOf(req), id, input);
    audit(auditCtx(req), input.approve ? 'leave.approve' : 'leave.reject', 'leave_request', id, { userId: result.request.user.id, days: result.request.days, warnings: result.warnings.length });
    return { data: result };
  });

  app.post('/leave/:id/cancel', async (req) => {
    const { id } = parseInput(idParams, req.params);
    const item = cancelLeave(app.db, actorOf(req), id);
    audit(auditCtx(req), 'leave.cancel', 'leave_request', id, { days: item.days });
    return { data: item };
  });

  app.get('/leave/allowances', async (req) => {
    const q = parseInput(yearQuery, req.query);
    const year = q.year ?? Number(todayKst(app.clock).slice(0, 4));
    return { data: allowanceTable(app.db, actorOf(req), year) };
  });

  app.put('/leave/allowances', async (req) => {
    const input = parseInput(saveAllowancesSchema, req.body);
    const saved = saveAllowances(app.db, input);
    audit(auditCtx(req), 'leave.allowance.update', 'leave_allowances', input.year, { count: saved });
    return { data: allowanceTable(app.db, actorOf(req), input.year) };
  });

  app.get('/settings/leave', async () => ({ data: readLeaveSettings(app.db) }));

  app.put('/settings/leave', async (req) => {
    const input = parseInput(leaveSettingsSchema, req.body);
    const saved = saveLeaveSettings(app.db, app.clock, input);
    audit(auditCtx(req), 'settings.leave.update', 'settings', 'leave', { ...saved });
    return { data: saved };
  });
}

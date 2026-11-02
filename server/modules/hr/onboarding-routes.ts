// 이 파일이 하는 일: 신규 직원 온보딩 API(backend.md §3.7 onboarding, FR-083)를 등록한다. 처리 내용은 onboarding.ts에 있다.
// - GET /onboarding/templates?jobType= · POST /onboarding/templates · PATCH /onboarding/templates/:id : 템플릿(onboarding.manage, 실장 이상)
//   AI 초안(기능 onboarding, POST /api/ai/run)을 화면에서 고친 뒤 source='ai'로 저장한다.
// - GET /onboarding/assignments : 배정 목록(실장 이상은 전부, 그 밖에는 본인·멘토인 것) · GET /onboarding/assignments/:id
// - POST /onboarding/assignments : 배정(실장 이상) · DELETE /onboarding/assignments/:id : 배정 지우기(실장 이상)
// - POST /onboarding/assignments/:id/items/:idx {done} : 항목 체크·해제(배정받은 본인 또는 담당 멘토) → 바뀐 진행률
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.ts';
import { assertCan, auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { JOB_TYPES } from '../../../shared/enums.ts';
import { checkItemSchema, createAssignmentSchema, createTemplateSchema, updateTemplateSchema } from '../../../shared/schemas/onboarding.ts';
import {
  checkItem,
  createAssignment,
  createTemplate,
  deleteAssignment,
  getAssignment,
  listAssignments,
  listTemplates,
  updateTemplate,
  type OnboardingActor,
} from './onboarding.ts';

const num = (label: string) => z.coerce.number({ error: `${label}를 확인해 주세요.` }).int({ error: `${label}를 확인해 주세요.` });
const idParams = z.object({ id: num('번호').positive({ error: '번호를 확인해 주세요.' }) });
const itemParams = z.object({ id: num('번호').positive({ error: '번호를 확인해 주세요.' }), idx: num('항목 번호').min(0, { error: '항목 번호를 확인해 주세요.' }) });
const templateQuery = z.object({ jobType: z.enum(JOB_TYPES, { error: '직무를 목록에서 골라 주세요.' }).optional() });

/** 세션 사용자 → 처리 함수에 넘길 모양 */
function actorOf(req: FastifyRequest): OnboardingActor {
  const u = currentUser(req);
  return { id: u.id, role: u.role };
}

/** 온보딩 API를 등록한다 */
export function registerOnboardingRoutes(app: FastifyInstance): void {
  app.get('/onboarding/templates', async (req) => {
    assertCan(req, 'onboarding.manage');
    const q = parseInput(templateQuery, req.query);
    return { data: listTemplates(app.db, { jobType: q.jobType }) };
  });

  app.post('/onboarding/templates', async (req, reply) => {
    assertCan(req, 'onboarding.manage');
    const input = parseInput(createTemplateSchema, req.body);
    const tpl = createTemplate(app.db, app.clock, actorOf(req), input);
    audit(auditCtx(req), 'onboarding.template.create', 'onboarding_template', tpl.id, { jobType: tpl.jobType, items: tpl.items.length, source: tpl.source });
    reply.code(201);
    return { data: tpl };
  });

  app.patch('/onboarding/templates/:id', async (req) => {
    assertCan(req, 'onboarding.manage');
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(updateTemplateSchema, req.body);
    const tpl = updateTemplate(app.db, app.clock, id, input);
    audit(auditCtx(req), 'onboarding.template.update', 'onboarding_template', id, { items: tpl.items.length, active: tpl.active });
    return { data: tpl };
  });

  app.get('/onboarding/assignments', async (req) => ({ data: listAssignments(app.db, actorOf(req)) }));

  app.get('/onboarding/assignments/:id', async (req) => {
    const { id } = parseInput(idParams, req.params);
    return { data: getAssignment(app.db, actorOf(req), id) };
  });

  app.post('/onboarding/assignments', async (req, reply) => {
    assertCan(req, 'onboarding.manage');
    const input = parseInput(createAssignmentSchema, req.body);
    const a = createAssignment(app.db, app.clock, actorOf(req), input);
    audit(auditCtx(req), 'onboarding.assign', 'onboarding_assignment', a.id, { userId: a.user.id, mentorId: a.mentor.id, templateId: a.templateId, items: a.total });
    reply.code(201);
    return { data: a };
  });

  app.delete('/onboarding/assignments/:id', async (req) => {
    assertCan(req, 'onboarding.manage');
    const { id } = parseInput(idParams, req.params);
    const a = deleteAssignment(app.db, actorOf(req), id);
    audit(auditCtx(req), 'onboarding.unassign', 'onboarding_assignment', id, { userId: a.user.id, done: a.done, total: a.total });
    return { data: a };
  });

  app.post('/onboarding/assignments/:id/items/:idx', async (req) => {
    const { id, idx } = parseInput(itemParams, req.params);
    const { done } = parseInput(checkItemSchema, req.body);
    const a = checkItem(app.db, app.clock, actorOf(req), id, idx, done);
    audit(auditCtx(req), done ? 'onboarding.item.check' : 'onboarding.item.uncheck', 'onboarding_assignment', id, { index: idx, percent: a.percent });
    return { data: a };
  });
}

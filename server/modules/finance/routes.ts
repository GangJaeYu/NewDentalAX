// 이 파일이 하는 일: finance 모듈의 지출·월간 요약 API(backend.md §3.9, FR-110·111)를 등록한다. 경로는 '/api'가 붙은 채로 등록된다. 모두 실장 이상(M)이다.
// - GET /expenses?month=YYYY-MM|all&categoryId&page&pageSize → { data, total, sum, month } · 달을 비우면 이번 달(서버 시계) · ?format=csv → CSV 내려받기(UTF-8 BOM)
// - POST /expenses → 201 { data } · GET/PATCH/DELETE /expenses/:id · POST/DELETE /expenses/:id/file(영수증 첨부, multipart)
// - GET /expense-categories → { data } · PUT /expense-categories { categories[] } → { data }
// - GET /finance/monthly?month= → { data: {total, byCategory, prevMonth, prevYear, topVendors, materialTrend12} }
// - POST /finance/monthly/summary { month } → AI 월간 요약(서버가 집계 숫자만 만들어 보낸다)
// 주소별 권한은 server/auth/api-permissions.ts 표가 먼저 막는다. 표에 없는 첨부·AI 주소는 여기서 requireCap으로 막는다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditCtx, currentUser, requireCap } from '../../auth/guard.ts';
import { readUpload, registerUploads } from '../../lib/files.ts';
import { csvDownloadHeaders } from '../../lib/csv.ts';
import { thisMonthKst } from '../../lib/dates.ts';
import { parseInput } from '../../security/validate.ts';
import { baseUrlsFromEnv, type AiOptions } from '../../ai/types.ts';
import type { AiCallContext } from '../../ai/gateway.ts';
import { categoriesPutSchema, expenseCreateSchema, expensePatchSchema, monthField } from '../../../shared/schemas/finance.ts';
import {
  attachReceipt,
  createExpense,
  deleteExpense,
  expensesCsv,
  getExpense,
  listCategories,
  listExpenses,
  monthlySummary,
  putCategories,
  removeReceipt,
  runMonthlyAi,
  updateExpense,
} from './service.ts';

const idParam = z.object({ id: z.coerce.number({ error: '번호가 올바르지 않아요.' }).int('번호가 올바르지 않아요.').positive('번호가 올바르지 않아요.') });
const listQuery = z.object({
  month: z.union([monthField, z.literal('all')]).optional(),
  categoryId: z.coerce.number({ error: '분류를 다시 골라 주세요.' }).int().positive('분류를 다시 골라 주세요.').optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500, '한 번에 500개까지 볼 수 있어요.').optional(),
  format: z.enum(['json', 'csv'], { error: '형식은 json 또는 csv예요.' }).optional(),
});
const monthQuery = z.object({ month: monthField.optional() });
const summaryBody = z.object({ month: monthField }).strict();

/** 이 서버의 AI 실행 옵션(테스트가 buildApp에 넣은 값, 없으면 환경 변수 AI_BASE_URL_*) */
function aiOptions(app: FastifyInstance): AiOptions {
  return app.aiOptions ?? { baseUrls: baseUrlsFromEnv() };
}

/** 게이트웨이에 넘길 맥락 */
function callCtx(app: FastifyInstance, req: FastifyRequest): AiCallContext {
  return { db: app.db, clock: app.clock, dataDir: app.dataDir, options: aiOptions(app), user: currentUser(req) };
}

/** finance 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  // 이 플러그인 범위에서만 multipart(영수증 올리기)를 받는다
  await registerUploads(app);
  const manage = { preHandler: requireCap('expenses.manage') };
  const fileEnv = () => ({ db: app.db, clock: app.clock, dataDir: app.dataDir });

  // 목록(최근 날짜부터) 또는 CSV
  app.get('/expenses', async (req, reply) => {
    const q = parseInput(listQuery, req.query);
    const month = q.month === 'all' ? undefined : (q.month ?? thisMonthKst(app.clock));
    if (q.format === 'csv') {
      const { csv } = expensesCsv(app.db, { month, categoryId: q.categoryId });
      return reply.headers(csvDownloadHeaders(`expenses-${month ?? 'all'}.csv`, `지출-${month ?? '전체'}.csv`)).send(csv);
    }
    return { ...listExpenses(app.db, { ...q, month }), month: month ?? null };
  });

  app.post('/expenses', async (req, reply) => {
    const input = parseInput(expenseCreateSchema, req.body);
    return reply.code(201).send({ data: createExpense(auditCtx(req), input) });
  });

  app.get('/expenses/:id', async (req) => ({ data: getExpense(app.db, parseInput(idParam, req.params).id) }));

  app.patch('/expenses/:id', async (req) => {
    const { id } = parseInput(idParam, req.params);
    return { data: updateExpense(auditCtx(req), id, parseInput(expensePatchSchema, req.body)) };
  });

  app.delete('/expenses/:id', async (req, reply) => {
    const { id } = parseInput(idParam, req.params);
    deleteExpense(auditCtx(req), id);
    return reply.code(204).send();
  });

  // 영수증 첨부(파일 하나, PDF·JPG·PNG). 권한 표에 없는 주소라 여기서 막는다
  app.post('/expenses/:id/file', manage, async (req) => {
    const { id } = parseInput(idParam, req.params);
    getExpense(app.db, id); // 없는 지출이면 파일을 읽기 전에 404
    const part = await readUpload(req);
    return { data: attachReceipt(fileEnv(), auditCtx(req), id, { name: part.name, data: part.data }) };
  });

  app.delete('/expenses/:id/file', manage, async (req) => {
    const { id } = parseInput(idParam, req.params);
    return { data: removeReceipt(fileEnv(), auditCtx(req), id) };
  });

  app.get('/expense-categories', async () => ({ data: listCategories(app.db) }));

  app.put('/expense-categories', async (req) => ({ data: putCategories(auditCtx(req), parseInput(categoriesPutSchema, req.body)) }));

  // 월간 요약(달을 비우면 이번 달)
  app.get('/finance/monthly', async (req) => {
    const q = parseInput(monthQuery, req.query);
    return { data: monthlySummary(app.db, q.month ?? thisMonthKst(app.clock)) };
  });

  // AI 월간 요약: 집계 숫자만 보낸다. 게이트웨이도 기능 권한(ai.monthly_summary)·켜짐·예산을 다시 확인한다
  app.post('/finance/monthly/summary', { preHandler: requireCap('finance.monthly') }, async (req) => {
    const { month } = parseInput(summaryBody, req.body);
    return { data: await runMonthlyAi(callCtx(app, req), month) };
  });
}

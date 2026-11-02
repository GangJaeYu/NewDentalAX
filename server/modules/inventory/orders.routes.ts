// 이 파일이 하는 일: 발주서 API(backend.md §3.5, FR-054)를 등록한다. 경로 앞에는 '/api'가 붙는다.
// 초안 만들기·목록·상세·수정·발주함·취소·입고 처리다. 모두 실장 이상(cap orders.manage)이고, 권한은 주소별 권한 표(server/auth/api-permissions.ts)가 막는다.
// 입력은 모두 zod로 검사한다. "지출로도 기록"(alsoExpense)은 지출 테이블이 생기기 전이라 받지 않는다(보내면 400).
// inventory 모듈 플러그인(routes.ts)이 이 파일을 함께 등록한다.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditCtx } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { ORDER_STATUSES, orderPatchSchema, orderReceiveSchema } from '../../../shared/schemas/orders.ts';
import { cancelOrder, createDrafts, getOrder, listOrders, placeOrder, receiveOrder, updateOrder } from './orders.service.ts';

const idParam = z.object({ id: z.coerce.number({ error: '번호가 올바르지 않아요.' }).int().positive('번호가 올바르지 않아요.') });
const listQuery = z.object({
  status: z.enum([...ORDER_STATUSES, 'all', 'open'], { error: '상태 필터를 다시 골라 주세요.' }).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200, '한 번에 200개까지 볼 수 있어요.').optional(),
});
const emptyBody = z.union([z.object({}).strict(), z.undefined(), z.null()]);

/** 발주서 API를 등록한다 */
export default async function orderRoutes(app: FastifyInstance): Promise<void> {
  // 초안 만들기: 부족·곧 부족 품목을 거래처별로 묶은 발주서(작성 중). { data: { orders, skipped } }
  app.post('/orders/draft', async (req, reply) => {
    parseInput(emptyBody, req.body);
    const result = createDrafts(auditCtx(req));
    reply.code(result.orders.length ? 201 : 200);
    return { data: result };
  });

  // 목록(최근 것부터). { data, total, counts }
  app.get('/orders', async (req) => listOrders(app.db, parseInput(listQuery, req.query)));

  // 상세(인쇄 화면도 이것을 쓴다)
  app.get('/orders/:id', async (req) => ({ data: getOrder(app.db, app.clock, parseInput(idParam, req.params).id) }));

  // 수정(작성 중일 때만)
  app.patch('/orders/:id', async (req) => {
    const { id } = parseInput(idParam, req.params);
    return { data: updateOrder(auditCtx(req), id, parseInput(orderPatchSchema, req.body)) };
  });

  // 발주함(작성 중 → 발주함)
  app.post('/orders/:id/order', async (req) => {
    const { id } = parseInput(idParam, req.params);
    parseInput(emptyBody, req.body);
    return { data: placeOrder(auditCtx(req), id) };
  });

  // 취소(작성 중·발주함 → 취소)
  app.post('/orders/:id/cancel', async (req) => {
    const { id } = parseInput(idParam, req.params);
    parseInput(emptyBody, req.body);
    return { data: cancelOrder(auditCtx(req), id) };
  });

  // 입고 처리(발주함 → 입고 완료): 줄마다 입고 기록, 한 트랜잭션
  app.post('/orders/:id/receive', async (req) => {
    const { id } = parseInput(idParam, req.params);
    return { data: receiveOrder(auditCtx(req), id, parseInput(orderReceiveSchema, req.body)) };
  });
}

// 이 파일이 하는 일: inventory 모듈의 품목·입출고·거래처·단가 API(backend.md §3.5)를 등록한다. 경로 앞에는 '/api'가 붙는다.
// 품목 등록·수정·삭제와 거래처 등록·수정은 주소별 권한 표(server/auth/api-permissions.ts)가 실장 이상만 통과시킨다.
// 입출고는 모든 로그인 사용자가 기록하고, 재고 조정(adjust)만 실장 이상(cap inventory.adjust)이다. 입력은 모두 zod로 검사한다.
// 발주서·CSV·명세서 입고 API는 phase-03-task-02·03-03·04-08이 이 폴더에 따로 파일을 더한다. 이 파일을 import하면 재고 알림 scanner도 등록된다.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertCan, auditCtx } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { isValidDate } from '../../lib/dates.ts';
import { itemCreateSchema, itemPatchSchema, MOVE_TYPES, moveSchema, vendorCreateSchema, vendorPatchSchema } from '../../../shared/schemas/inventory.ts';
import {
  createItem,
  createVendor,
  deleteItem,
  getItemDetail,
  listItems,
  listMoves,
  listPrices,
  listVendors,
  recordMove,
  updateItem,
  updateVendor,
} from './service.ts';
import './notify.ts';
import orderRoutes from './orders.routes.ts';
import csvRoutes, { sendMovesCsv } from './csv-routes.ts';
import receiptRoutes from './receipt.routes.ts';

const idParam = z.object({ id: z.coerce.number({ error: '번호가 올바르지 않아요.' }).int().positive('번호가 올바르지 않아요.') });
const pageFields = {
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200, '한 번에 200개까지 볼 수 있어요.').optional(),
};
const optId = z.coerce.number().int().positive().optional();
const day = z
  .string()
  .refine((s) => isValidDate(s), '날짜는 2026-11-02 형식으로 적어 주세요.')
  .optional();

const itemsQuery = z.object({
  q: z.string().max(80).optional(),
  category: z.string().max(30).optional(),
  status: z.enum(['all', 'warning', 'expired', 'low', 'expiring', 'soon_low', 'ok'], { error: '상태 필터를 다시 골라 주세요.' }).optional(),
  active: z.enum(['active', 'inactive', 'all']).optional(),
  vendorId: optId,
  sort: z.enum(['name', 'category', 'stock', 'status', 'dday', 'lastPrice', 'ratio']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  ...pageFields,
});

const movesQuery = z.object({
  itemId: optId,
  type: z.enum(MOVE_TYPES).optional(),
  from: day,
  to: day,
  q: z.string().max(80).optional(),
  ...pageFields,
});

const pricesQuery = z.object({
  itemId: optId,
  vendorId: optId,
  up: z.enum(['1', '0', 'true', 'false']).optional(),
  q: z.string().max(80).optional(),
  ...pageFields,
});

const vendorsQuery = z.object({ active: z.enum(['active', 'inactive', 'all']).optional() });

/** inventory 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  // CSV 가져오기·내보내기(phase-03-task-03, csv-routes.ts)
  await app.register(csvRoutes);
  // 명세서 사진 입고(phase-04-task-08, receipt.routes.ts)
  await app.register(receiptRoutes);

  // 품목 목록: 검색·분류·상태·정렬·쪽 나누기. { data, total, counts, categories }
  app.get('/items', async (req) => listItems(app.db, app.clock, parseInput(itemsQuery, req.query)));

  // 품목 상세: 로트별 잔량, 최근 기록, 단가 추이
  app.get('/items/:id', async (req) => ({ data: getItemDetail(app.db, app.clock, parseInput(idParam, req.params).id) }));

  // 품목 등록(M). 같은 이름이 있으면 저장하고 warnings로 알린다
  app.post('/items', async (req, reply) => {
    const input = parseInput(itemCreateSchema, req.body);
    reply.code(201);
    return { data: createItem(auditCtx(req), input) };
  });

  // 품목 수정(M)
  app.patch('/items/:id', async (req) => {
    const { id } = parseInput(idParam, req.params);
    return { data: updateItem(auditCtx(req), id, parseInput(itemPatchSchema, req.body)) };
  });

  // 품목 삭제(M): 입출고 기록이 있으면 "사용 안 함"으로 바뀐다
  app.delete('/items/:id', async (req) => ({ data: deleteItem(auditCtx(req), parseInput(idParam, req.params).id) }));

  // 입고·출고(모두), 조정(M). 재고보다 많은 출고는 force 없이 409 CONFLICT{needsConfirm}
  app.post('/inventory/moves', async (req, reply) => {
    const input = parseInput(moveSchema, req.body);
    if (input.type === 'adjust') assertCan(req, 'inventory.adjust');
    else assertCan(req, 'inventory.move');
    reply.code(201);
    return { data: recordMove(auditCtx(req), input) };
  });

  // 입출고 기록 목록(최근 것부터)
  app.get('/inventory/moves', async (req, reply) => {
    // ?format=csv면 같은 조건으로 CSV 내려받기(inventory.export, phase-03-task-03)
    if ((req.query as { format?: unknown }).format === 'csv') return sendMovesCsv(req, reply);
    return listMoves(app.db, parseInput(movesQuery, req.query));
  });

  // 단가 기록(최근 것부터, 직전 대비 변동률)
  app.get('/prices', async (req) => {
    const q = parseInput(pricesQuery, req.query);
    return listPrices(app.db, { ...q, up: q.up === '1' || q.up === 'true' });
  });

  // 거래처
  app.get('/vendors', async (req) => ({ data: listVendors(app.db, parseInput(vendorsQuery, req.query)) }));
  app.post('/vendors', async (req, reply) => {
    const input = parseInput(vendorCreateSchema, req.body);
    reply.code(201);
    return { data: createVendor(auditCtx(req), input) };
  });
  app.patch('/vendors/:id', async (req) => {
    const { id } = parseInput(idParam, req.params);
    return { data: updateVendor(auditCtx(req), id, parseInput(vendorPatchSchema, req.body)) };
  });

  // 발주서(phase-03-task-02, orders.routes.ts)
  await orderRoutes(app);
}

// 이 파일이 하는 일: 발주서 API(backend.md §3.5, FR-054)를 실제 라우트와 DB로 확인한다(phase-03-task-02 AC1~AC3).
// 부족 품목 3개(거래처 2곳) → 발주서 2건·권장 수량 올림(적정×1.5−현재고), 작성 중 수정 → 발주함 → 수정 불가(409),
// 입고 처리 → 입고 기록(order_id·거래처·단가·로트·유효기간)으로 재고 증가·상태 received, 한 트랜잭션 되돌림, 권한과 데모 데이터를 본다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock, type ManualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { seedDemo } from './seed.ts';
import { formatPoNo, suggestedQty, type OrderDetail, type OrderDraftResult, type OrderPage } from '../../../shared/schemas/orders.ts';
import type { ItemDetail, ItemRow, PriceRow } from '../../../shared/schemas/inventory.ts';

const START = '2026-11-02T09:00:00+09:00';

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

interface Env {
  app: FastifyInstance;
  clock: ManualClock;
  manager: TestLogin;
  staff: TestLogin;
}

async function makeEnv(): Promise<Env> {
  tmp = makeTmpDir('dentalax-po-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return { app, clock, manager: loginAs(app, 'manager'), staff: loginAs(app, 'staff') };
}

interface ErrBody {
  error?: { code: string; message: string; fields?: Record<string, string>; status?: string };
}

async function call<T>(env: Env, who: TestLogin, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const res = await env.app.inject({ method, url, headers: method === 'GET' ? who.headers : who.writeHeaders, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.json<T & ErrBody>() };
}

async function vendor(env: Env, name: string): Promise<number> {
  const r = await call<{ data: { id: number } }>(env, env.manager, 'POST', '/api/vendors', { name, phone: '02-555-0000' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.id;
}

/** 품목을 만들고 stock만큼 입고해 둔다(단가 price) */
async function stocked(env: Env, body: { name: string; par: number; vendorId: number | null; trackExpiry?: boolean }, stock: number, price: number | null): Promise<ItemRow> {
  const r = await call<{ data: { item: ItemRow } }>(env, env.manager, 'POST', '/api/items', { category: '소모품', unit: '박스', ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const id = r.body.data.item.id;
  if (stock > 0) {
    const m = await call(env, env.staff, 'POST', '/api/inventory/moves', { itemId: id, type: 'in', qty: stock, ...(price === null ? {} : { unitPrice: price }), ...(body.trackExpiry ? { expiryOn: '2027-06-30', lot: 'OLD1' } : {}) });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
  }
  return r.body.data.item;
}

async function itemOf(env: Env, id: number): Promise<ItemDetail> {
  const r = await call<{ data: ItemDetail }>(env, env.staff, 'GET', `/api/items/${id}`);
  expect(r.status).toBe(200);
  return r.body.data;
}

async function orderOf(env: Env, id: number): Promise<OrderDetail> {
  const r = await call<{ data: OrderDetail }>(env, env.manager, 'GET', `/api/orders/${id}`);
  expect(r.status).toBe(200);
  return r.body.data;
}

/** 부족 품목 3개(거래처 2곳) + 정상 품목 1개 */
async function threeLow(env: Env) {
  const a = await vendor(env, '한빛덴탈');
  const b = await vendor(env, '미소치재');
  const glove = await stocked(env, { name: '니트릴 글러브 M', par: 6, vendorId: a }, 2, 8400); // 6×1.5−2 = 7
  const tip = await stocked(env, { name: '석션 팁', par: 4, vendorId: a }, 1, 4200); // 4×1.5−1 = 5
  const resin = await stocked(env, { name: '레진 A2', par: 5, vendorId: b, trackExpiry: true }, 3.5, 32000); // 7.5−3.5 = 4
  const mask = await stocked(env, { name: '덴탈 마스크', par: 4, vendorId: a }, 10, 4500); // 정상 → 빠짐
  return { a, b, glove, tip, resin, mask };
}

describe('권장 수량 계산', () => {
  test('phase-03-task-02 AC1: 권장 수량 = ceil(적정×1.5−현재고), 0 이하면 0', () => {
    expect(suggestedQty(6, 2)).toBe(7);
    expect(suggestedQty(6, 5)).toBe(4); // 9−5
    expect(suggestedQty(5, 3.5)).toBe(4); // 7.5−3.5 = 4(딱 떨어짐)
    expect(suggestedQty(5, 3)).toBe(5); // 4.5 → 5(올림)
    expect(suggestedQty(3, 0.1 + 0.2)).toBe(5); // 4.2 → 5(소수 오차 정리 뒤 올림)
    expect(suggestedQty(4, -2)).toBe(8); // 재고가 음수여도 모자란 만큼 채운다
    expect(suggestedQty(4, 6)).toBe(0);
    expect(suggestedQty(4, 7)).toBe(0);
    expect(formatPoNo('2026-11', 3)).toBe('PO-2611-003');
  });
});

describe('발주서 초안', () => {
  test('phase-03-task-02 AC1: 부족 품목 3개(거래처 2곳)에서 "발주서 만들기" → 발주서 2건, 권장 수량 = ceil(적정×1.5−현재고)', async () => {
    const env = await makeEnv();
    const { a, b, glove, tip, resin, mask } = await threeLow(env);
    const r = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const orders = r.body.data.orders;
    expect(orders).toHaveLength(2);
    expect(orders.map((o) => [o.vendor, o.status, o.lineCount])).toEqual([
      ['미소치재', 'draft', 1],
      ['한빛덴탈', 'draft', 2],
    ]);
    expect(orders.map((o) => o.poNo)).toEqual(['PO-2611-001', 'PO-2611-002']);

    const hanbit = await orderOf(env, orders.find((o) => o.vendorId === a)?.id ?? 0);
    expect(hanbit.lines.map((l) => [l.itemId, l.qty, l.unitPrice]).sort()).toEqual(
      [
        [glove.id, 7, 8400],
        [tip.id, 5, 4200],
      ].sort(),
    );
    expect(hanbit.lines.some((l) => l.itemId === mask.id)).toBe(false);
    expect(hanbit.total).toBe(7 * 8400 + 5 * 4200);
    const miso = await orderOf(env, orders.find((o) => o.vendorId === b)?.id ?? 0);
    expect(miso.lines.map((l) => [l.itemId, l.qty])).toEqual([[resin.id, 4]]);
    expect(miso.vendorInfo?.name).toBe('미소치재');

    // 다시 누르면 이미 작성 중인 품목은 두 번 담지 않는다
    const again = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ orders: [], skipped: 3 });
    const list = await call<OrderPage>(env, env.manager, 'GET', '/api/orders?status=draft');
    expect(list.body.total).toBe(2);
    expect(list.body.counts.draft).toBe(2);
    const audit = env.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'order.draft'");
    expect(audit?.n).toBe(2);
  });

  test('phase-03-task-02 AC1: 곧 부족(적정 ≤ 현재고 ≤ 적정×1.2)도 담고, 거래처 없는 품목은 "거래처 미정" 1건으로 묶는다', async () => {
    const env = await makeEnv();
    const a = await vendor(env, '한빛덴탈');
    const soon = await stocked(env, { name: '거즈', par: 10, vendorId: a }, 12, 3200); // 곧 부족 → 15−12 = 3
    const noVendor = await stocked(env, { name: '종이컵', par: 10, vendorId: null }, 0, null); // 15
    const r = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    expect(r.body.data.orders.map((o) => o.vendor)).toEqual(['한빛덴탈', null]);
    const none = await orderOf(env, r.body.data.orders[1]?.id ?? 0);
    expect(none.lines).toMatchObject([{ itemId: noVendor.id, qty: 15, unitPrice: null, amount: null }]);
    expect(none.missingPrice).toBe(true);
    const first = await orderOf(env, r.body.data.orders[0]?.id ?? 0);
    expect(first.lines).toMatchObject([{ itemId: soon.id, qty: 3 }]);

    // 거래처 미정은 거래처를 고르기 전에는 발주할 수 없다
    const place = await call(env, env.manager, 'POST', `/api/orders/${none.id}/order`, {});
    expect(place.status).toBe(400);
    expect(place.body.error?.fields?.vendorId).toBe('거래처를 먼저 골라 주세요.');
  });

  test('phase-03-task-02 AC1: 담을 품목이 없으면 빈 목록, 직원은 발주서 API를 쓸 수 없다(403)', async () => {
    const env = await makeEnv();
    const r = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ orders: [], skipped: 0 });
    expect((await call(env, env.staff, 'POST', '/api/orders/draft', {})).status).toBe(403);
    expect((await call(env, env.staff, 'GET', '/api/orders')).status).toBe(403);
    expect((await call(env, env.staff, 'GET', '/api/orders/1')).status).toBe(403);
  });
});

describe('수정·발주함', () => {
  test('phase-03-task-02 AC2: draft에서 수량 수정 후 발주함 → 상태 ordered, ordered 상태에서는 수정 불가', async () => {
    const env = await makeEnv();
    const { a, glove, tip, mask } = await threeLow(env);
    const drafts = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    const id = drafts.body.data.orders.find((o) => o.vendorId === a)?.id ?? 0;

    // 수량을 고치고 품목 하나를 빼고 다른 품목을 넣는다
    const patched = await call<{ data: OrderDetail }>(env, env.manager, 'PATCH', `/api/orders/${id}`, {
      lines: [
        { itemId: glove.id, qty: 10 },
        { itemId: mask.id, qty: 2 },
      ],
      note: '오전 중 배송 부탁',
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data.status).toBe('draft');
    expect(patched.body.data.note).toBe('오전 중 배송 부탁');
    expect(patched.body.data.lines.map((l) => [l.itemId, l.qty, l.unitPrice]).sort()).toEqual(
      [
        [glove.id, 10, 8400], // 원래 줄 단가 유지
        [mask.id, 2, 4500], // 새로 넣은 품목은 최근 입고 단가
      ].sort(),
    );
    expect(patched.body.data.lines.some((l) => l.itemId === tip.id)).toBe(false);

    // 잘못된 입력은 400(수량 0, 같은 품목 두 번)
    const zero = await call(env, env.manager, 'PATCH', `/api/orders/${id}`, { lines: [{ itemId: glove.id, qty: 0 }] });
    expect(zero.status).toBe(400);
    expect(zero.body.error?.fields?.['lines.0.qty']).toBe('수량은 0보다 크게 적어 주세요.');
    const dup = await call(env, env.manager, 'PATCH', `/api/orders/${id}`, { lines: [{ itemId: glove.id, qty: 1 }, { itemId: glove.id, qty: 2 }] });
    expect(dup.status).toBe(400);

    // 발주함
    env.clock.advance(60 * 60 * 1000);
    const placed = await call<{ data: OrderDetail }>(env, env.manager, 'POST', `/api/orders/${id}/order`, {});
    expect(placed.status, JSON.stringify(placed.body)).toBe(200);
    expect(placed.body.data.status).toBe('ordered');
    expect(placed.body.data.orderedAt).toBe(env.clock.now().toISOString());

    // ordered 상태에서는 수정·다시 발주가 막힌다(409), 내용은 그대로
    const locked = await call(env, env.manager, 'PATCH', `/api/orders/${id}`, { lines: [{ itemId: glove.id, qty: 99 }] });
    expect(locked.status).toBe(409);
    expect(locked.body.error?.code).toBe('CONFLICT');
    expect(locked.body.error?.message).toBe('이 발주서는 지금 "발주함" 상태라 고칠 수 없어요.');
    expect((await call(env, env.manager, 'POST', `/api/orders/${id}/order`, {})).status).toBe(409);
    expect((await orderOf(env, id)).lines.find((l) => l.itemId === glove.id)?.qty).toBe(10);
    const audit = env.app.db.all<{ action: string }>("SELECT action FROM audit_log WHERE target_type = 'purchase_order' AND target_id = ? ORDER BY id", [String(id)]);
    expect(audit.map((x) => x.action)).toEqual(['order.draft', 'order.update', 'order.place']);
  });

  test('phase-03-task-02 AC2: 취소는 작성 중·발주함에서만 되고, 취소한 발주서는 고치거나 입고할 수 없다', async () => {
    const env = await makeEnv();
    const { glove } = await threeLow(env);
    const drafts = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    const [o1, o2] = drafts.body.data.orders;
    expect((await call<{ data: OrderDetail }>(env, env.manager, 'POST', `/api/orders/${o1?.id}/cancel`, {})).body.data.status).toBe('canceled');
    await call(env, env.manager, 'POST', `/api/orders/${o2?.id}/order`, {});
    expect((await call<{ data: OrderDetail }>(env, env.manager, 'POST', `/api/orders/${o2?.id}/cancel`, {})).body.data.status).toBe('canceled');
    expect((await call(env, env.manager, 'PATCH', `/api/orders/${o1?.id}`, { note: 'x' })).status).toBe(409);
    expect((await call(env, env.manager, 'POST', `/api/orders/${o2?.id}/receive`, { lines: [{ itemId: glove.id, qty: 1 }] })).status).toBe(409);
    // 취소된 발주서의 품목은 다시 초안에 담긴다
    const again = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    expect(again.body.data.orders).toHaveLength(2);
    expect((await call(env, env.manager, 'GET', '/api/orders/9999')).status).toBe(404);
  });
});

describe('입고 처리', () => {
  test('phase-03-task-02 AC3: 입고 처리 시 발주 품목이 입고 기록으로 들어가 재고가 증가하고 상태 received', async () => {
    const env = await makeEnv();
    const { a, b, glove, tip, resin } = await threeLow(env);
    const drafts = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    const id = drafts.body.data.orders.find((o) => o.vendorId === a)?.id ?? 0;
    await call(env, env.manager, 'POST', `/api/orders/${id}/order`, {});
    // 발주하기 전(작성 중)에는 입고할 수 없다
    const resinOrder = drafts.body.data.orders.find((o) => o.vendorId === b)?.id ?? 0;
    expect((await call(env, env.manager, 'POST', `/api/orders/${resinOrder}/receive`, { lines: [{ itemId: resin.id, qty: 4 }] })).status).toBe(409);

    env.clock.advance(2 * 60 * 60 * 1000); // 두 시간 뒤 도착(세션 유효 시간 안)
    const r = await call<{ data: OrderDetail }>(env, env.manager, 'POST', `/api/orders/${id}/receive`, {
      lines: [
        { itemId: glove.id, qty: 7, unitPrice: 8900 }, // 단가가 올랐다
        { itemId: tip.id, qty: 5 }, // 단가를 비우면 발주서 단가
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('received');
    expect(r.body.data.receivedAt).toBe(env.clock.now().toISOString());
    expect(r.body.data.lines.map((l) => [l.itemId, l.receivedQty]).sort()).toEqual(
      [
        [glove.id, 7],
        [tip.id, 5],
      ].sort(),
    );

    // 재고 증가(2 → 9, 1 → 6)
    expect((await itemOf(env, glove.id)).stock).toBe(9);
    expect((await itemOf(env, tip.id)).stock).toBe(6);
    // 입고 기록: 발주서 번호·거래처·단가가 들어간다
    const moves = env.app.db.all<{ item_id: number; type: string; qty: number; unit_price: number; vendor_id: number; order_id: number; reason: string }>(
      'SELECT item_id, type, qty, unit_price, vendor_id, order_id, reason FROM stock_moves WHERE order_id = ? ORDER BY item_id',
      [id],
    );
    expect(moves).toEqual(
      [
        { item_id: glove.id, type: 'in', qty: 7, unit_price: 8900, vendor_id: a, order_id: id, reason: `발주서 ${r.body.data.poNo} 입고` },
        { item_id: tip.id, type: 'in', qty: 5, unit_price: 4200, vendor_id: a, order_id: id, reason: `발주서 ${r.body.data.poNo} 입고` },
      ].sort((x, y) => x.item_id - y.item_id),
    );
    // 일반 입고와 같은 단가 이력 계산: 8,400 → 8,900은 ▲6% 인상
    const prices = await call<{ data: PriceRow[] }>(env, env.staff, 'GET', `/api/prices?itemId=${glove.id}`);
    expect(prices.body.data[0]).toMatchObject({ unitPrice: 8900, prevPrice: 8400, up: true });
    // 입고 완료 뒤에는 다시 입고·수정할 수 없다
    expect((await call(env, env.manager, 'POST', `/api/orders/${id}/receive`, { lines: [{ itemId: glove.id, qty: 1 }] })).status).toBe(409);
    expect((await call(env, env.manager, 'POST', `/api/orders/${id}/cancel`, {})).status).toBe(409);
    expect(env.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'order.receive'")?.n).toBe(1);
  });

  test('phase-03-task-02 AC3: 유효기간 품목은 로트·유효기간이 입고 기록에 남고 FEFO 로트 목록에 나온다', async () => {
    const env = await makeEnv();
    const { b, resin } = await threeLow(env);
    const drafts = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    const id = drafts.body.data.orders.find((o) => o.vendorId === b)?.id ?? 0;
    await call(env, env.manager, 'POST', `/api/orders/${id}/order`, {});
    const r = await call<{ data: OrderDetail }>(env, env.manager, 'POST', `/api/orders/${id}/receive`, { lines: [{ itemId: resin.id, qty: 4, lot: 'R2611', expiryOn: '2027-03-31' }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = await itemOf(env, resin.id);
    expect(d.stock).toBe(7.5);
    // 유효기간이 빠른 로트부터: 새 로트(2027-03-31)가 옛 로트(2027-06-30)보다 앞
    expect(d.lots.map((l) => [l.lot, l.expiryOn, l.remaining])).toEqual([
      ['R2611', '2027-03-31', 4],
      ['OLD1', '2027-06-30', 3.5],
    ]);
    expect(d.nearestExpiry).toBe('2027-03-31');
  });

  test('phase-03-task-02 AC3: 수량 0인 줄은 기록하지 않고, 발주서에 없는 품목·모두 0은 400, 실패하면 전부 되돌린다', async () => {
    const env = await makeEnv();
    const { a, glove, tip, mask } = await threeLow(env);
    const drafts = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    const id = drafts.body.data.orders.find((o) => o.vendorId === a)?.id ?? 0;
    await call(env, env.manager, 'POST', `/api/orders/${id}/order`, {});

    const notInOrder = await call(env, env.manager, 'POST', `/api/orders/${id}/receive`, { lines: [{ itemId: mask.id, qty: 1 }] });
    expect(notInOrder.status).toBe(400);
    const allZero = await call(env, env.manager, 'POST', `/api/orders/${id}/receive`, { lines: [{ itemId: glove.id, qty: 0 }] });
    expect(allZero.status).toBe(400);
    expect(allZero.body.error?.fields?.lines).toBe('들어온 수량을 한 품목 이상 적어 주세요.');
    // 지출 동시 기록(phase-04-task-04)의 입력이 틀리면 400이고 아무것도 기록하지 않는다
    expect((await call(env, env.manager, 'POST', `/api/orders/${id}/receive`, { lines: [{ itemId: glove.id, qty: 1 }], alsoExpense: { payMethod: 'coupon' } })).status).toBe(400);

    // 두 번째 품목이 "사용 안 함"이면 첫 품목 입고도 함께 되돌린다
    expect((await call(env, env.manager, 'DELETE', `/api/items/${tip.id}`)).status).toBe(200);
    const failed = await call(env, env.manager, 'POST', `/api/orders/${id}/receive`, {
      lines: [
        { itemId: glove.id, qty: 7 },
        { itemId: tip.id, qty: 5 },
      ],
    });
    expect(failed.status).toBe(409);
    expect((await itemOf(env, glove.id)).stock).toBe(2);
    expect(env.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_moves WHERE order_id = ?', [id])?.n).toBe(0);
    expect((await orderOf(env, id)).status).toBe('ordered');

    // 일부만 들어온 경우: 0인 줄은 빼고 기록
    const ok = await call<{ data: OrderDetail }>(env, env.manager, 'POST', `/api/orders/${id}/receive`, {
      lines: [
        { itemId: glove.id, qty: 6 },
        { itemId: tip.id, qty: 0 },
      ],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await itemOf(env, glove.id)).stock).toBe(8);
    expect(env.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_moves WHERE order_id = ?', [id])?.n).toBe(1);
  });
});

describe('데모 데이터', () => {
  test('phase-03-task-02: 재고 데모에 입고 완료 1건·발주함 1건이 들어가고, 입고 완료 건은 입고 기록과 이어진다', async () => {
    const env = await makeEnv();
    seedDemo(env.app.db, { clock: env.clock, scale: 1 });
    const list = await call<OrderPage>(env, env.manager, 'GET', '/api/orders');
    expect(list.body.counts).toMatchObject({ all: 2, received: 1, ordered: 1, draft: 0 });
    const received = list.body.data.find((o) => o.status === 'received');
    const ordered = list.body.data.find((o) => o.status === 'ordered');
    expect(received?.vendor).toBe('청정위생');
    expect(ordered?.vendor).toBe('미소치재');
    const d = await orderOf(env, received?.id ?? 0);
    expect(d.lines.length).toBeGreaterThan(0);
    expect(d.lines.every((l) => l.receivedQty === l.qty)).toBe(true);
    expect(list.body.data.every((o) => /^PO-\d{4}-\d{3}$/.test(o.poNo))).toBe(true);
    // 데모에서도 "발주서 만들기"를 누르면 남은 부족 품목으로 초안이 생긴다
    const drafts = await call<{ data: OrderDraftResult }>(env, env.manager, 'POST', '/api/orders/draft', {});
    expect(drafts.body.data.orders.length).toBeGreaterThan(0);
    expect(drafts.body.data.skipped).toBe((await orderOf(env, ordered?.id ?? 0)).lines.length);
  });
});

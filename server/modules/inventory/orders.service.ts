// 이 파일이 하는 일: 발주서 업무(FR-054, overview.md §3.3의 3~5번)를 DB와 함께 처리한다.
// ① 초안 만들기: 부족·곧 부족 품목을 기본 거래처별로 묶어 발주서(작성 중)를 만들고, 권장 수량 = 올림(적정 × 1.5 − 현재고), 단가 = 최근 입고 단가를 채운다.
// ② 수정(작성 중일 때만) ③ 발주함(작성 중 → 발주함) ④ 취소 ⑤ 입고 처리(발주함 → 입고 완료): 품목마다 재고 입고 기록을 남긴다.
// 입고 기록은 재고 service의 recordMove(입고 경로)를 그대로 써서 FEFO 로트·단가 이력 계산이 일반 입고와 같고, 모두 한 트랜잭션이다(하나라도 틀리면 전부 되돌림).
// "지출로도 기록"(alsoExpense)은 지출 테이블(phase-04-task-04)이 생긴 뒤 연결한다. 지금은 받지 않는다. 상태를 바꾸는 함수는 모두 감사 로그를 남긴다.
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError, validationError } from '../../lib/errors.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { thisMonthKst } from '../../lib/dates.ts';
import {
  formatPoNo,
  ORDER_STATUS_LABELS,
  suggestedQty,
  type OrderDetail,
  type OrderDraftResult,
  type OrderLine,
  type OrderPage,
  type OrderPatchInput,
  type OrderReceiveInput,
  type OrderRow,
  type OrderStatus,
} from '../../../shared/schemas/orders.ts';
import { readInventorySettings } from './settings.ts';
import { itemRow, listItems, recordMove } from './service.ts';

/** purchase_orders 한 줄(+ 거래처·만든 사람 이름, 줄 합계) */
interface OrderDb {
  id: number;
  po_no: string;
  status: OrderStatus;
  vendor_id: number | null;
  vendor_name: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
  ordered_at: string | null;
  received_at: string | null;
  canceled_at: string | null;
  line_count: number;
  total_qty: number | null;
  total: number | null;
  missing_price: number;
}

const ORDER_SELECT = `SELECT o.id, o.po_no, o.status, o.vendor_id, v.name AS vendor_name, o.note, u.name AS created_by_name,
  o.created_at, o.ordered_at, o.received_at, o.canceled_at,
  (SELECT COUNT(*) FROM po_lines l WHERE l.po_id = o.id) AS line_count,
  (SELECT SUM(l.qty) FROM po_lines l WHERE l.po_id = o.id) AS total_qty,
  (SELECT SUM(l.qty * l.unit_price) FROM po_lines l WHERE l.po_id = o.id AND l.unit_price IS NOT NULL) AS total,
  (SELECT COUNT(*) FROM po_lines l WHERE l.po_id = o.id AND l.unit_price IS NULL) AS missing_price
  FROM purchase_orders o LEFT JOIN vendors v ON v.id = o.vendor_id LEFT JOIN users u ON u.id = o.created_by`;

/** 금액을 원 단위로 반올림(소수 수량 × 단가의 오차 정리) */
function won(n: number): number {
  return Math.round(n);
}

/** DB 줄 → 목록 한 줄 */
function toOrder(o: OrderDb): OrderRow {
  return {
    id: o.id,
    poNo: o.po_no,
    status: o.status,
    vendorId: o.vendor_id,
    vendor: o.vendor_name,
    note: o.note,
    lineCount: o.line_count,
    totalQty: Math.round((o.total_qty ?? 0) * 100) / 100,
    total: won(o.total ?? 0),
    missingPrice: o.missing_price > 0,
    createdBy: o.created_by_name,
    createdAt: o.created_at,
    orderedAt: o.ordered_at,
    receivedAt: o.received_at,
    canceledAt: o.canceled_at,
  };
}

/** 발주서 하나(DB 줄)를 찾는다(없으면 404) */
function getOrderDb(db: Db, id: number): OrderDb {
  const o = db.get<OrderDb>(`${ORDER_SELECT} WHERE o.id = ?`, [id]);
  if (!o) throw new AppError('NOT_FOUND', { message: '찾는 발주서가 없어요. 목록을 새로 고쳐 주세요.' });
  return o;
}

/** 이 상태가 아니면 409(쉬운 문구로 지금 상태를 알려 준다) */
function assertStatus(o: OrderDb, allowed: readonly OrderStatus[], doing: string): void {
  if (allowed.includes(o.status)) return;
  throw new AppError('CONFLICT', {
    message: `이 발주서는 지금 "${ORDER_STATUS_LABELS[o.status]}" 상태라 ${doing} 수 없어요.`,
    extra: { status: o.status },
  });
}

/** 이번 달(KST)의 다음 발주 번호: PO-YYMM-NNN */
function nextPoNo(db: Db, clock: Clock): string {
  const month = thisMonthKst(clock);
  const prefix = formatPoNo(month, 0).slice(0, -3);
  const last = db.get<{ po_no: string }>('SELECT po_no FROM purchase_orders WHERE po_no LIKE ? ORDER BY po_no DESC LIMIT 1', [`${prefix}%`]);
  const seq = last ? Number(last.po_no.slice(prefix.length)) + 1 : 1;
  return formatPoNo(month, seq);
}

/** 거래처 번호가 있는지(없으면 400) */
function assertVendor(db: Db, vendorId: number): void {
  if (!db.get('SELECT id FROM vendors WHERE id = ?', [vendorId])) throw validationError({ vendorId: '없는 거래처예요. 거래처를 다시 골라 주세요.' });
}

/** 품목의 최근 입고 단가(없으면 null) */
function lastPrice(db: Db, itemId: number): number | null {
  return db.get<{ unit_price: number }>("SELECT unit_price FROM stock_moves WHERE item_id = ? AND type = 'in' AND unit_price IS NOT NULL ORDER BY moved_at DESC, id DESC LIMIT 1", [itemId])?.unit_price ?? null;
}

/** 목록 조건 */
export interface OrderListQuery {
  status?: OrderStatus | 'all' | 'open';
  page?: number;
  pageSize?: number;
}

/** 발주서 목록(최근 것부터). counts는 상태 필터 전 건수, 'open'은 작성 중 + 발주함 */
export function listOrders(db: Db, q: OrderListQuery = {}): OrderPage {
  const counts = { all: 0, draft: 0, ordered: 0, received: 0, canceled: 0 } as OrderPage['counts'];
  for (const r of db.all<{ status: OrderStatus; n: number }>('SELECT status, COUNT(*) AS n FROM purchase_orders GROUP BY status')) {
    counts[r.status] = r.n;
    counts.all += r.n;
  }
  const status = q.status ?? 'all';
  const where = status === 'all' ? '' : status === 'open' ? "WHERE o.status IN ('draft', 'ordered')" : 'WHERE o.status = ?';
  const params = status === 'all' || status === 'open' ? [] : [status];
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM purchase_orders o ${where}`, params)?.n ?? 0;
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
  const page = Math.max(1, q.page ?? 1);
  const rows = db.all<OrderDb>(`${ORDER_SELECT} ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  return { data: rows.map(toOrder), total, counts };
}

/** 병원 기본 정보(settings.clinic). 이름이 없으면 "우리 병원" */
function readClinicInfo(db: Db): OrderDetail['clinic'] {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'clinic'");
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = row ? JSON.parse(row.value) : {};
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    o = {};
  }
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  return { name: str(o.name) ?? '우리 병원', phone: str(o.phone), location: str(o.location) };
}

/** 발주서 상세: 품목 줄(지금 재고·적정·입고된 수량 포함), 거래처 정보, 병원 정보 */
export function getOrder(db: Db, clock: Clock, id: number): OrderDetail {
  const o = getOrderDb(db, id);
  const lines = db.all<{ id: number; item_id: number; qty: number; unit_price: number | null; name: string; category: string; unit: string; par_level: number; track_expiry: number }>(
    `SELECT l.id, l.item_id, l.qty, l.unit_price, i.name, i.category, i.unit, i.par_level, i.track_expiry
     FROM po_lines l JOIN items i ON i.id = l.item_id WHERE l.po_id = ? ORDER BY i.category, i.name, l.id`,
    [id],
  );
  const received = new Map<number, number>();
  for (const r of db.all<{ item_id: number; qty: number }>("SELECT item_id, SUM(qty) AS qty FROM stock_moves WHERE order_id = ? AND type = 'in' GROUP BY item_id", [id])) {
    received.set(r.item_id, r.qty);
  }
  const outLines: OrderLine[] = lines.map((l) => ({
    id: l.id,
    itemId: l.item_id,
    itemName: l.name,
    category: l.category,
    unit: l.unit,
    qty: l.qty,
    unitPrice: l.unit_price,
    amount: l.unit_price === null ? null : won(l.qty * l.unit_price),
    stock: itemRow(db, clock, l.item_id).stock,
    par: l.par_level,
    trackExpiry: l.track_expiry === 1,
    receivedQty: received.get(l.item_id) ?? 0,
  }));
  const v = o.vendor_id
    ? db.get<{ name: string; contact_name: string | null; phone: string | null; email: string | null; order_method: string | null }>(
        'SELECT name, contact_name, phone, email, order_method FROM vendors WHERE id = ?',
        [o.vendor_id],
      )
    : undefined;
  return {
    ...toOrder(o),
    lines: outLines,
    vendorInfo: v ? { name: v.name, contactName: v.contact_name, phone: v.phone, email: v.email, orderMethod: v.order_method } : null,
    clinic: readClinicInfo(db),
  };
}

/**
 * 발주서 초안을 만든다(FR-054 AC1). 사용 중인 품목 중 수량이 부족(현재고 < 적정)·곧 부족(현재고 ≤ 적정 × 곧 부족 배수)인 것을
 * 기본 거래처별로 묶어 거래처마다 1건을 만든다(거래처가 없는 품목은 "거래처 미정" 1건). 권장 수량 = 올림(적정 × 1.5 − 현재고).
 * 이미 작성 중·발주한 발주서에 들어 있는 품목은 두 번 주문하지 않게 뺀다(skipped). 담을 품목이 없으면 빈 목록을 돌려준다.
 */
export function createDrafts(ctx: AuditContext): OrderDraftResult {
  const { db, clock } = ctx;
  const ratio = readInventorySettings(db).soonLowRatio;
  const open = new Set(
    db.all<{ item_id: number }>("SELECT DISTINCT l.item_id FROM po_lines l JOIN purchase_orders o ON o.id = l.po_id WHERE o.status IN ('draft', 'ordered')").map((r) => r.item_id),
  );
  const rows = listItems(db, clock, { active: 'active', pageSize: 200, page: 1 });
  // listItems는 쪽마다 200개라, 품목이 더 많으면 나머지 쪽도 읽는다
  const all = [...rows.data];
  for (let p = 2; (p - 1) * 200 < rows.total; p++) all.push(...listItems(db, clock, { active: 'active', pageSize: 200, page: p }).data);

  let skipped = 0;
  const groups = new Map<number | null, Array<{ itemId: number; qty: number; price: number | null }>>();
  for (const r of all) {
    if (!(r.par > 0) || r.stock > r.par * ratio) continue;
    const qty = suggestedQty(r.par, r.stock);
    if (qty <= 0) continue;
    if (open.has(r.id)) {
      skipped += 1;
      continue;
    }
    const key = r.vendorId ?? null;
    const list = groups.get(key) ?? [];
    list.push({ itemId: r.id, qty, price: r.lastPrice });
    groups.set(key, list);
  }
  if (groups.size === 0) return { orders: [], skipped };

  // 거래처 이름순(거래처 미정은 맨 뒤)
  const vendorName = (id: number | null) => (id === null ? '' : (db.get<{ name: string }>('SELECT name FROM vendors WHERE id = ?', [id])?.name ?? ''));
  const keys = [...groups.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : vendorName(a).localeCompare(vendorName(b), 'ko')));
  const now = clock.now().toISOString();
  const ids = db.tx(() =>
    keys.map((vendorId) => {
      const lines = groups.get(vendorId) ?? [];
      const poNo = nextPoNo(db, clock);
      const r = db.run('INSERT INTO purchase_orders (po_no, vendor_id, status, note, created_by, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)', [
        poNo,
        vendorId,
        'draft',
        ctx.user?.id ?? null,
        now,
        now,
      ]);
      const poId = r.lastInsertRowid;
      for (const l of lines) db.run('INSERT INTO po_lines (po_id, item_id, qty, unit_price) VALUES (?, ?, ?, ?)', [poId, l.itemId, l.qty, l.price]);
      audit(ctx, 'order.draft', 'purchase_order', poId, { poNo, vendorId, lines: lines.length });
      return poId;
    }),
  );
  return { orders: ids.map((id) => toOrder(getOrderDb(db, id))), skipped };
}

/**
 * 발주서를 고친다(작성 중일 때만, 발주한 뒤에는 409). lines를 보내면 품목 줄 전체를 그 내용으로 바꾼다.
 * 단가를 보내지 않은 줄은 원래 줄의 단가를, 새로 넣은 품목은 최근 입고 단가를 쓴다.
 */
export function updateOrder(ctx: AuditContext, id: number, input: OrderPatchInput): OrderDetail {
  const { db, clock } = ctx;
  const o = getOrderDb(db, id);
  assertStatus(o, ['draft'], '고칠');
  if (input.vendorId) assertVendor(db, input.vendorId);
  if (input.lines) {
    input.lines.forEach((l, i) => {
      const it = db.get<{ active: number }>('SELECT active FROM items WHERE id = ?', [l.itemId]);
      if (!it) throw validationError({ [`lines.${i}.itemId`]: '없는 품목이에요. 품목을 다시 골라 주세요.' });
      if (it.active !== 1) throw validationError({ [`lines.${i}.itemId`]: '"사용 안 함" 품목은 발주서에 넣을 수 없어요.' });
    });
  }
  const now = clock.now().toISOString();
  db.tx(() => {
    const changed: string[] = [];
    if (input.lines) {
      const before = new Map(db.all<{ item_id: number; unit_price: number | null }>('SELECT item_id, unit_price FROM po_lines WHERE po_id = ?', [id]).map((r) => [r.item_id, r.unit_price]));
      db.run('DELETE FROM po_lines WHERE po_id = ?', [id]);
      for (const l of input.lines) {
        const price = l.unitPrice !== undefined ? l.unitPrice : before.has(l.itemId) ? (before.get(l.itemId) ?? null) : lastPrice(db, l.itemId);
        db.run('INSERT INTO po_lines (po_id, item_id, qty, unit_price) VALUES (?, ?, ?, ?)', [id, l.itemId, Math.round(l.qty * 100) / 100, price]);
      }
      changed.push('lines');
    }
    if (input.vendorId !== undefined) {
      db.run('UPDATE purchase_orders SET vendor_id = ? WHERE id = ?', [input.vendorId, id]);
      changed.push('vendorId');
    }
    if (input.note !== undefined) {
      db.run('UPDATE purchase_orders SET note = ? WHERE id = ?', [input.note, id]);
      changed.push('note');
    }
    db.run('UPDATE purchase_orders SET updated_at = ? WHERE id = ?', [now, id]);
    audit(ctx, 'order.update', 'purchase_order', id, { poNo: o.po_no, changed, lines: input.lines?.length });
  });
  return getOrder(db, clock, id);
}

/** 발주함으로 바꾼다(작성 중 → 발주함). 거래처와 품목이 있어야 한다 */
export function placeOrder(ctx: AuditContext, id: number): OrderDetail {
  const { db, clock } = ctx;
  const o = getOrderDb(db, id);
  assertStatus(o, ['draft'], '발주할');
  if (!o.vendor_id) throw validationError({ vendorId: '거래처를 먼저 골라 주세요.' }, '거래처를 고른 뒤 발주해 주세요.');
  if (o.line_count === 0) throw validationError({ lines: '품목을 한 개 이상 넣어 주세요.' }, '품목을 넣은 뒤 발주해 주세요.');
  const now = clock.now().toISOString();
  db.tx(() => {
    db.run("UPDATE purchase_orders SET status = 'ordered', ordered_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
    audit(ctx, 'order.place', 'purchase_order', id, { poNo: o.po_no, vendorId: o.vendor_id, total: won(o.total ?? 0) });
  });
  return getOrder(db, clock, id);
}

/** 취소한다(작성 중·발주함 → 취소). 입고 완료된 발주서는 취소할 수 없다 */
export function cancelOrder(ctx: AuditContext, id: number): OrderDetail {
  const { db, clock } = ctx;
  const o = getOrderDb(db, id);
  assertStatus(o, ['draft', 'ordered'], '취소할');
  const now = clock.now().toISOString();
  db.tx(() => {
    db.run("UPDATE purchase_orders SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
    audit(ctx, 'order.cancel', 'purchase_order', id, { poNo: o.po_no, from: o.status });
  });
  return getOrder(db, clock, id);
}

/**
 * 입고 처리(발주함 → 입고 완료, FR-054 AC3). 줄마다 재고 입고 기록(recordMove type 'in')을 남기고 그 기록에 발주서 번호(order_id)를 단다.
 * 단가를 비우면 발주서의 단가를 쓰고, 거래처는 발주서의 거래처다. 수량 0인 줄은 기록하지 않는다. 발주서에 없는 품목은 400.
 * 모두 한 트랜잭션이라, 중간에 하나라도 실패하면(예: 사용 안 함 품목) 아무것도 저장되지 않는다.
 */
export function receiveOrder(ctx: AuditContext, id: number, input: OrderReceiveInput): OrderDetail {
  const { db, clock } = ctx;
  const o = getOrderDb(db, id);
  assertStatus(o, ['ordered'], '입고 처리할');
  const poLines = new Map(db.all<{ item_id: number; unit_price: number | null }>('SELECT item_id, unit_price FROM po_lines WHERE po_id = ?', [id]).map((r) => [r.item_id, r.unit_price]));
  input.lines.forEach((l, i) => {
    if (!poLines.has(l.itemId)) throw validationError({ [`lines.${i}.itemId`]: '이 발주서에 없는 품목이에요. 품목 입고는 입출고 기록 화면에서 해 주세요.' });
  });
  const now = clock.now().toISOString();
  db.tx(() => {
    let count = 0;
    for (const l of input.lines) {
      if (!(l.qty > 0)) continue;
      const unitPrice = l.unitPrice !== undefined ? l.unitPrice : (poLines.get(l.itemId) ?? null);
      const r = recordMove(ctx, {
        itemId: l.itemId,
        type: 'in',
        qty: l.qty,
        unitPrice,
        vendorId: o.vendor_id,
        lot: l.lot,
        expiryOn: l.expiryOn,
        reason: `발주서 ${o.po_no} 입고`,
      });
      db.run('UPDATE stock_moves SET order_id = ? WHERE id = ?', [id, r.move.id]);
      count += 1;
    }
    db.run("UPDATE purchase_orders SET status = 'received', received_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
    audit(ctx, 'order.receive', 'purchase_order', id, { poNo: o.po_no, moves: count });
  });
  return getOrder(db, clock, id);
}


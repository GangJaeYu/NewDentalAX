// 이 파일이 하는 일: 재고 업무 기능(backend.md §3.5, FR-050~053·055)을 DB와 함께 처리한다.
// 품목 목록(검색·분류·상태 필터·정렬·쪽 나누기)·상세(로트별 잔량·최근 기록·단가 추이)·등록·수정·삭제(기록이 있으면 "사용 안 함"),
// 입출고·조정 기록(재고보다 많은 출고는 확인 필요 409), 입출고 기록 목록, 단가 기록, 거래처 목록·등록·수정을 둔다.
// 현재고와 상태는 저장하지 않고 조회할 때 입출고 합으로 계산한다(stock.ts). 상태를 바꾸는 함수는 모두 감사 로그를 남긴다.
// 출고·조정으로 품목이 "부족"이 되면 실장 이상에게 알림을 보낸다(같은 날 같은 품목은 한 번, notify.ts).
// 품목 바코드(FR-130)는 병원 안에서 겹치지 않게 저장하고, 바코드로 품목 하나를 찾는 함수(findItemByBarcode)가 있다.
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError, validationError } from '../../lib/errors.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { kstDayRangeUtc, todayKst } from '../../lib/dates.ts';
import {
  normalizeBarcode,
  STOCK_STATUSES,
  type InventorySettings,
  type ItemCreateInput,
  type ItemDeleteResult,
  type ItemDetail,
  type ItemPage,
  type ItemPatchInput,
  type ItemRow,
  type ItemSaveResult,
  type MoveInput,
  type MoveResult,
  type MoveRow,
  type MoveType,
  type PriceRow,
  type StockStatus,
  type VendorCreateInput,
  type VendorPatchInput,
  type VendorRow,
} from '../../../shared/schemas/inventory.ts';
import { readInventorySettings } from './settings.ts';
import { isPriceUp, itemState, priceChangePct, roundQty, type LotIn } from './stock.ts';
import { lowStockNotice } from './notify.ts';
import { emitNotification } from '../notifications/emit.ts';

/** items 테이블 한 줄(+ 기본 거래처 이름) */
interface ItemDb {
  id: number;
  name: string;
  category: string;
  unit: string;
  par_level: number;
  track_expiry: number;
  default_vendor_id: number | null;
  vendor_name: string | null;
  location: string | null;
  memo: string | null;
  barcode: string | null;
  active: number;
}

const ITEM_SELECT = `SELECT i.id, i.name, i.category, i.unit, i.par_level, i.track_expiry, i.default_vendor_id, v.name AS vendor_name,
  i.location, i.memo, i.barcode, i.active FROM items i LEFT JOIN vendors v ON v.id = i.default_vendor_id`;

/** 품목별 입출고 합계·로트·최근 단가 */
interface Agg {
  stock: number;
  consumed: number;
  moveCount: number;
  ins: LotIn[];
  last: number | null;
  prev: number | null;
}

/**
 * 품목별 합계를 한 번에 구한다(GROUP BY item_id). itemId를 주면 그 품목만.
 * 로트는 유효기간 관리 품목만 읽는다(allLots면 모든 품목).
 */
function aggregate(db: Db, itemId: number | null, allLots = false): Map<number, Agg> {
  const where = itemId === null ? '' : 'WHERE item_id = ?';
  const p = itemId === null ? [] : [itemId];
  const out = new Map<number, Agg>();
  const get = (id: number): Agg => {
    let a = out.get(id);
    if (!a) {
      a = { stock: 0, consumed: 0, moveCount: 0, ins: [], last: null, prev: null };
      out.set(id, a);
    }
    return a;
  };
  for (const r of db.all<{ item_id: number; n: number; stock: number; consumed: number }>(
    `SELECT item_id, COUNT(*) AS n,
       SUM(CASE WHEN type = 'out' THEN -qty ELSE qty END) AS stock,
       SUM(CASE WHEN type = 'out' THEN qty WHEN type = 'adjust' AND qty < 0 THEN -qty ELSE 0 END) AS consumed
     FROM stock_moves ${where} GROUP BY item_id`,
    p,
  )) {
    const a = get(r.item_id);
    a.stock = roundQty(r.stock ?? 0);
    a.consumed = roundQty(r.consumed ?? 0);
    a.moveCount = r.n;
  }
  const lotWhere = [
    "(m.type = 'in' OR (m.type = 'adjust' AND m.qty > 0))",
    itemId === null ? null : 'm.item_id = ?',
    allLots ? null : 'i.track_expiry = 1',
  ]
    .filter(Boolean)
    .join(' AND ');
  for (const r of db.all<{ item_id: number; id: number; qty: number; lot: string | null; expiry_on: string | null; moved_at: string }>(
    `SELECT m.item_id, m.id, m.qty, m.lot, m.expiry_on, m.moved_at FROM stock_moves m JOIN items i ON i.id = m.item_id WHERE ${lotWhere}`,
    p,
  )) {
    get(r.item_id).ins.push({ moveId: r.id, qty: r.qty, lot: r.lot, expiryOn: r.expiry_on, movedAt: r.moved_at });
  }
  for (const r of db.all<{ item_id: number; unit_price: number; rn: number }>(
    `SELECT item_id, unit_price, rn FROM (
       SELECT item_id, unit_price, ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY moved_at DESC, id DESC) AS rn
       FROM stock_moves WHERE type = 'in' AND unit_price IS NOT NULL ${itemId === null ? '' : 'AND item_id = ?'}
     ) WHERE rn <= 2`,
    p,
  )) {
    const a = get(r.item_id);
    if (r.rn === 1) a.last = r.unit_price;
    else a.prev = r.unit_price;
  }
  return out;
}

const EMPTY_AGG: Agg = { stock: 0, consumed: 0, moveCount: 0, ins: [], last: null, prev: null };

/** DB 줄 + 합계 → 목록 한 줄 */
function toRow(i: ItemDb, agg: Agg | undefined, today: string, s: InventorySettings): ItemRow & { lots: ReturnType<typeof itemState>['lots'] } {
  const a = agg ?? EMPTY_AGG;
  const st = itemState({ stock: a.stock, consumed: a.consumed, par: i.par_level, trackExpiry: i.track_expiry === 1, ins: a.ins }, today, s);
  const change = priceChangePct(a.prev, a.last);
  return {
    id: i.id,
    name: i.name,
    category: i.category,
    unit: i.unit,
    par: i.par_level,
    stock: st.stock,
    status: st.status,
    nearestExpiry: st.nearestExpiry,
    dday: st.dday,
    trackExpiry: i.track_expiry === 1,
    vendorId: i.default_vendor_id,
    vendor: i.vendor_name,
    location: i.location,
    memo: i.memo,
    barcode: i.barcode,
    active: i.active === 1,
    lastPrice: a.last,
    priceChangePct: change,
    priceUpPct: isPriceUp(change, s.priceAlertPct) ? change : null,
    moveCount: a.moveCount,
    lots: st.lots,
  };
}

/** lots를 뺀 목록 한 줄 */
function strip(r: ItemRow & { lots?: unknown }): ItemRow {
  const { lots: _lots, ...rest } = r;
  return rest;
}

/** 품목 하나를 찾는다(없으면 404) */
function getItemDb(db: Db, id: number): ItemDb {
  const i = db.get<ItemDb>(`${ITEM_SELECT} WHERE i.id = ?`, [id]);
  if (!i) throw new AppError('NOT_FOUND', { message: '찾는 품목이 없어요. 목록을 새로 고쳐 주세요.' });
  return i;
}

/** 품목 하나의 현재 목록 줄 */
export function itemRow(db: Db, clock: Clock, id: number): ItemRow {
  const i = getItemDb(db, id);
  return strip(toRow(i, aggregate(db, id).get(id), todayKst(clock), readInventorySettings(db)));
}

/** 목록 조건 */
export interface ItemListQuery {
  q?: string;
  category?: string;
  status?: StockStatus | 'warning' | 'all';
  /** 'active'(기본) · 'inactive' · 'all' */
  active?: 'active' | 'inactive' | 'all';
  vendorId?: number;
  sort?: 'name' | 'category' | 'stock' | 'status' | 'dday' | 'lastPrice' | 'ratio';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

const STATUS_RANK: Record<StockStatus, number> = Object.fromEntries(STOCK_STATUSES.map((s, i) => [s, i])) as Record<StockStatus, number>;

/** LIKE 검색어의 %·_ 글자를 글자 그대로 찾게 바꾼다 */
function likeText(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * 품목 목록. 기본은 사용 중 품목만, 상태가 급한 순서(만료→부족→임박→곧 부족→정상) 다음 이름순이다.
 * counts는 상태 필터를 적용하기 전 건수다(필터 버튼의 숫자).
 */
export function listItems(db: Db, clock: Clock, q: ItemListQuery = {}): ItemPage {
  const s = readInventorySettings(db);
  const today = todayKst(clock);
  const cond: string[] = [];
  const params: (string | number)[] = [];
  const active = q.active ?? 'active';
  if (active !== 'all') cond.push(`i.active = ${active === 'active' ? 1 : 0}`);
  if (q.category) {
    cond.push('i.category = ?');
    params.push(q.category);
  }
  if (q.vendorId) {
    cond.push('i.default_vendor_id = ?');
    params.push(q.vendorId);
  }
  const word = q.q?.trim();
  if (word) {
    // 바코드는 글자가 정확히 같을 때만 찾는다(숫자 일부만 같은 다른 품목이 섞이지 않게)
    cond.push("(i.name LIKE ? ESCAPE '\\' OR i.category LIKE ? ESCAPE '\\' OR IFNULL(i.location, '') LIKE ? ESCAPE '\\' OR i.barcode = ?)");
    params.push(likeText(word), likeText(word), likeText(word), word);
  }
  const items = db.all<ItemDb>(`${ITEM_SELECT} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}`, params);
  const agg = aggregate(db, null);
  const rows = items.map((i) => strip(toRow(i, agg.get(i.id), today, s)));

  const counts: ItemPage['counts'] = { all: rows.length, warning: 0, expired: 0, low: 0, expiring: 0, soon_low: 0, ok: 0 };
  for (const r of rows) {
    counts[r.status] += 1;
    if (r.status !== 'ok') counts.warning += 1;
  }
  const status = q.status ?? 'all';
  const filtered = status === 'all' ? rows : status === 'warning' ? rows.filter((r) => r.status !== 'ok') : rows.filter((r) => r.status === status);

  const sign = q.dir === 'desc' ? -1 : 1;
  const byName = (a: ItemRow, b: ItemRow) => a.name.localeCompare(b.name, 'ko');
  const num = (v: number | null) => (v === null ? Number.POSITIVE_INFINITY : v);
  const sortKey = q.sort ?? 'status';
  const cmp: Record<NonNullable<ItemListQuery['sort']>, (a: ItemRow, b: ItemRow) => number> = {
    name: byName,
    category: (a, b) => a.category.localeCompare(b.category, 'ko'),
    stock: (a, b) => a.stock - b.stock,
    status: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
    dday: (a, b) => num(a.dday) - num(b.dday),
    lastPrice: (a, b) => num(a.lastPrice) - num(b.lastPrice),
    ratio: (a, b) => num(a.par > 0 ? a.stock / a.par : null) - num(b.par > 0 ? b.stock / b.par : null),
  };
  const sorted = [...filtered].sort((a, b) => cmp[sortKey](a, b) * sign || byName(a, b));

  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
  const page = Math.max(1, q.page ?? 1);
  const categories = db.all<{ category: string }>('SELECT DISTINCT category FROM items WHERE active = 1 ORDER BY category').map((r) => r.category);
  return { data: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, counts, categories };
}

/** 품목 상세: 로트별 잔량(유효기간 순), 최근 기록 20건, 단가 기록(오래된 것부터) */
export function getItemDetail(db: Db, clock: Clock, id: number): ItemDetail {
  const i = getItemDb(db, id);
  const s = readInventorySettings(db);
  const row = toRow(i, aggregate(db, id, true).get(id), todayKst(clock), s);
  const recent = listMoves(db, { itemId: id, page: 1, pageSize: 20 }).data;
  const prices = priceRows(db, s, { itemId: id }).reverse();
  return {
    ...strip(row),
    lots: row.lots.filter((l) => l.remaining > 0),
    recentMoves: recent,
    prices,
    defaultVendor: i.default_vendor_id && i.vendor_name ? { id: i.default_vendor_id, name: i.vendor_name } : null,
  };
}

/** 거래처 번호가 있는지 확인(없으면 400) */
function assertVendor(db: Db, vendorId: number | null | undefined, field = 'vendorId'): void {
  if (vendorId === null || vendorId === undefined) return;
  if (!db.get('SELECT id FROM vendors WHERE id = ?', [vendorId])) throw validationError({ [field]: '없는 거래처예요. 거래처를 다시 골라 주세요.' });
}

/** 같은 이름(대소문자·앞뒤 공백 무시) 품목이 있으면 경고 문구 */
function duplicateWarnings(db: Db, name: string, exceptId: number | null): string[] {
  const dup = db.get<{ id: number; active: number }>('SELECT id, active FROM items WHERE name = ? COLLATE NOCASE AND id <> ? LIMIT 1', [name.trim(), exceptId ?? 0]);
  if (!dup) return [];
  return [`같은 이름의 품목이 이미 있어요${dup.active ? '' : '(사용 안 함)'}. 같은 물건이면 기존 품목을 써 주세요.`];
}

/** 다른 품목이 이미 쓰는 바코드면 409(어느 품목인지 알려 준다) */
function assertBarcodeFree(db: Db, barcode: string | null | undefined, exceptId: number | null): void {
  if (!barcode) return;
  const other = db.get<{ id: number; name: string; active: number }>('SELECT id, name, active FROM items WHERE barcode = ? AND id <> ?', [barcode, exceptId ?? 0]);
  if (!other) return;
  const msg = `이 바코드는 이미 "${other.name}"${other.active ? '' : '(사용 안 함)'} 품목에 등록돼 있어요. 바코드를 다시 확인해 주세요.`;
  throw new AppError('CONFLICT', { message: msg, fields: { barcode: msg } });
}

/**
 * 바코드로 품목 하나를 찾는다(FR-130). 앞뒤 공백은 지우고 비교한다.
 * 없으면 404와 쉬운 안내. "사용 안 함" 품목도 돌려준다(화면이 출고 대신 안내를 보여 준다).
 */
export function findItemByBarcode(db: Db, clock: Clock, code: string): ItemRow {
  const barcode = normalizeBarcode(code);
  const found = barcode ? db.get<{ id: number }>('SELECT id FROM items WHERE barcode = ?', [barcode]) : undefined;
  if (!found) {
    throw new AppError('NOT_FOUND', { message: '이 바코드로 등록된 품목이 없어요. 품목 수정에서 바코드를 넣어 주세요.', extra: { barcode } });
  }
  return itemRow(db, clock, found.id);
}

/** 품목을 등록한다(M). 같은 이름이 있으면 저장하고 warnings로 알린다 */
export function createItem(ctx: AuditContext, input: ItemCreateInput): ItemSaveResult {
  const { db, clock } = ctx;
  assertVendor(db, input.vendorId);
  assertBarcodeFree(db, input.barcode, null);
  const warnings = duplicateWarnings(db, input.name, null);
  const now = clock.now().toISOString();
  const id = db.tx(() => {
    const r = db.run(
      'INSERT INTO items (name, category, unit, par_level, track_expiry, default_vendor_id, location, memo, barcode, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      [input.name, input.category, input.unit, input.par, input.trackExpiry, input.vendorId ?? null, input.location ?? null, input.memo ?? null, input.barcode ?? null, now, now],
    );
    audit(ctx, 'item.create', 'item', r.lastInsertRowid, { name: input.name, category: input.category, duplicateName: warnings.length > 0 });
    return r.lastInsertRowid;
  });
  return { item: itemRow(db, clock, id), warnings };
}

/** 품목을 고친다(M). 보낸 항목만 바꾼다. active:true면 "사용 안 함"을 풀어 다시 쓴다 */
export function updateItem(ctx: AuditContext, id: number, input: ItemPatchInput): ItemSaveResult {
  const { db, clock } = ctx;
  getItemDb(db, id);
  if (input.vendorId !== undefined) assertVendor(db, input.vendorId);
  if (input.barcode !== undefined) assertBarcodeFree(db, input.barcode, id);
  const map: Array<[keyof ItemPatchInput, string]> = [
    ['name', 'name'],
    ['category', 'category'],
    ['unit', 'unit'],
    ['par', 'par_level'],
    ['trackExpiry', 'track_expiry'],
    ['vendorId', 'default_vendor_id'],
    ['location', 'location'],
    ['memo', 'memo'],
    ['barcode', 'barcode'],
    ['active', 'active'],
  ];
  const sets: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  const changed: string[] = [];
  for (const [k, col] of map) {
    const v = input[k];
    if (v === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(v);
    changed.push(k);
  }
  const warnings = input.name !== undefined ? duplicateWarnings(db, input.name, id) : [];
  if (sets.length) {
    db.tx(() => {
      db.run(`UPDATE items SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, clock.now().toISOString(), id]);
      audit(ctx, input.active === true ? 'item.reactivate' : 'item.update', 'item', id, { changed });
    });
  }
  return { item: itemRow(db, clock, id), warnings };
}

/** 품목을 지운다(M). 입출고 기록이 있으면 지우지 않고 "사용 안 함"으로 바꾼다(FR-050 AC3) */
export function deleteItem(ctx: AuditContext, id: number): ItemDeleteResult {
  const { db, clock } = ctx;
  const i = getItemDb(db, id);
  const used = (db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_moves WHERE item_id = ?', [id])?.n ?? 0) > 0;
  return db.tx(() => {
    if (used) {
      db.run('UPDATE items SET active = 0, updated_at = ? WHERE id = ?', [clock.now().toISOString(), id]);
      audit(ctx, 'item.deactivate', 'item', id, { name: i.name, reason: 'has_moves' });
      return { deleted: false, deactivated: true };
    }
    db.run('DELETE FROM items WHERE id = ?', [id]);
    audit(ctx, 'item.delete', 'item', id, { name: i.name });
    return { deleted: true, deactivated: false };
  });
}

/** 수량을 화면 글자로: 5 → "5", 2.5 → "2.5" */
function qtyText(n: number): string {
  return String(roundQty(n));
}

/**
 * 입고·출고·조정을 기록한다(FR-051). 출고가 현재고보다 많으면 force 없이는 409 CONFLICT{needsConfirm}.
 * 사용 안 함 품목에는 기록하지 않는다. 기록 뒤 품목이 "부족"이면 실장 이상에게 알림(같은 날 같은 품목 1번).
 */
export function recordMove(ctx: AuditContext, input: MoveInput): MoveResult {
  const { db, clock } = ctx;
  const item = getItemDb(db, input.itemId);
  if (item.active !== 1) {
    throw new AppError('CONFLICT', { message: '"사용 안 함" 품목이라 기록할 수 없어요. 품목을 다시 사용으로 바꾼 뒤 기록해 주세요.' });
  }
  const before = aggregate(db, item.id).get(item.id) ?? EMPTY_AGG;
  const qty = roundQty(input.qty);
  if (input.type === 'out' && qty > before.stock && !input.force) {
    throw new AppError('CONFLICT', {
      message: `지금 재고(${qtyText(before.stock)}${item.unit})보다 많이 출고하려고 해요. 수량이 맞는지 확인해 주세요.`,
      extra: { needsConfirm: true, stock: before.stock, unit: item.unit },
    });
  }
  if (input.type === 'adjust' && roundQty(before.stock + qty) < 0) {
    throw validationError({ qty: `조정하면 재고가 0보다 적어져요. 지금 재고는 ${qtyText(before.stock)}${item.unit}예요.` });
  }
  const isIn = input.type === 'in';
  const vendorId = isIn ? (input.vendorId === undefined ? item.default_vendor_id : input.vendorId) : null;
  if (isIn) assertVendor(db, vendorId);
  const now = clock.now().toISOString();
  const moveId = db.tx(() => {
    const r = db.run(
      'INSERT INTO stock_moves (item_id, type, qty, unit_price, vendor_id, lot, expiry_on, reason, order_id, moved_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)',
      [
        item.id,
        input.type,
        qty,
        isIn ? (input.unitPrice ?? null) : null,
        vendorId ?? null,
        isIn ? (input.lot ?? null) : null,
        isIn && input.expiryOn ? input.expiryOn : null,
        input.reason ?? null,
        now,
        ctx.user?.id ?? null,
      ],
    );
    audit(ctx, 'stock.move', 'item', item.id, {
      moveId: r.lastInsertRowid,
      type: input.type,
      qty,
      ...(isIn && input.unitPrice != null ? { unitPrice: input.unitPrice } : {}),
      ...(input.type === 'out' && qty > before.stock ? { overStock: true } : {}),
    });
    return r.lastInsertRowid;
  });
  const row = itemRow(db, clock, item.id);
  if (input.type !== 'in' && row.status === 'low') emitNotification(db, lowStockNotice(row, todayKst(clock)), clock);
  const move = listMoves(db, { moveId, page: 1, pageSize: 1 }).data[0];
  if (!move) throw new AppError('INTERNAL');
  return { move, item: row };
}

/** 입출고 기록 조건 */
export interface MoveListQuery {
  itemId?: number;
  moveId?: number;
  type?: MoveType;
  /** 한국 날짜 YYYY-MM-DD(포함) */
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

interface MoveDb {
  id: number;
  item_id: number;
  item_name: string;
  unit: string;
  type: MoveType;
  qty: number;
  unit_price: number | null;
  vendor_id: number | null;
  vendor_name: string | null;
  lot: string | null;
  expiry_on: string | null;
  reason: string | null;
  order_id: number | null;
  moved_at: string;
  user_name: string | null;
}

function toMove(r: MoveDb): MoveRow {
  return {
    id: r.id,
    itemId: r.item_id,
    itemName: r.item_name,
    unit: r.unit,
    type: r.type,
    qty: r.qty,
    unitPrice: r.unit_price,
    vendorId: r.vendor_id,
    vendor: r.vendor_name,
    lot: r.lot,
    expiryOn: r.expiry_on,
    reason: r.reason,
    orderId: r.order_id,
    movedAt: r.moved_at,
    userName: r.user_name,
  };
}

/** 입출고 기록 목록(최근 것부터) */
export function listMoves(db: Db, q: MoveListQuery = {}): { data: MoveRow[]; total: number } {
  const cond: string[] = [];
  const params: (string | number)[] = [];
  if (q.moveId) {
    cond.push('m.id = ?');
    params.push(q.moveId);
  }
  if (q.itemId) {
    cond.push('m.item_id = ?');
    params.push(q.itemId);
  }
  if (q.type) {
    cond.push('m.type = ?');
    params.push(q.type);
  }
  if (q.from) {
    cond.push('m.moved_at >= ?');
    params.push(kstDayRangeUtc(q.from).from);
  }
  if (q.to) {
    cond.push('m.moved_at < ?');
    params.push(kstDayRangeUtc(q.to).to);
  }
  const word = q.q?.trim();
  if (word) {
    cond.push("i.name LIKE ? ESCAPE '\\'");
    params.push(likeText(word));
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const from = 'FROM stock_moves m JOIN items i ON i.id = m.item_id LEFT JOIN vendors v ON v.id = m.vendor_id LEFT JOIN users u ON u.id = m.user_id';
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n ${from} ${where}`, params)?.n ?? 0;
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
  const page = Math.max(1, q.page ?? 1);
  const rows = db.all<MoveDb>(
    `SELECT m.id, m.item_id, i.name AS item_name, i.unit, m.type, m.qty, m.unit_price, m.vendor_id, v.name AS vendor_name, m.lot, m.expiry_on,
       m.reason, m.order_id, m.moved_at, u.name AS user_name ${from} ${where} ORDER BY m.moved_at DESC, m.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { data: rows.map(toMove), total };
}

/** 단가 기록 조건 */
export interface PriceQuery {
  itemId?: number;
  vendorId?: number;
  /** true면 정해 둔 비율보다 오른 기록만 */
  up?: boolean;
  q?: string;
}

/** 단가 기록(최근 것부터). 직전 단가는 같은 품목의 바로 앞 입고 단가다(거래처 무관) */
function priceRows(db: Db, s: InventorySettings, q: PriceQuery): PriceRow[] {
  const inner: string[] = ["m.type = 'in'", 'm.unit_price IS NOT NULL'];
  const params: (string | number)[] = [];
  if (q.itemId) {
    inner.push('m.item_id = ?');
    params.push(q.itemId);
  }
  const word = q.q?.trim();
  if (word) {
    inner.push("i.name LIKE ? ESCAPE '\\'");
    params.push(likeText(word));
  }
  const rows = db.all<{ id: number; item_id: number; item_name: string; unit: string; vendor_id: number | null; vendor_name: string | null; unit_price: number; prev: number | null; moved_at: string }>(
    `SELECT m.id, m.item_id, i.name AS item_name, i.unit, m.vendor_id, v.name AS vendor_name, m.unit_price,
       LAG(m.unit_price) OVER (PARTITION BY m.item_id ORDER BY m.moved_at, m.id) AS prev, m.moved_at
     FROM stock_moves m JOIN items i ON i.id = m.item_id LEFT JOIN vendors v ON v.id = m.vendor_id
     WHERE ${inner.join(' AND ')} ORDER BY m.moved_at DESC, m.id DESC`,
    params,
  );
  const out: PriceRow[] = [];
  for (const r of rows) {
    if (q.vendorId && r.vendor_id !== q.vendorId) continue;
    const changePct = priceChangePct(r.prev, r.unit_price);
    const up = isPriceUp(changePct, s.priceAlertPct);
    if (q.up && !up) continue;
    out.push({ moveId: r.id, itemId: r.item_id, itemName: r.item_name, unit: r.unit, vendorId: r.vendor_id, vendor: r.vendor_name, unitPrice: r.unit_price, prevPrice: r.prev, changePct, up, movedAt: r.moved_at });
  }
  return out;
}

/** 단가 기록 목록(쪽 나누기) */
export function listPrices(db: Db, q: PriceQuery & { page?: number; pageSize?: number } = {}): { data: PriceRow[]; total: number; alertPct: number } {
  const s = readInventorySettings(db);
  const all = priceRows(db, s, q);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
  const page = Math.max(1, q.page ?? 1);
  return { data: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, alertPct: s.priceAlertPct };
}

interface VendorDb {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  order_method: string | null;
  memo: string | null;
  active: number;
  item_count: number;
}

function toVendor(v: VendorDb): VendorRow {
  return {
    id: v.id,
    name: v.name,
    contactName: v.contact_name,
    phone: v.phone,
    email: v.email,
    orderMethod: v.order_method,
    memo: v.memo,
    active: v.active === 1,
    itemCount: v.item_count,
  };
}

const VENDOR_SELECT = `SELECT v.id, v.name, v.contact_name, v.phone, v.email, v.order_method, v.memo, v.active,
  (SELECT COUNT(*) FROM items i WHERE i.default_vendor_id = v.id AND i.active = 1) AS item_count FROM vendors v`;

/** 거래처 목록(이름순). 기본은 사용 중인 곳만 */
export function listVendors(db: Db, opts: { active?: 'active' | 'inactive' | 'all' } = {}): VendorRow[] {
  const a = opts.active ?? 'active';
  const where = a === 'all' ? '' : `WHERE v.active = ${a === 'active' ? 1 : 0}`;
  return db.all<VendorDb>(`${VENDOR_SELECT} ${where} ORDER BY v.name COLLATE NOCASE`).map(toVendor);
}

function getVendor(db: Db, id: number): VendorRow {
  const v = db.get<VendorDb>(`${VENDOR_SELECT} WHERE v.id = ?`, [id]);
  if (!v) throw new AppError('NOT_FOUND', { message: '찾는 거래처가 없어요. 목록을 새로 고쳐 주세요.' });
  return toVendor(v);
}

/** 같은 상호가 있으면 409 */
function assertVendorName(db: Db, name: string, exceptId: number | null): void {
  if (db.get('SELECT id FROM vendors WHERE name = ? COLLATE NOCASE AND id <> ?', [name.trim(), exceptId ?? 0])) {
    throw new AppError('CONFLICT', { message: '같은 상호의 거래처가 이미 있어요. 기존 거래처를 고쳐 주세요.', fields: { name: '같은 상호의 거래처가 이미 있어요.' } });
  }
}

/** 거래처를 등록한다(M) */
export function createVendor(ctx: AuditContext, input: VendorCreateInput): VendorRow {
  const { db, clock } = ctx;
  assertVendorName(db, input.name, null);
  const now = clock.now().toISOString();
  const id = db.tx(() => {
    const r = db.run(
      'INSERT INTO vendors (name, contact_name, phone, email, order_method, memo, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      [input.name, input.contactName ?? null, input.phone ?? null, input.email ?? null, input.orderMethod ?? null, input.memo ?? null, now, now],
    );
    // 연락처는 감사 기록에 넣지 않는다(상호만)
    audit(ctx, 'vendor.create', 'vendor', r.lastInsertRowid, { name: input.name });
    return r.lastInsertRowid;
  });
  return getVendor(db, id);
}

/** 거래처를 고친다(M). active:false면 사용 안 함 */
export function updateVendor(ctx: AuditContext, id: number, input: VendorPatchInput): VendorRow {
  const { db, clock } = ctx;
  getVendor(db, id);
  if (input.name !== undefined) assertVendorName(db, input.name, id);
  const map: Array<[keyof VendorPatchInput, string]> = [
    ['name', 'name'],
    ['contactName', 'contact_name'],
    ['phone', 'phone'],
    ['email', 'email'],
    ['orderMethod', 'order_method'],
    ['memo', 'memo'],
    ['active', 'active'],
  ];
  const sets: string[] = [];
  const params: (string | number | boolean | null)[] = [];
  const changed: string[] = [];
  for (const [k, col] of map) {
    const v = input[k];
    if (v === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(v);
    changed.push(k);
  }
  if (sets.length) {
    db.tx(() => {
      db.run(`UPDATE vendors SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, clock.now().toISOString(), id]);
      audit(ctx, 'vendor.update', 'vendor', id, { changed });
    });
  }
  return getVendor(db, id);
}

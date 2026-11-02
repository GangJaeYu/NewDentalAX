// 이 파일이 하는 일: 발주서 데모 데이터(database.md §11, 하늘숲치과). 재고 데모(seed.ts)를 넣은 다음에 불린다.
// ① 입고 완료 발주서 1건: 청정위생 품목의 최근 입고 기록(최대 3개)을 한 발주서로 묶고, 그 입고 기록에 발주서 번호(order_id)를 단다.
// ② 발주함 발주서 1건: 미소치재 품목 중 부족·곧 부족인 것(최대 3개)을 권장 수량으로 담아 이틀 전에 발주한 것으로 둔다.
// 나머지 부족 품목(한빛덴탈 등)은 비워 두어 화면에서 "발주서 만들기"를 눌러 볼 수 있다. 거래처·품목은 모두 가상이고 환자 정보는 없다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { DAY_MS } from '../../lib/clock.ts';
import { formatPoNo, suggestedQty } from '../../../shared/schemas/orders.ts';
import { kstDate } from '../../lib/dates.ts';
import { readInventorySettings } from './settings.ts';
import { listItems } from './service.ts';

/** 발주서 기능이 소유한 테이블(초기화 때 비울 대상, 가리키는 쪽부터) */
export const orderTables: readonly string[] = ['purchase_orders', 'po_lines'];

/** 그 달(KST)의 다음 발주 번호 */
function nextPoNo(db: Db, at: Date): string {
  const month = kstDate(at).slice(0, 7);
  const prefix = formatPoNo(month, 0).slice(0, -3);
  const last = db.get<{ po_no: string }>('SELECT po_no FROM purchase_orders WHERE po_no LIKE ? ORDER BY po_no DESC LIMIT 1', [`${prefix}%`]);
  return formatPoNo(month, last ? Number(last.po_no.slice(prefix.length)) + 1 : 1);
}

/** 발주서 데모 2건을 넣는다(거래처가 없으면 건너뛴다) */
export function seedOrdersDemo(db: Db, ctx: SeedContext): void {
  const now = ctx.clock.now();
  const vendorId = (name: string) => db.get<{ id: number }>('SELECT id FROM vendors WHERE name = ?', [name])?.id ?? null;
  const manager = db.get<{ id: number }>("SELECT id FROM users WHERE active = 1 AND role IN ('manager', 'admin') ORDER BY role DESC, id LIMIT 1")?.id ?? null;
  const iso = (d: Date) => d.toISOString();

  db.tx(() => {
    // ① 입고 완료: 청정위생의 최근 입고 기록 3개(품목별 가장 최근 1건)
    const clean = vendorId('청정위생');
    if (clean) {
      const moves = db.all<{ id: number; item_id: number; qty: number; unit_price: number | null; moved_at: string }>(
        `SELECT m.id, m.item_id, m.qty, m.unit_price, m.moved_at FROM stock_moves m
         WHERE m.type = 'in' AND m.vendor_id = ? AND m.order_id IS NULL
           AND m.id = (SELECT m2.id FROM stock_moves m2 WHERE m2.item_id = m.item_id AND m2.type = 'in' ORDER BY m2.moved_at DESC, m2.id DESC LIMIT 1)
         ORDER BY m.moved_at DESC LIMIT 3`,
        [clean],
      );
      if (moves.length) {
        const receivedAt = new Date(Math.min(...moves.map((m) => new Date(m.moved_at).getTime())));
        const orderedAt = new Date(receivedAt.getTime() - 2 * DAY_MS);
        const createdAt = new Date(orderedAt.getTime() - 60 * 60 * 1000);
        const r = db.run(
          "INSERT INTO purchase_orders (po_no, vendor_id, status, note, created_by, created_at, updated_at, ordered_at, received_at) VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?)",
          [nextPoNo(db, createdAt), clean, '정기 주문(주 2회 배송분)', manager, iso(createdAt), iso(receivedAt), iso(orderedAt), iso(receivedAt)],
        );
        for (const m of moves) {
          db.run('INSERT OR IGNORE INTO po_lines (po_id, item_id, qty, unit_price) VALUES (?, ?, ?, ?)', [r.lastInsertRowid, m.item_id, m.qty, m.unit_price]);
          db.run('UPDATE stock_moves SET order_id = ? WHERE id = ?', [r.lastInsertRowid, m.id]);
        }
      }
    }

    // ② 발주함: 미소치재 품목 중 부족·곧 부족(최대 3개)
    const miso = vendorId('미소치재');
    if (miso) {
      const ratio = readInventorySettings(db).soonLowRatio;
      const low = listItems(db, ctx.clock, { vendorId: miso, pageSize: 200 })
        .data.filter((i) => i.par > 0 && i.stock <= i.par * ratio && suggestedQty(i.par, i.stock) > 0)
        .slice(0, 3);
      if (low.length) {
        const orderedAt = new Date(now.getTime() - 2 * DAY_MS);
        const createdAt = new Date(orderedAt.getTime() - 30 * 60 * 1000);
        const r = db.run(
          "INSERT INTO purchase_orders (po_no, vendor_id, status, note, created_by, created_at, updated_at, ordered_at) VALUES (?, ?, 'ordered', ?, ?, ?, ?, ?)",
          [nextPoNo(db, createdAt), miso, '온라인 몰로 주문함', manager, iso(createdAt), iso(orderedAt), iso(orderedAt)],
        );
        for (const i of low) db.run('INSERT INTO po_lines (po_id, item_id, qty, unit_price) VALUES (?, ?, ?, ?)', [r.lastInsertRowid, i.id, suggestedQty(i.par, i.stock), i.lastPrice]);
      }
    }
  });
}

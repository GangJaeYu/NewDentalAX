-- 이 파일이 하는 일: 발주서 테이블을 만든다(database.md §3.1, FR-054). 발주서(purchase_orders)와 발주 품목 줄(po_lines).
-- 발주 번호는 PO-YYMM-NNN(한국 날짜 기준 달마다 001부터)이고, 상태는 작성(draft) → 발주함(ordered) → 입고 완료(received), 또는 취소(canceled)다.
-- 거래처가 없는 품목도 초안에 담을 수 있게 vendor_id는 비워 둘 수 있다(발주할 때는 거래처가 꼭 있어야 한다, 서비스에서 확인).
-- po_lines.unit_price는 만들 때의 최근 입고 단가다(없으면 비움). 입고 기록(stock_moves.order_id)은 이 표의 id를 숫자로 담는다(020에서 제약 없이 만듦).
-- 환자 관련 열은 두지 않는다(NFR-001). 시각은 ISO-8601 UTC 문자열(_at)이다.

CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  po_no TEXT NOT NULL UNIQUE,
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'received', 'canceled')),
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ordered_at TEXT,
  received_at TEXT,
  canceled_at TEXT
);
CREATE INDEX idx_purchase_orders_status ON purchase_orders (status, created_at);

CREATE TABLE po_lines (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty REAL NOT NULL CHECK (qty > 0),
  unit_price REAL CHECK (unit_price IS NULL OR unit_price >= 0),
  UNIQUE (po_id, item_id)
);
CREATE INDEX idx_po_lines_item ON po_lines (item_id);

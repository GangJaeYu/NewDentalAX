-- 이 파일이 하는 일: 재고 테이블을 만든다(database.md §3.1). 거래처(vendors), 품목(items), 입출고 기록(stock_moves).
-- 현재고·상태·유효기간 상태는 저장하지 않고 입출고 기록으로 계산한다(database.md §3.2). 거래처는 사업자 정보라 연락처 열을 둔다.
-- 발주서(purchase_orders·po_lines)는 phase-03-task-02의 021_orders.sql이 만든다. stock_moves.order_id는 그 표의 id를 담는 칸이다
-- (SQLite는 나중에 외래키를 더할 수 없어 여기서는 연결 제약 없이 숫자만 둔다).
-- 환자 관련 열은 두지 않는다(NFR-001). 시각은 ISO-8601 UTC 문자열(_at), 날짜는 YYYY-MM-DD(_on), 불리언은 0/1이다.

CREATE TABLE vendors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  order_method TEXT,
  memo TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  par_level REAL NOT NULL DEFAULT 0 CHECK (par_level >= 0),
  track_expiry INTEGER NOT NULL DEFAULT 0 CHECK (track_expiry IN (0, 1)),
  default_vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  location TEXT,
  memo TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_items_active_category ON items (active, category);
CREATE INDEX idx_items_name ON items (name);

-- qty는 in·out에서 양수, adjust(실사 조정)에서만 부호가 있다(+ 늘림, − 줄임)
CREATE TABLE stock_moves (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('in', 'out', 'adjust')),
  qty REAL NOT NULL CHECK ((type = 'adjust' AND qty <> 0) OR (type <> 'adjust' AND qty > 0)),
  unit_price REAL CHECK (unit_price IS NULL OR unit_price >= 0),
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  lot TEXT,
  expiry_on TEXT,
  reason TEXT,
  order_id INTEGER,
  moved_at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_stock_moves_item_at ON stock_moves (item_id, moved_at);
CREATE INDEX idx_stock_moves_price ON stock_moves (type, item_id, vendor_id, moved_at);

-- 이 파일이 하는 일: 지출 분류(expense_categories)와 지출 기록(expenses) 테이블을 만든다(database.md §9, FR-110·111, phase-04-task-04).
-- 금액은 원 단위 정수다. 결제 수단은 종류만 고른다(card 카드, transfer 계좌이체, cash 현금, other 기타). 카드 번호 같은 값은 두지 않는다.
-- 분류의 code는 기능이 기대는 분류 표시다('material' = 재료비: 발주 입고 지출의 기본 분류, 재료비 추이 그래프). 이름은 바꿔도 code는 남는다.
-- stock_move_ref는 입고 묶음 참조('order:<발주서 id>' 또는 'receipt:<파일 id>')로, 같은 입고가 지출로 두 번 기록되지 않게 막는다.
-- 매출 테이블과 환자 관련 열은 두지 않는다(FR-110 AC3, NFR-001). 지운 지출은 deleted_at만 채운다. 시각은 ISO-8601 UTC(_at), date는 YYYY-MM-DD(KST)다.

CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  code TEXT UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

-- 기본 분류(database.md §9 seed). 데모 초기화 때도 남는다(database.md §11)
INSERT INTO expense_categories (name, code, sort) VALUES
  ('재료비', 'material', 1),
  ('장비', NULL, 2),
  ('임대료', NULL, 3),
  ('공과금', NULL, 4),
  ('인건비 외', NULL, 5),
  ('마케팅', NULL, 6),
  ('기타', 'other', 7);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  category_id INTEGER NOT NULL REFERENCES expense_categories(id),
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  pay_method TEXT NOT NULL DEFAULT 'card' CHECK (pay_method IN ('card', 'transfer', 'cash', 'other')),
  memo TEXT,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  stock_move_ref TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_expenses_date ON expenses (date);
CREATE INDEX idx_expenses_category ON expenses (category_id, date);
-- 같은 입고 묶음은 지운 것을 빼고 한 번만 지출로 남는다
CREATE UNIQUE INDEX idx_expenses_stock_ref ON expenses (stock_move_ref) WHERE stock_move_ref IS NOT NULL AND deleted_at IS NULL;

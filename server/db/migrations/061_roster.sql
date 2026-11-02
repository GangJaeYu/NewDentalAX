-- 이 파일이 하는 일: 인사 모듈의 근무 유형(shift_types)과 근무표(roster)를 만든다(database.md §7, FR-081, phase-04-task-01).
-- 근무 유형 기본 5개(종일·오전·오후·야간·휴무)를 함께 넣는다. 근무 유형은 데모 초기화 뒤에도 남는 사전이다(admin/demo-service.ts KEEP_TABLES).
-- 근무표는 직원 × 날짜마다 한 칸이다(PK user_id, date). 승인된 휴가는 이 표에 쓰지 않고 조회할 때 leave_requests에서 덧씌운다(overview §3.6).
-- 근무 유형은 지우지 않고 active=0으로 숨긴다(지난 근무표가 그 유형을 계속 가리키게). 환자 정보 열은 두지 않는다(NFR-001).

CREATE TABLE shift_types (
  id INTEGER PRIMARY KEY,
  -- 기본 유형은 full/am/pm/night/off, 관리자가 더한 유형은 custom-<번호>
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  -- 'HH:MM'. 휴무처럼 시간이 없는 유형은 둘 다 NULL
  start_time TEXT,
  end_time TEXT,
  -- 칩 색 이름(tokens.css 의미 색). 글자도 함께 보여 주므로 색만으로 구분하지 않는다
  color_token TEXT NOT NULL DEFAULT 'info' CHECK (color_token IN ('accent', 'info', 'ok', 'warn', 'ghost')),
  -- 날짜별 근무 인원 합계에 넣는지(휴무는 0)
  counts_as_work INTEGER NOT NULL DEFAULT 1 CHECK (counts_as_work IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CHECK ((start_time IS NULL) = (end_time IS NULL))
);

INSERT INTO shift_types (code, label, start_time, end_time, color_token, counts_as_work, sort, active) VALUES
  ('full', '종일', '09:30', '18:30', 'info', 1, 1, 1),
  ('am', '오전', '09:30', '13:00', 'ok', 1, 2, 1),
  ('pm', '오후', '14:00', '18:30', 'accent', 1, 3, 1),
  ('night', '야간', '13:00', '20:30', 'warn', 1, 4, 1),
  ('off', '휴무', NULL, NULL, 'ghost', 0, 5, 1);

CREATE TABLE roster (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  shift_type_id INTEGER NOT NULL REFERENCES shift_types(id),
  note TEXT,
  PRIMARY KEY (user_id, date)
);
CREATE INDEX idx_roster_date ON roster (date);

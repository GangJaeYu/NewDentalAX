-- 이 파일이 하는 일: 시설 모듈의 장비 대장(equipment), 점검·수리 이력(equipment_logs), 멸균기 점검 기록(sterilizer_logs)을 만든다(database.md §8, FR-101·102, phase-04-task-03).
-- 다음 점검일은 저장하지 않고 "마지막 점검일(없으면 설치일) + 점검 주기(개월)"로 그때그때 계산한다.
-- 멸균 기록에는 환자 관련 열을 두지 않는다(FR-102 AC1, NFR-001). result = 'fail' AND action_at IS NULL이면 조치 전 경고(대시보드·멸균 화면)다.
-- legal_tasks.equipment_id(050)는 외래키 없이 숫자만 둔다. 장비를 지워도 법정 일정은 남는다(장비는 끄기만 하고 지우지 않는다).

CREATE TABLE equipment (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('xray', 'sterilizer', 'unit_chair', 'compressor', 'suction', 'other')),
  installed_on TEXT,
  vendor_name TEXT,
  -- 정기 점검 주기(개월). NULL이면 정기 점검 없음(고장 때만 수리)
  inspect_cycle_months INTEGER CHECK (inspect_cycle_months IS NULL OR inspect_cycle_months BETWEEN 1 AND 120),
  memo TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_equipment_kind ON equipment (active, kind);

CREATE TABLE equipment_logs (
  id INTEGER PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('inspection', 'repair')),
  content TEXT NOT NULL,
  -- 비용(원). 모르면 NULL
  cost INTEGER CHECK (cost IS NULL OR cost >= 0),
  vendor_name TEXT,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_equipment_logs_eq ON equipment_logs (equipment_id, kind, date);

CREATE TABLE sterilizer_logs (
  id INTEGER PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  -- bd = B&D(보위딕) 테스트, bi = 생물학적 지표, ci = 화학적 지표, cycle = 일반 사이클 기록
  test_type TEXT NOT NULL CHECK (test_type IN ('bd', 'bi', 'ci', 'cycle')),
  cycle_no TEXT,
  temp_c REAL,
  pressure_kpa REAL,
  minutes REAL,
  result TEXT NOT NULL CHECK (result IN ('pass', 'fail')),
  action_taken TEXT,
  action_at TEXT,
  -- 조치를 기록한 사람
  action_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sterilizer_logs_date ON sterilizer_logs (date, equipment_id);
CREATE INDEX idx_sterilizer_logs_open ON sterilizer_logs (result, action_at);

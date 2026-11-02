-- 이 파일이 하는 일: 시설 모듈의 법정 의무 일정(legal_tasks)과 수행 이력(legal_task_logs)을 만든다(database.md §8, FR-100, phase-03-task-08).
-- 기본 템플릿(TRD TD-022 표 22행)은 server/db/seed/legal-templates.ts가 서버 시작 때 빠진 것만 넣는다(template_key로 구분, 데모 초기화 뒤에도 남음).
-- 다음 예정일은 저장하지 않고 last_done_on + 주기(cycle_months, cycle_days)로 그때그때 계산한다. 주기가 없으면 안내 항목이다.
-- 장비 표(equipment)는 phase-04-task-03이 다음 번호로 만들므로 equipment_id에는 아직 외래키를 걸지 않는다. 환자 정보 열은 두지 않는다(NFR-001).

CREATE TABLE legal_tasks (
  id INTEGER PRIMARY KEY,
  -- 기본 템플릿 항목의 고유 이름(직접 추가한 항목은 NULL)
  template_key TEXT UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('radiation', 'waste', 'fire', 'privacy', 'infection', 'labor', 'report', 'license', 'other')),
  cycle_months INTEGER CHECK (cycle_months IS NULL OR cycle_months BETWEEN 1 AND 120),
  cycle_days INTEGER CHECK (cycle_days IS NULL OR cycle_days BETWEEN 1 AND 3650),
  -- 화면에 보여 줄 주기 설명(예: '3년, 만료일 전후 31일이 검사기간'). NULL이면 주기 숫자로 만든다
  cycle_text TEXT,
  -- 근거 조항(예: '진단용 방사선 규칙 제4조')
  basis TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  verify_status TEXT NOT NULL DEFAULT 'needs_check' CHECK (verify_status IN ('verified', 'recommended', 'needs_check')),
  applicability TEXT NOT NULL DEFAULT 'always' CHECK (applicability IN ('always', 'conditional')),
  -- 적용 조건 설명(예: '해당 시(스프링클러 설치 건물 등)')
  applies_text TEXT,
  -- 템플릿 설명(적용 배제 조건·대체 방법·확인 못 한 점)
  guidance TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  equipment_id INTEGER,
  last_done_on TEXT,
  note TEXT,
  -- 법령을 확인한 날
  checked_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_legal_tasks_enabled ON legal_tasks (enabled, category);

CREATE TABLE legal_task_logs (
  id INTEGER PRIMARY KEY,
  legal_task_id INTEGER NOT NULL REFERENCES legal_tasks(id) ON DELETE CASCADE,
  done_on TEXT NOT NULL,
  note TEXT,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_legal_task_logs_task ON legal_task_logs (legal_task_id, done_on);

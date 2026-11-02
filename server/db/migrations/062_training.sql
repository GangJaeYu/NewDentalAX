-- 이 파일이 하는 일: 인사 모듈의 교육 이수 기록(trainings·training_records)과 신규 직원 온보딩(onboarding_*) 테이블을 만든다(database.md §7, FR-082·083, phase-04-task-02).
-- 교육: 항목마다 주기(개월, 없으면 한 번만)를 두고, 직원별 이수일·증빙 파일(files, purpose training)을 쌓는다. 다음 예정일 = 가장 최근 이수일 + 주기(저장하지 않고 계산).
-- 법정 의무 일정(legal_tasks)과는 trainings.legal_task_id로 선택해서 잇는다. 온보딩: 직무별 템플릿 → 직원에게 배정(항목 복사) → 항목별 체크(진행률은 계산).
-- 환자 정보 열은 두지 않는다(NFR-001).

CREATE TABLE trainings (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  -- 주기(개월). NULL이면 한 번만 받는 교육이라 다음 예정일이 없다
  cycle_months INTEGER CHECK (cycle_months IS NULL OR (cycle_months BETWEEN 1 AND 120)),
  description TEXT NOT NULL DEFAULT '',
  legal_task_id INTEGER REFERENCES legal_tasks(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE training_records (
  id INTEGER PRIMARY KEY,
  training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  completed_on TEXT NOT NULL,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_training_records_pair ON training_records (training_id, user_id, completed_on);
CREATE INDEX idx_training_records_user ON training_records (user_id);

CREATE TABLE onboarding_templates (
  id INTEGER PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('hygienist', 'assistant', 'desk', 'doctor', 'other')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  -- 체크리스트 항목(JSON 문자열 배열)
  items TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('ai', 'manual')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE onboarding_assignments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  template_id INTEGER REFERENCES onboarding_templates(id) ON DELETE SET NULL,
  mentor_id INTEGER NOT NULL REFERENCES users(id),
  started_on TEXT NOT NULL,
  -- 배정할 때의 제목·항목을 복사해 둔다(템플릿을 고쳐도 진행 중인 배정은 그대로)
  title TEXT NOT NULL,
  items_snapshot TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK (user_id <> mentor_id)
);
CREATE INDEX idx_onboarding_assignments_user ON onboarding_assignments (user_id);
CREATE INDEX idx_onboarding_assignments_mentor ON onboarding_assignments (mentor_id);

CREATE TABLE onboarding_progress (
  assignment_id INTEGER NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL CHECK (item_index >= 0),
  done_at TEXT NOT NULL,
  done_by INTEGER REFERENCES users(id),
  PRIMARY KEY (assignment_id, item_index)
);

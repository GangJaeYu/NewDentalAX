-- 이 파일이 하는 일: 데스크 모듈의 공지·인수인계(posts)와 읽음 기록(post_reads), 오픈·마감 체크리스트 항목(checklist_items)과
-- 날짜별 체크 기록(checklist_checks)을 만든다(database.md §2, FR-040·041, phase-03-task-04).
-- 체크 기록은 (항목, 날짜)마다 한 줄이고, 체크를 풀면 그 줄을 지운다(오늘 날짜만). 지난 날짜 기록은 그대로 남아 조회만 된다.
-- 환자 정보 열은 두지 않는다(NFR-001). 저장 문구(saved_texts)·광고 규칙(ad_rules)은 phase-03-task-05가 다음 번호로 만든다.

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('notice', 'handover')),
  category TEXT NOT NULL DEFAULT '일반',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  author_id INTEGER NOT NULL REFERENCES users(id),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_posts_kind ON posts (kind, pinned, created_at);

CREATE TABLE post_reads (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE checklist_items (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('open', 'close')),
  text TEXT NOT NULL,
  -- 담당 직무(users.job_type 값). NULL이면 모두
  role_hint TEXT CHECK (role_hint IS NULL OR role_hint IN ('hygienist', 'assistant', 'desk', 'doctor', 'other')),
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE INDEX idx_checklist_items_kind ON checklist_items (kind, active, sort);

CREATE TABLE checklist_checks (
  item_id INTEGER NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  checked_by INTEGER NOT NULL REFERENCES users(id),
  checked_at TEXT NOT NULL,
  PRIMARY KEY (item_id, date)
);
CREATE INDEX idx_checklist_checks_date ON checklist_checks (date);

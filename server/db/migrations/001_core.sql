-- 이 파일이 하는 일: 공통·보안 테이블을 만든다(database.md §1). 설정(settings), 직원 계정(users), 로그인 세션(sessions),
-- 로그인 실패 기록(login_attempts), 감사 로그(audit_log, 고치기·지우기를 트리거로 막음), 알림(notifications), 업로드 파일(files).
-- 환자 관련 열은 두지 않는다(NFR-001). 시각은 ISO-8601 UTC 문자열(_at), 날짜는 YYYY-MM-DD(_on), 불리언은 0/1이다.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL
);

-- 직원 정보는 이 열들만 둔다(FR-004 AC1). 연락처·주소 같은 열을 더하지 않는다.
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
  job_type TEXT NOT NULL DEFAULT 'other' CHECK (job_type IN ('hygienist', 'assistant', 'desk', 'doctor', 'other')),
  hired_on TEXT,
  password_hash TEXT NOT NULL,
  must_change_pw INTEGER NOT NULL DEFAULT 0 CHECK (must_change_pw IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT
);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);
CREATE INDEX idx_sessions_user ON sessions (user_id);

-- IP별 제한은 메모리에 두고, 아이디별 실패 횟수만 저장한다
CREATE TABLE login_attempts (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT,
  locked_until TEXT
);

-- 감사 로그: 한 번 쓰면 고치거나 지울 수 없다(FR-005 AC3). 사용자가 바뀌어도 기록이 남도록 username을 함께 적는다.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT CHECK (detail IS NULL OR json_valid(detail)),
  ip TEXT
);
CREATE INDEX idx_audit_at ON audit_log (at);
CREATE INDEX idx_audit_user_at ON audit_log (user_id, at);
CREATE INDEX idx_audit_action ON audit_log (action);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, '감사 로그는 고칠 수 없습니다.');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, '감사 로그는 지울 수 없습니다.');
END;

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX idx_notifications_user_read ON notifications (user_id, read_at);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  stored_path TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  sha256 TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('form', 'kb', 'receipt', 'training', 'equipment', 'expense')),
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_files_purpose ON files (purpose);

-- 이 파일이 하는 일: 인사 모듈의 연차·휴가 신청(leave_requests)과 직원별 해마다 부여 일수(leave_allowances)를 만든다(database.md §7, FR-080, phase-03-task-09).
-- 신청은 pending(대기) → approved(승인)·rejected(반려, 사유 필수)·canceled(본인 취소)로 바뀐다. days는 영업일 기준 일수이고 반차는 0.5다.
-- 근무 유형(shift_types)·근무표(roster)는 phase-04-task-01이 061에서 만든다. 환자 정보 열은 두지 않는다(NFR-001).

CREATE TABLE leave_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('annual', 'half_am', 'half_pm', 'sick', 'other')),
  start_on TEXT NOT NULL,
  end_on TEXT NOT NULL,
  days REAL NOT NULL CHECK (days > 0),
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (end_on >= start_on),
  -- 반려는 사유가 꼭 있어야 한다
  CHECK (status <> 'rejected' OR (reject_reason IS NOT NULL AND length(trim(reject_reason)) > 0))
);
CREATE INDEX idx_leave_requests_status ON leave_requests (status);
CREATE INDEX idx_leave_requests_start ON leave_requests (start_on);
CREATE INDEX idx_leave_requests_user ON leave_requests (user_id, start_on);

CREATE TABLE leave_allowances (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  days REAL NOT NULL CHECK (days >= 0),
  PRIMARY KEY (user_id, year)
);

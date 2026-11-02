-- 이 파일이 하는 일: 보관 문구 테이블 saved_texts를 만든다(database.md §2, FR-042~044, phase-03-task-05).
-- 응대 스크립트·문자/안내문 템플릿·리뷰 답글(그리고 뒤 태스크의 홍보 글·채용 공고·온보딩 초안)을 종류(kind)·분류(category)로 보관한다.
-- shared=1이면 모든 직원이 보는 공용 문구이고 실장 이상만 고친다. 0이면 만든 사람만 본다. 지우기는 deleted_at을 채우는 숨김이다.
-- 환자 정보 열은 두지 않는다(NFR-001). 광고 점검 규칙(ad_rules)은 의료광고 점검 태스크(phase-04-task-06, 080번대)가 만든다.

CREATE TABLE saved_texts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('script', 'template', 'review_reply', 'promo', 'hiring', 'onboarding')),
  category TEXT NOT NULL DEFAULT '기타',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  -- 화면별 추가 정보(JSON: 말투·상황 등)
  meta TEXT,
  shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_saved_texts_kind ON saved_texts (kind, deleted_at, updated_at);
CREATE INDEX idx_saved_texts_owner ON saved_texts (created_by, kind);

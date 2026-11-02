-- 이 파일이 하는 일: 의료광고 1차 점검 사전(ad_rules)을 만든다(database.md §2, FR-120, phase-04-task-06).
-- 기본 규칙(최고·유일·100%·전후 비교·경험담·할인/무료 강조·비교 광고 등)은 server/db/seed/ad-rules.ts가 서버 시작 때 빠진 것만 넣는다(rule_key로 구분).
-- admin이 추가한 규칙은 rule_key가 NULL이다. 이 표는 데모 초기화 뒤에도 남는다(database.md §11, demo-service KEEP_TABLES).
-- 환자 정보 열은 두지 않는다(NFR-001).

CREATE TABLE ad_rules (
  id INTEGER PRIMARY KEY,
  -- 기본 규칙의 고유 이름(admin이 추가한 규칙은 NULL)
  rule_key TEXT UNIQUE,
  -- 찾을 말(word) 또는 정규식(regex)
  pattern TEXT NOT NULL CHECK (length(pattern) BETWEEN 1 AND 200),
  match_type TEXT NOT NULL DEFAULT 'word' CHECK (match_type IN ('word', 'regex')),
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('superlative', 'guarantee', 'before_after', 'testimonial', 'discount', 'free', 'comparison', 'other')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('high', 'medium')),
  reason TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_ad_rules_active ON ad_rules (active, sort);

-- 이 파일이 하는 일: AI 모델·단가 표(ai_models)와 AI 사용 기록(ai_usage)을 만들고, 모델·단가 기본값을 넣는다(database.md §10, TD-021).
-- 단가는 USD / 100만 토큰이다. 확인일 2026-11-02, 출처 URL은 행마다 적는다. 관리자가 /api/ai/models로 고칠 수 있다(FR-036).
-- ai_usage에는 프롬프트 원문을 저장하지 않는다(FR-034 AC1). privacy 열은 {종류: 건수} 요약만 담는다.

CREATE TABLE ai_models (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai', 'gemini')),
  model_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('fast', 'standard', 'premium')),
  input_usd_per_m REAL NOT NULL CHECK (input_usd_per_m >= 0),
  output_usd_per_m REAL NOT NULL CHECK (output_usd_per_m >= 0),
  long_threshold_tokens INTEGER CHECK (long_threshold_tokens IS NULL OR long_threshold_tokens > 0),
  long_input_usd_per_m REAL CHECK (long_input_usd_per_m IS NULL OR long_input_usd_per_m >= 0),
  long_output_usd_per_m REAL CHECK (long_output_usd_per_m IS NULL OR long_output_usd_per_m >= 0),
  supports_images INTEGER NOT NULL DEFAULT 0 CHECK (supports_images IN (0, 1)),
  checked_on TEXT,
  source_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
-- 공급자·등급마다 활성 모델은 하나뿐이다
CREATE UNIQUE INDEX idx_ai_models_active ON ai_models (provider, tier) WHERE active = 1;

CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  cost_krw REAL NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0 CHECK (estimated IN (0, 1)),
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'blocked')),
  error_code TEXT,
  privacy TEXT CHECK (privacy IS NULL OR json_valid(privacy)),
  duration_ms INTEGER
);
CREATE INDEX idx_ai_usage_at ON ai_usage (at);
CREATE INDEX idx_ai_usage_user_at ON ai_usage (user_id, at);
CREATE INDEX idx_ai_usage_feature_at ON ai_usage (feature, at);

-- 모델·단가 기본값(TD-021, 2026-11-02 공식 가격 페이지 확인). 사진은 세 공급자 모두 표준·고급 모델이 읽을 수 있다고 본다
INSERT INTO ai_models (provider, model_id, tier, input_usd_per_m, output_usd_per_m, long_threshold_tokens, long_input_usd_per_m, long_output_usd_per_m, supports_images, checked_on, source_url) VALUES
  ('anthropic', 'claude-haiku-5-5', 'fast', 0.10, 0.50, 100000, 0.50, 2.50, 1, '2026-11-02', 'https://platform.claude.com/docs/en/about-claude/pricing'),
  ('anthropic', 'claude-sonnet-5-5', 'standard', 2.00, 10.00, NULL, NULL, NULL, 1, '2026-11-02', 'https://platform.claude.com/docs/en/about-claude/pricing'),
  ('anthropic', 'claude-opus-5-5', 'premium', 4.00, 20.00, NULL, NULL, NULL, 1, '2026-11-02', 'https://platform.claude.com/docs/en/about-claude/pricing'),
  ('openai', 'gpt-6-luna', 'fast', 0.10, 0.50, NULL, NULL, NULL, 1, '2026-11-02', 'https://developers.openai.com/api/docs/pricing'),
  ('openai', 'gpt-6.1-terra', 'standard', 1.00, 5.00, NULL, NULL, NULL, 1, '2026-11-02', 'https://developers.openai.com/api/docs/pricing'),
  ('openai', 'gpt-6.1-sol', 'premium', 2.00, 10.00, NULL, NULL, NULL, 1, '2026-11-02', 'https://developers.openai.com/api/docs/pricing'),
  ('gemini', 'gemini-3.1-flash-lite', 'fast', 0.25, 1.50, NULL, NULL, NULL, 1, '2026-11-02', 'https://ai.google.dev/gemini-api/docs/pricing'),
  ('gemini', 'gemini-3.8-flash', 'standard', 0.75, 3.75, NULL, NULL, NULL, 1, '2026-11-02', 'https://ai.google.dev/gemini-api/docs/pricing'),
  ('gemini', 'gemini-4-argon', 'premium', 2.00, 10.00, NULL, NULL, NULL, 1, '2026-11-02', 'https://ai.google.dev/gemini-api/docs/pricing');

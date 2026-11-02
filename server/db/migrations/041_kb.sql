-- 이 파일이 하는 일: 원내 AI 도우미의 자료(kb_docs)·조각(kb_chunks)·검색 색인(kb_fts)·대화 기록(assistant_messages)을 만든다(database.md §6, FR-070·071).
-- kb_fts의 정의는 server/modules/assistant/search.ts의 KB_FTS_DDL과 같다(01-06 결정, 2-gram 글을 unicode61로 끊는다). rowid = kb_chunks.id.
-- body는 꺼낸 글(개인정보 검토가 끝나면 가린 글)이고, findings는 감지한 개인정보 종류별 건수 [{type,count}]만 담는다(원문 값은 담지 않는다).
-- 시각은 ISO-8601 UTC 문자열(_at)이다. 지운 자료는 deleted_at을 채우고 조각·색인을 지운다. 환자 관련 열은 두지 않는다(NFR-001).

CREATE TABLE kb_docs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  file_id INTEGER REFERENCES files(id),
  document_id INTEGER REFERENCES documents(id),
  visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all', 'manager')),
  status TEXT NOT NULL CHECK (status IN ('processing', 'needs_review', 'ready', 'failed')),
  error TEXT,
  body TEXT NOT NULL DEFAULT '',
  findings TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(findings)),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_kb_docs_list ON kb_docs (deleted_at, status, visibility);

CREATE TABLE kb_chunks (
  id INTEGER PRIMARY KEY,
  kb_doc_id INTEGER NOT NULL REFERENCES kb_docs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  heading TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX idx_kb_chunks_doc ON kb_chunks (kb_doc_id, seq);

CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(heading, grams, cross, tokenize='unicode61');

CREATE TABLE assistant_messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sources)),
  found INTEGER NOT NULL DEFAULT 1 CHECK (found IN (0, 1)),
  demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_assistant_messages_user ON assistant_messages (user_id, id);

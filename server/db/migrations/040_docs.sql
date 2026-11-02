-- 이 파일이 하는 일: 서식 보관함의 문서(documents)와 저장할 때마다 쌓이는 문서 버전(document_versions)을 만든다(database.md §6, FR-060·062).
-- AI로 쓴 문서·직접 쓴 문서는 body_md(마크다운)를, 올린 서식 파일은 file_id(files 테이블)를 가진다. 환자 관련 열은 두지 않는다(NFR-001).
-- 시각은 ISO-8601 UTC 문자열(_at)이다. 지운 문서는 deleted_at을 채워 목록에서 숨긴다(버전 기록은 남긴다).

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('notice_patient', 'official', 'policy', 'manual', 'review', 'minutes', 'other', 'form')),
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  source TEXT NOT NULL CHECK (source IN ('ai', 'manual', 'upload')),
  file_id INTEGER REFERENCES files(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_documents_list ON documents (deleted_at, updated_at);
CREATE INDEX idx_documents_folder ON documents (folder);

CREATE TABLE document_versions (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_document_versions_doc ON document_versions (document_id, id);

// 이 파일이 하는 일: 서식 보관함 문서의 저장·조회·수정·삭제·버전 기록을 맡는다(FR-060 AC3, FR-062, backend.md §3.6).
// - 글 문서(AI 초안·직접 작성)는 저장할 때마다 document_versions에 한 줄씩 쌓인다(버전 1, 2, ...). 제목·본문이 그대로면 버전을 늘리지 않는다.
// - 올린 서식 파일은 files 줄을 가리키고(file_id), 본문이 없어 버전은 0이다.
// - 고치기·지우기는 작성자 본인 또는 documents.edit_any(manager 이상)만 할 수 있다. 지우면 deleted_at만 채운다.
// - 모든 변경은 감사 로그(server/lib/audit.ts)에 남긴다. 본문 원문은 감사 로그에 넣지 않는다.
import type { Db } from '../../db/index.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { AppError } from '../../lib/errors.ts';
import { saveUpload, type SaveEnv } from '../../lib/files.ts';
import { can, type Role } from '../../../shared/roles.ts';
import type { DocDetail, DocKind, DocListItem, DocListResponse, DocSource, DocVersionView, DocumentCreateInput, DocumentPatchInput } from '../../../shared/schemas/docs.ts';

/** 요청한 사람 */
export interface Actor {
  id: number;
  role: Role;
}

/** DB에서 읽은 문서 한 줄(+작성자 이름·파일·버전 수) */
interface DocRow {
  id: number;
  kind: DocKind;
  title: string;
  body_md: string;
  folder: string;
  tags: string;
  source: DocSource;
  file_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  author: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  versions: number;
}

const SELECT_DOC = `
  SELECT d.*, u.name AS author, f.original_name AS file_name, f.mime AS file_mime, f.size AS file_size,
         (SELECT COUNT(*) FROM document_versions v WHERE v.document_id = d.id) AS versions
  FROM documents d
  LEFT JOIN users u ON u.id = d.created_by
  LEFT JOIN files f ON f.id = d.file_id`;

/** 태그 JSON을 배열로(틀린 값이면 빈 배열) */
function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 목록용 모양으로 */
function toItem(r: DocRow): DocListItem {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    folder: r.folder,
    tags: parseTags(r.tags),
    source: r.source,
    file: r.file_id ? { id: r.file_id, name: r.file_name ?? '파일', mime: r.file_mime ?? 'application/octet-stream', size: r.file_size ?? 0 } : null,
    createdBy: r.author,
    updatedAt: r.updated_at,
    version: r.versions,
  };
}

/** 이 사람이 문서를 고치거나 지울 수 있는지(작성자 본인 또는 documents.edit_any) */
export function canEditDoc(actor: Actor, createdBy: number | null): boolean {
  if (can(actor.role, 'documents.edit_any')) return true;
  return createdBy !== null && createdBy === actor.id && can(actor.role, 'documents.write');
}

/** 지우지 않은 문서 한 줄(없으면 404) */
function findDoc(db: Db, id: number): DocRow {
  const r = db.get<DocRow>(`${SELECT_DOC} WHERE d.id = ? AND d.deleted_at IS NULL`, [id]);
  if (!r) throw new AppError('NOT_FOUND', { message: '찾는 문서가 없어요. 지워졌을 수 있어요.' });
  return r;
}

/** 문서 상세 */
export function getDocument(db: Db, id: number, actor: Actor): DocDetail {
  const r = findDoc(db, id);
  return { ...toItem(r), bodyMd: r.body_md, createdAt: r.created_at, createdById: r.created_by, canEdit: canEditDoc(actor, r.created_by) };
}

/** LIKE 검색어의 %·_를 글자 그대로 찾게 바꾼다 */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** 목록 조건 */
export interface ListQuery {
  folder?: string | undefined;
  kind?: DocKind | undefined;
  q?: string | undefined;
  tag?: string | undefined;
  page: number;
  pageSize: number;
}

/** 서식 보관함 목록(최근 고친 것부터). 폴더·종류·태그·검색어(제목·본문·파일 이름)로 거른다 */
export function listDocuments(db: Db, query: ListQuery): DocListResponse {
  const where = ['d.deleted_at IS NULL'];
  const params: (string | number)[] = [];
  if (query.folder !== undefined) {
    where.push('d.folder = ?');
    params.push(query.folder);
  }
  if (query.kind) {
    where.push('d.kind = ?');
    params.push(query.kind);
  }
  if (query.tag) {
    where.push('EXISTS (SELECT 1 FROM json_each(d.tags) t WHERE t.value = ?)');
    params.push(query.tag);
  }
  if (query.q) {
    const like = `%${likeEscape(query.q)}%`;
    where.push("(d.title LIKE ? ESCAPE '\\' OR d.body_md LIKE ? ESCAPE '\\' OR f.original_name LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const cond = where.join(' AND ');
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM documents d LEFT JOIN files f ON f.id = d.file_id WHERE ${cond}`, params)?.n ?? 0;
  const rows = db.all<DocRow>(`${SELECT_DOC} WHERE ${cond} ORDER BY d.updated_at DESC, d.id DESC LIMIT ? OFFSET ?`, [
    ...params,
    query.pageSize,
    (query.page - 1) * query.pageSize,
  ]);
  const folders = db
    .all<{ folder: string }>("SELECT DISTINCT folder FROM documents WHERE deleted_at IS NULL AND folder <> '' ORDER BY folder")
    .map((r) => r.folder);
  const tags = db
    .all<{ tag: string }>('SELECT DISTINCT t.value AS tag FROM documents d, json_each(d.tags) t WHERE d.deleted_at IS NULL ORDER BY tag')
    .map((r) => r.tag);
  return { data: rows.map(toItem), total, facets: { folders, tags } };
}

/** 버전 한 줄을 넣는다 */
function addVersion(db: Db, docId: number, title: string, body: string, userId: number, at: string): void {
  db.run('INSERT INTO document_versions (document_id, title, body_md, created_by, created_at) VALUES (?, ?, ?, ?, ?)', [docId, title, body, userId, at]);
}

/** 글 문서를 새로 저장한다(버전 1) */
export function createDocument(ctx: AuditContext, actor: Actor, input: DocumentCreateInput): DocDetail {
  const at = ctx.clock.now().toISOString();
  const id = ctx.db.tx(() => {
    const r = ctx.db.run(
      'INSERT INTO documents (kind, title, body_md, folder, tags, source, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [input.kind, input.title, input.body_md, input.folder, JSON.stringify(input.tags), input.source, actor.id, at, at],
    );
    addVersion(ctx.db, r.lastInsertRowid, input.title, input.body_md, actor.id, at);
    audit(ctx, 'documents.create', 'document', r.lastInsertRowid, { kind: input.kind, source: input.source, folder: input.folder, length: input.body_md.length });
    return r.lastInsertRowid;
  });
  return getDocument(ctx.db, id, actor);
}

/** 서식 파일을 올려 문서로 만든다(검사·저장은 server/lib/files.ts) */
export function uploadDocument(
  env: SaveEnv,
  ctx: AuditContext,
  actor: Actor,
  input: { name: string; data: Buffer; title: string; folder: string; tags: string[] },
): DocDetail {
  const file = saveUpload(env, { name: input.name, data: input.data, purpose: 'form', userId: actor.id });
  const at = ctx.clock.now().toISOString();
  const title = input.title || file.original_name.replace(/\.[^.]+$/, '') || file.original_name;
  const r = ctx.db.run(
    "INSERT INTO documents (kind, title, body_md, folder, tags, source, file_id, created_by, created_at, updated_at) VALUES ('form', ?, '', ?, ?, 'upload', ?, ?, ?, ?)",
    [title, input.folder, JSON.stringify(input.tags), file.id, actor.id, at, at],
  );
  audit(ctx, 'documents.upload', 'document', r.lastInsertRowid, { fileId: file.id, mime: file.mime, size: file.size, folder: input.folder });
  return getDocument(ctx.db, r.lastInsertRowid, actor);
}

/** 문서를 고친다. 제목·본문이 바뀌면 새 버전을 남긴다 */
export function updateDocument(ctx: AuditContext, actor: Actor, id: number, patch: DocumentPatchInput): DocDetail {
  const cur = findDoc(ctx.db, id);
  if (!canEditDoc(actor, cur.created_by)) throw new AppError('FORBIDDEN', { message: '내가 쓴 문서만 고칠 수 있어요. 다른 사람 문서는 실장님 이상이 고칠 수 있어요.' });
  if (cur.source === 'upload' && patch.body_md !== undefined) {
    throw new AppError('VALIDATION', { message: '올린 서식 파일은 본문을 고칠 수 없어요. 새 파일을 올려 주세요.', fields: { body_md: '올린 파일은 본문이 없어요.' } });
  }
  if (cur.source === 'upload' && patch.kind !== undefined && patch.kind !== 'form') {
    throw new AppError('VALIDATION', { fields: { kind: '올린 서식 파일의 종류는 바꿀 수 없어요.' } });
  }
  const next = {
    kind: patch.kind ?? cur.kind,
    title: patch.title ?? cur.title,
    body: patch.body_md ?? cur.body_md,
    folder: patch.folder ?? cur.folder,
    tags: patch.tags ? JSON.stringify(patch.tags) : cur.tags,
  };
  const contentChanged = next.title !== cur.title || next.body !== cur.body_md;
  const at = ctx.clock.now().toISOString();
  ctx.db.tx(() => {
    ctx.db.run('UPDATE documents SET kind = ?, title = ?, body_md = ?, folder = ?, tags = ?, updated_at = ? WHERE id = ?', [
      next.kind,
      next.title,
      next.body,
      next.folder,
      next.tags,
      at,
      id,
    ]);
    if (contentChanged && cur.source !== 'upload') addVersion(ctx.db, id, next.title, next.body, actor.id, at);
    audit(ctx, 'documents.update', 'document', id, { fields: Object.keys(patch), newVersion: contentChanged && cur.source !== 'upload' });
  });
  return getDocument(ctx.db, id, actor);
}

/** 문서를 지운다(목록에서 숨김) */
export function deleteDocument(ctx: AuditContext, actor: Actor, id: number): void {
  const cur = findDoc(ctx.db, id);
  if (!canEditDoc(actor, cur.created_by)) throw new AppError('FORBIDDEN', { message: '내가 쓴 문서만 지울 수 있어요. 다른 사람 문서는 실장님 이상이 지울 수 있어요.' });
  ctx.db.run('UPDATE documents SET deleted_at = ? WHERE id = ?', [ctx.clock.now().toISOString(), id]);
  audit(ctx, 'documents.delete', 'document', id, { kind: cur.kind, source: cur.source });
}

/** 버전 기록(최신부터). 번호는 1부터 저장 순서대로 */
export function listVersions(db: Db, id: number): DocVersionView[] {
  findDoc(db, id);
  const rows = db.all<{ id: number; title: string; body_md: string; author: string | null; created_at: string }>(
    'SELECT v.id, v.title, v.body_md, u.name AS author, v.created_at FROM document_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.document_id = ? ORDER BY v.id',
    [id],
  );
  return rows.map((r, i) => ({ id: r.id, version: i + 1, title: r.title, bodyMd: r.body_md, createdBy: r.author, createdAt: r.created_at })).reverse();
}

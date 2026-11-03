// 이 파일이 하는 일: 원내 AI 도우미의 업무 규칙을 맡는다(FR-070·071, overview §3.5).
// - 자료 올리기: 파일(txt·md·pdf·docx) 또는 서식 보관함 문서 → 글 꺼내기 → 개인정보 검사(감지되면 needs_review로 멈춤) → 조각·색인 → ready. 꺼내지 못하면 failed + 이유.
// - "가리고 저장": needs_review 자료의 개인정보를 "[전화번호]" 같은 표시로 바꾼 뒤 색인한다. 지우기: deleted_at을 채우고 조각·색인을 지워 검색에서 뺀다.
// - 질문: 역할에 맞는 공개 범위(staff는 전체 공개만)에서 검색하고, 근거가 없으면 AI를 부르지 않고 "원내 문서에서 찾지 못했습니다"로 답한다.
//   근거가 있으면 게이트웨이(feature assistant)로 답을 만든다. 질문·답·근거는 사용자별 대화 기록(최근 200개)에 남는다.
import fs from 'node:fs';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { AppError } from '../../lib/errors.ts';
import { extOf, getFile, saveUpload, storedFilePath, type SaveEnv } from '../../lib/files.ts';
import { filterText, type PiiFinding } from '../../privacy/filter.ts';
import { readPrivacyForAi } from '../../ai/settings.ts';
import { runAi, type AiCallContext, type AiResult } from '../../ai/gateway.ts';
import { atLeast, type Role } from '../../../shared/roles.ts';
import {
  KB_FILE_EXTS, NOT_FOUND_ANSWER, type AskResponse, type AssistantMessage, type AssistantSource, type KbDocDetail, type KbDocItem,
  type KbStatus, type KbVisibility,
} from '../../../shared/schemas/kb.ts';
import { extractKbText, ExtractError } from './extract.ts';
import { DEFAULT_SEARCH_PARAMS, indexDocument, normalizeText, removeDocumentIndex, searchKb, titleOf, toQueryTerms, type SearchFilter, type SearchHit } from './search.ts';

/** 요청한 사람 */
export interface Actor {
  id: number;
  role: Role;
}

/** 사용자별로 남기는 대화 수(database.md §6) */
export const HISTORY_KEEP = 200;
/** 근거 카드 최대 수 */
export const MAX_SOURCES = 3;
/** 발췌 글자 수 */
export const EXCERPT_CHARS = 180;

/** DB kb_docs 한 줄(+작성자·출처 이름) */
interface KbRow {
  id: number;
  title: string;
  file_id: number | null;
  document_id: number | null;
  visibility: KbVisibility;
  status: KbStatus;
  error: string | null;
  body: string;
  findings: string;
  chunk_count: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  author: string | null;
  file_name: string | null;
  doc_title: string | null;
}

const SELECT_KB = `
  SELECT k.*, u.name AS author, f.original_name AS file_name, d.title AS doc_title
  FROM kb_docs k
  LEFT JOIN users u ON u.id = k.created_by
  LEFT JOIN files f ON f.id = k.file_id
  LEFT JOIN documents d ON d.id = k.document_id`;

/** 실장님 이상인지(전체 공개 범위 자료를 모두 볼 수 있는지) */
function seesAll(role: Role): boolean {
  return atLeast(role, 'manager');
}

/** 이 역할이 볼 수 있는 공개 범위 */
export function visibleScopes(role: Role): KbVisibility[] {
  return seesAll(role) ? ['all', 'manager'] : ['all'];
}

/**
 * 검색에서 쓸 조각만 남기는 조건: 지우지 않았고, 완료(ready)이며, 역할에 맞는 공개 범위인 자료의 조각.
 * searchKb의 filter 인자로 넘긴다(kb_chunks는 c라는 이름).
 */
export function searchFilterFor(role: Role): SearchFilter {
  const scopes = visibleScopes(role);
  return {
    sql: `c.kb_doc_id IN (SELECT id FROM kb_docs WHERE deleted_at IS NULL AND status = 'ready' AND visibility IN (${scopes.map(() => '?').join(', ')}))`,
    params: scopes,
  };
}

/** findings JSON을 배열로(틀리면 빈 배열) */
function parseFindings(raw: string): PiiFinding[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as PiiFinding[]).filter((f) => f && typeof f.type === 'string' && typeof f.count === 'number') : [];
  } catch {
    return [];
  }
}

/** 목록용 모양 */
function toItem(r: KbRow): KbDocItem {
  const sourceKind = r.file_id ? 'file' : r.document_id ? 'document' : 'demo';
  const sourceName = r.file_id ? (r.file_name ?? '파일') : r.document_id ? `서식 보관함: ${r.doc_title ?? '문서'}` : '데모 매뉴얼';
  return {
    id: r.id,
    title: r.title,
    sourceName,
    sourceKind,
    visibility: r.visibility,
    status: r.status,
    error: r.status === 'failed' ? r.error : null,
    findings: r.status === 'needs_review' ? parseFindings(r.findings) : [],
    chunkCount: r.chunk_count,
    createdBy: r.author,
    createdAt: r.created_at,
  };
}

/** 자료 목록. 실장님 이상은 모든 상태를, 직원은 완료되고 전체 공개인 자료만 본다(최근 올린 것부터) */
export function listKbDocs(db: Db, actor: Actor): KbDocItem[] {
  const all = seesAll(actor.role);
  const rows = db.all<KbRow>(
    `${SELECT_KB} WHERE k.deleted_at IS NULL ${all ? '' : "AND k.status = 'ready' AND k.visibility = 'all'"} ORDER BY k.created_at DESC, k.id DESC`,
  );
  return rows.map(toItem);
}

/** 지우지 않은 자료 한 줄. 이 사람이 볼 수 없으면(공개 범위·상태) 없는 것처럼 404 */
function findVisible(db: Db, actor: Actor, id: number): KbRow {
  const r = db.get<KbRow>(`${SELECT_KB} WHERE k.id = ? AND k.deleted_at IS NULL`, [id]);
  const ok = r && (seesAll(actor.role) || (r.status === 'ready' && r.visibility === 'all'));
  if (!r || !ok) throw new AppError('NOT_FOUND', { message: '찾는 자료가 없어요. 지워졌거나 볼 수 없는 자료예요.' });
  return r;
}

/** 개인정보가 들어 있는 줄을 가린 모양으로 최대 5줄 */
function piiSamples(db: Db, body: string): string[] {
  const settings = readPrivacyForAi(db);
  const out: string[] = [];
  for (const line of body.split('\n')) {
    const r = filterText(line, settings);
    if (!r.redacted) continue;
    const t = r.redactedText.trim();
    out.push(t.length > 160 ? `${t.slice(0, 157)}…` : t);
    if (out.length >= 5) break;
  }
  return out;
}

/** 자료 상세(원문 보기). 완료된 자료는 조각을, 검토 필요 자료는 가린 미리보기 줄을 담는다 */
export function getKbDoc(db: Db, actor: Actor, id: number): KbDocDetail {
  const r = findVisible(db, actor, id);
  const chunks = r.status === 'ready' ? db.all<{ id: number; seq: number; heading: string; text: string }>('SELECT id, seq, heading, text FROM kb_chunks WHERE kb_doc_id = ? ORDER BY seq', [id]) : [];
  return {
    ...toItem(r),
    chunks: chunks.map((c) => ({ id: Number(c.id), seq: Number(c.seq), heading: c.heading, text: c.text })),
    samples: r.status === 'needs_review' ? piiSamples(db, r.body) : [],
    fileId: seesAll(actor.role) ? r.file_id : null,
    documentId: r.document_id,
  };
}

/** 자료 한 줄을 다시 읽어 목록 모양으로 */
function itemOf(db: Db, id: number): KbDocItem {
  return toItem(db.get<KbRow>(`${SELECT_KB} WHERE k.id = ?`, [id]) as KbRow);
}

/** 글을 조각으로 나눠 색인하고 ready로 바꾼다. 조각 수를 돌려준다 */
function indexAndReady(db: Db, clock: Clock, id: number, title: string, body: string): number {
  return db.tx(() => {
    removeDocumentIndex(db, id);
    const n = indexDocument(db, id, title, body);
    db.run("UPDATE kb_docs SET status = 'ready', body = ?, findings = '[]', error = NULL, chunk_count = ?, updated_at = ? WHERE id = ?", [
      body, n, clock.now().toISOString(), id,
    ]);
    return n;
  });
}

/** 꺼낸 글을 처리한다: 개인정보가 있으면 needs_review로 멈추고, 없으면 색인해서 ready로 */
function processText(db: Db, clock: Clock, id: number, title: string, body: string): void {
  const scan = filterText(body, readPrivacyForAi(db));
  if (scan.findings.length) {
    db.run("UPDATE kb_docs SET status = 'needs_review', body = ?, findings = ?, updated_at = ? WHERE id = ?", [
      body, JSON.stringify(scan.findings), clock.now().toISOString(), id,
    ]);
    return;
  }
  indexAndReady(db, clock, id, title, body);
}

/** 실패로 남긴다(이유는 화면에 그대로 보인다) */
function markFailed(db: Db, clock: Clock, id: number, reason: string): void {
  db.run("UPDATE kb_docs SET status = 'failed', error = ?, body = '', chunk_count = 0, updated_at = ? WHERE id = ?", [reason, clock.now().toISOString(), id]);
}

/** 처리 중(processing) 자료 한 줄을 만든다 */
function insertProcessing(db: Db, clock: Clock, actor: Actor, v: { title: string; fileId: number | null; documentId: number | null; visibility: KbVisibility }): number {
  const at = clock.now().toISOString();
  return db.run(
    "INSERT INTO kb_docs (title, file_id, document_id, visibility, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'processing', ?, ?, ?)",
    [v.title, v.fileId, v.documentId, v.visibility, actor.id, at, at],
  ).lastInsertRowid;
}

/** 꺼내기 → 처리. 꺼내기에 실패하면 failed */
async function extractAndProcess(db: Db, clock: Clock, id: number, title: string, fallbackTitle: string, ext: string, data: Buffer): Promise<void> {
  let body: string;
  try {
    body = await extractKbText(ext, data);
  } catch (e) {
    markFailed(db, clock, id, e instanceof ExtractError ? e.message : '파일에서 글을 꺼내지 못했어요. 다른 파일로 다시 올려 주세요.');
    return;
  }
  // 제목: 입력한 제목 → 글의 첫 # 제목 → 파일 이름(또는 문서 제목)
  const finalTitle = title || titleOf(body)?.slice(0, 200) || fallbackTitle || '이름 없는 자료';
  if (finalTitle !== title) db.run('UPDATE kb_docs SET title = ? WHERE id = ?', [finalTitle, id]);
  processText(db, clock, id, finalTitle, body);
}

/** 파일 이름에서 확장자를 뺀 제목 */
function nameTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim().slice(0, 200);
}

/**
 * 파일로 자료를 올린다(manager 이상). 파일 검사(형식·크기·매직 넘버)에 걸리면 저장하지 않고 413·415를 던진다.
 * 글을 꺼내지 못하면 failed, 개인정보가 있으면 needs_review, 아니면 ready인 자료를 돌려준다.
 */
export async function uploadKbFile(
  env: SaveEnv,
  ctx: AuditContext,
  actor: Actor,
  input: { name: string; data: Buffer; title: string; visibility: KbVisibility },
): Promise<KbDocItem> {
  const file = saveUpload(env, { name: input.name, data: input.data, purpose: 'kb', userId: actor.id });
  const ext = extOf(file.original_name);
  const fallback = nameTitle(file.original_name);
  const id = insertProcessing(env.db, env.clock, actor, { title: input.title || fallback, fileId: file.id, documentId: null, visibility: input.visibility });
  await extractAndProcess(env.db, env.clock, id, input.title, fallback, ext, input.data);
  const item = itemOf(env.db, id);
  audit(ctx, 'kb.upload', 'kb_doc', id, { source: 'file', ext, status: item.status, chunks: item.chunkCount, visibility: item.visibility });
  return item;
}

/**
 * 서식 보관함 문서를 자료로 고른다(manager 이상). 글 문서는 본문을 쓰고, 올린 서식 파일은 TXT·MD·PDF·DOCX만 글을 꺼낸다(HWP 등은 415).
 */
export async function addKbFromDocument(
  env: SaveEnv,
  ctx: AuditContext,
  actor: Actor,
  input: { documentId: number; title: string; visibility: KbVisibility },
): Promise<KbDocItem> {
  const doc = env.db.get<{ id: number; title: string; body_md: string; file_id: number | null }>(
    'SELECT id, title, body_md, file_id FROM documents WHERE id = ? AND deleted_at IS NULL',
    [input.documentId],
  );
  if (!doc) throw new AppError('NOT_FOUND', { message: '고른 서식 보관함 문서가 없어요. 지워졌을 수 있어요.' });
  let ext = '.md';
  let data: Buffer | null = doc.body_md.trim() ? Buffer.from(doc.body_md, 'utf8') : null;
  if (!data && doc.file_id) {
    const f = getFile(env.db, doc.file_id);
    ext = f ? extOf(f.original_name) : '';
    if (!f || !(KB_FILE_EXTS as readonly string[]).includes(ext)) {
      throw new AppError('FILE_TYPE', { message: '이 서식 파일은 글을 꺼낼 수 없어요(HWP·XLSX·사진 등). TXT·MD·PDF·DOCX 문서만 고를 수 있어요.' });
    }
    const abs = storedFilePath(env.dataDir, f);
    if (!abs || !fs.existsSync(abs)) throw new AppError('NOT_FOUND', { message: '서식 파일을 찾을 수 없어요. 지워졌거나 옮겨졌을 수 있어요.' });
    data = fs.readFileSync(abs);
  }
  if (!data) throw new AppError('VALIDATION', { message: '고른 문서에 내용이 없어요. 내용이 있는 문서를 골라 주세요.', fields: { documentId: '내용이 없는 문서예요.' } });
  const title = input.title || doc.title;
  const id = insertProcessing(env.db, env.clock, actor, { title, fileId: null, documentId: doc.id, visibility: input.visibility });
  await extractAndProcess(env.db, env.clock, id, title, doc.title, ext, data);
  const item = itemOf(env.db, id);
  audit(ctx, 'kb.upload', 'kb_doc', id, { source: 'document', documentId: doc.id, status: item.status, chunks: item.chunkCount, visibility: item.visibility });
  return item;
}

/** "가리고 저장": 검토 필요 자료의 개인정보를 모두 가린 뒤 색인한다(FR-070 AC3) */
export function confirmRedact(ctx: AuditContext, actor: Actor, id: number): KbDocItem {
  const r = findVisible(ctx.db, actor, id);
  if (r.status !== 'needs_review') throw new AppError('CONFLICT', { message: '검토가 필요한 자료가 아니에요. 화면을 새로 고쳐 주세요.' });
  const scan = filterText(r.body, readPrivacyForAi(ctx.db));
  indexAndReady(ctx.db, ctx.clock, id, r.title, scan.redactedText);
  const item = itemOf(ctx.db, id);
  audit(ctx, 'kb.confirm_redact', 'kb_doc', id, { findings: parseFindings(r.findings), chunks: item.chunkCount });
  return item;
}

/** 자료를 지운다: 검색 조각·색인을 지우고 꺼낸 글도 비운다(FR-070 AC2). 검토 필요 자료의 "취소"도 이것을 쓴다 */
export function deleteKbDoc(ctx: AuditContext, actor: Actor, id: number): void {
  const r = findVisible(ctx.db, actor, id);
  ctx.db.tx(() => {
    removeDocumentIndex(ctx.db, id);
    ctx.db.run("UPDATE kb_docs SET deleted_at = ?, body = '', chunk_count = 0, updated_at = ? WHERE id = ?", [ctx.clock.now().toISOString(), ctx.clock.now().toISOString(), id]);
  });
  audit(ctx, 'kb.delete', 'kb_doc', id, { status: r.status });
}

// ───────────────────────── 질문과 근거 ─────────────────────────

/**
 * 조각에서 질문 낱말이 처음 나오는 곳 둘레를 잘라 발췌를 만든다(앞뒤가 잘리면 …).
 * 예: "…아침 첫 운전 전에 멸균기를 예열하고, … B&D 테스트를 한다…"
 */
export function makeExcerpt(text: string, question: string, max = EXCERPT_CHARS): string {
  // 줄 앞 목록 표시("- ", "* ")는 떼고 한 줄로 편다
  const flat = text.replace(/^\s*[-*]\s+/gm, '').replace(/\s*\n\s*/g, ' ').trim();
  if (flat.length <= max) return flat;
  const lower = normalizeText(flat);
  let at = -1;
  for (const t of toQueryTerms(question)) {
    if (t.word.length < 2) continue;
    const i = lower.indexOf(t.word);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  let start = at < 0 ? 0 : Math.max(0, at - Math.floor(max / 4));
  if (start + max > flat.length) start = Math.max(0, flat.length - max);
  const body = flat.slice(start, start + max).trim();
  return `${start > 0 ? '…' : ''}${body}${start + max < flat.length ? '…' : ''}`;
}

/** 근거 카드로 쓸 조각: 기준 비율을 넘는 조각 중 점수 순서로 최대 3개 */
function pickSources(db: Db, hits: readonly SearchHit[], question: string): AssistantSource[] {
  const good = hits.filter((h) => h.matchRatio >= DEFAULT_SEARCH_PARAMS.minMatchRatio).slice(0, MAX_SOURCES);
  const titles = new Map<number, string>();
  for (const h of good) {
    if (!titles.has(h.kbDocId)) titles.set(h.kbDocId, db.get<{ title: string }>('SELECT title FROM kb_docs WHERE id = ?', [h.kbDocId])?.title ?? '원내 문서');
  }
  return good.map((h, i) => ({
    n: i + 1,
    kbDocId: h.kbDocId,
    title: titles.get(h.kbDocId) ?? '원내 문서',
    chunkId: h.chunkId,
    heading: h.heading,
    excerpt: makeExcerpt(h.text, question),
  }));
}

/** 찾지 못했을 때 어떤 문서를 올리면 되는지 안내(FR-071 AC2) */
export function notFoundHint(question: string, role: Role): string {
  const words = toQueryTerms(question).map((t) => t.word).filter((w) => w.length >= 2).slice(0, 3);
  const topic = words.length ? `"${words.join(' ')}"에 관한` : '이 질문에 관한';
  return seesAll(role)
    ? `${topic} 원내 규정이나 매뉴얼을 "원내 문서" 탭에서 올리면 다음부터 근거와 함께 답할 수 있어요.`
    : `${topic} 원내 규정이나 매뉴얼을 실장님께 올려 달라고 요청해 주세요. 올라오면 근거와 함께 답할 수 있어요.`;
}

/** DB 대화 한 줄 */
interface MessageRow {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  sources: string;
  found: number;
  demo: number;
  created_at: string;
}

/** 근거 JSON을 배열로(틀리면 빈 배열) */
function parseSources(raw: string): AssistantSource[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as AssistantSource[]) : [];
  } catch {
    return [];
  }
}

/** 대화 한 줄을 응답 모양으로. live에 없는 자료는 deleted 표시 */
function toMessage(r: MessageRow, live: ReadonlySet<number>): AssistantMessage {
  return {
    id: Number(r.id),
    role: r.role,
    text: r.text,
    sources: parseSources(r.sources).map((s) => (live.has(s.kbDocId) ? s : { ...s, deleted: true })),
    found: r.found === 1,
    demo: r.demo === 1,
    createdAt: r.created_at,
  };
}

/** 지금 이 사람이 볼 수 있는(지우지 않은 완료) 자료 번호 */
function liveDocIds(db: Db, role: Role): Set<number> {
  const scopes = visibleScopes(role);
  return new Set(
    db
      .all<{ id: number }>(`SELECT id FROM kb_docs WHERE deleted_at IS NULL AND status = 'ready' AND visibility IN (${scopes.map(() => '?').join(', ')})`, scopes)
      .map((r) => Number(r.id)),
  );
}

/** 대화 한 줄을 저장하고 id를 돌려준다 */
function addMessage(db: Db, clock: Clock, userId: number, m: { role: 'user' | 'assistant'; text: string; sources?: AssistantSource[]; found?: boolean; demo?: boolean }): number {
  return db.run('INSERT INTO assistant_messages (user_id, role, text, sources, found, demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    userId, m.role, m.text, JSON.stringify(m.sources ?? []), m.found === false ? 0 : 1, m.demo ? 1 : 0, clock.now().toISOString(),
  ]).lastInsertRowid;
}

/** 사용자별로 최근 HISTORY_KEEP개만 남긴다 */
function trimHistory(db: Db, userId: number): void {
  db.run(
    'DELETE FROM assistant_messages WHERE user_id = ? AND id NOT IN (SELECT id FROM assistant_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?)',
    [userId, userId, HISTORY_KEEP],
  );
}

/** 내 대화 기록(오래된 것부터, 최근 200개) */
export function listHistory(db: Db, actor: Actor): AssistantMessage[] {
  const live = liveDocIds(db, actor.role);
  const rows = db.all<MessageRow>(
    'SELECT * FROM (SELECT * FROM assistant_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id',
    [actor.id, HISTORY_KEEP],
  );
  return rows.map((r) => toMessage(r, live));
}

/** 내 대화 기록을 모두 지운다. 지운 줄 수를 돌려준다 */
export function clearHistory(ctx: AuditContext, actor: Actor): number {
  const n = ctx.db.run('DELETE FROM assistant_messages WHERE user_id = ?', [actor.id]).changes;
  audit(ctx, 'assistant.history_clear', 'user', actor.id, { messages: n });
  return n;
}

/**
 * 질문에 답한다(FR-071).
 * ① 공개 범위 안에서 검색 → ② 근거가 없으면 AI를 부르지 않고 "찾지 못했습니다" + 안내 → ③ 있으면 게이트웨이(assistant)로 답 → ④ 대화 기록에 남긴다.
 * AI 오류(예산 초과·꺼짐 등)는 그대로 던지고 기록하지 않는다.
 */
export async function ask(ai: AiCallContext, question: string): Promise<AskResponse> {
  const { db, clock, user } = ai;
  const actor: Actor = { id: user.id, role: user.role };
  // 기록에는 개인정보를 가린 질문만 남긴다
  const savedQuestion = filterText(question, readPrivacyForAi(db)).redactedText;
  const result = searchKb(db, question, DEFAULT_SEARCH_PARAMS, searchFilterFor(actor.role));
  if (!result.found) {
    // 안내 문구도 기록에 남으므로 가린 질문으로 만든다(원문 앞부분의 주민번호 숫자가 남지 않게, phase-05-task-02)
    const hint = notFoundHint(savedQuestion, actor.role);
    const answer = `${NOT_FOUND_ANSWER} ${hint}`;
    const messages = db.tx(() => {
      const q = addMessage(db, clock, actor.id, { role: 'user', text: savedQuestion });
      const a = addMessage(db, clock, actor.id, { role: 'assistant', text: answer, found: false });
      trimHistory(db, actor.id);
      return [q, a];
    });
    return { found: false, answer: NOT_FOUND_ANSWER, hint, sources: [], messages: readMessages(db, actor, messages), ai: null };
  }
  const sources = pickSources(db, result.hits, question);
  const chunks = sources.map((s) => ({ n: s.n, title: s.heading, text: result.hits.find((h) => h.chunkId === s.chunkId)?.text ?? s.excerpt }));
  const r: AiResult = await runAi(ai, { feature: 'assistant', input: { question, chunks } });
  const messages = db.tx(() => {
    const q = addMessage(db, clock, actor.id, { role: 'user', text: savedQuestion });
    const a = addMessage(db, clock, actor.id, { role: 'assistant', text: r.text, sources, found: true, demo: r.demo });
    trimHistory(db, actor.id);
    return [q, a];
  });
  return {
    found: true,
    answer: r.text,
    hint: null,
    sources,
    messages: readMessages(db, actor, messages),
    ai: { demo: r.demo, notice: r.privacy.notice, costKrw: r.usage.costKrw, requestId: r.requestId },
  };
}

/** 방금 넣은 대화 줄들을 다시 읽는다 */
function readMessages(db: Db, actor: Actor, ids: number[]): AssistantMessage[] {
  const live = liveDocIds(db, actor.role);
  return ids.map((id) => toMessage(db.get<MessageRow>('SELECT * FROM assistant_messages WHERE id = ?', [id]) as MessageRow, live));
}

// 이 파일이 하는 일: 보관 문구 API(backend.md §3.4 GET/POST/PATCH/DELETE /saved-texts, FR-042 AC2·AC3, FR-043, FR-044 AC1)와 그 처리 함수를 둔다.
// - 응대 스크립트·문자/안내문 템플릿·리뷰 답글 등을 종류(kind)·분류(category)로 저장하고, 제목·본문·분류로 검색한다.
// - 내 문구는 나만 보고 고친다. 공용 문구(shared)는 모든 직원이 보고, 만들기·고치기·지우기는 실장 이상(savedtexts.shared.edit)만 한다.
// - 템플릿에는 환자 이름 같은 개인 정보 치환자({이름} 등)를 저장하지 못하게 막는다(FR-044 AC1). 지우기는 deleted_at을 채우는 숨김이다.
// - 공용 문구를 바꾸면 감사 기록을 남긴다(내 문구는 개인 메모라 남기지 않음).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { audit } from '../../lib/audit.ts';
import { AppError } from '../../lib/errors.ts';
import { auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { can, type Role } from '../../../shared/roles.ts';
import { SAVED_TEXT_KINDS, scanPlaceholders, type SavedText, type SavedTextKind } from '../../../shared/desk-texts.ts';

/** 요청한 사람 */
export interface TextActor {
  id: number;
  role: Role;
}

const kindSchema = z.enum(SAVED_TEXT_KINDS, { error: '보관 종류를 확인해 주세요.' });
const categorySchema = z.string({ error: '분류를 글자로 적어 주세요.' }).trim().max(20, { error: '분류는 20자까지 적을 수 있어요.' });
const titleSchema = z
  .string({ error: '제목을 적어 주세요.' })
  .trim()
  .min(1, { error: '제목을 적어 주세요.' })
  .max(100, { error: '제목은 100자까지 적을 수 있어요.' });
const bodySchema = z
  .string({ error: '내용을 적어 주세요.' })
  .max(10000, { error: '내용은 10,000자까지 적을 수 있어요.' })
  .refine((v) => v.trim().length > 0, { error: '내용을 적어 주세요.' });
const metaSchema = z
  .record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null(), z.array(z.string().max(50)).max(10)]), { error: '추가 정보 모양을 확인해 주세요.' })
  .refine((m) => Object.keys(m).length <= 20, { error: '추가 정보가 너무 많아요.' })
  .nullable();

/** 새 문구 입력 */
export const createTextSchema = z.object({
  kind: kindSchema,
  category: categorySchema.optional(),
  title: titleSchema,
  body: bodySchema,
  meta: metaSchema.optional(),
  shared: z.boolean({ error: '공용 여부를 확인해 주세요.' }).optional().default(false),
});

/** 문구 고치기 입력(바꿀 것만) */
export const updateTextSchema = z.object({
  category: categorySchema.optional(),
  title: titleSchema.optional(),
  body: bodySchema.optional(),
  meta: metaSchema.optional(),
  shared: z.boolean({ error: '공용 여부를 확인해 주세요.' }).optional(),
});

const listQuerySchema = z.object({
  kind: kindSchema.optional(),
  category: categorySchema.optional(),
  q: z.string().trim().max(50, { error: '검색어는 50자까지 적을 수 있어요.' }).optional(),
  mine: z.enum(['0', '1'], { error: 'mine은 0 또는 1로 적어 주세요.' }).optional(),
});

const idParams = z.object({ id: z.coerce.number({ error: '문구 번호를 확인해 주세요.' }).int({ error: '문구 번호를 확인해 주세요.' }).positive({ error: '문구 번호를 확인해 주세요.' }) });

interface TextRow {
  id: number;
  kind: SavedTextKind;
  category: string;
  title: string;
  body: string;
  meta: string | null;
  shared: number;
  created_by: number;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT_TEXT = `
  SELECT t.id, t.kind, t.category, t.title, t.body, t.meta, t.shared, t.created_by, u.name AS author_name, t.created_at, t.updated_at
  FROM saved_texts t LEFT JOIN users u ON u.id = t.created_by`;

/** 이 사람이 이 문구를 고치거나 지울 수 있는지: 공용은 실장 이상, 내 문구는 나 */
function canEditText(actor: TextActor, row: { shared: number; created_by: number }): boolean {
  if (row.shared === 1) return can(actor.role, 'savedtexts.shared.edit');
  return row.created_by === actor.id;
}

function parseMeta(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toText(row: TextRow, actor: TextActor): SavedText {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: row.title,
    body: row.body,
    meta: parseMeta(row.meta),
    shared: row.shared === 1,
    createdBy: { id: row.created_by, name: row.author_name ?? '알 수 없음' },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canEdit: canEditText(actor, row),
  };
}

/** 문구 한 건(지웠거나, 남의 개인 문구면 404) */
function getRow(db: Db, actor: TextActor, id: number): TextRow {
  const row = db.get<TextRow>(`${SELECT_TEXT} WHERE t.id = ? AND t.deleted_at IS NULL AND (t.shared = 1 OR t.created_by = ?)`, [id, actor.id]);
  if (!row) throw new AppError('NOT_FOUND', { message: '찾는 문구가 없어요. 이미 지워졌을 수 있어요.' });
  return row;
}

/** 템플릿 본문에 개인 정보 치환자가 있으면 400(FR-044 AC1) */
function assertNoPersonalPlaceholder(kind: SavedTextKind, body: string): void {
  if (kind !== 'template') return;
  const { personal } = scanPlaceholders(body);
  if (personal.length) {
    throw new AppError('VALIDATION', {
      fields: { body: `${personal.map((k) => `{${k}}`).join(', ')} 같은 환자 개인 정보 치환자는 쓸 수 없어요. "고객님"처럼 바꿔 주세요.` },
    });
  }
}

/**
 * 보이는 문구 목록(내 문구 + 공용 문구). 최근에 고친 순.
 * q는 제목·본문·분류에서 찾고, category는 분류가 같은 것만, mine=true면 내가 만든 것만 본다.
 */
export function listTexts(db: Db, actor: TextActor, q: { kind?: SavedTextKind; category?: string; q?: string; mine?: boolean }): SavedText[] {
  const where = ['t.deleted_at IS NULL', '(t.shared = 1 OR t.created_by = :me)'];
  const params: Record<string, string | number> = { me: actor.id };
  if (q.kind) {
    where.push('t.kind = :kind');
    params.kind = q.kind;
  }
  if (q.category) {
    where.push('t.category = :category');
    params.category = q.category;
  }
  if (q.mine) where.push('t.created_by = :me');
  if (q.q) {
    where.push("(t.title LIKE :word ESCAPE '\\' OR t.body LIKE :word ESCAPE '\\' OR t.category LIKE :word ESCAPE '\\')");
    params.word = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  }
  return db.all<TextRow>(`${SELECT_TEXT} WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC, t.id DESC LIMIT 500`, params).map((r) => toText(r, actor));
}

/** 문구 한 건을 본다 */
export function getText(db: Db, actor: TextActor, id: number): SavedText {
  return toText(getRow(db, actor, id), actor);
}

/** 새 문구를 저장한다. 공용으로 저장하려면 실장 이상이어야 한다 */
export function createText(db: Db, clock: Clock, actor: TextActor, input: z.output<typeof createTextSchema>): number {
  if (input.shared && !can(actor.role, 'savedtexts.shared.edit')) {
    throw new AppError('FORBIDDEN', { message: '공용 문구는 실장 이상만 만들 수 있어요. 내 보관함에 저장해 주세요.' });
  }
  assertNoPersonalPlaceholder(input.kind, input.body);
  const now = clock.now().toISOString();
  const r = db.run('INSERT INTO saved_texts (kind, category, title, body, meta, shared, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    input.kind,
    input.category || '기타',
    input.title,
    input.body,
    input.meta ? JSON.stringify(input.meta) : null,
    input.shared ? 1 : 0,
    actor.id,
    now,
    now,
  ]);
  return r.lastInsertRowid;
}

/** 문구를 고친다. 바뀐 항목 이름을 돌려준다 */
export function updateText(db: Db, clock: Clock, actor: TextActor, id: number, input: z.output<typeof updateTextSchema>): { changed: string[]; wasShared: boolean } {
  const row = getRow(db, actor, id);
  if (!canEditText(actor, row)) throw new AppError('FORBIDDEN', { message: '공용 문구는 실장 이상만 고칠 수 있어요.' });
  if (input.shared !== undefined && input.shared !== (row.shared === 1)) {
    if (!can(actor.role, 'savedtexts.shared.edit')) throw new AppError('FORBIDDEN', { message: '공용으로 바꾸는 것은 실장 이상만 할 수 있어요.' });
    if (!input.shared && row.created_by !== actor.id) throw new AppError('FORBIDDEN', { message: '다른 사람이 만든 공용 문구는 개인 문구로 바꿀 수 없어요.' });
  }
  if (input.body !== undefined) assertNoPersonalPlaceholder(row.kind, input.body);
  const sets: string[] = [];
  const params: Record<string, string | number | null> = { id };
  const changed: string[] = [];
  const put = (col: string, value: string | number | null) => {
    sets.push(`${col} = :${col}`);
    params[col] = value;
    changed.push(col);
  };
  if (input.category !== undefined) put('category', input.category || '기타');
  if (input.title !== undefined) put('title', input.title);
  if (input.body !== undefined) put('body', input.body);
  if (input.meta !== undefined) put('meta', input.meta ? JSON.stringify(input.meta) : null);
  if (input.shared !== undefined) put('shared', input.shared ? 1 : 0);
  if (sets.length) {
    params.now = clock.now().toISOString();
    db.run(`UPDATE saved_texts SET ${sets.join(', ')}, updated_at = :now WHERE id = :id`, params);
  }
  return { changed, wasShared: row.shared === 1 };
}

/** 문구를 지운다(숨김) */
export function deleteText(db: Db, clock: Clock, actor: TextActor, id: number): TextRow {
  const row = getRow(db, actor, id);
  if (!canEditText(actor, row)) throw new AppError('FORBIDDEN', { message: '공용 문구는 실장 이상만 지울 수 있어요.' });
  const now = clock.now().toISOString();
  db.run('UPDATE saved_texts SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  return row;
}

function actorOf(req: FastifyRequest): TextActor {
  const u = currentUser(req);
  return { id: u.id, role: u.role };
}

/** 보관 문구 API를 등록한다(routes.ts가 부른다) */
export function registerSavedTextRoutes(app: FastifyInstance): void {
  app.get('/saved-texts', async (req, reply) => {
    const q = parseInput(listQuerySchema, req.query);
    reply.header('cache-control', 'no-store');
    const data = listTexts(app.db, actorOf(req), { kind: q.kind, category: q.category || undefined, q: q.q || undefined, mine: q.mine === '1' });
    return { data, total: data.length };
  });

  app.get('/saved-texts/:id', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    reply.header('cache-control', 'no-store');
    return { data: getText(app.db, actorOf(req), id) };
  });

  app.post('/saved-texts', async (req, reply) => {
    const input = parseInput(createTextSchema, req.body);
    const actor = actorOf(req);
    const id = createText(app.db, app.clock, actor, input);
    if (input.shared) audit(auditCtx(req), 'savedtext.create', 'saved_text', id, { kind: input.kind, title: input.title, shared: true });
    return reply.code(201).send({ data: getText(app.db, actor, id) });
  });

  app.patch('/saved-texts/:id', async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(updateTextSchema, req.body);
    const actor = actorOf(req);
    const { changed, wasShared } = updateText(app.db, app.clock, actor, id, input);
    if (changed.length && (wasShared || input.shared)) audit(auditCtx(req), 'savedtext.update', 'saved_text', id, { changed });
    return { data: getText(app.db, actor, id) };
  });

  app.delete('/saved-texts/:id', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const row = deleteText(app.db, app.clock, actorOf(req), id);
    if (row.shared === 1) audit(auditCtx(req), 'savedtext.delete', 'saved_text', id, { kind: row.kind, title: row.title });
    return reply.code(204).send();
  });
}

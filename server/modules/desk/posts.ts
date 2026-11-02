// 이 파일이 하는 일: 공지·인수인계 보드 API(backend.md §3.4, FR-040)와 그 처리 함수를 둔다.
// - 공지(notice)는 manager 이상만 쓰고 고정할 수 있고, 인수인계(handover)는 모두 쓴다. 다른 사람 글은 작성자나 manager 이상만 고치고 지운다.
// - 글을 열면(GET /posts/:id) 읽음으로 남기고, 작성자와 manager 이상에게는 읽은 사람·안 읽은 사람 목록을 함께 준다(사용 중인 계정만 셈).
// - 새 공지를 올리면 사용 중인 전 직원에게 'notice' 알림을 만든다(FR-040 AC3). 인수인계는 "처리 완료" 표시를 한다(AC4).
// - 지우기는 deleted_at을 채우는 숨김이다(기록 보존). 상태를 바꾸면 감사 기록을 남긴다. phase-03-task-06(회의록 할 일 보내기)도 POST /posts를 부른다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { audit } from '../../lib/audit.ts';
import { AppError } from '../../lib/errors.ts';
import { auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { emitNotification } from '../notifications/emit.ts';
import { atLeast, can, type Role } from '../../../shared/roles.ts';
import { POST_KINDS, type PersonRef, type PostDetail, type PostKind, type PostListItem } from '../../../shared/schemas/desk.ts';

/** 요청한 사람(서비스 함수에 넘기는 값) */
export interface Actor {
  id: number;
  role: Role;
}

const kindSchema = z.enum(POST_KINDS, { error: '글 종류는 공지 또는 인수인계로 골라 주세요.' });
const categorySchema = z.string({ error: '분류를 글자로 적어 주세요.' }).trim().max(20, { error: '분류는 20자까지 적을 수 있어요.' });
const titleSchema = z
  .string({ error: '제목을 적어 주세요.' })
  .trim()
  .min(1, { error: '제목을 적어 주세요.' })
  .max(100, { error: '제목은 100자까지 적을 수 있어요.' });
const bodySchema = z.string({ error: '내용을 글자로 적어 주세요.' }).max(10000, { error: '내용은 10,000자까지 적을 수 있어요.' });

/** 새 글 입력 */
export const createPostSchema = z.object({
  kind: kindSchema,
  category: categorySchema.optional(),
  title: titleSchema,
  body: bodySchema.optional().default(''),
  pinned: z.boolean({ error: '고정 여부를 확인해 주세요.' }).optional().default(false),
});

/** 글 고치기 입력(바꿀 것만) */
export const updatePostSchema = z.object({
  category: categorySchema.optional(),
  title: titleSchema.optional(),
  body: bodySchema.optional(),
  pinned: z.boolean({ error: '고정 여부를 확인해 주세요.' }).optional(),
});

const listQuerySchema = z.object({
  kind: kindSchema.optional(),
  unresolved: z.enum(['0', '1'], { error: 'unresolved는 0 또는 1로 적어 주세요.' }).optional(),
  q: z.string().trim().max(50, { error: '검색어는 50자까지 적을 수 있어요.' }).optional(),
  page: z.coerce.number({ error: '쪽 번호를 확인해 주세요.' }).int({ error: '쪽 번호를 확인해 주세요.' }).min(1, { error: '쪽 번호를 확인해 주세요.' }).default(1),
  pageSize: z.coerce
    .number({ error: '한 쪽 개수를 확인해 주세요.' })
    .int({ error: '한 쪽 개수를 확인해 주세요.' })
    .min(1, { error: '한 쪽 개수는 1 이상이에요.' })
    .max(200, { error: '한 번에 200개까지 볼 수 있어요.' })
    .default(50),
});

const idParams = z.object({ id: z.coerce.number({ error: '글 번호를 확인해 주세요.' }).int({ error: '글 번호를 확인해 주세요.' }).positive({ error: '글 번호를 확인해 주세요.' }) });

const resolveSchema = z.object({ resolved: z.boolean({ error: '처리 완료 여부를 확인해 주세요.' }).optional().default(true) });

/** 종류별 기본 분류 */
const DEFAULT_CATEGORY: Record<PostKind, string> = { notice: '일반', handover: '기타' };

interface PostRow {
  id: number;
  kind: PostKind;
  category: string;
  title: string;
  body: string;
  pinned: number;
  author_id: number;
  author_name: string | null;
  resolved_at: string | null;
  resolved_by: number | null;
  resolved_name: string | null;
  created_at: string;
  updated_at: string;
  read_count: number;
  read_by_me: number;
}

/** 목록·상세에 공통으로 쓰는 SELECT(읽은 수는 사용 중인 계정만 센다) */
const SELECT_POST = `
  SELECT p.id, p.kind, p.category, p.title, p.body, p.pinned, p.author_id, a.name AS author_name,
         p.resolved_at, p.resolved_by, r.name AS resolved_name, p.created_at, p.updated_at,
         (SELECT COUNT(*) FROM post_reads pr JOIN users u ON u.id = pr.user_id WHERE pr.post_id = p.id AND u.active = 1) AS read_count,
         EXISTS (SELECT 1 FROM post_reads pr WHERE pr.post_id = p.id AND pr.user_id = :me) AS read_by_me
  FROM posts p
  LEFT JOIN users a ON a.id = p.author_id
  LEFT JOIN users r ON r.id = p.resolved_by`;

/** 사용 중인 계정 수 */
function activeUserCount(db: Db): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE active = 1')?.n ?? 0;
}

function person(id: number | null, name: string | null): PersonRef | null {
  return id === null ? null : { id, name: name ?? '알 수 없음' };
}

/** 본문 앞부분(줄바꿈은 빈칸으로) */
function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

function toListItem(row: PostRow, totalUsers: number): PostListItem {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: row.title,
    preview: previewOf(row.body),
    pinned: row.pinned === 1,
    author: person(row.author_id, row.author_name) as PersonRef,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    resolvedBy: person(row.resolved_by, row.resolved_name),
    readCount: row.read_count,
    totalUsers,
    readByMe: row.read_by_me === 1,
  };
}

/** 글 한 건을 읽는다(지운 글·없는 글은 404) */
function getRow(db: Db, id: number, me: number): PostRow {
  const row = db.get<PostRow>(`${SELECT_POST} WHERE p.id = :id AND p.deleted_at IS NULL`, { id, me });
  if (!row) throw new AppError('NOT_FOUND', { message: '찾는 글이 없어요. 이미 지워졌을 수 있어요.' });
  return row;
}

/** 이 사람이 이 글을 고치거나 지울 수 있는지(작성자 또는 manager 이상) */
function canEditPost(actor: Actor, row: { author_id: number }): boolean {
  return row.author_id === actor.id || can(actor.role, 'posts.moderate');
}

/**
 * 글 목록. 고정 글이 먼저, 그다음 최근 글 순이다.
 * unresolved=true면 처리 전 인수인계만 본다(대시보드용).
 */
export function listPosts(
  db: Db,
  me: number,
  q: { kind?: PostKind; unresolved?: boolean; q?: string; page: number; pageSize: number },
): { data: PostListItem[]; total: number } {
  const where = ['p.deleted_at IS NULL'];
  // node:sqlite는 SQL에 없는 이름의 값을 넘기면 오류를 내므로, 건수 조회에는 :me를 넣지 않는다
  const params: Record<string, string | number> = {};
  if (q.kind) {
    where.push('p.kind = :kind');
    params.kind = q.kind;
  }
  if (q.unresolved) where.push("p.kind = 'handover' AND p.resolved_at IS NULL");
  if (q.q) {
    where.push("(p.title LIKE :word ESCAPE '\\' OR p.body LIKE :word ESCAPE '\\' OR p.category LIKE :word ESCAPE '\\')");
    params.word = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  }
  const cond = where.join(' AND ');
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM posts p WHERE ${cond}`, params)?.n ?? 0;
  const rows = db.all<PostRow>(`${SELECT_POST} WHERE ${cond} ORDER BY p.pinned DESC, p.created_at DESC, p.id DESC LIMIT :limit OFFSET :offset`, {
    ...params,
    me,
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  const users = activeUserCount(db);
  return { data: rows.map((r) => toListItem(r, users)), total };
}

/** 이 글을 이 사람이 읽은 것으로 남긴다(이미 읽었으면 처음 읽은 시각을 그대로 둔다) */
export function markPostRead(db: Db, clock: Clock, postId: number, userId: number): void {
  db.run('INSERT OR IGNORE INTO post_reads (post_id, user_id, read_at) VALUES (?, ?, ?)', [postId, userId, clock.now().toISOString()]);
}

/**
 * 글 상세를 열어 본다. 열면 읽음으로 남긴다(FR-040 AC2).
 * 작성자와 manager 이상에게는 읽은 사람(읽은 시각 순)과 안 읽은 사람(이름 순) 목록을 붙인다.
 */
export function openPost(db: Db, clock: Clock, actor: Actor, id: number): PostDetail {
  getRow(db, id, actor.id);
  markPostRead(db, clock, id, actor.id);
  const row = getRow(db, id, actor.id);
  const { preview: _preview, ...item } = toListItem(row, activeUserCount(db));
  const detail: PostDetail = { ...item, body: row.body, canEdit: canEditPost(actor, row) };
  if (row.author_id === actor.id || atLeast(actor.role, 'manager')) {
    detail.readers = db
      .all<{ id: number; name: string; read_at: string }>(
        'SELECT u.id, u.name, pr.read_at FROM post_reads pr JOIN users u ON u.id = pr.user_id WHERE pr.post_id = ? AND u.active = 1 ORDER BY pr.read_at, u.id',
        [id],
      )
      .map((r) => ({ id: r.id, name: r.name, readAt: r.read_at }));
    detail.unreadUsers = db.all<PersonRef>(
      'SELECT u.id, u.name FROM users u WHERE u.active = 1 AND NOT EXISTS (SELECT 1 FROM post_reads pr WHERE pr.post_id = ? AND pr.user_id = u.id) ORDER BY u.name, u.id',
      [id],
    );
  }
  return detail;
}

/**
 * 새 글을 만든다. 공지는 manager 이상만(아니면 403), 고정은 공지에만 쓸 수 있다.
 * 작성자는 자기 글을 읽은 것으로 시작한다. 공지면 전 직원에게 알림을 만든다.
 */
export function createPost(
  db: Db,
  clock: Clock,
  actor: Actor,
  input: z.output<typeof createPostSchema>,
): { id: number; notified: number } {
  if (input.kind === 'notice' && !can(actor.role, 'notices.write')) {
    throw new AppError('FORBIDDEN', { message: '공지는 실장 이상만 쓸 수 있어요. 인수인계로 남겨 주세요.' });
  }
  if (input.kind === 'handover' && !can(actor.role, 'handover.write')) throw new AppError('FORBIDDEN');
  if (input.pinned && input.kind !== 'notice') {
    throw new AppError('VALIDATION', { fields: { pinned: '맨 위 고정은 공지에만 쓸 수 있어요.' } });
  }
  const now = clock.now().toISOString();
  const category = input.category || DEFAULT_CATEGORY[input.kind];
  const id = db.tx(() => {
    const r = db.run(
      'INSERT INTO posts (kind, category, title, body, pinned, author_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [input.kind, category, input.title, input.body, input.pinned ? 1 : 0, actor.id, now, now],
    );
    markPostRead(db, clock, r.lastInsertRowid, actor.id);
    return r.lastInsertRowid;
  });
  let notified = 0;
  if (input.kind === 'notice') {
    notified = emitNotification(db, { type: 'notice', title: `새 공지: ${input.title}`, body: previewOf(input.body) || null, link: `/desk/board/${id}`, dedupeKey: `notice:${id}` }, clock);
  }
  return { id, notified };
}

/** 글을 고친다(작성자 또는 manager 이상). 고정은 공지에서 manager 이상만 바꾼다. 바뀐 항목 이름을 돌려준다 */
export function updatePost(db: Db, clock: Clock, actor: Actor, id: number, input: z.output<typeof updatePostSchema>): string[] {
  const row = getRow(db, id, actor.id);
  if (!canEditPost(actor, row)) throw new AppError('FORBIDDEN', { message: '내가 쓴 글만 고칠 수 있어요.' });
  if (input.pinned !== undefined) {
    if (row.kind !== 'notice') throw new AppError('VALIDATION', { fields: { pinned: '맨 위 고정은 공지에만 쓸 수 있어요.' } });
    if (!can(actor.role, 'notices.write')) throw new AppError('FORBIDDEN');
  }
  const sets: string[] = [];
  const params: Record<string, string | number> = { id };
  const changed: string[] = [];
  if (input.category !== undefined) {
    sets.push('category = :category');
    params.category = input.category || DEFAULT_CATEGORY[row.kind];
    changed.push('category');
  }
  if (input.title !== undefined) {
    sets.push('title = :title');
    params.title = input.title;
    changed.push('title');
  }
  if (input.body !== undefined) {
    sets.push('body = :body');
    params.body = input.body;
    changed.push('body');
  }
  if (input.pinned !== undefined) {
    sets.push('pinned = :pinned');
    params.pinned = input.pinned ? 1 : 0;
    changed.push('pinned');
  }
  if (sets.length === 0) return [];
  params.now = clock.now().toISOString();
  db.run(`UPDATE posts SET ${sets.join(', ')}, updated_at = :now WHERE id = :id`, params);
  return changed;
}

/** 글을 지운다(숨김). 작성자 또는 manager 이상 */
export function deletePost(db: Db, clock: Clock, actor: Actor, id: number): PostRow {
  const row = getRow(db, id, actor.id);
  if (!canEditPost(actor, row)) throw new AppError('FORBIDDEN', { message: '내가 쓴 글만 지울 수 있어요.' });
  const now = clock.now().toISOString();
  db.run('UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  return row;
}

/** 인수인계를 처리 완료로(또는 다시 처리 전으로) 바꾼다. 모든 로그인 사용자가 할 수 있다(FR-040 AC4) */
export function resolvePost(db: Db, clock: Clock, actor: Actor, id: number, resolved: boolean): void {
  const row = getRow(db, id, actor.id);
  if (row.kind !== 'handover') throw new AppError('VALIDATION', { message: '처리 완료 표시는 인수인계에만 쓸 수 있어요.', fields: { kind: '인수인계가 아니에요.' } });
  const now = clock.now().toISOString();
  if (resolved) db.run('UPDATE posts SET resolved_at = COALESCE(resolved_at, ?), resolved_by = COALESCE(resolved_by, ?), updated_at = ? WHERE id = ?', [now, actor.id, now, id]);
  else db.run('UPDATE posts SET resolved_at = NULL, resolved_by = NULL, updated_at = ? WHERE id = ?', [now, id]);
}

function actorOf(req: FastifyRequest): Actor {
  const u = currentUser(req);
  return { id: u.id, role: u.role };
}

/** 공지·인수인계 API를 등록한다(routes.ts가 부른다) */
export function registerPostRoutes(app: FastifyInstance): void {
  app.get('/posts', async (req, reply) => {
    const q = parseInput(listQuerySchema, req.query);
    reply.header('cache-control', 'no-store');
    return listPosts(app.db, currentUser(req).id, { kind: q.kind, unresolved: q.unresolved === '1', q: q.q || undefined, page: q.page, pageSize: q.pageSize });
  });

  app.post('/posts', async (req, reply) => {
    const input = parseInput(createPostSchema, req.body);
    const actor = actorOf(req);
    const { id, notified } = createPost(app.db, app.clock, actor, input);
    audit(auditCtx(req), `${input.kind}.create`, 'post', id, { kind: input.kind, title: input.title, pinned: input.pinned, notified });
    return reply.code(201).send({ data: openPost(app.db, app.clock, actor, id) });
  });

  app.get('/posts/:id', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    reply.header('cache-control', 'no-store');
    return { data: openPost(app.db, app.clock, actorOf(req), id) };
  });

  app.patch('/posts/:id', async (req) => {
    const { id } = parseInput(idParams, req.params);
    const input = parseInput(updatePostSchema, req.body);
    const actor = actorOf(req);
    const changed = updatePost(app.db, app.clock, actor, id, input);
    if (changed.length) audit(auditCtx(req), 'post.update', 'post', id, { changed, ...(input.pinned !== undefined ? { pinned: input.pinned } : {}) });
    return { data: openPost(app.db, app.clock, actor, id) };
  });

  app.delete('/posts/:id', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const row = deletePost(app.db, app.clock, actorOf(req), id);
    audit(auditCtx(req), 'post.delete', 'post', id, { kind: row.kind, title: row.title });
    return reply.code(204).send();
  });

  app.post('/posts/:id/resolve', async (req) => {
    const { id } = parseInput(idParams, req.params);
    const { resolved } = parseInput(resolveSchema, req.body);
    const actor = actorOf(req);
    resolvePost(app.db, app.clock, actor, id, resolved);
    audit(auditCtx(req), resolved ? 'handover.resolve' : 'handover.reopen', 'post', id, null);
    return { data: openPost(app.db, app.clock, actor, id) };
  });
}

// 이 파일이 하는 일: docs 모듈의 문서 작성·서식 보관함·파일 내려받기 API(backend.md §3.6, FR-060·062)를 등록한다.
// GET /api/documents?folder&kind&q&tag&page&pageSize → { data, total, facets }      (모든 로그인 사용자)
// POST /api/documents  JSON {kind,title,body_md,folder,tags,source} → 201 { data }  (documents.write = S, 버전 1)
//                      multipart(file + title·folder·tags) → 201 { data }           (documents.upload = M, 검사는 server/lib/files.ts)
// GET/PATCH/DELETE /api/documents/:id   (조회 S, 고치기·지우기는 작성자 또는 documents.edit_any) · GET /api/documents/:id/versions
// GET /api/files/:id → 첨부 파일(attachment). 파일 쓰임새(purpose)마다 볼 수 있는 권한을 따로 확인한다.
// 로그인·CSRF·주소별 권한은 server/auth/guard.ts가 먼저 확인한다. 등록은 server/modules/index.ts가 '/api' 앞붙임으로 한다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertCan, auditCtx, currentUser } from '../../auth/guard.ts';
import { AppError } from '../../lib/errors.ts';
import { getFile, readUpload, registerUploads, sendAttachment, type FilePurpose } from '../../lib/files.ts';
import { parseInput } from '../../security/validate.ts';
import { can, type Cap } from '../../../shared/roles.ts';
import { DOC_KINDS, documentCreateSchema, documentPatchSchema } from '../../../shared/schemas/docs.ts';
import { createDocument, deleteDocument, getDocument, listDocuments, listVersions, updateDocument, uploadDocument, type Actor } from './service.ts';

/** 목록 조회 조건 */
const listQuery = z.object({
  folder: z.string().max(50, '폴더 이름이 너무 길어요.').optional(),
  kind: z.enum(DOC_KINDS, { error: '문서 종류를 다시 골라 주세요.' }).optional(),
  q: z.string().trim().max(100, '검색어는 100자 이하로 적어 주세요.').optional(),
  tag: z.string().trim().max(20, '태그가 너무 길어요.').optional(),
  page: z.coerce.number({ error: '쪽 번호는 숫자로 적어 주세요.' }).int({ error: '쪽 번호는 정수로 적어 주세요.' }).min(1, { error: '쪽 번호는 1 이상이에요.' }).default(1),
  pageSize: z.coerce
    .number({ error: '한 쪽 개수는 숫자로 적어 주세요.' })
    .int({ error: '한 쪽 개수는 정수로 적어 주세요.' })
    .min(1, { error: '한 쪽 개수는 1 이상이에요.' })
    .max(200, { error: '한 쪽에 200개까지 볼 수 있어요.' })
    .default(50),
});

/** 주소의 번호 */
const idParams = z.object({ id: z.coerce.number({ error: '번호를 확인해 주세요.' }).int({ error: '번호를 확인해 주세요.' }).positive({ error: '번호를 확인해 주세요.' }) });

/** 업로드 글 칸(제목·폴더·태그). 태그는 쉼표로 나눈 글 */
const uploadFields = z.object({
  title: z.string().trim().max(200, '제목은 200자 이하로 줄여 주세요.').default(''),
  folder: z.string().trim().max(50, '폴더 이름은 50자 이하로 적어 주세요.').default(''),
  tags: z
    .string()
    .default('')
    .transform((s) => [...new Set(s.split(',').map((t) => t.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(20, '태그는 20자 이하로 적어 주세요.')).max(10, '태그는 10개까지 넣을 수 있어요.')),
});

/** 파일 쓰임새 → 내려받을 수 있는 권한(이 표에 없으면 관리자만) */
const FILE_VIEW_CAP: Readonly<Record<FilePurpose, Cap>> = {
  form: 'app.view',
  training: 'app.view',
  equipment: 'app.view',
  kb: 'kb.manage',
  receipt: 'expenses.manage',
  expense: 'expenses.manage',
};

/** 요청한 사람(id·역할) */
function actorOf(req: FastifyRequest): Actor {
  const u = currentUser(req);
  return { id: u.id, role: u.role };
}

/** docs 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  // 이 플러그인 범위에서만 multipart(파일 올리기)를 받는다
  await registerUploads(app);

  app.get('/documents', async (req) => {
    const q = parseInput(listQuery, req.query);
    return listDocuments(app.db, { folder: q.folder, kind: q.kind, q: q.q || undefined, tag: q.tag || undefined, page: q.page, pageSize: q.pageSize });
  });

  app.post('/documents', async (req, reply) => {
    const actor = actorOf(req);
    if (req.isMultipart()) {
      // 업로드는 manager 이상만(파일을 읽기 전에 막는다)
      if (!can(actor.role, 'documents.upload')) throw new AppError('FORBIDDEN', { message: '서식 파일은 실장님 이상만 올릴 수 있어요.' });
      const part = await readUpload(req);
      const f = parseInput(uploadFields, part.fields);
      const doc = uploadDocument({ db: app.db, clock: app.clock, dataDir: app.dataDir }, auditCtx(req, app), actor, {
        name: part.name,
        data: part.data,
        title: f.title,
        folder: f.folder,
        tags: f.tags,
      });
      return reply.code(201).send({ data: doc });
    }
    assertCan(req, 'documents.write');
    const input = parseInput(documentCreateSchema, req.body);
    return reply.code(201).send({ data: createDocument(auditCtx(req, app), actor, input) });
  });

  app.get('/documents/:id', async (req) => {
    const { id } = parseInput(idParams, req.params);
    return { data: getDocument(app.db, id, actorOf(req)) };
  });

  app.patch('/documents/:id', async (req) => {
    const { id } = parseInput(idParams, req.params);
    const patch = parseInput(documentPatchSchema, req.body);
    return { data: updateDocument(auditCtx(req, app), actorOf(req), id, patch) };
  });

  app.delete('/documents/:id', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    deleteDocument(auditCtx(req, app), actorOf(req), id);
    return reply.code(204).send();
  });

  app.get('/documents/:id/versions', async (req) => {
    const { id } = parseInput(idParams, req.params);
    return { data: listVersions(app.db, id) };
  });

  app.get('/files/:id', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    const user = currentUser(req);
    const row = getFile(app.db, id);
    if (!row) throw new AppError('NOT_FOUND', { message: '파일을 찾을 수 없어요.' });
    const cap = FILE_VIEW_CAP[row.purpose] ?? 'users.manage';
    if (!can(user.role, cap)) throw new AppError('FORBIDDEN');
    // 서식 파일은 지우지 않은 문서에 딸린 것만 내려받을 수 있다
    if (row.purpose === 'form' && !app.db.get('SELECT 1 AS x FROM documents WHERE file_id = ? AND deleted_at IS NULL', [id])) {
      throw new AppError('NOT_FOUND', { message: '파일을 찾을 수 없어요. 문서가 지워졌을 수 있어요.' });
    }
    return sendAttachment(reply, app.dataDir, row);
  });
}

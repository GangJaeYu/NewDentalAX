// 이 파일이 하는 일: assistant 모듈의 원내 AI 도우미 API(backend.md §3.6, FR-070·071)를 등록한다. 등록은 server/modules/index.ts가 '/api' 앞붙임으로 한다.
// GET  /api/kb/docs                      → { data: KbDocItem[] }    (모든 로그인 사용자. 직원은 완료·전체 공개 자료만)
// GET  /api/kb/docs/:id                  → { data: KbDocDetail }    (원문 보기. 볼 수 없는 자료는 404)
// POST /api/kb/docs  multipart(file + title·visibility) 또는 JSON {documentId, title?, visibility?} → 201 { data }  (kb.manage = M)
// DELETE /api/kb/docs/:id → 204 · POST /api/kb/docs/:id/confirm-redact → { data }   (kb.manage, 주소별 권한 표가 먼저 막는다)
// POST /api/assistant/ask {question} → { data: AskResponse }  (ai.assistant) · GET/DELETE /api/assistant/history (본인 기록만)
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertCan, auditCtx, currentUser } from '../../auth/guard.ts';
import { readUpload, registerUploads } from '../../lib/files.ts';
import { parseInput } from '../../security/validate.ts';
import { baseUrlsFromEnv } from '../../ai/types.ts';
import type { AiCallContext } from '../../ai/gateway.ts';
import { askSchema, kbFromDocumentSchema, kbUploadFieldsSchema } from '../../../shared/schemas/kb.ts';
import { addKbFromDocument, ask, clearHistory, confirmRedact, deleteKbDoc, getKbDoc, listHistory, listKbDocs, uploadKbFile, type Actor } from './service.ts';

/** 주소의 번호 */
const idParams = z.object({ id: z.coerce.number({ error: '번호를 확인해 주세요.' }).int({ error: '번호를 확인해 주세요.' }).positive({ error: '번호를 확인해 주세요.' }) });

/** 요청한 사람(id·역할) */
function actorOf(req: FastifyRequest): Actor {
  const u = currentUser(req);
  return { id: u.id, role: u.role };
}

/** 게이트웨이에 넘길 맥락(테스트가 buildApp에 넣은 AI 옵션, 없으면 환경 변수) */
function aiCtx(app: FastifyInstance, req: FastifyRequest): AiCallContext {
  return { db: app.db, clock: app.clock, dataDir: app.dataDir, options: app.aiOptions ?? { baseUrls: baseUrlsFromEnv() }, user: currentUser(req) };
}

/** assistant 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  // 이 플러그인 범위에서만 multipart(파일 올리기)를 받는다
  await registerUploads(app);
  const env = () => ({ db: app.db, clock: app.clock, dataDir: app.dataDir });

  app.get('/kb/docs', async (req) => ({ data: listKbDocs(app.db, actorOf(req)) }));

  app.get('/kb/docs/:id', async (req) => {
    const { id } = parseInput(idParams, req.params);
    return { data: getKbDoc(app.db, actorOf(req), id) };
  });

  app.post('/kb/docs', async (req, reply) => {
    // 주소별 권한 표(kb.manage)가 먼저 막지만, 파일을 읽기 전에 한 번 더 확인한다
    assertCan(req, 'kb.manage');
    const actor = actorOf(req);
    if (req.isMultipart()) {
      const part = await readUpload(req);
      const f = parseInput(kbUploadFieldsSchema, part.fields);
      const item = await uploadKbFile(env(), auditCtx(req, app), actor, { name: part.name, data: part.data, title: f.title, visibility: f.visibility });
      return reply.code(201).send({ data: item });
    }
    const input = parseInput(kbFromDocumentSchema, req.body);
    return reply.code(201).send({ data: await addKbFromDocument(env(), auditCtx(req, app), actor, input) });
  });

  app.post('/kb/docs/:id/confirm-redact', async (req) => {
    const { id } = parseInput(idParams, req.params);
    return { data: confirmRedact(auditCtx(req, app), actorOf(req), id) };
  });

  app.delete('/kb/docs/:id', async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    deleteKbDoc(auditCtx(req, app), actorOf(req), id);
    return reply.code(204).send();
  });

  app.post('/assistant/ask', async (req) => {
    const { question } = parseInput(askSchema, req.body);
    return { data: await ask(aiCtx(app, req), question) };
  });

  app.get('/assistant/history', async (req) => ({ data: listHistory(app.db, actorOf(req)) }));

  app.delete('/assistant/history', async (req, reply) => {
    clearHistory(auditCtx(req, app), actorOf(req));
    return reply.code(204).send();
  });
}

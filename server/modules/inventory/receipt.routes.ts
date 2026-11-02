// 이 파일이 하는 일: 명세서·영수증 사진 입고 API(backend.md §3.5, FR-122)를 등록한다. 경로 앞에는 '/api'가 붙는다.
//   GET  /inventory/receipt-status                         → { data: ReceiptStatus }  지금 사진 읽기를 쓸 수 있는지(꺼짐·사진 미지원 모델·예산)
//   POST /ai/receipt  multipart(file + confirmed=true)      → { data: ReceiptReadResult } (cap ai.receipt, 주소별 권한 표가 먼저 막는다)
//   POST /inventory/receipt-commit  {fileId, …, lines, alsoExpense?} → 201 { data: ReceiptCommitResult } (입고는 S, 지출 동시 기록은 M)
// multipart는 이 플러그인 범위에서만 받는다. 사진 크기 상한(8MB)·형식 검사는 server/lib/files.ts, 픽셀 크기 검사와 저장은 receipt.service.ts가 한다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertCan, auditCtx, currentUser } from '../../auth/guard.ts';
import { readUpload, registerUploads } from '../../lib/files.ts';
import { parseInput } from '../../security/validate.ts';
import { baseUrlsFromEnv } from '../../ai/types.ts';
import type { AiCallContext } from '../../ai/gateway.ts';
import { commitReceipt, readReceipt, receiptStatus } from './receipt.service.ts';
import { receiptCommitSchema } from './receipt.schema.ts';

/** 게이트웨이에 넘길 맥락(테스트가 buildApp에 넣은 AI 옵션, 없으면 환경 변수) */
function aiCtx(app: FastifyInstance, req: FastifyRequest): AiCallContext {
  return { db: app.db, clock: app.clock, dataDir: app.dataDir, options: app.aiOptions ?? { baseUrls: baseUrlsFromEnv() }, user: currentUser(req) };
}

/** 명세서 사진 입고 API를 등록한다 */
export default async function receiptRoutes(app: FastifyInstance): Promise<void> {
  await registerUploads(app);

  // 사진 읽기 사용 가능 여부(화면의 비활성 안내용)
  app.get('/inventory/receipt-status', async (req) => ({ data: receiptStatus(app.db, app.clock, app.dataDir, currentUser(req).role) }));

  // 사진 읽기: 확인 체크·크기 검사 → AI → 사진 저장 → 품목 후보
  app.post('/ai/receipt', async (req) => {
    const up = await readUpload(req);
    const confirmed = up.fields.confirmed === 'true' || up.fields.confirmed === '1';
    return { data: await readReceipt(aiCtx(app, req), { name: up.name, data: up.data, confirmed }) };
  });

  // 확인·수정한 표를 입고로(실장 이상이 고르면 지출도) 저장
  app.post('/inventory/receipt-commit', async (req, reply) => {
    assertCan(req, 'inventory.move');
    const input = parseInput(receiptCommitSchema, req.body);
    const result = commitReceipt(auditCtx(req), currentUser(req).role, input);
    reply.code(201);
    return { data: result };
  });
}

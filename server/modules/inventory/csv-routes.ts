// 이 파일이 하는 일: 재고 CSV API(backend.md §3.5 import/export, FR-056)를 등록한다. 경로 앞에는 '/api'가 붙는다.
//   GET  /export/items.csv · /export/vendors.csv · /export/moves.csv   (inventory.export = M) 엑셀 호환 CSV(UTF-8 BOM)
//   GET  /inventory/moves?format=csv                                    (같은 권한) 입출고 목록과 같은 조건으로 내보내기 — routes.ts가 sendMovesCsv를 부른다
//   GET  /import/items/template.csv                                    (items.import = M) 가져오기 양식
//   POST /import/items/preview  multipart CSV → { data: ImportPreview } (items.import) 저장하지 않고 신규·변경·오류만 보여 준다
//   POST /import/items/commit   { token, skipErrors } → { data: { created, updated, skipped, errorLines } }
// 주소별 권한은 server/auth/api-permissions.ts가 먼저 막는다. 내보내기·가져오기는 감사 기록을 남긴다.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertCan, auditCtx } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { audit } from '../../lib/audit.ts';
import { AppError } from '../../lib/errors.ts';
import { isValidDate } from '../../lib/dates.ts';
import { csvDownloadHeaders } from '../../lib/csv.ts';
import { readUpload, registerUploads } from '../../lib/files.ts';
import { MOVE_TYPES } from '../../../shared/schemas/inventory.ts';
import { EXPORT_ENTITY_LABELS, importCommitSchema, type ExportEntity } from '../../../shared/schemas/inventory-csv.ts';
import { commitImport, itemsCsv, kstStamp, movesCsv, previewImport, templateCsv, vendorsCsv } from './csv.ts';

const day = z
  .string()
  .refine((s) => isValidDate(s), '날짜는 2026-11-02 형식으로 적어 주세요.')
  .optional();

/** 입출고 내보내기 조건(입출고 목록과 같은 이름) */
const movesCsvQuery = z.object({
  itemId: z.coerce.number().int().positive().optional(),
  type: z.enum(MOVE_TYPES).optional(),
  from: day,
  to: day,
  q: z.string().max(80).optional(),
});

const exportParam = z.object({ file: z.string().max(40) });

/** CSV 글을 내려받기로 보낸다 */
function sendCsv(reply: FastifyReply, asciiName: string, koreanName: string, csv: string): FastifyReply {
  return reply.headers(csvDownloadHeaders(asciiName, koreanName)).send(csv);
}

/** 입출고 기록을 조건대로 CSV로 내려보낸다(GET /inventory/moves?format=csv에서도 쓴다). 권한 inventory.export를 확인한다 */
export function sendMovesCsv(req: FastifyRequest, reply: FastifyReply): FastifyReply {
  assertCan(req, 'inventory.export');
  const q = parseInput(movesCsvQuery, req.query);
  const { csv, rows } = movesCsv(req.server.db, q);
  audit(auditCtx(req), 'inventory.export', 'moves', null, { entity: 'moves', rows, ...q });
  const stamp = kstStamp(req.server.clock);
  return sendCsv(reply, `moves-${stamp}.csv`, `입출고기록-${stamp}.csv`, csv);
}

/** 재고 CSV API를 등록한다(multipart는 이 플러그인 범위에서만 받는다) */
export default async function csvRoutes(app: FastifyInstance): Promise<void> {
  await registerUploads(app);

  // 품목·거래처·입출고 내보내기
  app.get('/export/:file', async (req, reply) => {
    const { file } = parseInput(exportParam, req.params);
    const m = /^(items|vendors|moves)\.csv$/.exec(file);
    if (!m) throw new AppError('NOT_FOUND', { message: '내보낼 수 있는 것은 품목·거래처·입출고 기록이에요.' });
    const entity = m[1] as ExportEntity;
    if (entity === 'moves') return sendMovesCsv(req, reply);
    const { csv, rows } = entity === 'items' ? itemsCsv(app.db, app.clock) : vendorsCsv(app.db);
    audit(auditCtx(req), 'inventory.export', entity, null, { entity, rows });
    const stamp = kstStamp(app.clock);
    return sendCsv(reply, `${entity}-${stamp}.csv`, `${EXPORT_ENTITY_LABELS[entity]}-${stamp}.csv`, csv);
  });

  // 가져오기 양식
  app.get('/import/items/template.csv', async (_req, reply) => sendCsv(reply, 'items-template.csv', '품목-가져오기-양식.csv', templateCsv()));

  // 미리보기(저장하지 않음)
  app.post('/import/items/preview', async (req) => {
    const part = await readUpload(req);
    return { data: previewImport(auditCtx(req), { name: part.name, data: part.data }) };
  });

  // 확정
  app.post('/import/items/commit', async (req) => {
    const input = parseInput(importCommitSchema, req.body);
    return { data: commitImport(auditCtx(req), input.token, input.skipErrors) };
  });
}

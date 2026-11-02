// 이 파일이 하는 일: 교육 이수 기록 API(backend.md §3.7 trainings, FR-082)를 등록한다. 처리 내용은 training.ts에 있다.
// - GET /trainings : 교육 항목과 직원별 다음 예정일·상태(직원은 본인 줄만) · POST /trainings · PATCH /trainings/:id : 항목 관리(trainings.manage, 실장 이상)
// - GET /trainings/:id/records?userId= : 이수 기록(직원은 본인 것만) · POST /trainings/:id/records : 이수 기록(본인, 또는 실장 이상이 다른 직원 것)
//   JSON {userId?, completedOn, note} 또는 multipart(증빙 파일 + 같은 글 칸). 저장 직후 예정일이 알림 일수 안이면 바로 알린다(training-notify.ts).
// - DELETE /trainings/records/:id : 잘못 넣은 기록 지우기 · GET /trainings/records/:id/file : 증빙 파일 내려받기(첨부 파일, 본인 또는 실장 이상)
// multipart는 이 파일의 하위 플러그인 범위에만 건다(같은 hr 모듈의 다른 라우트에 영향 없음). 로그인·CSRF는 server/auth/guard.ts가 먼저 확인한다.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.ts';
import { readUpload, registerUploads, sendAttachment } from '../../lib/files.ts';
import { assertCan, auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { createRecordSchema, createTrainingSchema, updateTrainingSchema, type TrainingRecordResult } from '../../../shared/schemas/training.ts';
import { createRecord, createTraining, deleteRecord, listRecords, listTrainings, recordFile, updateTraining, type TrainingActor } from './training.ts';
import { notifyTrainingPair, registerTrainingNotifyScanner } from './training-notify.ts';

const idParams = z.object({ id: z.coerce.number({ error: '번호를 확인해 주세요.' }).int({ error: '번호를 확인해 주세요.' }).positive({ error: '번호를 확인해 주세요.' }) });
const recordsQuery = z.object({
  userId: z.coerce.number({ error: '직원 번호를 확인해 주세요.' }).int({ error: '직원 번호를 확인해 주세요.' }).positive({ error: '직원 번호를 확인해 주세요.' }).optional(),
});

/** 세션 사용자 → 처리 함수에 넘길 모양 */
function actorOf(req: FastifyRequest): TrainingActor {
  const u = currentUser(req);
  return { id: u.id, role: u.role };
}

/** multipart 글 칸에서 빈 값을 뺀다(빈 userId는 "본인"으로 본다) */
function compact(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim() !== ''));
}

/** 교육 이수 기록 API를 등록한다(하위 플러그인으로 감싸 multipart 범위를 좁힌다) */
export async function registerTrainingRoutes(app: FastifyInstance): Promise<void> {
  registerTrainingNotifyScanner();
  await app.register(async (sub) => {
    await registerUploads(sub);

    sub.get('/trainings', async (req) => ({ data: listTrainings(sub.db, sub.clock, actorOf(req)) }));

    sub.post('/trainings', async (req, reply) => {
      assertCan(req, 'trainings.manage');
      const input = parseInput(createTrainingSchema, req.body);
      const item = createTraining(sub.db, sub.clock, actorOf(req), input);
      audit(auditCtx(req), 'training.create', 'training', item.id, { name: item.name, cycleMonths: item.cycleMonths });
      reply.code(201);
      return { data: item };
    });

    sub.patch('/trainings/:id', async (req) => {
      assertCan(req, 'trainings.manage');
      const { id } = parseInput(idParams, req.params);
      const input = parseInput(updateTrainingSchema, req.body);
      const item = updateTraining(sub.db, sub.clock, actorOf(req), id, input);
      audit(auditCtx(req), 'training.update', 'training', id, { fields: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined) });
      return { data: item };
    });

    sub.get('/trainings/:id/records', async (req) => {
      const { id } = parseInput(idParams, req.params);
      const q = parseInput(recordsQuery, req.query);
      return { data: listRecords(sub.db, actorOf(req), id, q.userId) };
    });

    sub.post('/trainings/:id/records', async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      const actor = actorOf(req);
      let fields: unknown = req.body;
      let file: { name: string; data: Buffer } | null = null;
      if (req.isMultipart()) {
        const part = await readUpload(req);
        fields = compact(part.fields);
        file = { name: part.name, data: part.data };
      }
      const input = parseInput(createRecordSchema, fields);
      const saved = createRecord({ db: sub.db, clock: sub.clock, dataDir: sub.dataDir }, actor, id, input, file);
      const notified = notifyTrainingPair(sub.db, sub.clock, id, saved.record.user.id);
      audit(auditCtx(req), 'training.record', 'training_record', saved.record.id, {
        trainingId: id,
        userId: saved.record.user.id,
        completedOn: saved.record.completedOn,
        file: saved.record.file ? saved.record.file.id : null,
      });
      reply.code(201);
      const data: TrainingRecordResult = { record: saved.record, status: saved.status, notified };
      return { data };
    });

    sub.delete('/trainings/records/:id', async (req) => {
      const { id } = parseInput(idParams, req.params);
      const rec = deleteRecord(sub.db, actorOf(req), id);
      audit(auditCtx(req), 'training.record.delete', 'training_record', id, { trainingId: rec.trainingId, userId: rec.user.id, completedOn: rec.completedOn });
      return { data: rec };
    });

    sub.get('/trainings/records/:id/file', async (req, reply) => {
      const { id } = parseInput(idParams, req.params);
      const row = recordFile(sub.db, actorOf(req), id);
      return sendAttachment(reply, sub.dataDir, row);
    });
  });
}

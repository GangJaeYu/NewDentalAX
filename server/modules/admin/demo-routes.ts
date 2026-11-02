// 이 파일이 하는 일: 데모 데이터 API(backend.md §3.2, FR-007). 경로에는 '/api'가 붙는다(admin/routes.ts가 등록).
// GET /demo/status(데모 상태·비었는지) · POST /demo/load(빈 상태일 때만 데모 데이터 넣기) · POST /demo/reset {confirm:'초기화합니다'}
// load·reset 권한은 server/auth/api-permissions.ts 표(demo.manage)가, status는 여기서 같은 권한으로 확인한다.
import type { FastifyInstance } from 'fastify';
import { auditCtx, requireCap } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { resetSchema, type DemoStatus, type ResetResult } from '../../../shared/schemas/backup.ts';
import { backupEnvOf } from '../../jobs/backup-job.ts';
import { demoStatus, loadDemo, resetDemo } from './demo-service.ts';

/** 데모 데이터 API를 등록한다 */
export async function demoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/demo/status', { preHandler: requireCap('demo.manage') }, async (): Promise<{ data: DemoStatus }> => ({ data: demoStatus(app.db) }));

  app.post('/demo/load', async (req, reply) => {
    await loadDemo(app.db, app.clock, auditCtx(req));
    return reply.code(204).send();
  });

  // 초기화: 확인 문구가 정확해야 한다(틀리면 400, 아무것도 지우지 않음)
  app.post('/demo/reset', async (req): Promise<{ data: ResetResult }> => {
    parseInput(resetSchema, req.body);
    const out = resetDemo(backupEnvOf(app), auditCtx(req));
    return { data: { backup: out.backup } };
  });
}

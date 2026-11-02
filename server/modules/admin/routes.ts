// 이 파일이 하는 일: admin 모듈의 API 등록부(backend.md §3.2). 직원 계정(users.ts)·병원 기본 정보(clinic.ts)·활동 기록(audit.ts)·백업(backup-routes.ts)·데모(demo-routes.ts)를 등록한다.
// 등록은 server/modules/index.ts가 '/api' 앞붙임으로 한다(예: app.get('/users') → GET /api/users).
// 로그인·CSRF·주소별 권한은 server/auth/guard.ts가 먼저 확인한다. 본문·작성자에 따라 다른 권한은 requireCap·assertCan으로 더 확인한다.
// 기능별 파일: 백업·복원 backup-routes.ts, 데모 데이터 demo-routes.ts(phase-02-task-05). 직원·병원·감사 로그는 phase-01-task-05가 더한다.
import type { FastifyInstance } from 'fastify';
import { usersRoutes } from './users.ts';
import { clinicRoutes } from './clinic.ts';
import { auditRoutes } from './audit.ts';
import { backupRoutes } from './backup-routes.ts';
import { demoRoutes } from './demo-routes.ts';

/** admin 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  await usersRoutes(app);
  await clinicRoutes(app);
  await auditRoutes(app);
  await backupRoutes(app);
  await demoRoutes(app);
}

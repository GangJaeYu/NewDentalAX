// 이 파일이 하는 일: admin 모듈의 직원 계정·감사 로그·설정·백업·데모 API(backend.md §3.2)를 등록한다.
// 등록은 server/modules/index.ts가 이미 해 두었으니 이 파일만 고치면 된다. 경로는 '/api'가 붙은 채로 등록된다(예: app.get('/items', ...) → GET /api/items).
// 로그인·CSRF·주소별 권한은 server/auth/guard.ts가 먼저 확인한다. 본문·작성자에 따라 다른 권한은 requireCap·assertCan으로 더 확인한다.
// 기능별 파일: 백업·복원 backup-routes.ts, 데모 데이터 demo-routes.ts(phase-02-task-05). 직원·병원·감사 로그는 phase-01-task-05가 더한다.
import type { FastifyInstance } from 'fastify';
import { backupRoutes } from './backup-routes.ts';
import { demoRoutes } from './demo-routes.ts';

/** admin 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  await backupRoutes(app);
  await demoRoutes(app);
}

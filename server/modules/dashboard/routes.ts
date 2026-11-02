// 이 파일이 하는 일: 대시보드 API(backend.md §3.3, FR-008)를 등록한다. GET /api/dashboard → { data: DashboardData }.
// 모든 로그인 사용자(S, cap app.view)가 부를 수 있고, 역할에 따라 빠지는 영역은 service.ts가 null로 비운다.
// 숫자가 자주 바뀌므로 캐시하지 않는다. 등록은 notifications 모듈 등록부(backend.md §3.3 "dashboard · notifications")가 한다.
import type { FastifyInstance } from 'fastify';
import { currentUser, requireCap } from '../../auth/guard.ts';
import { getDashboard } from './service.ts';

/** 대시보드 API를 등록한다 */
export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get('/dashboard', { preHandler: requireCap('app.view') }, async (req, reply) => {
    const user = currentUser(req);
    reply.header('cache-control', 'no-store');
    return { data: getDashboard(app.db, app.clock, app.dataDir, { id: user.id, name: user.name, role: user.role }) };
  });
}

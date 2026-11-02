// 이 파일이 하는 일: 알림센터 API(backend.md §3.3, FR-090)를 등록한다. 모든 로그인 사용자(S, cap notifications.read)가 자기 알림만 본다.
// GET /api/notifications/summary → { data: { unread, latestId } }  (화면 종 아이콘이 30초마다 부름, 캐시 안 함)
// GET /api/notifications?page=1&pageSize=50&unread=1 → { data: [...], total }  (최근 것부터, pageSize 최대 200)
// POST /api/notifications/:id/read → 204 (내 알림이 아니면 404) · POST /api/notifications/read-all → 204
// 로그인·CSRF는 server/auth/guard.ts가 먼저 확인한다. 등록은 server/modules/index.ts가 '/api' 앞붙임으로 한다.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireCap } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { getSummary, listNotifications, markAllRead, markRead } from './service.ts';
import { registerDashboardRoutes } from '../dashboard/routes.ts';

/** 목록 조회 조건(쿼리 문자열) */
const listQuery = z.object({
  page: z.coerce.number({ error: '쪽 번호는 숫자로 적어 주세요.' }).int({ error: '쪽 번호는 정수로 적어 주세요.' }).min(1, { error: '쪽 번호는 1 이상이에요.' }).default(1),
  pageSize: z.coerce
    .number({ error: '한 쪽 개수는 숫자로 적어 주세요.' })
    .int({ error: '한 쪽 개수는 정수로 적어 주세요.' })
    .min(1, { error: '한 쪽 개수는 1 이상이에요.' })
    .max(200, { error: '한 쪽에 200개까지 볼 수 있어요.' })
    .default(50),
  unread: z.enum(['0', '1'], { error: 'unread는 0 또는 1로 적어 주세요.' }).optional(),
});

/** 주소의 알림 번호 */
const idParams = z.object({ id: z.coerce.number({ error: '알림 번호를 확인해 주세요.' }).int({ error: '알림 번호를 확인해 주세요.' }).positive({ error: '알림 번호를 확인해 주세요.' }) });

/** notifications 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  const canRead = { preHandler: requireCap('notifications.read') };

  app.get('/notifications/summary', canRead, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return { data: getSummary(app.db, currentUser(req).id) };
  });

  app.get('/notifications', canRead, async (req, reply) => {
    const q = parseInput(listQuery, req.query);
    reply.header('cache-control', 'no-store');
    return listNotifications(app.db, currentUser(req).id, { page: q.page, pageSize: q.pageSize, unreadOnly: q.unread === '1' });
  });

  app.post('/notifications/read-all', canRead, async (req, reply) => {
    markAllRead(app.db, app.clock, currentUser(req).id);
    return reply.code(204).send();
  });

  app.post('/notifications/:id/read', canRead, async (req, reply) => {
    const { id } = parseInput(idParams, req.params);
    markRead(app.db, app.clock, currentUser(req).id, id);
    return reply.code(204).send();
  });

  // 대시보드(GET /api/dashboard, phase-03-task-10)는 backend.md §3.3에서 알림과 같은 묶음이라 여기서 함께 등록한다
  registerDashboardRoutes(app);
}

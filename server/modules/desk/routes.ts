// 이 파일이 하는 일: desk 모듈 API(backend.md §3.4)의 등록부. 공지·인수인계(posts.ts)와 오픈·마감 체크리스트(checklists.ts)를 붙인다.
// 보관 문구(saved-texts)는 phase-03-task-05가 이 파일에 한 줄 더 붙인다. 경로는 '/api'가 붙은 채로 등록된다(server/modules/index.ts).
// 로그인·CSRF·주소별 권한은 server/auth/guard.ts가 먼저 확인하고, 본문·작성자에 따라 다른 권한은 각 파일이 확인한다.
import type { FastifyInstance } from 'fastify';
import { registerChecklistRoutes } from './checklists.ts';
import { registerPostRoutes } from './posts.ts';

/** desk 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  registerPostRoutes(app);
  registerChecklistRoutes(app);
}

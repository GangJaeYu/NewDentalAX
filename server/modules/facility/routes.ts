// 이 파일이 하는 일: facility 모듈 API(backend.md §3.8)의 등록부. 법정 의무 일정(legal.ts)과 그 기한 알림 scanner(legal-notify.ts)를 붙인다.
// 장비·멸균기(equipment·sterilizer)는 phase-04-task-03이 이 파일에 한 줄씩 더한다. 경로는 '/api'가 붙은 채로 등록된다(server/modules/index.ts).
// 로그인·CSRF·주소별 권한은 server/auth/guard.ts가 먼저 확인하고, 본문에 따라 다른 권한은 각 파일이 확인한다.
// 서버가 켜질 때 법정 일정 기본 템플릿(TRD TD-022) 중 빠진 것을 넣는다.
import type { FastifyInstance } from 'fastify';
import { ensureLegalTemplates } from '../../db/seed/legal-templates.ts';
import { registerLegalRoutes } from './legal.ts';
import { registerLegalNotifyScanner } from './legal-notify.ts';

/** facility 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  // DB 없이 등록만 시험하는 경우(server/modules/index.test.ts)는 건너뛴다. 목록을 읽을 때도 빠진 템플릿을 채운다
  if (app.hasDecorator('db') && app.hasDecorator('clock')) ensureLegalTemplates(app.db, app.clock);
  registerLegalNotifyScanner();
  registerLegalRoutes(app);
}

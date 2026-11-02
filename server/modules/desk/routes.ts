// 이 파일이 하는 일: desk 모듈의 공지·인수인계·체크리스트·보관 문구 API(backend.md §3.4) 자리. 아직 비어 있고, 이 모듈을 맡은 태스크가 채운다.
// 등록은 server/modules/index.ts가 이미 해 두었으니 이 파일만 고치면 된다. 경로는 '/api'가 붙은 채로 등록된다(예: app.get('/items', ...) → GET /api/items).
// 로그인·CSRF·주소별 권한은 server/auth/guard.ts가 먼저 확인한다. 본문·작성자에 따라 다른 권한은 requireCap·assertCan으로 더 확인한다.
import type { FastifyInstance } from 'fastify';

/** desk 모듈 API를 등록한다(아직 없음) */
export default async function routes(_app: FastifyInstance): Promise<void> {}

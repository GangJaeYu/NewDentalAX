// 이 파일이 하는 일: 회의 녹음 받아쓰기 API(FR-132, phase-06-task-03)를 등록한다. 경로 앞에는 '/api'가 붙는다.
//   GET  /ai/transcribe/status                    → { data: TranscribeStatus }  지금 받아쓰기를 쓸 수 있는지(꺼짐·음성 미지원 공급자·예산)
//   POST /ai/transcribe  multipart(file + confirmed=true) → { data: TranscribeResult } 받아쓴 글(개인정보 가림). 회의록 요약 화면이 메모 칸에 넣는다
// multipart 받기는 부모(docs routes.ts)가 registerUploads로 이미 걸어 두었다(20MB 상한). 녹음은 저장하지 않는다(server/ai/transcribe.ts).
// 로그인·CSRF는 server/auth/guard.ts가 먼저 확인하고, 권한(ai.minutes)·기능 켜짐은 서비스가 확인한다.
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../../auth/guard.ts';
import { readUpload } from '../../lib/files.ts';
import { baseUrlsFromEnv } from '../../ai/types.ts';
import { runTranscribe, transcribeStatus } from '../../ai/transcribe.ts';

/** 녹음 받아쓰기 API를 등록한다 */
export default async function transcribeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ai/transcribe/status', async (req) => ({ data: transcribeStatus(app.db, app.clock, app.dataDir, currentUser(req).role) }));

  app.post('/ai/transcribe', async (req) => {
    const up = await readUpload(req);
    const confirmed = up.fields.confirmed === 'true' || up.fields.confirmed === '1';
    const ctx = { db: app.db, clock: app.clock, dataDir: app.dataDir, options: app.aiOptions ?? { baseUrls: baseUrlsFromEnv() }, user: currentUser(req) };
    return { data: await runTranscribe(ctx, { name: up.name, data: up.data, confirmed }) };
  });
}

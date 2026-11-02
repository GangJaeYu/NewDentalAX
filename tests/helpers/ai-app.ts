// 이 파일이 하는 일: AI 게이트웨이 테스트용 서버를 만든다. 임시 데이터 폴더(.tmp/unit), 멈춘 시계(2026-11-02 09:00 KST),
// 가짜 LLM 서버(tests/fake-llm) 주소를 넣은 buildApp과 역할별 로그인, AI 설정 저장 도우미를 준다. 실제 공급자·키는 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { manualClock, type ManualClock } from '../../server/lib/clock.ts';
import type { AiOptions } from '../../server/ai/types.ts';
import { startFakeLlm, type FakeLlm } from '../fake-llm/server.ts';
import { loginAs, type TestLogin } from './auth.ts';
import { makeTmpDir } from './tmp-dir.ts';

export const AI_TEST_START = '2026-11-02T09:00:00+09:00';

/** 테스트 서버 한 벌 */
export interface AiTestEnv {
  app: FastifyInstance;
  fake: FakeLlm;
  clock: ManualClock;
  dataDir: string;
  admin: TestLogin;
  staff: TestLogin;
  /** 모두 정리 */
  close(): Promise<void>;
}

/** 가짜 LLM 서버와 테스트 서버를 함께 띄운다 */
export async function makeAiEnv(opts: Omit<AiOptions, 'baseUrls'> & { withWeb?: boolean } = {}): Promise<AiTestEnv> {
  const { withWeb, ...ai } = opts;
  const fake = await startFakeLlm();
  const dataDir = makeTmpDir('dentalax-ai-');
  // withWeb이면 화면 HTML(web/dist/index.html, 없으면 web/index.html)을 화면 폴더로 복사해 HTML 응답도 확인할 수 있게 한다
  const webDist = path.join(dataDir, withWeb ? 'web' : 'no-web');
  if (withWeb) {
    fs.mkdirSync(webDist, { recursive: true });
    const built = path.join(process.cwd(), 'web', 'dist', 'index.html');
    fs.copyFileSync(fs.existsSync(built) ? built : path.join(process.cwd(), 'web', 'index.html'), path.join(webDist, 'index.html'));
  }
  const clock = manualClock(AI_TEST_START);
  const app = await buildApp({
    dataDir,
    webDist,
    clock,
    ai: { baseUrls: { anthropic: fake.url, openai: fake.url, gemini: fake.url }, demoStreamDelayMs: 5, ...ai },
  });
  const admin = loginAs(app, 'admin');
  const staff = loginAs(app, 'staff');
  return {
    app,
    fake,
    clock,
    dataDir,
    admin,
    staff,
    async close() {
      await app.close();
      await fake.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** 관리자로 AI 설정을 바꾼다(실패하면 오류) */
export async function putAiSettings(env: AiTestEnv, body: Record<string, unknown>) {
  const res = await env.app.inject({ method: 'PUT', url: '/api/ai/settings', headers: env.admin.writeHeaders, payload: body });
  if (res.statusCode !== 200) throw new Error(`AI 설정 저장 실패 ${res.statusCode} ${res.body}`);
  return res;
}

/** AI 실행 요청 */
export function runAi(env: AiTestEnv, who: TestLogin, payload: Record<string, unknown>) {
  return env.app.inject({ method: 'POST', url: '/api/ai/run', headers: who.writeHeaders, payload });
}

/** ai_usage 마지막 줄 */
export function lastUsage(env: AiTestEnv) {
  return env.app.db.get<Record<string, unknown>>('SELECT * FROM ai_usage ORDER BY id DESC LIMIT 1');
}

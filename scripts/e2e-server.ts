// 이 파일이 하는 일: Playwright가 띄우는 E2E 테스트 서버. 작업 사본 안 .tmp/e2e/에 매번 새 임시 데이터 폴더를 만들고,
// 포트 E2E_PORT(기본 18090)·고정 시각 TEST_NOW(기본 2026-11-02T09:00:00+09:00)로 server/main.ts를 실행한다.
// 실제 data/ 폴더와 8090 포트는 쓰지 않는다. 브라우저 자동 열기는 끈다. SEED_DEMO=1이면 켜기 전에 데모 데이터를 넣는다(SEED_SCALE 배율).
// E2E_DATA_DIR을 주면(tests/e2e/fixtures.ts) 그 폴더를 그대로 쓰고, 다른 실행의 폴더를 지우거나 끝날 때 폴더를 지우지 않는다(정리는 부른 쪽이 한다).
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../server/main.ts';
import { fixedClock } from '../server/lib/clock.ts';
import { openAppDb } from '../server/db/migrate.ts';
import { seedDemoAll } from '../server/db/seed/registry.ts';

const ROOT = process.cwd();
const BASE = path.join(ROOT, '.tmp', 'e2e');
const DEFAULT_TEST_NOW = '2026-11-02T09:00:00+09:00';

/** 지난 실행이 남긴 임시 폴더를 지운다(Playwright가 강제 종료하면 정리할 틈이 없어서 다음 실행 때 지움) */
function cleanOld(): void {
  if (!fs.existsSync(BASE)) return;
  for (const name of fs.readdirSync(BASE)) {
    try {
      fs.rmSync(path.join(BASE, name), { recursive: true, force: true });
    } catch {
      // 다른 실행이 쓰는 중이면 남겨 둔다
    }
  }
}

const givenDir = process.env.E2E_DATA_DIR ? path.resolve(process.env.E2E_DATA_DIR) : null;
if (!givenDir) cleanOld();
const dataDir = givenDir ?? path.join(BASE, `run-${Date.now()}-${process.pid}`);
fs.mkdirSync(dataDir, { recursive: true });

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: process.env.E2E_PORT || '18090',
  HOST: '127.0.0.1',
  DATA_DIR: dataDir,
  BACKUP_DIR: path.join(dataDir, 'backups'),
  TEST_NOW: process.env.TEST_NOW || DEFAULT_TEST_NOW,
  OPEN_BROWSER: '0',
  NO_BROWSER: '1',
};
// 실제 AI 공급자로는 절대 나가지 않게 한다: AI_BASE_URL_*를 주지 않았으면 닫힌 로컬 주소로 막는다(연결 거부 → AI_NETWORK).
// 가짜 LLM 서버(tests/fake-llm)를 쓰는 spec은 isoServer.extraEnv로 주소를 넘긴다(phase-02-task-03 추가).
for (const k of ['AI_BASE_URL_ANTHROPIC', 'AI_BASE_URL_OPENAI', 'AI_BASE_URL_GEMINI']) {
  if (!env[k]) env[k] = 'http://127.0.0.1:9';
}
process.env.AI_BASE_URL_ANTHROPIC = env.AI_BASE_URL_ANTHROPIC;
process.env.AI_BASE_URL_OPENAI = env.AI_BASE_URL_OPENAI;
process.env.AI_BASE_URL_GEMINI = env.AI_BASE_URL_GEMINI;
console.log(`[e2e-server] DATA_DIR=${dataDir} PORT=${env.PORT} TEST_NOW=${env.TEST_NOW}`);

// SEED_DEMO=1이면 서버를 켜기 전에 데모 데이터를 넣는다(등록된 모든 모듈의 seedDemo, server/db/seed/registry.ts)
if (process.env.SEED_DEMO === '1' && !fs.existsSync(path.join(dataDir, 'app.db'))) {
  const { db } = openAppDb(dataDir, { clock: fixedClock(env.TEST_NOW as string) });
  try {
    const done = await seedDemoAll(db, { clock: fixedClock(env.TEST_NOW as string), scale: Number(process.env.SEED_SCALE || 1) });
    console.log(`[e2e-server] 데모 데이터 적재: ${done.join(', ')}`);
  } finally {
    db.close();
  }
}

const code = await main(env);
if (!givenDir) fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(code);

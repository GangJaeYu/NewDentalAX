// 이 파일이 하는 일: Playwright가 띄우는 E2E 테스트 서버. 작업 사본 안 .tmp/e2e/에 매번 새 임시 데이터 폴더를 만들고,
// 포트 E2E_PORT(기본 18090)·고정 시각 TEST_NOW(기본 2026-11-02T09:00:00+09:00)로 server/main.ts를 실행한다.
// 실제 data/ 폴더와 8090 포트는 쓰지 않는다. 브라우저 자동 열기는 끈다.
import fs from 'node:fs';
import path from 'node:path';
import { main } from '../server/main.ts';

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

cleanOld();
const dataDir = path.join(BASE, `run-${Date.now()}-${process.pid}`);
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
console.log(`[e2e-server] DATA_DIR=${dataDir} PORT=${env.PORT} TEST_NOW=${env.TEST_NOW}`);

const code = await main(env);
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(code);

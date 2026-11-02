// 이 파일이 하는 일: 브라우저 E2E(Playwright) 설정. 설치된 Microsoft Edge(channel: msedge)를 쓰고,
// scripts/e2e-server.ts가 임시 데이터 폴더·고정 시각(TEST_NOW)으로 띄운 테스트 서버에 접속한다. 재시도는 0(흔들림을 숨기지 않음).
import { defineConfig, devices } from '@playwright/test';

/** 테스트 서버 포트: 환경 변수 E2E_PORT, 없으면 18090(구현 슬롯 0). 병렬 Loop 워커는 18090+슬롯 번호를 준다 */
const port = Number(process.env.E2E_PORT || 18090);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'artifacts/e2e/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30000,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/e2e/report', open: 'never' }]],
  use: {
    baseURL,
    channel: 'msedge',
    headless: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }],
  webServer: {
    command: 'node scripts/e2e-server.ts',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_PORT: String(port) },
  },
});

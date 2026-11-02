// 이 파일이 하는 일: 브라우저 E2E(Playwright) 설정. 설치된 Microsoft Edge(channel: msedge)를 쓰고, 재시도는 0(흔들림을 숨기지 않음).
// 테스트 서버는 공용 webServer 하나를 쓰지 않고, tests/e2e/fixtures.ts가 spec 파일마다 새 임시 데이터 폴더·고정 시각(TEST_NOW)으로
// scripts/e2e-server.ts를 따로 띄운다(한 spec의 계정 잠금·첫 설정이 다른 spec에 번지지 않게, 2026-11-02 조정자 요청). baseURL도 fixture가 정한다.
import { defineConfig, devices } from '@playwright/test';

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
    channel: 'msedge',
    headless: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }],
});

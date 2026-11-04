// 이 파일이 하는 일: 브라우저 E2E(Playwright) 설정. 설치된 Microsoft Edge(channel: msedge)를 쓰고, 재시도는 0(흔들림을 숨기지 않음).
// 테스트 서버는 공용 webServer 하나를 쓰지 않고, tests/e2e/fixtures.ts가 spec 파일마다 새 임시 데이터 폴더·고정 시각(TEST_NOW)으로
// scripts/e2e-server.ts를 따로 띄운다(한 spec의 계정 잠금·첫 설정이 다른 spec에 번지지 않게, 2026-11-02 조정자 요청). baseURL도 fixture가 정한다.
// 설정 파일은 config/에 두고, 아래 경로는 이 파일 위치 기준이라 한 단계 위(프로젝트 폴더)를 가리킨다(npm run test:e2e가 --config로 이 파일을 쓴다).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '../tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: '../artifacts/e2e/test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // 테스트 하나의 시간 한도. 여러 작업 사본이 동시에 돌 때 scrypt 로그인이 많은 테스트(app-shell AC1 단독 28.9초)가 30초에 걸려 흔들려서 60초로 늘렸다(2026-11-03, 06-02 검증 관찰)
  timeout: 60000,
  reporter: [['list'], ['html', { outputFolder: '../artifacts/e2e/report', open: 'never' }]],
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

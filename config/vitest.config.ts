// 이 파일이 하는 일: 단위·통합 테스트(Vitest) 설정. 서버·공용·화면 순수 로직·스크립트의 *.test.ts를 실행하고, 브라우저 E2E(tests/e2e)는 뺀다.
// 설정 파일은 config/에 두고, 테스트 경로는 프로젝트 폴더(한 단계 위) 기준이다(npm run test:unit이 --config로 이 파일을 쓴다).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/e2e/**', 'web/dist/**', '.tmp/**'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    allowOnly: false,
    passWithNoTests: false,
  },
});

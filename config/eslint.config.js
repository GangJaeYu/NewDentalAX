// 이 파일이 하는 일: ESLint 규칙. typescript-eslint 권장 + react-hooks 규칙에 더해,
// dangerouslySetInnerHTML 금지(TD-007), 테스트의 .only·.skip 금지(정직한 게이트), 화면 코드의 crypto.randomUUID 금지(http 환경)를 건다.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';

/** Node 실행 파일(.js/.mjs)에서 쓰는 전역 이름 */
const nodeGlobals = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  fetch: 'readonly', AbortController: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly',
};

/** 모든 코드에 거는 금지 문법 */
const restrictedSyntax = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML은 쓰지 않아요(XSS 위험, TD-007). 글자는 React가 이스케이프하게 두세요.',
  },
  {
    selector: "MemberExpression[object.name=/^(test|it|describe)$/][property.name=/^(only|skip|todo|fixme)$/]",
    message: '테스트의 .only·.skip·.todo·.fixme는 게이트에서 금지예요. 실패 원인을 고쳐 주세요.',
  },
  {
    selector: "MemberExpression[object.property.name='describe'][property.name=/^(only|skip|fixme)$/]",
    message: '테스트의 .only·.skip·.fixme는 게이트에서 금지예요. 실패 원인을 고쳐 주세요.',
  },
];

// 설정 파일은 config/에 두고 scripts/lint.ts가 overrideConfigFile로 지정한다. 이때 아래 경로 패턴은 실행 폴더(프로젝트 폴더) 기준이다
export default defineConfig(
  globalIgnores([
    'node_modules/**', 'web/dist/**', 'artifacts/**', 'test-results/**', 'playwright-report/**',
    '.tmp/**', 'data/**', 'backups/**', 'harness_setup/evidence/**', 'docs/design/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.flat.recommended.rules },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: nodeGlobals },
  },
  {
    rules: {
      'no-restricted-syntax': ['error', ...restrictedSyntax],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': ['error', { object: 'crypto', property: 'randomUUID', message: 'http 원내 접속에서는 crypto.randomUUID를 쓸 수 없어요(TD-008). 다른 방법으로 id를 만드세요.' }],
    },
  },
);

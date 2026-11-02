---
id: phase-01-task-01
status: completed
phase: "01"
title: "프로젝트 골격·도구·실행 스크립트"
depends_on: []
files:
  - "package.json"
  - "tsconfig*.json"
  - "vite.config.ts"
  - "eslint.config.js"
  - "vitest.config.ts"
  - "playwright.config.ts"
  - "start.bat"
  - "stop.bat"
  - ".gitignore"
  - "server/main.ts"
  - "server/app.ts"
  - "server/config.ts"
  - "web/index.html"
  - "web/src/main.tsx"
  - "scripts/check-file-headers.ts"
  - "scripts/e2e-server.ts"
acceptance_criteria:
  - "`npm run lint`가 tsc(server·web)·eslint·머리 주석 검사를 모두 실행하고, 머리 주석이 없는 임시 파일을 넣으면 실패한다"
  - "`npm start` 후 `GET http://localhost:8090/api/health`가 `{ok:true}`를 돌려주고 브라우저 루트가 빌드된 index.html을 보여 준다"
  - "`cmd /c .\\start.bat`로 실행하면 콘솔에 한국어 안내와 이 PC의 원내 IP 주소가 출력되고 서버가 응답하며, `stop.bat`로 종료된다"
  - "PORT 8090이 이미 사용 중이면 start.bat/서버가 한국어로 원인과 해결 방법을 출력한다"
  - "`npm run test:unit`과 `npm run test:e2e`가 각각 최소 1개의 실제 테스트(health 확인, 첫 화면 로드)를 실행해 통과한다"
  - "`node harness_setup/scripts/gate.mjs lint|unit|e2e`가 모두 PASS다(lint는 각 단계가 `[lint:tsc-server|tsc-web|eslint|headers] checked N` 줄을 N>0으로 출력 — harness_setup/quality_gates/lint.md 계약)"
  - "`node harness_setup/scripts/preflight.mjs`의 'Playwright로 Edge 실행' 항목이 건너뜀이 아니라 Edge 버전을 출력한다"
verification: [lint, unit, e2e, task_validation]
---

# phase-01-task-01 — 프로젝트 골격·도구·실행 스크립트

- **관련 요구·결정**: NFR-003, NFR-010, TD-001·002·018·019·023
- **설계 근거**: overview.md §1 폴더 지도, §4 (docs/ARCHITECTURE/)
- **선행**: 없음

## 범위
- git 저장소 초기화(로컬만), .gitignore(data/, backups/, node_modules/, artifacts/, test-results/)
- TD-023의 런타임 의존성 전부와 개발 의존성(typescript, vite, @vitejs/plugin-react, react, react-dom, react-router, vitest, @playwright/test, @axe-core/playwright, eslint, typescript-eslint, eslint-plugin-react-hooks, autocannon)을 이 태스크에서 한 번에 설치한다(이후 태스크가 package.json을 동시에 수정하지 않게)
- npm scripts: start, dev, build:web, lint(tsc×2 + eslint + check-file-headers), test:unit, test:e2e, screenshots, perf, validate
- lint는 `scripts/lint.ts`가 단계별로 실행하고 각 단계마다 `[lint:<단계>] checked <대상 파일 수>`를 출력한다(자동 수정 옵션 금지). `validate`는 `node harness_setup/scripts/task-brief.mjs`를 호출한다
- Playwright 설정: `channel: 'msedge'`, webServer는 `scripts/e2e-server.ts`(임시 DATA_DIR, PORT=18090+워커 인덱스 또는 환경 변수 E2E_PORT, TEST_NOW 고정 시계), 산출물은 `artifacts/e2e/`
- server/app.ts buildApp(deps) + GET /api/health, 정적 web/dist 제공과 SPA 폴백
- start.bat/stop.bat(TD-019 전체 동작: Node 버전 확인, 첫 실행 npm ci --omit=dev, 브라우저 열기, 원내 IP 안내, 재시작 5회, PID 파일), chcp 65001
- scripts/check-file-headers.ts: server/ web/src/ shared/ scripts/ tests/의 모든 소스 파일 첫 5줄 안에 "이 파일이 하는 일" 주석 확인

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

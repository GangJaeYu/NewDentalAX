# task_validation 인계서 — phase-01-task-01

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: b23bb51
- 변경 범위(기준 765d116):
```
.gitattributes                                     |    3 +-
 docs/ARCHITECTURE/backend.md                       |    3 +-
 docs/ARCHITECTURE/database.md                      |    2 +-
 docs/ARCHITECTURE/overview.md                      |    4 +-
 docs/DECISIONS.md                                  |   33 +
 docs/PRD.md                                        |    2 +-
 docs/TRD.md                                        |   18 +-
 eslint.config.js                                   |   59 +
 harness_setup/HARNESS.md                           |    6 +-
 .../validation-2026-11-02T1930-fail.md             |   15 +
 .../validation-2026-11-02T2000-fail2.md            |   15 +
 .../validation-2026-11-02T2022-fail3.md            |   21 +
 .../worker-2026-11-02-attempt4-ac4-manual.md       |   41 +
 .../validation-2026-11-02T1953-pass.md             |   12 +
 .../validation-2026-11-02T2011-pass.md             |   20 +
 .../validation-2026-11-02T2007-pass.md             |   21 +
 .../validation-2026-11-02T2008-pass.md             |   16 +
 loop_setup/specs/phase-01-task-01-fix2.md          |   74 +
 loop_setup/specs/phase-01-task-01-fix3.md          |   75 +
 loop_setup/specs/phase-01-task-01-fix4.md          |   81 +
 loop_setup/specs/phase-01-task-01-validation.md    |  266 +
 loop_setup/specs/phase-01-task-02-validation.md    |  127 +
 loop_setup/specs/phase-01-task-02.md               |   58 +
 loop_setup/specs/phase-01-task-03-validation.md    |  136 +
 loop_setup/specs/phase-01-task-03.md               |   65 +
 loop_setup/specs/phase-01-task-04.md               |   68 +
 loop_setup/specs/phase-01-task-06-validation.md    |  110 +
 loop_setup/specs/phase-01-task-06.md               |   63 +
 loop_setup/specs/phase-02-task-01-validation.md    |  113 +
 .../{phase-01-task-01.md => phase-02-task-01.md}   |   39 +-
 loop_setup/specs/phase-02-task-02-validation.md    |  148 +
 loop_setup/specs/phase-02-task-02.md               |   64 +
 loop_setup/specs/phase-02-task-04.md               |   66 +
 loop_setup/validation-appendix.md                  |   17 +
 package-lock.json                                  | 5061 ++++++++++++++++++++
 package.json                                       |   54 +
 plan_setup/LOG.md                                  |  121 +
 plan_setup/STATE.md                                |   29 +-
 .../phase-01/phase-01-tasks/phase-01-task-01.md    |    4 +-
 .../phase-01/phase-01-tasks/phase-01-task-02.md    |    2 +-
 .../phase-01/phase-01-tasks/phase-01-task-03.md    |    2 +-
 .../phase-01/phase-01-tasks/phase-01-task-04.md    |    2 +-
 .../phase-01/phase-01-tasks/phase-01-task-06.md    |    2 +-
 .../phase-02/phase-02-tasks/phase-02-task-01.md    |    2 +-
 .../phase-02/phase-02-tasks/phase-02-task-02.md    |    2 +-
 .../phase-02/phase-02-tasks/phase-02-task-04.md    |    2 +-
 .../phase-05/phase-05-tasks/phase-05-task-05.md    |    2 +-
 playwright.config.ts                               |   38 +
 scripts/check-file-headers.test.ts                 |   74 +
 scripts/check-file-headers.ts                      |   69 +
 scripts/dev.ts                                     |   26 +
 scripts/e2e-server.ts                              |   57 +
 scripts/kb-eval.ts                                 |  246 +
 scripts/lint.ts                                    |   98 +
 scripts/perf.ts                                    |   31 +
 scripts/screenshots.ts                             |   62 +
 scripts/windows/batch-scripts.test.ts              |  246 +
 scripts/windows/start-main.cmd                     |   99 +
 scripts/windows/stop-main.cmd                      |   48 +
 server/ai/budget.ts                                |   67 +
 server/ai/features/adcheck.ts                      |   32 +
 server/ai/features/assistant.ts                    |   28 +
 server/ai/features/doc_revise.ts                   |   23 +
 server/ai/features/doc_writer.ts                   |   25 +
 server/ai/features/hiring.ts                       |   29 +
 server/ai/features/index.ts                        |   40 +
 server/ai/features/minutes.ts                      |   30 +
 server/ai/features/monthly_summary.ts              |   23 +
 server/ai/features/onboarding.ts                   |   22 +
 server/ai/features/promo.ts                        |   24 +
 server/ai/features/quick.ts                        |   22 +
 server/ai/features/receipt.ts                      |   44 +
 server/ai/features/review_reply.ts                 |   30 +
 server/ai/features/script.ts                       |   25 +
 server/ai/features/template.ts                     |   25 +
 server/ai/features/types.ts                        |   88 +
 server/ai/gateway.test.ts                          |  451 ++
 server/ai/gateway.ts                               |  509 ++
 server/ai/log.ts                                   |   30 +
 server/ai/pricing.ts                               |  160 +
 server/ai/providers/anthropic.ts                   |   68 +
 server/ai/providers/demo.ts                        |   46 +
 server/ai/providers/gemini.ts                      |   65 +
 server/ai/providers/http.ts                        |  130 +
 server/ai/providers/index.ts                       |   13 +
 server/ai/providers/openai.ts                      |   80 +
 server/ai/settings.ts                              |  228 +
 server/ai/stream.test.ts                           |  143 +
 server/ai/stream.ts                                |   53 +
 server/ai/types.ts                                 |   99 +
 server/ai/units.test.ts                            |  144 +
 server/ai/usage.ts                                 |  173 +
 server/app.test.ts                                 |  105 +
 server/app.ts                                      |  187 +
 server/auth/api-permissions.ts                     |  104 +
 server/auth/auth.test.ts                           |  355 ++
 server/auth/csrf.ts                                |   51 +
 server/auth/guard.ts                               |  119 +
 server/auth/login-limit.ts                         |   93 +
 server/auth/password.test.ts                       |   26 +
 server/auth/password.ts                            |   52 +
 server/auth/permissions.test.ts                    |  151 +
 server/auth/routes.ts                              |  178 +
 server/auth/sessions.ts                            |  138 +
 server/config.test.ts                              |   62 +
 server/config.ts                                   |  118 +
 server/db/audit-log.test.ts                        |   89 +
 server/db/index.test.ts                            |  136 +
 server/db/index.ts                                 |  160 +
 server/db/migrate.test.ts                          |  174 +
 server/db/migrate.ts                               |  127 +
 server/db/migrations/001_core.sql                  |   98 +
 server/db/migrations/010_ai.sql                    |   55 +
 server/db/seed/registry.test.ts                    |   38 +
 server/db/seed/registry.ts                         |   61 +
 server/db/seed/types.ts                            |   21 +
 server/lib/audit.ts                                |   72 +
 server/lib/clock.ts                                |   45 +
 server/lib/crypto.ts                               |   70 +
 server/lib/dates.test.ts                           |  111 +
 server/lib/dates.ts                                |  202 +
 server/lib/errors.test.ts                          |   82 +
 server/lib/errors.ts                               |  102 +
 server/main.test.ts                                |  369 ++
 server/main.ts                                     |  432 ++
 server/modules/admin/routes.ts                     |    7 +
 server/modules/admin/seed.ts                       |   11 +
 server/modules/ai/routes.ts                        |  132 +
 server/modules/ai/seed.ts                          |   11 +
 server/modules/assistant/routes.ts                 |    7 +
 server/modules/assistant/search.test.ts            |  284 ++
 server/modules/assistant/search.ts                 |  520 ++
 server/modules/assistant/seed.ts                   |   11 +
 server/modules/desk/routes.ts                      |    7 +
 server/modules/desk/seed.ts                        |   11 +
 server/modules/docs/routes.ts                      |    7 +
 server/modules/docs/seed.ts                        |   11 +
 server/modules/facility/routes.ts                  |    7 +
 server/modules/facility/seed.ts                    |   11 +
 server/modules/finance/routes.ts                   |    7 +
 server/modules/finance/seed.ts                     |   11 +
 server/modules/hr/routes.ts                        |    7 +
 server/modules/hr/seed.ts                          |   11 +
 server/modules/index.test.ts                       |   32 +
 server/modules/index.ts                            |   41 +
 server/modules/inventory/routes.ts                 |    7 +
 server/modules/inventory/seed.ts                   |   11 +
 server/modules/marketing/routes.ts                 |    7 +
 server/modules/marketing/seed.ts                   |   11 +
 server/modules/notifications/emit.ts               |   51 +
 server/modules/notifications/routes.ts             |    7 +
 server/modules/notifications/seed.ts               |   11 +
 server/privacy/filter.test.ts                      |  396 ++
 server/privacy/filter.ts                           |  158 +
 server/security/headers.ts                         |   35 +
 server/security/network.ts                         |   82 +
 server/security/security.test.ts                   |  153 +
 server/security/validate.ts                        |   30 +
 shared/ai-features.ts                              |  142 +
 shared/enums.ts                                    |   39 +
 shared/privacy-rules.ts                            |  347 ++
 shared/roles.test.ts                               |   71 +
 shared/roles.ts                                    |  198 +
 shared/schemas/auth.ts                             |   88 +
 start.bat                                          |    6 +
 stop.bat                                           |    6 +
 tests/e2e/auth-api.spec.ts                         |   95 +
 tests/e2e/smoke.spec.ts                            |   32 +
 tests/fake-llm/server.ts                           |  234 +
 tests/fixtures/kb/eval-set.json                    |   46 +
 tests/fixtures/kb/front-desk.md                    |   52 +
 tests/fixtures/kb/infection-control.md             |   57 +
 tests/fixtures/kb/inventory.md                     |   52 +
 tests/fixtures/kb/leave-and-work.md                |   55 +
 tests/fixtures/kb/sterilization.md                 |   52 +
 tests/helpers/ai-app.ts                            |   78 +
 tests/helpers/auth.ts                              |   42 +
 tests/helpers/tmp-dir.ts                           |   10 +
 tests/schema-privacy.test.ts                       |  106 +
 tsconfig.base.json                                 |   16 +
 tsconfig.json                                      |    3 +
 tsconfig.server.json                               |   11 +
 vite.config.ts                                     |   19 +
 vitest.config.ts                                   |   14 +
 web/index.html                                     |   16 +
 web/src/boot.css                                   |   43 +
 web/src/lib/privacy.test.ts                        |   53 +
 web/src/lib/privacy.ts                             |   57 +
 web/src/main.tsx                                   |   24 +
 web/tsconfig.json                                  |   11 +
 190 files changed, 19515 insertions(+), 57 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-01-task-01` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-01-task-01
status: failed
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


## 참조 문서
- 요구: docs/PRD.md (위 태스크의 FR/NFR 절)
- 설계: docs/ARCHITECTURE/ (위 "설계 근거" 절)
- 디자인: docs/DESIGN.md

## 예산
- loop_started_at: 2026-11-02T18:55:20+09:00` (전체 24시간 중 일부). 검증은 필요한 범위만 한다.

## 반환 형식 (그대로 채워서 마지막 응답으로)
| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
- 게이트 결과: lint=…, unit=…(건수), e2e=…(건수)
- 환경 문제·판정 불가 사유:
- 재현 방법(실패 시):


## Orca 검증 워커 추가 지시
- 너는 검증할 커밋으로 새로 만든 작업 사본에 있다. 먼저 `npm ci`를 실행한다(설치는 테스트 데이터 준비로 허용된다).
- 슬롯 1
  - 화면 테스트: `E2E_PORT=18095`
  - 수동 서버: `PORT=18195`
  - 데이터: `.tmp/` 아래
  - gate.mjs를 실행할 때 환경 변수 `E2E_PORT`를 지정한다.
- 파일 수정 범위
  - `.tmp/`와 git이 무시하는 산출물(artifacts/ 등)만 만들 수 있다.
  - 제품·테스트·문서는 수정하지 않는다.
  - 커밋하지 않는다.
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed
- 참고: 이번이 네 번째 검증이다. 이전 FAIL은 다음과 같았다.
  - 1차: AC3, 새 콘솔 949에서 start.bat 첫 줄 오류
  - 2차: AC4, [::] 점유를 감지하지 못함
  - 3차: AC4, [::] IPv6 전용 점유를 감지하지 못함
- 지금은 "연 뒤 자기 확인" 방식으로 바뀌었다(docs/DECISIONS.md 참고).
- 판정 방법
  - 7개 기준을 처음부터 다시 판정한다. AC3·AC4는 새 콘솔(949)에서 확인한다.
  - AC4는 다음 점유 경우를 모두 확인한다.
    - (a) [::] 이중 스택
    - (b) 0.0.0.0
    - (c) 127.0.0.1
    - (d) [::] IPv6 전용: Node ipv6Only:true와 PowerShell .NET TcpListener IPv6Any 둘 다
    - (e) ::1
  - 점유가 없을 때 정상으로 켜지는지도 확인한다.
  - 필요하면 네가 생각하는 다른 점유 방식도 시도하라.

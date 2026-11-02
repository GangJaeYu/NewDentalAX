# task_validation 인계서 — phase-03-task-10

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: e431b64
- 변경 범위(기준 191a57c~1):
```
PROGRESS.md                                        |  11 +-
 docs/DECISIONS.md                                  |   6 +
 docs/PRD.md                                        |   2 +-
 .../phase-03-task-10/ac1-dashboard-1440x900.png    | Bin 0 -> 228629 bytes
 .../phase-03-task-10/dashboard-1440-light.png      | Bin 0 -> 154017 bytes
 .../phase-03-task-10/dashboard-demo-1024-light.png | Bin 0 -> 117810 bytes
 .../phase-03-task-10/dashboard-demo-1440-dark.png  | Bin 0 -> 226353 bytes
 .../phase-03-task-10/dashboard-demo-1440-light.png | Bin 0 -> 227853 bytes
 .../phase-03-task-10/dashboard-demo-390-dark.png   | Bin 0 -> 66340 bytes
 .../phase-03-task-10/dashboard-demo-390-light.png  | Bin 0 -> 65822 bytes
 .../phase-03-task-10/dashboard-demo-768-dark.png   | Bin 0 -> 156315 bytes
 .../dashboard-quickout-1440-light.png              | Bin 0 -> 213066 bytes
 .../evidence/phase-03-task-10/perf-dashboard.txt   |   2 +
 .../validation-2026-11-03T0155-partial.md          |  16 +
 .../validation-2026-11-03T0232-pass.md             |  14 +
 loop_setup/specs/phase-03-task-10-validation.md    | 176 +++++++
 loop_setup/specs/phase-04-task-02-validation.md    | 191 ++++++++
 loop_setup/specs/phase-04-task-04-validation.md    | 146 ++++++
 loop_setup/specs/phase-04-task-05.md               |  76 +++
 loop_setup/specs/phase-04-task-08.md               |  76 +++
 loop_setup/specs/phase-05-task-01.md               |  74 +++
 plan_setup/LOG.md                                  |  54 ++
 plan_setup/STATE.md                                |  50 +-
 .../phase-04/phase-04-tasks/phase-04-task-04.md    |   2 +-
 .../phase-04/phase-04-tasks/phase-04-task-05.md    |   2 +-
 .../phase-04/phase-04-tasks/phase-04-task-08.md    |   2 +-
 .../phase-05/phase-05-tasks/phase-05-task-01.md    |   2 +-
 scripts/perf-dashboard.ts                          |  20 +
 scripts/screens/phase-03-task-10.ts                |  76 +++
 scripts/screens/phase-04-task-04.ts                |  86 ++++
 scripts/screens/phase-04-task-05.ts                |  70 +++
 scripts/screens/phase-04-task-07.ts                |  65 +++
 scripts/screens/phase-04-task-08.ts                |  58 +++
 scripts/screenshots.ts                             |   3 +-
 server/ai/features/hiring.ts                       |  78 ++-
 server/ai/features/monthly_summary.ts              |  41 +-
 server/ai/features/receipt.ts                      |  55 ++-
 server/ai/features/review_reply.ts                 |   4 +-
 server/ai/features/script.ts                       |   4 +-
 server/db/migrations/070_finance.sql               |  44 ++
 server/jobs/notify-job.ts                          |  29 ++
 server/jobs/notify-sources.test.ts                 | 151 ++++++
 server/modules/admin/demo.test.ts                  |   6 +-
 server/modules/dashboard/dashboard.test.ts         | 202 ++++++++
 server/modules/dashboard/perf.ts                   |  91 ++++
 server/modules/dashboard/routes.ts                 |  15 +
 server/modules/dashboard/service.ts                | 251 ++++++++++
 server/modules/finance/finance.test.ts             | 388 +++++++++++++++
 server/modules/finance/routes.ts                   | 123 ++++-
 server/modules/finance/seed.ts                     |  87 +++-
 server/modules/finance/service.ts                  | 441 +++++++++++++++++
 server/modules/inventory/orders.routes.ts          |   8 +-
 server/modules/inventory/orders.service.ts         |  21 +-
 server/modules/inventory/orders.test.ts            |   4 +-
 server/modules/inventory/receipt-image.ts          |  81 +++
 server/modules/inventory/receipt.routes.ts         |  42 ++
 server/modules/inventory/receipt.schema.ts         |  58 +++
 server/modules/inventory/receipt.service.ts        | 299 ++++++++++++
 server/modules/inventory/receipt.test.ts           | 261 ++++++++++
 server/modules/inventory/routes.ts                 |   3 +
 server/modules/marketing/hiring-rules.test.ts      | 180 +++++++
 server/modules/marketing/hiring-rules.ts           | 219 +++++++++
 server/modules/marketing/routes.ts                 |  10 +-
 server/modules/notifications/routes.ts             |   4 +
 shared/josa.test.ts                                |  36 ++
 shared/josa.ts                                     |  59 +++
 shared/schemas/dashboard.ts                        | 194 ++++++++
 shared/schemas/finance.ts                          | 213 ++++++++
 shared/schemas/hiring.ts                           |  60 +++
 shared/schemas/orders.ts                           |   7 +-
 tests/e2e/app-shell.spec.ts                        |  11 +-
 tests/e2e/backup-reset.spec.ts                     |  13 +-
 tests/e2e/dashboard.spec.ts                        | 417 ++++++++++++++++
 tests/e2e/desk-ai.spec.ts                          |  44 +-
 tests/e2e/finance.spec.ts                          | 301 ++++++++++++
 tests/e2e/hr-hiring.spec.ts                        | 223 +++++++++
 tests/e2e/inventory-receipt.spec.ts                | 281 +++++++++++
 tests/e2e/notifications-pwa.spec.ts                | 165 +++++++
 tests/e2e/notifications-sources.spec.ts            | 153 ++++++
 tests/fixtures/receipt/images.ts                   |  51 ++
 tests/fixtures/receipt/statement-4000x3000.jpg     | Bin 0 -> 225518 bytes
 web/src/layout/TopBar.tsx                          |  14 +-
 web/src/pages/DashboardPage.tsx                    | 157 ++++--
 web/src/pages/dashboard.css                        | 209 ++++++++
 web/src/pages/dashboardCards.tsx                   | 488 ++++++++++++++++++
 web/src/pages/dashboardLib.test.ts                 | 104 ++++
 web/src/pages/dashboardLib.ts                      | 114 +++++
 web/src/pages/desk/ReviewPage.tsx                  |   7 +-
 web/src/pages/finance/ExpensesPage.tsx             | 506 ++++++++++++++++++-
 web/src/pages/finance/MonthlyPage.tsx              | 224 ++++++++-
 web/src/pages/finance/finance.css                  |  54 ++
 web/src/pages/finance/financeLib.test.ts           |  42 ++
 web/src/pages/finance/financeLib.ts                |  96 ++++
 web/src/pages/hr/HiringPage.tsx                    | 382 ++++++++++++++-
 web/src/pages/hr/hiring.css                        |  35 ++
 web/src/pages/hr/hiringLib.test.ts                 |  65 +++
 web/src/pages/hr/hiringLib.ts                      | 120 +++++
 web/src/pages/inventory/OrderDetailPage.tsx        |  45 +-
 web/src/pages/inventory/ReceiptPage.tsx            | 543 ++++++++++++++++++++-
 web/src/pages/inventory/receipt.css                |  68 +++
 web/src/pages/inventory/receiptLib.test.ts         |  87 ++++
 web/src/pages/inventory/receiptLib.ts              | 196 ++++++++
 102 files changed, 10095 insertions(+), 169 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-03-task-10` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-03-task-10
status: in_progress
phase: "03"
title: "대시보드"
depends_on: [phase-03-task-01, phase-03-task-02, phase-03-task-04, phase-03-task-08, phase-03-task-09, phase-02-task-03]
files:
  - "server/modules/dashboard/**"
  - "web/src/pages/dashboard*"
acceptance_criteria:
  - "데모 데이터 기준 1440×900에서 요약 숫자 줄과 첫 줄 카드 4개가 스크롤 없이 보인다(스크린샷 확인)"
  - "각 카드 항목 클릭 시 해당 화면/항목으로 이동한다"
  - "staff 로그인 시 승인 대기·발주·지출 카드가 없다"
  - "데이터가 빈 DB에서 모든 카드가 빈 상태 안내와 바로가기를 보인다"
  - "대시보드에서 출고 기록을 3번 클릭 이하로 완료한다(E2E 클릭 수 측정)"
  - "GET /api/dashboard p95 300ms 이하(10배 데이터, phase-05 측정과 연결)"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-10 — 대시보드

- **관련 요구·결정**: FR-008, NFR-009, DESIGN §4 대시보드 순서
- **설계 근거**: backend.md §3.3 GET /dashboard (docs/ARCHITECTURE/)
- **선행**: phase-03-task-01, phase-03-task-02, phase-03-task-04, phase-03-task-08, phase-03-task-09, phase-02-task-03

## 범위
- 요약 숫자 6개 + 카드 10개(DESIGN §4), 역할별 표시
- 아직 없는 P1 데이터(근무표·지출·멸균)는 해당 태스크 완료 전까지 빈 상태로 표시하고 연결 지점 유지
- 빠른 행동(출고 기록·공지 쓰기·AI 문서), AI 빠른 요청 카드(AiPanel 소형)

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
- 슬롯 0
  - 화면 테스트: `E2E_PORT=18094`
  - 수동 서버: `PORT=18194`
  - 데이터: `.tmp/` 아래
  - gate.mjs를 실행할 때 환경 변수 `E2E_PORT`를 지정한다.
- 파일 수정 범위
  - `.tmp/`와 git이 무시하는 산출물(artifacts/ 등)만 만들 수 있다.
  - 제품·테스트·문서는 수정하지 않는다.
  - 커밋하지 않는다.
- **포트와 프로세스(엄수)**
  - 화면 테스트·스크린샷·수동 서버는 위 슬롯 포트만 쓴다. 다른 번호(특히 18096, 18300 등)는 다른 세션이 쓰고 있을 수 있다.
  - 프로세스는 네가 띄운 자식 프로세스의 핸들로만 종료한다. PID를 보고 종료해야 한다면, 명령줄의 작업 폴더가 네 작업 사본 경로인지와 부모 프로세스가 네 것인지 먼저 확인한다. 확인할 수 없으면 종료하지 말고 보고한다(2026-11-03 사고 재발 방지).
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed
- 참고: 이 작업 사본은 커밋 6315aa6 기준이다(phase-04 모두 병합, main 게이트 lint·unit 720·e2e 243 PASS). 화면 태스크이고 기준일은 TEST_NOW=2026-11-02다.
- 상단바 데모 배지("가상 데이터"·"AI 키 미설정")와 바뀐 e2e 기대값(backup-reset AC5·AC6, app-shell)이 검사를 약하게 만들지 않았는지 확인한다.

## 추가 검증 항목: phase-04-task-03 AC2 대시보드 행
- 멸균 기록에서 불합격을 저장하면 대시보드에 조치 전까지 경고가 보이는지, 조치를 기록하면 사라지는지 판정한다.
- 결과는 별도 표 "phase-04-task-03 AC2 대시보드 행"에 적는다.

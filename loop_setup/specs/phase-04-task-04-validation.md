# task_validation 인계서 — phase-04-task-04

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: 2bb65b8
- 변경 범위(기준 bd55ba8~1):
```
docs/DECISIONS.md                                  |   3 +
 .../validation-2026-11-03T0155-partial.md          |  16 +
 loop_setup/specs/phase-04-task-05.md               |  76 ++++
 loop_setup/specs/phase-04-task-08.md               |  76 ++++
 plan_setup/LOG.md                                  |  18 +
 plan_setup/STATE.md                                |  12 +-
 .../phase-04/phase-04-tasks/phase-04-task-05.md    |   2 +-
 .../phase-04/phase-04-tasks/phase-04-task-08.md    |   2 +-
 scripts/screens/phase-04-task-04.ts                |  86 ++++
 scripts/screens/phase-04-task-07.ts                |  65 +++
 scripts/screenshots.ts                             |   4 +-
 server/ai/features/hiring.ts                       |  78 +++-
 server/ai/features/monthly_summary.ts              |  41 +-
 server/ai/features/review_reply.ts                 |   4 +-
 server/ai/features/script.ts                       |   4 +-
 server/db/migrations/070_finance.sql               |  44 ++
 server/modules/admin/demo.test.ts                  |   6 +-
 server/modules/finance/finance.test.ts             | 388 ++++++++++++++++
 server/modules/finance/routes.ts                   | 123 ++++-
 server/modules/finance/seed.ts                     |  87 +++-
 server/modules/finance/service.ts                  | 441 ++++++++++++++++++
 server/modules/inventory/orders.routes.ts          |   8 +-
 server/modules/inventory/orders.service.ts         |  21 +-
 server/modules/inventory/orders.test.ts            |   4 +-
 server/modules/marketing/hiring-rules.test.ts      | 180 ++++++++
 server/modules/marketing/hiring-rules.ts           | 219 +++++++++
 server/modules/marketing/routes.ts                 |  10 +-
 shared/josa.test.ts                                |  36 ++
 shared/josa.ts                                     |  59 +++
 shared/schemas/finance.ts                          | 213 +++++++++
 shared/schemas/hiring.ts                           |  60 +++
 shared/schemas/orders.ts                           |   7 +-
 tests/e2e/app-shell.spec.ts                        |   2 +-
 tests/e2e/desk-ai.spec.ts                          |  44 +-
 tests/e2e/finance.spec.ts                          | 301 ++++++++++++
 tests/e2e/hr-hiring.spec.ts                        | 223 +++++++++
 web/src/pages/desk/ReviewPage.tsx                  |   7 +-
 web/src/pages/finance/ExpensesPage.tsx             | 506 ++++++++++++++++++++-
 web/src/pages/finance/MonthlyPage.tsx              | 224 ++++++++-
 web/src/pages/finance/finance.css                  |  54 +++
 web/src/pages/finance/financeLib.test.ts           |  42 ++
 web/src/pages/finance/financeLib.ts                |  96 ++++
 web/src/pages/hr/HiringPage.tsx                    | 382 +++++++++++++++-
 web/src/pages/hr/hiring.css                        |  35 ++
 web/src/pages/hr/hiringLib.test.ts                 |  65 +++
 web/src/pages/hr/hiringLib.ts                      | 120 +++++
 web/src/pages/inventory/OrderDetailPage.tsx        |  45 +-
 47 files changed, 4460 insertions(+), 79 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-04-task-04` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-04-task-04
status: in_progress
phase: "04"
title: "지출 기록·월간 요약"
depends_on: [phase-02-task-03, phase-03-task-02]
files:
  - "server/modules/finance/**"
  - "server/ai/features/monthly_summary.ts"
  - "server/db/migrations/070_finance.sql"
  - "web/src/pages/finance/**"
acceptance_criteria:
  - "staff는 지출 화면 접근 불가(메뉴 없음, API 403)"
  - "발주 입고 시 \"지출로도 기록\" 체크 → 지출 목록에 합계 금액·거래처·재료비 분류로 1건 생성"
  - "월간 요약 숫자가 해당 월 지출 합계 SQL 결과와 일치하고 데이터 없는 달은 빈 상태"
  - "AI 월간 요약 요청 본문(가짜 서버 수신)에 개별 메모 텍스트가 없고 집계 숫자만 있다"
verification: [lint, unit, e2e, task_validation]
---

# phase-04-task-04 — 지출 기록·월간 요약

- **관련 요구·결정**: FR-110, FR-111, FR-054 AC3 지출 연결
- **설계 근거**: database.md §9, backend.md §3.9 (docs/ARCHITECTURE/)
- **선행**: phase-02-task-03, phase-03-task-02

## 범위
- 지출 CRUD·분류 편집·영수증 첨부·CSV
- 발주 입고 시 지출 동시 기록 옵션 활성화
- 월간 요약(합계·분류 비중·전월/전년 대비·거래처 상위·재료비 추이 그래프), AI 월간 요약(집계 숫자만 전송)
- 대시보드 이번 달 지출 카드 연결

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
- 슬롯 2
  - 화면 테스트: `E2E_PORT=18096`
  - 수동 서버: `PORT=18196`
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
- 참고: 이 작업 사본은 커밋 c29faf9 기준이다. 화면 태스크다. AI 월간 요약은 가짜 LLM으로 받은 요청 본문을 확인한다(개별 메모 글자가 없어야 한다).

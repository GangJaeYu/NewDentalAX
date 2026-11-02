# task_validation 인계서 — phase-03-task-09

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: 9f04ada
- 변경 범위(기준 1acc1fc~1):
```
PROGRESS.md                                        |   4 +-
 docs/DECISIONS.md                                  |   3 +
 .../validation-2026-11-02T2256-pass.md             |  16 +
 plan_setup/LOG.md                                  |  11 +
 .../phase-03/phase-03-tasks/phase-03-task-01.md    |   2 +-
 scripts/screens/phase-03-task-08.ts                |  85 +++
 scripts/screens/phase-03-task-09.ts                |  72 ++
 server/db/migrate.test.ts                          |  24 +-
 server/db/migrations/050_facility.sql              |  45 ++
 server/db/migrations/060_hr.sql                    |  31 +
 server/db/seed/legal-templates.ts                  | 369 ++++++++++
 server/modules/admin/demo.test.ts                  |  14 +-
 server/modules/facility/legal-notify.ts            |  44 ++
 server/modules/facility/legal.test.ts              | 321 +++++++++
 server/modules/facility/legal.ts                   | 426 ++++++++++++
 server/modules/facility/routes.ts                  |  19 +-
 server/modules/facility/seed.ts                    |  85 ++-
 server/modules/hr/leave-days.test.ts               |  40 ++
 server/modules/hr/leave-routes.ts                  |  85 +++
 server/modules/hr/leave.test.ts                    | 306 ++++++++
 server/modules/hr/leave.ts                         | 379 ++++++++++
 server/modules/hr/routes.ts                        |  13 +-
 server/modules/hr/seed.ts                          | 118 +++-
 shared/schemas/leave.ts                            | 233 +++++++
 shared/schemas/legal.ts                            | 108 +++
 tests/e2e/facility-legal.spec.ts                   | 269 +++++++
 tests/e2e/hr-leave.spec.ts                         | 297 ++++++++
 web/src/pages/facility/LegalPage.tsx               | 773 ++++++++++++++++++++-
 web/src/pages/facility/legal.css                   |  62 ++
 web/src/pages/hr/LeaveDialogs.tsx                  | 361 ++++++++++
 web/src/pages/hr/LeavePage.tsx                     | 359 +++++++++-
 web/src/pages/hr/leave.css                         |  36 +
 32 files changed, 4967 insertions(+), 43 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-03-task-09` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-03-task-09
status: in_progress
phase: "03"
title: "연차·휴가 신청과 승인"
depends_on: [phase-01-task-05, phase-02-task-04]
files:
  - "server/modules/hr/leave*"
  - "server/db/migrations/060_hr.sql(leave 부분)"
  - "web/src/pages/hr/leave*"
acceptance_criteria:
  - "staff 신청 → manager 알림 → 승인 → 신청자 알림, 잔여 일수 감소(반차 0.5)"
  - "반려 시 사유를 비우면 저장되지 않고 오류 문구가 보인다"
  - "같은 날 이미 승인 2건(maxPerDay=2)인 날 승인하려 하면 경고가 보인다(승인은 가능)"
  - "staff는 다른 사람 신청을 승인할 수 없다(403)"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-09 — 연차·휴가 신청과 승인

- **관련 요구·결정**: FR-080
- **설계 근거**: overview.md §3.6, backend.md §3.7 leave, database.md §7 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-05, phase-02-task-04

## 범위
- 신청(종류·기간·반차 0.5일)·취소·승인/반려(사유 필수)·알림
- 부여 일수(A)·잔여 표시
- 같은 날 인원 초과 경고

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
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed
- 참고: 화면 태스크다. 기준일은 TEST_NOW=2026-11-02다.

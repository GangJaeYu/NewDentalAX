# task_validation 인계서 — phase-04-task-01

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: 7750bce
- 변경 범위(기준 48cf0e6~1):
```
docs/DECISIONS.md                                  |   2 +
 harness_setup/evidence/phase-04-task-01/README.md  |  20 +
 .../screens/dashboard-roster-1440-dark.png         | Bin 0 -> 148677 bytes
 .../screens/dashboard-roster-1440-light.png        | Bin 0 -> 150677 bytes
 .../screens/dashboard-roster-390-dark.png          | Bin 0 -> 45300 bytes
 .../screens/dashboard-roster-390-light.png         | Bin 0 -> 45164 bytes
 .../screens/hr-roster-1440-dark.png                | Bin 0 -> 113795 bytes
 .../screens/hr-roster-1440-light.png               | Bin 0 -> 115494 bytes
 .../screens/hr-roster-390-dark.png                 | Bin 0 -> 50769 bytes
 .../screens/hr-roster-390-light.png                | Bin 0 -> 51006 bytes
 .../screens/hr-roster-month-1440-dark.png          | Bin 0 -> 131307 bytes
 .../screens/hr-roster-month-1440-light.png         | Bin 0 -> 133127 bytes
 .../screens/hr-roster-month-390-dark.png           | Bin 0 -> 52370 bytes
 .../screens/hr-roster-month-390-light.png          | Bin 0 -> 52663 bytes
 .../screens/hr-roster-pick-1440-dark.png           | Bin 0 -> 129178 bytes
 .../screens/hr-roster-pick-1440-light.png          | Bin 0 -> 137474 bytes
 .../screens/hr-roster-pick-390-dark.png            | Bin 0 -> 53364 bytes
 .../screens/hr-roster-pick-390-light.png           | Bin 0 -> 56626 bytes
 .../screens/hr-roster-types-1440-dark.png          | Bin 0 -> 138567 bytes
 .../screens/hr-roster-types-1440-light.png         | Bin 0 -> 145415 bytes
 .../screens/hr-roster-types-390-dark.png           | Bin 0 -> 52144 bytes
 .../screens/hr-roster-types-390-light.png          | Bin 0 -> 53266 bytes
 .../screens/print-roster-1440-dark.png             | Bin 0 -> 75416 bytes
 .../screens/print-roster-1440-light.png            | Bin 0 -> 75937 bytes
 .../screens/print-roster-390-dark.png              | Bin 0 -> 54664 bytes
 .../screens/print-roster-390-light.png             | Bin 0 -> 55054 bytes
 plan_setup/LOG.md                                  |   8 +
 scripts/screens/phase-04-task-01.ts                |  80 ++++
 server/db/migrations/061_roster.sql                |  37 ++
 server/modules/hr/leave.test.ts                    |   2 +-
 server/modules/hr/roster-routes.ts                 |  53 +++
 server/modules/hr/roster-seed.ts                   |  75 ++++
 server/modules/hr/roster.test.ts                   | 402 +++++++++++++++++++++
 server/modules/hr/roster.ts                        | 230 ++++++++++++
 server/modules/hr/routes.ts                        |   2 +
 server/modules/hr/seed.ts                          |   5 +-
 shared/schemas/roster.ts                           | 281 ++++++++++++++
 tests/e2e/hr-roster.spec.ts                        | 374 +++++++++++++++++++
 web/src/pages/DashboardPage.tsx                    |   3 +-
 web/src/pages/hr/RosterDialogs.tsx                 | 215 +++++++++++
 web/src/pages/hr/RosterPage.tsx                    | 296 ++++++++++++++-
 web/src/pages/hr/RosterTodayCard.tsx               |  55 +++
 web/src/pages/hr/roster.css                        |  76 ++++
 web/src/pages/hr/rosterLib.test.ts                 |  45 +++
 web/src/pages/hr/rosterLib.ts                      |  97 +++++
 web/src/pages/print/PrintRosterPage.tsx            | 136 ++++++-
 46 files changed, 2483 insertions(+), 11 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-04-task-01` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-04-task-01
status: in_progress
phase: "04"
title: "근무표"
depends_on: [phase-03-task-09]
files:
  - "server/modules/hr/roster*"
  - "server/db/migrations/061_roster.sql"
  - "web/src/pages/hr/roster*"
  - "web/src/pages/print/roster*"
acceptance_criteria:
  - "manager가 칸을 클릭해 \"오전\"을 고르면 1~2번 클릭으로 저장되고 새로고침 후 유지된다"
  - "지난주 복사 후 이번 주 칸이 지난주와 같다(휴가는 복사되지 않음)"
  - "승인된 연차 날짜 칸에 \"연차\"가 표시되고 인원 합계에서 빠진다"
  - "staff는 조회만 가능(편집 시도 403)"
  - "대시보드 오늘 근무 카드에 오늘 근무자와 유형이 보인다"
verification: [lint, unit, e2e, task_validation]
---

# phase-04-task-01 — 근무표

- **관련 요구·결정**: FR-081
- **설계 근거**: backend.md §3.7 roster, database.md §7 (docs/ARCHITECTURE/)
- **선행**: phase-03-task-09

## 범위
- 주간·월간 달력, 칸 클릭 → 유형 선택, 근무 유형 관리, 지난주 복사, 승인 휴가 덮어 표시, 날짜별 인원 합계, 인쇄
- 대시보드 오늘 근무·이번 주 일정 카드 연결

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
- 참고: 화면 태스크다. 기준일은 TEST_NOW=2026-11-02다. 근무표 인쇄는 A4 가로 PDF다.

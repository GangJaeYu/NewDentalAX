# task_validation 인계서 — phase-05-task-01

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: 7f3c4d0
- 변경 범위(기준 66e6c31~1):
```
PROGRESS.md                                        |   4 +-
 docs/DECISIONS.md                                  |   2 +
 docs/PERF.md                                       | 108 ++++
 .../phase-03-task-10/dashboard-demo-1440-dark.png  | Bin 226353 -> 226016 bytes
 .../phase-03-task-10/dashboard-demo-1440-light.png | Bin 227853 -> 227541 bytes
 .../phase-03-task-10/dashboard-demo-768-dark.png   | Bin 156315 -> 154548 bytes
 .../phase-03-task-10/design5-due-390-dark.png      | Bin 0 -> 34738 bytes
 .../phase-03-task-10/design5-due-390-light.png     | Bin 0 -> 34460 bytes
 .../phase-03-task-10/design5-due-768-dark.png      | Bin 0 -> 33018 bytes
 .../phase-03-task-10/design5-due-768-light.png     | Bin 0 -> 32788 bytes
 .../validation-2026-11-03T0913-pass.md             |  19 +
 .../phase-05-task-01/npm-run-perf-output.txt       |  61 ++
 ...erf-2026-11-02T23-17-08-768Z-disturbed-FAIL.txt |  38 ++
 .../perf-2026-11-02T23-28-33-487Z.json             | 666 +++++++++++++++++++++
 .../perf-2026-11-02T23-28-33-487Z.txt              |  38 ++
 plan_setup/LOG.md                                  |  10 +
 .../phase-04/phase-04-tasks/phase-04-task-08.md    |   2 +-
 scripts/heavy-slot.ts                              |  55 ++
 scripts/perf-browser.ts                            |  81 +++
 scripts/perf-lib.test.ts                           | 173 ++++++
 scripts/perf-lib.ts                                | 483 +++++++++++++++
 scripts/perf.ts                                    | 238 +++++++-
 scripts/screenshots.ts                             |   4 +
 tests/e2e/dashboard.spec.ts                        |  49 ++
 tests/e2e/perf-first-screen.spec.ts                |  28 +
 web/src/pages/dashboard.css                        |  10 +
 web/src/pages/dashboardCards.tsx                   |  20 +-
 27 files changed, 2060 insertions(+), 29 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-05-task-01` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-05-task-01
status: in_progress
phase: "05"
title: "성능·부하 측정"
depends_on: [phase-03-task-10, phase-04-task-04]
files:
  - "scripts/perf.ts"
  - "docs/PERF.md"
acceptance_criteria:
  - "품목 1,000·입출고 2만 건에서 주요 목록 API p95 ≤ 300ms(측정 출력 첨부)"
  - "20 동시 연결 60초 시나리오 오류 0건"
  - "첫 화면(로그인 후 대시보드) 2초 이내"
  - "측정 환경·수치를 docs/PERF.md에 기록"
verification: [lint, unit, task_validation]
---

# phase-05-task-01 — 성능·부하 측정

- **관련 요구·결정**: NFR-005
- **설계 근거**: database.md §3.2 성능, TD-024 scale=10 (docs/ARCHITECTURE/)
- **선행**: phase-03-task-10, phase-04-task-04

## 범위
- scale=10 데이터 생성, 주요 목록 API·대시보드 p95 측정, autocannon 20 동시 연결 시나리오, 첫 화면 표시 시간(Playwright)
- 미달 시 인덱스·쿼리 개선 후 재측정

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
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
- **포트와 프로세스(엄수)**
  - 화면 테스트·스크린샷·수동 서버는 위 슬롯 포트만 쓴다. 다른 번호(특히 18096, 18300 등)는 다른 세션이 쓰고 있을 수 있다.
  - 프로세스는 네가 띄운 자식 프로세스의 핸들로만 종료한다. PID를 보고 종료해야 한다면, 명령줄의 작업 폴더가 네 작업 사본 경로인지와 부모 프로세스가 네 것인지 먼저 확인한다. 확인할 수 없으면 종료하지 말고 보고한다(2026-11-03 사고 재발 방지).
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed
- 참고: 이 작업 사본은 커밋 60af70b 기준이다(05-01 병합 뒤 main 게이트 lint·unit 732·e2e 244 PASS). 성능 수치는 PC 부하에 따라 흔들린다. 측정 직전 CPU 부하를 기록하고, 다른 무거운 검사와 겹치면 기다렸다가 잰다(npm run perf가 자리 제한을 따르지 않으면 부하를 함께 적는다). 기준 판정은 docs/PERF.md의 수치를 그대로 믿지 말고 직접 잰 값으로 한다.

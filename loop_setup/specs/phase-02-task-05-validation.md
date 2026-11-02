# task_validation 인계서 — phase-02-task-05

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: af16b2c
- 변경 범위(기준 5fd3994~1):
```
PROGRESS.md                                        |   8 +-
 .../validation-2026-11-02T2142-pass.md             |  15 +
 .../validation-2026-11-02T2141-pass.md             |  13 +
 loop_setup/specs/phase-01-task-05-validation.md    | 130 +++++++
 loop_setup/specs/phase-02-task-03-validation.md    | 141 ++++++++
 loop_setup/specs/phase-03-task-01.md               |  80 +++++
 loop_setup/specs/phase-03-task-04.md               |  78 ++++
 loop_setup/specs/phase-03-task-06.md               |  82 +++++
 plan_setup/LOG.md                                  |  34 ++
 plan_setup/STATE.md                                |  18 +-
 .../phase-01/phase-01-tasks/phase-01-task-05.md    |   2 +-
 .../phase-02/phase-02-tasks/phase-02-task-03.md    |   2 +-
 .../phase-03/phase-03-tasks/phase-03-task-01.md    |   2 +-
 .../phase-03/phase-03-tasks/phase-03-task-04.md    |   2 +-
 .../phase-03/phase-03-tasks/phase-03-task-06.md    |   2 +-
 scripts/screenshots.ts                             |   3 +
 server/app.ts                                      |  24 +-
 server/auth/routes.ts                              |   9 +-
 server/db/seed/registry.test.ts                    |  24 +-
 server/jobs/backup-job.test.ts                     | 142 ++++++++
 server/jobs/backup-job.ts                          |  52 +++
 server/main.ts                                     |  14 +-
 server/modules/admin/backup-fs.test.ts             |  55 +++
 server/modules/admin/backup-fs.ts                  |  58 +++
 server/modules/admin/backup-routes.ts              |  54 +++
 server/modules/admin/backup-service.ts             | 399 +++++++++++++++++++++
 server/modules/admin/backup-swap.ts                |  71 ++++
 server/modules/admin/backup.test.ts                | 359 ++++++++++++++++++
 server/modules/admin/demo-routes.ts                |  26 ++
 server/modules/admin/demo-service.ts               | 161 +++++++++
 server/modules/admin/demo.test.ts                  | 204 +++++++++++
 server/modules/admin/routes.ts                     |   9 +-
 server/modules/admin/seed.ts                       |  97 ++++-
 shared/schemas/backup.ts                           |  76 ++++
 tests/e2e/backup-reset.spec.ts                     | 257 +++++++++++++
 web/src/pages/admin/BackupPage.tsx                 | 214 ++++++++++-
 web/src/pages/admin/ResetPage.tsx                  | 139 ++++++-
 37 files changed, 3007 insertions(+), 49 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-02-task-05` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-02-task-05
status: in_progress
phase: "02"
title: "백업·복원·데모 데이터 적재/초기화"
depends_on: [phase-01-task-02, phase-01-task-04]
files:
  - "server/jobs/backup-job.ts"
  - "server/modules/admin/backup*"
  - "server/db/seed/**"
  - "web/src/pages/admin/{backup,reset}*"
acceptance_criteria:
  - "값 A로 백업 → 값 B로 수정 → 복원하면 값 A가 보이고 pre-restore 백업이 생긴다(통합 테스트)"
  - "보관 개수 3으로 설정 후 5번 백업하면 최신 3개만 남는다"
  - "주입 시계로 어제 백업만 있는 상태에서 서버를 시작하면 오늘 백업이 즉시 생긴다"
  - "업로드 파일이 백업 zip 안에 포함된다"
  - "초기화 실행 후 업무 테이블은 비고 admin 계정·설정·감사 로그·AI 사용 기록은 남으며 직전 자동 백업이 있다"
  - "확인 문구를 틀리게 입력하면 복원/초기화가 실행되지 않는다"
verification: [lint, unit, e2e, task_validation]
---

# phase-02-task-05 — 백업·복원·데모 데이터 적재/초기화

- **관련 요구·결정**: FR-006, FR-007, NFR-004, TD-014·024
- **설계 근거**: overview.md §3.7, database.md §11 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-02, phase-01-task-04

## 범위
- 백업(VACUUM INTO + uploads + secret.key + manifest), 보관 개수, 놓친 백업 따라잡기, zip 다운로드(fflate)
- 복원(maintenance 모드, pre-restore, 실패 시 되돌림, 세션 전부 삭제)
- 데모 적재/초기화(seed registry 순회, 초기화 전 자동 백업, 남길 테이블 규칙)
- /setup의 withDemo 연결

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
- 참고: 1차 병합 뒤 Windows 파일 잠김(EPERM) 때문에 간헐 실패가 있었고, 수정이 병합됐다(DECISIONS 2026-11-02 백업 항목). 전체 unit은 간헐성을 보려고 2회 이상 돌린다. 화면 태스크(백업·초기화 화면)라 스크린샷을 대조한다.

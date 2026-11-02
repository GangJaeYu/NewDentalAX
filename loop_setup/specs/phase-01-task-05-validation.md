# task_validation 인계서 — phase-01-task-05

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: 5fd3994
- 변경 범위(기준 a138471):
```
docs/DECISIONS.md                      |   5 +
 plan_setup/LOG.md                      |  16 ++
 plan_setup/STATE.md                    |   3 +
 scripts/screenshots.ts                 |   7 +
 server/app.ts                          |  24 +-
 server/auth/guard.ts                   |   2 +-
 server/auth/permissions.test.ts        |   5 +-
 server/auth/routes.ts                  |  11 +-
 server/db/seed/registry.test.ts        |  24 +-
 server/jobs/backup-job.test.ts         | 121 +++++++++
 server/jobs/backup-job.ts              | 101 ++++++++
 server/main.ts                         |  12 +-
 server/modules/admin/admin.test.ts     | 361 ++++++++++++++++++++++++++
 server/modules/admin/audit.ts          | 148 +++++++++++
 server/modules/admin/backup-routes.ts  |  54 ++++
 server/modules/admin/backup-service.ts | 374 +++++++++++++++++++++++++++
 server/modules/admin/backup-swap.ts    |  71 ++++++
 server/modules/admin/backup.test.ts    | 289 +++++++++++++++++++++
 server/modules/admin/clinic.ts         |  63 +++++
 server/modules/admin/demo-routes.ts    |  26 ++
 server/modules/admin/demo-service.ts   | 160 ++++++++++++
 server/modules/admin/demo.test.ts      | 204 +++++++++++++++
 server/modules/admin/routes.ts         |  20 +-
 server/modules/admin/seed.ts           |  97 ++++++-
 server/modules/admin/users.ts          | 204 +++++++++++++++
 shared/schemas/admin.ts                | 238 +++++++++++++++++
 shared/schemas/backup.ts               |  76 ++++++
 tests/e2e/admin.spec.ts                | 342 +++++++++++++++++++++++++
 tests/e2e/backup-reset.spec.ts         | 257 +++++++++++++++++++
 web/src/pages/admin/AuditPage.tsx      | 252 +++++++++++++++++-
 web/src/pages/admin/BackupPage.tsx     | 214 +++++++++++++++-
 web/src/pages/admin/ClinicPage.tsx     | 242 +++++++++++++++++-
 web/src/pages/admin/ResetPage.tsx      | 139 +++++++++-
 web/src/pages/admin/UsersPage.tsx      | 452 ++++++++++++++++++++++++++++++++-
 34 files changed, 4563 insertions(+), 51 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-01-task-05` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-01-task-05
status: in_progress
phase: "01"
title: "사용자 관리·병원 정보·활동 기록 화면"
depends_on: [phase-01-task-04]
files:
  - "server/modules/admin/**"
  - "web/src/pages/admin/{users,clinic,audit}*"
  - "server/db/migrations/002_admin.sql(필요 시)"
acceptance_criteria:
  - "admin이 직원을 추가하면 그 직원이 임시 비밀번호로 로그인 → 비밀번호 변경 화면으로 강제 이동 → 변경 후 대시보드 진입"
  - "직원 추가 폼에 이름·아이디·역할·직무·입사일 외 입력란이 없다"
  - "마지막 admin을 비활성화/강등하면 409 LAST_ADMIN과 안내가 보이고 상태가 바뀌지 않는다"
  - "비활성화한 직원의 열린 세션은 다음 요청에서 401이 된다"
  - "활동 기록에서 기간·사용자 필터가 동작하고 CSV를 엑셀 형식(UTF-8 BOM)으로 받는다; staff는 접근 불가"
  - "병원 정보를 저장하고 새로고침해도 값이 유지된다"
verification: [lint, unit, e2e, task_validation]
---

# phase-01-task-05 — 사용자 관리·병원 정보·활동 기록 화면

- **관련 요구·결정**: FR-003 AC2·3, FR-004, FR-005, FR-042 AC1(병원 정보)
- **설계 근거**: backend.md §3.2, database.md §5 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-04

## 범위
- 사용자 CRUD·비활성화·비밀번호 초기화(다음 로그인 변경 강제)·마지막 admin 보호
- 병원 기본 정보(진료시간·점심·휴진·주차·위치·보험 일반 안내·대표번호)
- 감사 로그 목록·필터·CSV 내보내기

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
- 참고: 이 검증 작업 사본은 커밋 ddd48a0(01-05 병합 직후, 02-05 병합 전) 기준이다. 화면 태스크라 스크린샷을 대조한다.

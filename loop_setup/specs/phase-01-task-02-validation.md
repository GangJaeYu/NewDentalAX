# task_validation 인계서 — phase-01-task-02

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: cd40371
- 변경 범위(기준 75c01db):
```
scripts/e2e-server.ts                |  16 ++-
 server/app.ts                        |  67 ++++++------
 server/db/audit-log.test.ts          |  89 +++++++++++++++
 server/db/index.test.ts              | 136 +++++++++++++++++++++++
 server/db/index.ts                   | 160 +++++++++++++++++++++++++++
 server/db/migrate.test.ts            | 174 ++++++++++++++++++++++++++++++
 server/db/migrate.ts                 | 127 ++++++++++++++++++++++
 server/db/migrations/001_core.sql    |  98 +++++++++++++++++
 server/db/seed/registry.test.ts      |  38 +++++++
 server/db/seed/registry.ts           |  61 +++++++++++
 server/db/seed/types.ts              |  21 ++++
 server/lib/audit.ts                  |  72 +++++++++++++
 server/lib/clock.ts                  |  45 ++++++++
 server/lib/dates.test.ts             | 111 +++++++++++++++++++
 server/lib/dates.ts                  | 202 +++++++++++++++++++++++++++++++++++
 server/lib/errors.test.ts            |  79 ++++++++++++++
 server/lib/errors.ts                 | 102 ++++++++++++++++++
 server/main.ts                       |  30 +++++-
 server/modules/admin/seed.ts         |  11 ++
 server/modules/ai/seed.ts            |  11 ++
 server/modules/assistant/seed.ts     |  11 ++
 server/modules/desk/seed.ts          |  11 ++
 server/modules/docs/seed.ts          |  11 ++
 server/modules/facility/seed.ts      |  11 ++
 server/modules/finance/seed.ts       |  11 ++
 server/modules/hr/seed.ts            |  11 ++
 server/modules/inventory/seed.ts     |  11 ++
 server/modules/marketing/seed.ts     |  11 ++
 server/modules/notifications/seed.ts |  11 ++
 shared/enums.ts                      |  39 +++++++
 tests/schema-privacy.test.ts         | 106 ++++++++++++++++++
 31 files changed, 1857 insertions(+), 37 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-01-task-02` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-01-task-02
status: in_progress
phase: "01"
title: "DB 래퍼·마이그레이션·공통 라이브러리"
depends_on: [phase-01-task-01]
files:
  - "server/db/**"
  - "server/lib/**"
  - "shared/enums.ts"
  - "tests/schema-privacy.test.ts"
acceptance_criteria:
  - "빈 폴더에서 서버를 시작하면 data/app.db가 생성되고 schema_version이 최신이며, 두 번째 시작에서는 마이그레이션이 다시 적용되지 않는다"
  - "audit_log 행에 UPDATE나 DELETE를 실행하면 오류가 나고 행이 그대로 남는다(테스트)"
  - "스키마 개인정보 검사 테스트가 실행되어 통과하고, 금지어 열(예: patient_name)을 임시 마이그레이션으로 추가하면 실패한다"
  - "dates 단위 테스트: 2026-01-31+1개월, 윤년, KST 자정 경계, D-day(오늘=0, 지남=음수)가 기대값과 일치한다"
verification: [lint, unit, e2e, task_validation]
---

# phase-01-task-02 — DB 래퍼·마이그레이션·공통 라이브러리

- **관련 요구·결정**: NFR-001, NFR-004, FR-005(기반), TD-003·020
- **설계 근거**: database.md §1·§4·§5, overview.md §2 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-01

## 범위
- server/db/index.ts(open/close/tx/all/get/run, WAL, foreign_keys), migrate.ts, migrations/001_core.sql(settings, users, sessions, login_attempts, audit_log+트리거, notifications, files)
- 마이그레이션 번호 예약표(모듈별 파일명)를 plan_setup/PLAN.md "공유 파일 규칙"대로 따른다
- seed 등록 구조: server/db/seed/registry.ts — 각 모듈이 `server/modules/<m>/seed.ts`에서 `{ tables, seedDemo(db, ctx) }`를 export하면 등록 목록에서 호출(이 태스크에서 모든 모듈 이름을 미리 등록하고 빈 seed 파일 생성)
- lib: clock(주입), dates(KST, D-day, 월 경계, 주기 더하기), errors(AppError + 한국어 코드표 backend.md §2), audit(ctx, ...)
- tests/schema-privacy.test.ts(database.md §4 금지어 검사, 마이그레이션 전체 적용 후 실행)

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

# task_validation 인계서 — phase-02-task-03

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
- 변경 범위(기준 a138471~1):
```
docs/DECISIONS.md                        |   5 +
 plan_setup/LOG.md                        |  16 +
 plan_setup/STATE.md                      |   3 +
 scripts/e2e-server.ts                    |   8 +
 scripts/screenshots.ts                   |   9 +
 server/app.ts                            |  24 +-
 server/auth/guard.ts                     |   2 +-
 server/auth/permissions.test.ts          |   5 +-
 server/auth/routes.ts                    |  11 +-
 server/db/seed/registry.test.ts          |  24 +-
 server/jobs/backup-job.test.ts           | 121 ++++++++
 server/jobs/backup-job.ts                | 101 +++++++
 server/main.ts                           |  12 +-
 server/modules/admin/admin.test.ts       | 361 +++++++++++++++++++++++
 server/modules/admin/audit.ts            | 148 ++++++++++
 server/modules/admin/backup-routes.ts    |  54 ++++
 server/modules/admin/backup-service.ts   | 374 ++++++++++++++++++++++++
 server/modules/admin/backup-swap.ts      |  71 +++++
 server/modules/admin/backup.test.ts      | 289 ++++++++++++++++++
 server/modules/admin/clinic.ts           |  63 ++++
 server/modules/admin/demo-routes.ts      |  26 ++
 server/modules/admin/demo-service.ts     | 160 ++++++++++
 server/modules/admin/demo.test.ts        | 204 +++++++++++++
 server/modules/admin/routes.ts           |  20 +-
 server/modules/admin/seed.ts             |  97 ++++++-
 server/modules/admin/users.ts            | 204 +++++++++++++
 server/modules/ai/routes.ts              |  15 +-
 server/modules/ai/status-pricing.test.ts |  48 +++
 shared/schemas/admin.ts                  | 238 +++++++++++++++
 shared/schemas/backup.ts                 |  76 +++++
 tests/e2e/admin.spec.ts                  | 342 ++++++++++++++++++++++
 tests/e2e/ai-admin.spec.ts               | 221 ++++++++++++++
 tests/e2e/ai-panel.spec.ts               |  92 ++++++
 tests/e2e/backup-reset.spec.ts           | 257 ++++++++++++++++
 tests/e2e/fixtures.ts                    |   4 +-
 web/src/components/AiPanel.css           |  64 ++++
 web/src/components/AiPanel.tsx           | 246 ++++++++++++++++
 web/src/components/PrivacyGuard.tsx      |  37 +++
 web/src/components/index.ts              |   2 +
 web/src/lib/ai.test.ts                   | 128 ++++++++
 web/src/lib/ai.ts                        | 264 +++++++++++++++++
 web/src/pages/admin/AiSettingsPage.tsx   | 483 ++++++++++++++++++++++++++++++-
 web/src/pages/admin/AiUsagePage.tsx      | 180 +++++++++++-
 web/src/pages/admin/AuditPage.tsx        | 252 +++++++++++++++-
 web/src/pages/admin/BackupPage.tsx       | 214 +++++++++++++-
 web/src/pages/admin/ClinicPage.tsx       | 242 +++++++++++++++-
 web/src/pages/admin/ResetPage.tsx        | 139 ++++++++-
 web/src/pages/admin/UsersPage.tsx        | 452 ++++++++++++++++++++++++++++-
 48 files changed, 6346 insertions(+), 62 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-02-task-03` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-02-task-03
status: in_progress
phase: "02"
title: "AI 관리 화면·AI 공용 화면 부품"
depends_on: [phase-02-task-02, phase-01-task-04]
files:
  - "web/src/pages/admin/ai*"
  - "web/src/components/{AiPanel,PrivacyGuard}*"
acceptance_criteria:
  - "E2E: 관리자가 키를 입력·저장하면 화면에 끝 4자리만 보이고 새로고침 후에도 원문이 보이지 않는다"
  - "E2E: 모델 단가를 수정 후 데모가 아닌 가짜 공급자 호출(테스트 서버 설정)의 비용이 새 단가로 계산된다"
  - "사용량 화면에 이번 달 비용·예산 대비 %·기능별 표가 보이고 데이터 없을 때 빈 상태가 보인다"
  - "AiPanel 입력에 전화번호를 치면 노란 경고가, 실행 후 \"전화번호 1건을 가리고 보냈습니다\"가 보인다"
  - "예산 초과 상태에서 실행하면 한국어 안내와 관리자 문의 문구가 보인다"
verification: [lint, unit, e2e, task_validation]
---

# phase-02-task-03 — AI 관리 화면·AI 공용 화면 부품

- **관련 요구·결정**: FR-030 AC3, FR-033, FR-034 AC3, FR-035, FR-036, FR-038, FR-032 AC5
- **설계 근거**: frontend.md §2(AiPanel, PrivacyGuard), §3 /admin/ai·/admin/ai-usage (docs/ARCHITECTURE/)
- **선행**: phase-02-task-02, phase-01-task-04

## 범위
- AI 설정(공급자, 키 입력/삭제, 연결 확인, 월 예산, 환율, 기능별 등급·역할 켜기/끄기), 모델·단가 표 편집, 사용량 대시보드(월·기능별·사용자별·일별)
- AiPanel(등급별 예상 비용·실행·중지·스트림 표시·오류·개인정보 처리 결과·고지), PrivacyGuard

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
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed
- 참고: 이 검증 작업 사본은 커밋 ddd48a0(02-03·01-05 병합 직후, 02-05 병합 전) 기준이다. 그 커밋에서 main 게이트는 lint·unit 422·e2e 53 PASS였다. 화면 태스크라 스크린샷을 대조한다. e2e는 실제 공급자에 닿지 않는지(가짜 서버 수신 수) 함께 확인한다.

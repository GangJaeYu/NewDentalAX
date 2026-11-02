# task_validation 인계서 — phase-02-task-04

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: cba8533
- 변경 범위(기준 cba8533~1):
```
scripts/screenshots.ts                             |  48 ++-
 server/jobs/notify-job.ts                          |  79 +++++
 server/jobs/scheduler.test.ts                      | 186 ++++++++++++
 server/jobs/scheduler.ts                           | 167 +++++++++++
 server/main.ts                                     |   4 +
 server/modules/notifications/emit.ts               |  58 +++-
 server/modules/notifications/notifications.test.ts | 210 +++++++++++++
 server/modules/notifications/routes.ts             |  55 +++-
 server/modules/notifications/service.ts            |  73 +++++
 shared/schemas/notifications.ts                    |  82 ++++++
 tests/e2e/notifications-api.spec.ts                | 110 +++++++
 tests/e2e/notifications.spec.ts                    | 165 +++++++++++
 web/src/layout/NotificationBell.css                |  53 ++++
 web/src/layout/NotificationBell.tsx                | 125 +++++++-
 web/src/layout/NotificationList.test.tsx           |  97 ++++++
 web/src/layout/NotificationList.tsx                |  81 +++++
 web/src/lib/useNotifications.test.ts               | 267 +++++++++++++++++
 web/src/lib/useNotifications.ts                    | 328 +++++++++++++++++++++
 web/src/pages/NotificationsPage.tsx                |  84 +++++-
 19 files changed, 2234 insertions(+), 38 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-02-task-04` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-02-task-04
status: in_progress
phase: "02"
title: "알림 서비스·스케줄러"
depends_on: [phase-01-task-03]
files:
  - "server/modules/notifications/**"
  - "server/jobs/{scheduler,notify-job}.ts"
  - "web/src/layout/NotificationBell*"
acceptance_criteria:
  - "같은 dedupe_key로 두 번 emit해도 알림은 1건이다"
  - "알림을 누르면 링크로 이동하고 읽음 처리되어 배지 수가 줄어든다"
  - "새 알림이 생기면 새로고침 없이 60초 안에 배지에 반영된다(E2E, 폴링 주기 테스트 설정)"
  - "수신자 규칙: staff에게는 manager 전용 알림이 가지 않는다"
verification: [lint, unit, e2e, task_validation]
---

# phase-02-task-04 — 알림 서비스·스케줄러

- **관련 요구·결정**: FR-090(서버), overview §3.8
- **설계 근거**: backend.md §3.3·§6, database.md notifications (docs/ARCHITECTURE/)
- **선행**: phase-01-task-03

## 범위
- notify.emit(type, recipients 규칙, dedupe)
- summary/list/read API, 상단바 종 아이콘 30초 폴링·목록 팝오버·/notifications 화면
- scheduler(시작 시 + 매시 정각, clock 주입), notify-job 확장 지점(모듈이 scanner 등록)

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
- 슬롯 3
  - 화면 테스트: `E2E_PORT=18097`
  - 수동 서버: `PORT=18197`
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
- 참고: 화면 태스크(상단바 종·알림 화면)다. e2e는 tests/e2e/fixtures.ts 격리 서버를 쓴다. 스크린샷은 npm run screenshots로 찍는다(알림 팝오버·화면 포함).

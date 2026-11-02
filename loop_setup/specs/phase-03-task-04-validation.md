# task_validation 인계서 — phase-03-task-04

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: 8504a1c
- 변경 범위(기준 8504a1c~1):
```
scripts/screenshots.ts                     |  23 ++
 server/db/migrations/030_desk.sql          |  47 ++++
 server/modules/desk/checklists.test.ts     | 180 ++++++++++++++
 server/modules/desk/checklists.ts          | 168 +++++++++++++
 server/modules/desk/posts.test.ts          | 231 ++++++++++++++++++
 server/modules/desk/posts.ts               | 347 ++++++++++++++++++++++++++
 server/modules/desk/routes.ts              |  15 +-
 server/modules/desk/seed.ts                | 139 ++++++++++-
 shared/schemas/desk.ts                     |  86 +++++++
 tests/e2e/desk-board.spec.ts               | 197 +++++++++++++++
 tests/e2e/desk-checklist.spec.ts           | 203 +++++++++++++++
 web/src/pages/desk/BoardDetailPage.tsx     | 244 ++++++++++++++++++-
 web/src/pages/desk/BoardPage.tsx           | 218 ++++++++++++++++-
 web/src/pages/desk/BoardPostForm.tsx       | 132 ++++++++++
 web/src/pages/desk/ChecklistPage.tsx       | 379 ++++++++++++++++++++++++++++-
 web/src/pages/desk/board.css               |  25 ++
 web/src/pages/desk/checklist.css           |  42 ++++
 web/src/pages/print/PrintChecklistPage.tsx |  89 ++++++-
 18 files changed, 2734 insertions(+), 31 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-03-task-04` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-03-task-04
status: in_progress
phase: "03"
title: "데스크: 공지·인수인계·오픈/마감 체크리스트"
depends_on: [phase-01-task-05, phase-02-task-04]
files:
  - "server/modules/desk/{posts,checklists}*"
  - "server/db/migrations/030_desk.sql"
  - "web/src/pages/desk/{board,checklist}*"
  - "web/src/pages/print/checklist*"
acceptance_criteria:
  - "staff가 공지 작성 시도 → 403/버튼 없음, 인수인계는 작성 가능"
  - "staff가 공지를 열면 manager 화면의 읽음 수가 1 증가하고 안 읽은 사람 목록에서 빠진다"
  - "새 공지 등록 시 전 직원에게 알림이 생긴다"
  - "오늘 항목 체크 시 체크한 사람·시각이 보이고, 주입 시계로 다음 날이 되면 미체크로 시작하며 어제 기록은 읽기 전용으로 조회된다"
  - "체크리스트 항목 순서 변경 후 새로고침해도 순서가 유지된다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-04 — 데스크: 공지·인수인계·오픈/마감 체크리스트

- **관련 요구·결정**: FR-040, FR-041
- **설계 근거**: database.md §2, backend.md §3.4 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-05, phase-02-task-04

## 범위
- 공지(M 작성·고정)·인수인계(S 작성·처리 완료)·읽음 기록·읽은/안 읽은 사람
- 체크리스트 편집(M)·오늘 체크·지난 날짜 조회·인쇄
- 새 공지 알림
- demo seed

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
- 참고: 화면 태스크다. `npm run screenshots`로 데스크 화면(desk-*·print-checklist)을 찍어 기준선과 대조한다.

## 추가 검증 항목: phase-02-task-05 화면 행 재판정
- 02-05(백업·복원·데모 초기화)의 수용 기준 AC1~6은 이전 독립 검증에서 PASS였다.
- 화면 행만 FAIL이었다. 원인은 `npm run screenshots`의 admin-reset 준비 글자 결함이었다. 조정자가 scripts/screenshots.ts를 고쳤으므로 너는 이 행만 다시 판정한다.
- 할 일
  - `npm run screenshots -- admin-backup admin-reset`가 성공하는지 확인한다.
  - 4너비×2테마 16장을 DESIGN §5와 기준선으로 대조한다.
- 결과는 표 아래에 별도 표 "phase-02-task-05 화면 행"으로 PASS/FAIL과 증거를 적는다.

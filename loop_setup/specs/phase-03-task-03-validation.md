# task_validation 인계서 — phase-03-task-03

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: e76708e
- 변경 범위(기준 a186dba):
```
scripts/screens/phase-03-task-03.ts       |  65 +++++
 server/lib/csv.ts                         |  82 ++++++
 server/modules/admin/audit.ts             |  17 +-
 server/modules/inventory/csv-routes.ts    |  83 ++++++
 server/modules/inventory/csv.test.ts      | 315 +++++++++++++++++++++
 server/modules/inventory/csv.ts           | 438 ++++++++++++++++++++++++++++++
 server/modules/inventory/routes.ts        |  10 +-
 shared/schemas/inventory-csv.ts           |  97 +++++++
 tests/e2e/inventory-csv.spec.ts           | 209 ++++++++++++++
 tests/fixtures/csv/items-cp949.csv        |   5 +
 tests/fixtures/csv/items-utf8-bom.csv     |   5 +
 web/src/pages/inventory/ImportPage.tsx    | 294 +++++++++++++++++++-
 web/src/pages/inventory/InventoryPage.tsx |  12 +-
 web/src/pages/inventory/import.css        |  38 +++
 web/src/styles/components.css             |   2 +-
 15 files changed, 1649 insertions(+), 23 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-03-task-03` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-03-task-03
status: in_progress
phase: "03"
title: "CSV 가져오기·내보내기"
depends_on: [phase-03-task-01]
files:
  - "server/lib/csv.ts"
  - "server/modules/inventory/csv*"
  - "web/src/pages/inventory/import*"
  - "tests/fixtures/csv/**"
acceptance_criteria:
  - "내보낸 CSV 첫 3바이트가 BOM이고 한글 열 이름이 들어 있다"
  - "CP949로 저장한 예제 CSV를 올리면 한글이 깨지지 않고 미리보기에 신규/변경/오류 줄이 구분된다"
  - "오류 줄(적정 재고에 문자)이 이유와 함께 표시되고 \"오류 줄 건너뛰고 확정\" 시 나머지만 반영된다"
  - "`=HYPERLINK(...)`로 시작하는 품목명을 내보내면 앞에 작은따옴표가 붙는다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-03 — CSV 가져오기·내보내기

- **관련 요구·결정**: FR-056, TD-016
- **설계 근거**: backend.md §3.5 import/export (docs/ARCHITECTURE/)
- **선행**: phase-03-task-01

## 범위
- 품목·거래처·입출고 내보내기(UTF-8 BOM, 수식 주입 방지)
- 품목 가져오기 미리보기/확정, UTF-8·CP949 자동 판별, 양식 다운로드

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
- 참고: 화면 태스크다. 병합 커밋(e76708e)에 조정자가 두 가지를 반영했으니 함께 판정한다. (1) 재고 화면(/inventory)에 실장 이상에게만 보이는 'CSV 가져오기·내보내기' 진입 버튼 (2) .filedrop position:relative(넓은 화면 가로 스크롤 방지). CP949 예제 파일은 tests/fixtures/csv/에 있다.

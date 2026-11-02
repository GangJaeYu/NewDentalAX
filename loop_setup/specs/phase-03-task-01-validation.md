# task_validation 인계서 — phase-03-task-01

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: ec629bf
- 변경 범위(기준 ec629bf~1):
```
scripts/screens/phase-03-task-01.ts        |  59 +++
 scripts/screenshots.ts                     |   2 +-
 server/db/migrations/020_inventory.sql     |  53 +++
 server/modules/inventory/inventory.test.ts | 325 +++++++++++++++
 server/modules/inventory/notify.ts         |  77 ++++
 server/modules/inventory/routes.ts         | 123 +++++-
 server/modules/inventory/seed.ts           | 253 ++++++++++-
 server/modules/inventory/service.ts        | 647 +++++++++++++++++++++++++++++
 server/modules/inventory/settings.ts       |  28 ++
 server/modules/inventory/stock.test.ts     |  86 ++++
 server/modules/inventory/stock.ts          | 125 ++++++
 shared/schemas/inventory.ts                | 263 ++++++++++++
 tests/e2e/app-shell.spec.ts                |   4 +-
 tests/e2e/inventory.spec.ts                | 378 +++++++++++++++++
 web/src/components/DataTable.tsx           |   4 +-
 web/src/lib/api.ts                         |  24 +-
 web/src/pages/inventory/InventoryPage.tsx  | 204 ++++++++-
 web/src/pages/inventory/ItemDetailPage.tsx | 210 +++++++++-
 web/src/pages/inventory/MovesPage.tsx      | 148 ++++++-
 web/src/pages/inventory/PricesPage.tsx     | 100 ++++-
 web/src/pages/inventory/QuickOutDialog.tsx | 139 +++++++
 web/src/pages/inventory/VendorsPage.tsx    | 212 +++++++++-
 web/src/pages/inventory/inventory-ui.tsx   | 559 +++++++++++++++++++++++++
 23 files changed, 3984 insertions(+), 39 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-03-task-01` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-03-task-01
status: in_progress
phase: "03"
title: "재고: 품목·입출고·상태·거래처·단가"
depends_on: [phase-01-task-05, phase-02-task-04]
files:
  - "server/modules/inventory/**"
  - "server/db/migrations/020_inventory.sql"
  - "web/src/pages/inventory/{index,item,moves,vendors,prices}*"
acceptance_criteria:
  - "staff가 품목 검색 → 수량 입력 → 저장(2단계)으로 출고하면 현재고가 줄고 기록에 남는다"
  - "재고보다 많이 출고하면 확인 대화상자가 뜨고 확인해야만 저장된다; 수량 0·음수는 거부"
  - "적정 6, 현재 5 → 부족 / 7 → 곧 부족 / 8 → 정상으로 표시된다"
  - "유효기간 2026-11-14 로트가 남아 있으면 기준일 2026-11-02에 \"D-12\", 출고로 해당 로트가 소진되면(FEFO) 다음 로트 기준으로 바뀐다"
  - "직전 단가 8,400 → 8,900 입고 시 ▲6% 표시, 품목 상세에 단가 추이 표·그래프"
  - "입출고 기록이 있는 품목 삭제 시 \"사용 안 함\"으로 바뀌고 목록 기본 필터에서 빠진다"
  - "부족 품목이 생기면 manager에게 알림 1건(같은 날 중복 없음)"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-01 — 재고: 품목·입출고·상태·거래처·단가

- **관련 요구·결정**: FR-050, FR-051, FR-052, FR-053, FR-055
- **설계 근거**: database.md §3, backend.md §3.5, overview.md §3.3 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-05, phase-02-task-04

## 범위
- 품목·거래처 CRUD, 입출고·조정, 상태 계산(FEFO), 단가 이력·인상 표시, 목록 필터/정렬/검색
- 대시보드용 출고 빠른 입력 Dialog(공용 컴포넌트로 export)
- notify scanner(재고 부족·유효기간)
- demo seed(품목 약 80, 거래처 5, 90일 기록)

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
- 참고: 화면 태스크다. 기준일은 TEST_NOW=2026-11-02 기준이다(D-12 등).

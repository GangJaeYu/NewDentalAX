# task_validation 인계서 — phase-03-task-02

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: 6b44e6d
- 변경 범위(기준 6b44e6d~1):
```
harness_setup/evidence/phase-03-task-02/README.md  |  21 +
 .../screens/inventory-order-draft-1440-dark.png    | Bin 0 -> 111333 bytes
 .../screens/inventory-order-draft-1440-light.png   | Bin 0 -> 112145 bytes
 .../screens/inventory-order-draft-390-dark.png     | Bin 0 -> 48292 bytes
 .../screens/inventory-order-draft-390-light.png    | Bin 0 -> 48184 bytes
 .../screens/inventory-order-ordered-1440-dark.png  | Bin 0 -> 97507 bytes
 .../screens/inventory-order-ordered-1440-light.png | Bin 0 -> 98407 bytes
 .../screens/inventory-order-ordered-390-dark.png   | Bin 0 -> 49094 bytes
 .../screens/inventory-order-ordered-390-light.png  | Bin 0 -> 49263 bytes
 .../screens/inventory-order-receive-1440-dark.png  | Bin 0 -> 109654 bytes
 .../screens/inventory-order-receive-1440-light.png | Bin 0 -> 116331 bytes
 .../screens/inventory-order-receive-390-dark.png   | Bin 0 -> 47590 bytes
 .../screens/inventory-order-receive-390-light.png  | Bin 0 -> 49834 bytes
 .../screens/inventory-order-received-1440-dark.png | Bin 0 -> 107022 bytes
 .../inventory-order-received-1440-light.png        | Bin 0 -> 107869 bytes
 .../screens/inventory-order-received-390-dark.png  | Bin 0 -> 51272 bytes
 .../screens/inventory-order-received-390-light.png | Bin 0 -> 51366 bytes
 .../screens/inventory-orders-1440-dark.png         | Bin 0 -> 101228 bytes
 .../screens/inventory-orders-1440-light.png        | Bin 0 -> 102128 bytes
 .../screens/inventory-orders-390-dark.png          | Bin 0 -> 41077 bytes
 .../screens/inventory-orders-390-light.png         | Bin 0 -> 41681 bytes
 .../screens/print-order-1440-dark.png              | Bin 0 -> 57910 bytes
 .../screens/print-order-1440-light.png             | Bin 0 -> 57971 bytes
 .../screens/print-order-390-dark.png               | Bin 0 -> 52760 bytes
 .../screens/print-order-390-light.png              | Bin 0 -> 52538 bytes
 scripts/screens/phase-03-task-02.ts                |  86 ++++
 server/db/migrations/021_orders.sql                |  30 ++
 server/modules/inventory/orders.routes.ts          |  61 +++
 server/modules/inventory/orders.seed.ts            |  75 ++++
 server/modules/inventory/orders.service.ts         | 358 ++++++++++++++++
 server/modules/inventory/orders.test.ts            | 371 ++++++++++++++++
 server/modules/inventory/routes.ts                 |   4 +
 server/modules/inventory/seed.ts                   |   5 +-
 shared/schemas/orders.ts                           | 173 ++++++++
 tests/e2e/app-shell.spec.ts                        |   2 +-
 tests/e2e/orders.spec.ts                           | 266 ++++++++++++
 web/src/pages/inventory/OrderDetailPage.tsx        | 474 ++++++++++++++++++++-
 web/src/pages/inventory/OrdersPage.tsx             | 156 ++++++-
 web/src/pages/inventory/orders.css                 |  66 +++
 web/src/pages/inventory/ordersLib.test.ts          |  58 +++
 web/src/pages/inventory/ordersLib.ts               | 113 +++++
 web/src/pages/print/PrintOrderPage.tsx             | 166 +++++++-
 42 files changed, 2470 insertions(+), 15 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-03-task-02` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-03-task-02
status: in_progress
phase: "03"
title: "발주서 자동 작성·인쇄·입고 처리"
depends_on: [phase-03-task-01]
files:
  - "server/modules/inventory/orders*"
  - "server/db/migrations/021_orders.sql"
  - "web/src/pages/inventory/orders*"
  - "web/src/pages/print/order*"
acceptance_criteria:
  - "부족 품목 3개(거래처 2곳)에서 \"발주서 만들기\" → 발주서 2건, 권장 수량 = ceil(적정×1.5−현재고)"
  - "draft에서 수량 수정 후 발주함 → 상태 ordered, ordered 상태에서는 수정 불가"
  - "입고 처리 시 발주 품목이 입고 기록으로 들어가 재고가 증가하고 상태 received"
  - "인쇄 화면을 PDF로 저장(Playwright page.pdf)하면 1쪽 A4에 병원명·거래처·품목·합계 텍스트가 들어 있고 메뉴·버튼이 없다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-02 — 발주서 자동 작성·인쇄·입고 처리

- **관련 요구·결정**: FR-054, FR-063(발주서 인쇄)
- **설계 근거**: overview.md §3.3, backend.md §3.5, frontend.md /inventory/orders, /print/order (docs/ARCHITECTURE/)
- **선행**: phase-03-task-01

## 범위
- 초안 생성(거래처별 묶음·권장 수량), 수정, 상태 전이, 입고 처리(트랜잭션, 선택 시 지출 동시 기록은 finance 테이블 준비 후 연결 — 없으면 옵션 숨김)
- A4 인쇄 화면

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
- 참고: 화면 태스크다. 발주서 인쇄 PDF는 page.pdf로 확인한다. 기준일은 TEST_NOW=2026-11-02다.

---
id: phase-03-task-02
status: completed
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

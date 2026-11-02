---
id: phase-03-task-01
status: pending
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

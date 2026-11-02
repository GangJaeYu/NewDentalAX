---
id: phase-04-task-01
status: completed
phase: "04"
title: "근무표"
depends_on: [phase-03-task-09]
files:
  - "server/modules/hr/roster*"
  - "server/db/migrations/061_roster.sql"
  - "web/src/pages/hr/roster*"
  - "web/src/pages/print/roster*"
acceptance_criteria:
  - "manager가 칸을 클릭해 \"오전\"을 고르면 1~2번 클릭으로 저장되고 새로고침 후 유지된다"
  - "지난주 복사 후 이번 주 칸이 지난주와 같다(휴가는 복사되지 않음)"
  - "승인된 연차 날짜 칸에 \"연차\"가 표시되고 인원 합계에서 빠진다"
  - "staff는 조회만 가능(편집 시도 403)"
  - "대시보드 오늘 근무 카드에 오늘 근무자와 유형이 보인다"
verification: [lint, unit, e2e, task_validation]
---

# phase-04-task-01 — 근무표

- **관련 요구·결정**: FR-081
- **설계 근거**: backend.md §3.7 roster, database.md §7 (docs/ARCHITECTURE/)
- **선행**: phase-03-task-09

## 범위
- 주간·월간 달력, 칸 클릭 → 유형 선택, 근무 유형 관리, 지난주 복사, 승인 휴가 덮어 표시, 날짜별 인원 합계, 인쇄
- 대시보드 오늘 근무·이번 주 일정 카드 연결

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

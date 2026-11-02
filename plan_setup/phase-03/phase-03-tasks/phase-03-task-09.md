---
id: phase-03-task-09
status: in_progress
phase: "03"
title: "연차·휴가 신청과 승인"
depends_on: [phase-01-task-05, phase-02-task-04]
files:
  - "server/modules/hr/leave*"
  - "server/db/migrations/060_hr.sql(leave 부분)"
  - "web/src/pages/hr/leave*"
acceptance_criteria:
  - "staff 신청 → manager 알림 → 승인 → 신청자 알림, 잔여 일수 감소(반차 0.5)"
  - "반려 시 사유를 비우면 저장되지 않고 오류 문구가 보인다"
  - "같은 날 이미 승인 2건(maxPerDay=2)인 날 승인하려 하면 경고가 보인다(승인은 가능)"
  - "staff는 다른 사람 신청을 승인할 수 없다(403)"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-09 — 연차·휴가 신청과 승인

- **관련 요구·결정**: FR-080
- **설계 근거**: overview.md §3.6, backend.md §3.7 leave, database.md §7 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-05, phase-02-task-04

## 범위
- 신청(종류·기간·반차 0.5일)·취소·승인/반려(사유 필수)·알림
- 부여 일수(A)·잔여 표시
- 같은 날 인원 초과 경고

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

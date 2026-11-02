---
id: phase-04-task-03
status: completed
phase: "04"
title: "장비 점검·유지보수·멸균기 기록"
depends_on: [phase-03-task-08]
files:
  - "server/modules/facility/{equipment,sterilizer}*"
  - "server/db/migrations/051_equipment.sql"
  - "web/src/pages/facility/{equipment,sterilizer}*"
  - "web/src/pages/print/{sterilizer,equipment}*"
acceptance_criteria:
  - "멸균 기록 입력 폼에 환자 관련 입력란이 없다(필드 목록 검사)"
  - "BI 결과 \"불합격\" 저장 → manager 알림 즉시 1건, 대시보드에 조치 전까지 경고 표시 → 조치 기록 후 경고 사라짐"
  - "점검 주기 6개월 장비의 마지막 점검 2026-05-10 → 다음 2026-11-10 D-8 표시"
  - "기간 지정 인쇄 PDF에 해당 기간 기록 행이 모두 들어 있다"
verification: [lint, unit, e2e, task_validation]
---

# phase-04-task-03 — 장비 점검·유지보수·멸균기 기록

- **관련 요구·결정**: FR-101, FR-102
- **설계 근거**: database.md §8, backend.md §3.8 (docs/ARCHITECTURE/)
- **선행**: phase-03-task-08

## 범위
- 장비 등록·이력·다음 점검일·알림
- 멸균기 일일/주간 기록(B&D·BI·CI·사이클), 불합격 즉시 알림·조치 기록, 기간 인쇄·CSV
- 대시보드 멸균 상태/점검 카드 연결
- demo seed

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

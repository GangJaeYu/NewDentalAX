---
id: phase-04-task-02
status: completed
phase: "04"
title: "교육 이수 기록·신규 직원 온보딩"
depends_on: [phase-02-task-03, phase-03-task-08]
files:
  - "server/modules/hr/{training,onboarding}*"
  - "server/ai/features/onboarding.ts"
  - "server/db/migrations/062_training.sql"
  - "web/src/pages/hr/{training,onboarding}*"
acceptance_criteria:
  - "주기 12개월 교육을 2025-12-01 이수 기록 → 다음 예정 2026-12-01, D-30 안이면 해당 직원과 manager에게 알림"
  - "증빙 파일 업로드 후 다운로드된다"
  - "AI(데모)로 치과위생사 온보딩 초안을 만들어 템플릿으로 저장 → 신규 직원에게 배정 → 항목 체크 시 진행률 %가 직원·멘토 화면 모두에서 갱신"
verification: [lint, unit, e2e, task_validation]
---

# phase-04-task-02 — 교육 이수 기록·신규 직원 온보딩

- **관련 요구·결정**: FR-082, FR-083
- **설계 근거**: database.md §7, backend.md §3.7 (docs/ARCHITECTURE/)
- **선행**: phase-02-task-03, phase-03-task-08

## 범위
- 교육 항목·주기·직원별 이수(증빙 파일)·다음 예정일·임박 알림
- 온보딩 템플릿(직무별)·AI 초안·배정·진행률

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

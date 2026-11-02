---
id: phase-03-task-08
status: completed
phase: "03"
title: "법정 의무 일정"
depends_on: [phase-01-task-05, phase-02-task-04]
files:
  - "server/modules/facility/legal*"
  - "server/db/migrations/050_facility.sql(legal 부분)"
  - "server/db/seed/legal-templates.ts"
  - "web/src/pages/facility/legal*"
acceptance_criteria:
  - "목록에 TD-022의 모든 항목이 근거·출처 링크·상태 칩(확인됨/권장값/확인 필요)과 함께 보인다"
  - "\"파노라마 정기검사\" 최근 수행일 2023-11-23 입력 → 다음 예정일 2026-11-23, 기준일 2026-11-02에서 D-21"
  - "\"해당 없음\"으로 끈 항목은 대시보드·알림에서 빠진다"
  - "admin이 주기를 바꾸면 다음 예정일이 다시 계산되고 감사 로그에 남는다; manager는 주기 수정 불가"
  - "화면에 \"법령은 바뀔 수 있습니다(확인일 2026-11-02)\" 고지가 보인다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-08 — 법정 의무 일정

- **관련 요구·결정**: FR-100, TD-022
- **설계 근거**: database.md §8 legal_tasks, backend.md §3.8 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-05, phase-02-task-04

## 범위
- TD-022 표 전 항목 seed(확인 상태·적용 조건·근거·출처·확인일)
- 수행 기록 → 다음 예정일, 적용 해제, 주기·상태 수정(A), 항목 추가
- D-30/D-7/당일/기한 지남 알림 scanner, 법령 변경 고지

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

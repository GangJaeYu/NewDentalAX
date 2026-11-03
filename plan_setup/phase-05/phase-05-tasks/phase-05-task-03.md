---
id: phase-05-task-03
status: completed
phase: "05"
title: "전체 E2E·스크린샷 전수 점검·접근성"
depends_on: [phase-04-task-01, phase-04-task-02, phase-04-task-03, phase-04-task-05, phase-04-task-06, phase-04-task-07, phase-04-task-08]
files:
  - "tests/e2e/**"
  - "scripts/screenshots.ts"
  - "artifacts/screens/**(git 제외)"
acceptance_criteria:
  - "전체 E2E 통과(실행 수·소요 시간 기록)"
  - "스크린샷 점검표(화면×너비×테마)에 문제 0건 또는 수정 후 재확인 기록"
  - "axe 위반 0건(전 화면, 두 테마)"
  - "키보드만으로 로그인·출고·문서 생성·연차 신청 완료"
verification: [lint, unit, e2e, task_validation]
---

# phase-05-task-03 — 전체 E2E·스크린샷 전수 점검·접근성

- **관련 요구·결정**: NFR-006, NFR-007, NFR-009, 원문 10절 최종 통합 검증
- **설계 근거**: DESIGN §5, frontend.md §4 (docs/ARCHITECTURE/)
- **선행**: phase-04-task-01, phase-04-task-02, phase-04-task-03, phase-04-task-05, phase-04-task-06, phase-04-task-07, phase-04-task-08

## 범위
- 로그인 → 모듈별 핵심 작업 E2E 묶음
- 전 화면 × 4너비 × 2테마 스크린샷 생성 후 직접 열람해 DESIGN §5 기준 점검·수정
- axe 전 화면, 키보드 핵심 4작업

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

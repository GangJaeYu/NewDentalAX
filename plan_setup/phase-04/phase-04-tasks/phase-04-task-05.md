---
id: phase-04-task-05
status: in_progress
phase: "04"
title: "알림센터 완성·휴대폰 홈 화면(PWA)"
depends_on: [phase-03-task-10]
files:
  - "server/jobs/notify-job.ts"
  - "web/src/pages/notifications*"
  - "web/public/manifest.webmanifest"
acceptance_criteria:
  - "FR-090 AC2의 알림 종류 6가지 각각을 발생시키는 E2E/통합 테스트가 있고 올바른 수신자에게만 간다"
  - "모바일 에뮬레이션(390×844)에서 manifest가 로드되고 이름·아이콘·theme-color가 올바르다"
  - "390px에서 주요 화면 10개에 가로 스크롤이 없다(스크립트 측정: document.scrollWidth ≤ innerWidth)"
verification: [lint, unit, e2e, task_validation]
---

# phase-04-task-05 — 알림센터 완성·휴대폰 홈 화면(PWA)

- **관련 요구·결정**: FR-090, FR-091
- **설계 근거**: overview.md §3.8, TD-013·017 (docs/ARCHITECTURE/)
- **선행**: phase-03-task-10

## 범위
- PRD FR-090 AC2 알림 종류 전체 점검(누락 scanner 보완), 모두 읽음
- PWA 매니페스트·아이콘 검증, 390px 전 화면 점검

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

---
id: phase-03-task-10
status: failed
phase: "03"
title: "대시보드"
depends_on: [phase-03-task-01, phase-03-task-02, phase-03-task-04, phase-03-task-08, phase-03-task-09, phase-02-task-03]
files:
  - "server/modules/dashboard/**"
  - "web/src/pages/dashboard*"
acceptance_criteria:
  - "데모 데이터 기준 1440×900에서 요약 숫자 줄과 첫 줄 카드 4개가 스크롤 없이 보인다(스크린샷 확인)"
  - "각 카드 항목 클릭 시 해당 화면/항목으로 이동한다"
  - "staff 로그인 시 승인 대기·발주·지출 카드가 없다"
  - "데이터가 빈 DB에서 모든 카드가 빈 상태 안내와 바로가기를 보인다"
  - "대시보드에서 출고 기록을 3번 클릭 이하로 완료한다(E2E 클릭 수 측정)"
  - "GET /api/dashboard p95 300ms 이하(10배 데이터, phase-05 측정과 연결)"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-10 — 대시보드

- **관련 요구·결정**: FR-008, NFR-009, DESIGN §4 대시보드 순서
- **설계 근거**: backend.md §3.3 GET /dashboard (docs/ARCHITECTURE/)
- **선행**: phase-03-task-01, phase-03-task-02, phase-03-task-04, phase-03-task-08, phase-03-task-09, phase-02-task-03

## 범위
- 요약 숫자 6개 + 카드 10개(DESIGN §4), 역할별 표시
- 아직 없는 P1 데이터(근무표·지출·멸균)는 해당 태스크 완료 전까지 빈 상태로 표시하고 연결 지점 유지
- 빠른 행동(출고 기록·공지 쓰기·AI 문서), AI 빠른 요청 카드(AiPanel 소형)

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

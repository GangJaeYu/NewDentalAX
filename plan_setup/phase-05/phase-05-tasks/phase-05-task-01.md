---
id: phase-05-task-01
status: in_progress
phase: "05"
title: "성능·부하 측정"
depends_on: [phase-03-task-10, phase-04-task-04]
files:
  - "scripts/perf.ts"
  - "docs/PERF.md"
acceptance_criteria:
  - "품목 1,000·입출고 2만 건에서 주요 목록 API p95 ≤ 300ms(측정 출력 첨부)"
  - "20 동시 연결 60초 시나리오 오류 0건"
  - "첫 화면(로그인 후 대시보드) 2초 이내"
  - "측정 환경·수치를 docs/PERF.md에 기록"
verification: [lint, unit, task_validation]
---

# phase-05-task-01 — 성능·부하 측정

- **관련 요구·결정**: NFR-005
- **설계 근거**: database.md §3.2 성능, TD-024 scale=10 (docs/ARCHITECTURE/)
- **선행**: phase-03-task-10, phase-04-task-04

## 범위
- scale=10 데이터 생성, 주요 목록 API·대시보드 p95 측정, autocannon 20 동시 연결 시나리오, 첫 화면 표시 시간(Playwright)
- 미달 시 인덱스·쿼리 개선 후 재측정

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

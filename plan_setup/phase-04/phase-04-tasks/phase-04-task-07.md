---
id: phase-04-task-07
status: pending
phase: "04"
title: "채용 공고·면접 질문 초안"
depends_on: [phase-04-task-06]
files:
  - "server/ai/features/hiring.ts"
  - "server/modules/marketing/hiring-rules*"
  - "web/src/pages/hr/hiring*"
acceptance_criteria:
  - "데모 모드로 공고와 질문 목록(직무·태도·상황 구분)이 표시된다"
  - "조건에 \"20대 여성 우대\"를 넣으면 차별 소지 경고가 보인다"
  - "저장한 초안이 보관함(saved_texts kind=hiring)에서 다시 열린다"
verification: [lint, unit, e2e, task_validation]
---

# phase-04-task-07 — 채용 공고·면접 질문 초안

- **관련 요구·결정**: FR-084
- **설계 근거**: backend.md §4 hiring (docs/ARCHITECTURE/)
- **선행**: phase-04-task-06

## 범위
- 입력 폼 → 공고·면접 질문 JSON, 차별 소지 표현 규칙(나이·성별·결혼·출신 등) 경고, 저장·복사

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

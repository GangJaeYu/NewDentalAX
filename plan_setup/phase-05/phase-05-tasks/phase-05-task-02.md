---
id: phase-05-task-02
status: completed
phase: "05"
title: "보안 점검·SECURITY.md"
depends_on: [phase-04-task-08, phase-04-task-05]
files:
  - "docs/SECURITY.md"
  - "tests/security/**"
acceptance_criteria:
  - "`npm audit --omit=dev` high/critical 0건(출력 첨부)"
  - "SECURITY.md 모든 항목에 결과와 증거(테스트 이름/명령) 기입, 미점검 0"
  - "SQL 인젝션 문자열(' OR 1=1 --)을 검색어로 넣어도 정상 응답이며 데이터 노출 없음"
verification: [lint, unit, e2e, task_validation]
---

# phase-05-task-02 — 보안 점검·SECURITY.md

- **관련 요구·결정**: NFR-002, 원문 7절
- **설계 근거**: TD-006·007·008·012·016 (docs/ARCHITECTURE/)
- **선행**: phase-04-task-08, phase-04-task-05

## 범위
- npm audit(high/critical 0), 헤더·CSRF·XSS·SQLi·업로드·CSV 주입·키 노출·원내망·세션 테스트 재확인
- 체크리스트 항목별 점검 방법·결과·증거 기록, 외부 공개 시 위험

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

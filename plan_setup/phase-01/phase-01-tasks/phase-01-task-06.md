---
id: phase-01-task-06
status: completed
phase: "01"
title: "[위험 해소] 한글 문서 검색 품질 실험 (OQ-008)"
depends_on: [phase-01-task-02]
files:
  - "server/modules/assistant/search.ts"
  - "server/modules/assistant/search.test.ts"
  - "tests/fixtures/kb/**"
  - "scripts/kb-eval.ts"
acceptance_criteria:
  - "`npm run kb-eval`이 질문 20개 각각의 상위 3개 결과와 정답 포함 여부, 전체 적중률을 출력한다"
  - "적중률이 80% 이상이면 통과; 미달이면 청크 크기·가중치(제목 가중)·질의 확장을 바꿔 재측정한 기록을 LOG에 남기고 최종값과 \"근거 없음\" 판정 임계값을 TRD TD-011/Architecture §6에 반영한다"
  - "2글자 질의(\"재고\", \"연차\")와 띄어쓰기 없는 질의가 정답 문서를 찾는 단위 테스트가 있다"
  - "관련 없는 질문(예: \"주식 시세\")에서 임계값 판정이 \"찾지 못함\"이 된다"
verification: [lint, unit, task_validation]
---

# phase-01-task-06 — [위험 해소] 한글 문서 검색 품질 실험 (OQ-008)

- **관련 요구·결정**: FR-071, TD-011, OQ-008
- **설계 근거**: overview.md §3.5 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-02

## 범위
- 2-gram 변환·청크 분할·FTS5 색인·BM25 검색 함수를 순수 모듈로 구현
- 데모용 원내 매뉴얼 5종(감염관리, 멸균, 재고 관리, 연차·근무 규정, 데스크 응대) 작성 — 이후 demo seed에 재사용
- 질문 20개와 정답 문서 라벨 세트, 평가 스크립트 `npm run kb-eval`

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

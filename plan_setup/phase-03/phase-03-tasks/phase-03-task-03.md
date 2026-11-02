---
id: phase-03-task-03
status: pending
phase: "03"
title: "CSV 가져오기·내보내기"
depends_on: [phase-03-task-01]
files:
  - "server/lib/csv.ts"
  - "server/modules/inventory/csv*"
  - "web/src/pages/inventory/import*"
  - "tests/fixtures/csv/**"
acceptance_criteria:
  - "내보낸 CSV 첫 3바이트가 BOM이고 한글 열 이름이 들어 있다"
  - "CP949로 저장한 예제 CSV를 올리면 한글이 깨지지 않고 미리보기에 신규/변경/오류 줄이 구분된다"
  - "오류 줄(적정 재고에 문자)이 이유와 함께 표시되고 \"오류 줄 건너뛰고 확정\" 시 나머지만 반영된다"
  - "`=HYPERLINK(...)`로 시작하는 품목명을 내보내면 앞에 작은따옴표가 붙는다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-03 — CSV 가져오기·내보내기

- **관련 요구·결정**: FR-056, TD-016
- **설계 근거**: backend.md §3.5 import/export (docs/ARCHITECTURE/)
- **선행**: phase-03-task-01

## 범위
- 품목·거래처·입출고 내보내기(UTF-8 BOM, 수식 주입 방지)
- 품목 가져오기 미리보기/확정, UTF-8·CP949 자동 판별, 양식 다운로드

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

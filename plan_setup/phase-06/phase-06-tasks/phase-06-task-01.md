---
id: phase-06-task-01
status: in_progress
phase: "06"
title: "바코드 출고(스캐너·사진)"
depends_on: [phase-05-task-05]
files:
  - "web/src/pages/inventory/**"
  - "server/modules/inventory/**"
acceptance_criteria:
  - "바코드 입력란에 스캐너 입력(테스트: 키보드 타이핑+Enter) 시 해당 품목 출고 Dialog가 수량 1로 열린다"
  - "바코드 사진 파일을 올리면 품목이 찾아진다(fixture 이미지)"
verification: [lint, unit, e2e, task_validation]
---

# phase-06-task-01 — 바코드 출고(스캐너·사진)

- **관련 요구·결정**: FR-130
- **설계 근거**: TD-017(http에서 카메라 실시간 접근 불가) (docs/ARCHITECTURE/)
- **선행**: phase-05-task-05

## 범위
- 품목 바코드 필드, USB 바코드 스캐너(키보드 입력) 출고 모드, 휴대폰은 사진 촬영(file input capture) 후 브라우저에서 바코드 해독 — 실시간 카메라는 http 제약으로 제외

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

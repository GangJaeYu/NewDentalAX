---
id: phase-04-task-08
status: in_progress
phase: "04"
title: "명세서·영수증 사진 → 입고·지출 입력"
depends_on: [phase-03-task-01, phase-04-task-04]
files:
  - "server/ai/features/receipt.ts"
  - "server/modules/inventory/receipt*"
  - "web/src/pages/inventory/receipt*"
  - "web/src/lib/image.ts"
  - "tests/fixtures/receipt/**"
acceptance_criteria:
  - "확인 체크 전에는 전송 버튼이 비활성이다"
  - "4000×3000 사진을 올리면 서버가 받은 이미지 긴 변이 1600px 이하다"
  - "데모 결과의 각 줄에 기존 품목 후보가 제시되고, 확인 후 저장하면 입고 기록과(M일 때 선택 시) 지출이 생긴다"
  - "가짜 공급자가 카드번호가 든 텍스트를 돌려주면 화면에 가려진 채 표시되고 안내가 보인다"
  - "이미지 미지원 모델 설정 시 기능 비활성 안내가 보인다"
verification: [lint, unit, e2e, task_validation]
---

# phase-04-task-08 — 명세서·영수증 사진 → 입고·지출 입력

- **관련 요구·결정**: FR-122, TD-012
- **설계 근거**: overview.md §3.4, backend.md §3.5 receipt (docs/ARCHITECTURE/)
- **선행**: phase-03-task-01, phase-04-task-04

## 범위
- 경고·확인 체크 후 전송, 브라우저 축소(1600px), 서버 크기 검사
- AI 결과 표 → 품목 후보 연결(2-gram 유사도) → 수정 → 입고(+지출: M만)
- 이미지 미지원 모델이면 비활성 안내, 데모 예시 결과

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

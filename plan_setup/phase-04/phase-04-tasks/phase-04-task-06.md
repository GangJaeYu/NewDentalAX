---
id: phase-04-task-06
status: pending
phase: "04"
title: "의료광고 문구 점검·홍보 글 초안"
depends_on: [phase-02-task-03]
files:
  - "server/modules/marketing/**"
  - "server/ai/features/{adcheck,promo}.ts"
  - "server/db/seed/ad-rules.ts"
  - "server/db/migrations/080_marketing.sql"
  - "web/src/pages/docs/{adcheck,promo}*"
acceptance_criteria:
  - "\"국내 최고 임플란트, 100% 성공, 지금 50% 할인\" 입력 → 규칙 3건 이상 하이라이트와 이유·대체 표현"
  - "결과에 \"법률 자문이 아니며 사전심의 대상 여부는 관련 기관 확인\" 고지"
  - "admin이 규칙을 추가하면 다음 점검부터 적용된다"
  - "홍보 글 생성 후 점검 결과가 자동으로 함께 보인다; 리뷰 답글 화면의 점검 버튼이 동작한다"
verification: [lint, unit, e2e, task_validation]
---

# phase-04-task-06 — 의료광고 문구 점검·홍보 글 초안

- **관련 요구·결정**: FR-120, FR-121, FR-043 AC2 연결
- **설계 근거**: backend.md §3.10 adcheck/ad-rules, §4 adcheck/promo (docs/ARCHITECTURE/)
- **선행**: phase-02-task-03

## 범위
- 규칙 사전 seed(최고·유일·100%·전후 비교·경험담·할인/무료 강조·비교 광고 등) + 관리(A)
- 1차 규칙 + 2차 AI 점검, 위험 표현 하이라이트·이유·대체 표현, 고지
- 홍보 글 초안 → 자동 점검
- 리뷰 답글·문서 작성기에서 "광고 문구 점검" 연결

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

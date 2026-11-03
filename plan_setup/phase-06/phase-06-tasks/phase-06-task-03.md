---
id: phase-06-task-03
status: in_progress
phase: "06"
title: "회의 녹음 파일 → 회의록"
depends_on: [phase-05-task-05]
files:
  - "server/ai/features/transcribe.ts"
  - "web/src/pages/docs/minutes*"
acceptance_criteria:
  - "데모 모드에서 음성 파일 업로드 → 예시 전사문 → 회의록 요약 화면으로 이어진다"
  - "음성 미지원 공급자면 비활성 안내"
  - "20MB 초과 파일 거부"
verification: [lint, unit, e2e, task_validation]
---

# phase-06-task-03 — 회의 녹음 파일 → 회의록

- **관련 요구·결정**: FR-132
- **설계 근거**: TD-017(http에서 마이크 접근 불가 → 녹음 파일 업로드) (docs/ARCHITECTURE/)
- **선행**: phase-05-task-05

## 범위
- 녹음 파일 업로드(휴대폰 녹음 앱 파일) → 음성 인식(지원 공급자만) → 기존 회의록 요약 흐름
- 개인정보 경고(환자 이야기 녹음 금지)

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

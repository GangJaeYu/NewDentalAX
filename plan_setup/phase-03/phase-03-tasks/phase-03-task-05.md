---
id: phase-03-task-05
status: in_progress
phase: "03"
title: "데스크 AI: 응대 스크립트·리뷰 답글·문자/안내문 템플릿"
depends_on: [phase-02-task-03, phase-03-task-04]
files:
  - "server/ai/features/{script,review_reply,template}.ts"
  - "server/modules/desk/saved-texts*"
  - "web/src/pages/desk/{script,review,templates}*"
acceptance_criteria:
  - "병원 정보에 \"토요일 9:30~14:00\"을 저장한 뒤 데모 모드 스크립트 생성 결과에 그 값이 들어간다(데모 응답도 병원 정보를 치환)"
  - "리뷰에 전화번호가 있으면 가려진 뒤 처리되고 안내가 보인다"
  - "답글 초안이 2개 이상 말투별로 보이고 복사·저장된다"
  - "템플릿에 {진료시간} 치환 결과 미리보기와 90바이트 초과 시 \"장문\" 표시"
  - "환자 이름 치환자는 선택 목록에 없다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-05 — 데스크 AI: 응대 스크립트·리뷰 답글·문자/안내문 템플릿

- **관련 요구·결정**: FR-042, FR-043, FR-044
- **설계 근거**: backend.md §3.4 saved-texts, §4 script/review_reply/template (docs/ARCHITECTURE/)
- **선행**: phase-02-task-03, phase-03-task-04

## 범위
- 병원 정보 자동 반영 프롬프트, 상황·말투 선택, 보관함(분류·검색)
- 리뷰 답글 2~3안, 진료 사실 확인 표현 경고(규칙), 광고 점검 연결 지점(FR-120 완료 전에는 안내만)
- 템플릿 치환자({진료시간} 등)·글자 수(바이트)·복사

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

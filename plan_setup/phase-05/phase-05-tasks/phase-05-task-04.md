---
id: phase-05-task-04
status: in_progress
phase: "05"
title: "사용자 문서: README·LLM_GUIDE·COST·PLAN·DECISIONS·PROGRESS"
depends_on: [phase-05-task-03]
files:
  - "README.md"
  - "docs/LLM_GUIDE.md"
  - "docs/COST.md"
  - "docs/PLAN.md"
  - "docs/DECISIONS.md"
  - "PROGRESS.md"
  - "scripts/check-docs.ts"
  - "docs/images/**"
acceptance_criteria:
  - "`npm run lint`의 문서 검사가 원문 12·13절 필수 소제목 누락 0건"
  - "COST.md의 모든 가격 행에 확인일과 출처 URL이 있다"
  - "README 스크린샷 파일이 실제 존재하고 최신 화면이다"
  - "README의 설치 절차가 phase-05-task-05 리허설에서 그대로 따라 성공한다"
verification: [lint, task_validation]
---

# phase-05-task-04 — 사용자 문서: README·LLM_GUIDE·COST·PLAN·DECISIONS·PROGRESS

- **관련 요구·결정**: NFR-011, 원문 12·13절, OQ-009(데이터 정책)
- **설계 근거**: — (docs/ARCHITECTURE/)
- **선행**: phase-05-task-03

## 범위
- README: 원문 12절 항목 전부 + 실제 스크린샷 + 폴더 지도 + Claude Code 수정 요령
- LLM_GUIDE: 비유, 키 발급 단계(3사), 토큰·요금, 안전 수칙
- COST: 공식 가격표(확인일·출처), 기능별 토큰 추정, 5/10/20명 월 비용(원화, 환율 가정), 추천 조합, 절약 팁, 공급자별 데이터 정책(공식 페이지 확인), 서버 비용 비교
- check-docs.ts: 문서별 필수 소제목 검사를 lint에 연결

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

---
id: phase-05-task-05
status: in_progress
phase: "05"
title: "깨끗한 설치 리허설·최종 보고 준비"
depends_on: [phase-05-task-01, phase-05-task-02, phase-05-task-04]
files:
  - "plan_setup/STATE.md"
  - "plan_setup/LOG.md"
  - "PROGRESS.md"
acceptance_criteria:
  - "새 폴더에서 `cmd /c .\\start.bat` → npm ci 자동 → 서버 응답 → /setup 표시까지 성공(로그 첨부, 소요 시간 기록)"
  - "그 상태에서 전체 lint·unit·e2e 통과 수치 기록"
  - "최종 보고용 \"검증한 것 / 미검증 / 사용자 할 일\" 목록이 PROGRESS.md에 있다"
verification: [lint, unit, e2e, task_validation]
---

# phase-05-task-05 — 깨끗한 설치 리허설·최종 보고 준비

- **관련 요구·결정**: NFR-003, NFR-012, 원문 10절·14절
- **설계 근거**: TD-019 (docs/ARCHITECTURE/)
- **선행**: phase-05-task-01, phase-05-task-02, phase-05-task-04

## 범위
- git으로 추적된 파일만 새 임시 폴더에 내보내기(node_modules·data 없음) → README 순서대로 start.bat 실행 → 첫 설정 → 데모 → 주요 화면 확인
- 전체 게이트 최종 실행 수치 기록, 미검증·한계 목록 정리

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

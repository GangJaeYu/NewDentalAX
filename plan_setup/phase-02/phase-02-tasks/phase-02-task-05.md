---
id: phase-02-task-05
status: pending
phase: "02"
title: "백업·복원·데모 데이터 적재/초기화"
depends_on: [phase-01-task-02, phase-01-task-04]
files:
  - "server/jobs/backup-job.ts"
  - "server/modules/admin/backup*"
  - "server/db/seed/**"
  - "web/src/pages/admin/{backup,reset}*"
acceptance_criteria:
  - "값 A로 백업 → 값 B로 수정 → 복원하면 값 A가 보이고 pre-restore 백업이 생긴다(통합 테스트)"
  - "보관 개수 3으로 설정 후 5번 백업하면 최신 3개만 남는다"
  - "주입 시계로 어제 백업만 있는 상태에서 서버를 시작하면 오늘 백업이 즉시 생긴다"
  - "업로드 파일이 백업 zip 안에 포함된다"
  - "초기화 실행 후 업무 테이블은 비고 admin 계정·설정·감사 로그·AI 사용 기록은 남으며 직전 자동 백업이 있다"
  - "확인 문구를 틀리게 입력하면 복원/초기화가 실행되지 않는다"
verification: [lint, unit, e2e, task_validation]
---

# phase-02-task-05 — 백업·복원·데모 데이터 적재/초기화

- **관련 요구·결정**: FR-006, FR-007, NFR-004, TD-014·024
- **설계 근거**: overview.md §3.7, database.md §11 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-02, phase-01-task-04

## 범위
- 백업(VACUUM INTO + uploads + secret.key + manifest), 보관 개수, 놓친 백업 따라잡기, zip 다운로드(fflate)
- 복원(maintenance 모드, pre-restore, 실패 시 되돌림, 세션 전부 삭제)
- 데모 적재/초기화(seed registry 순회, 초기화 전 자동 백업, 남길 테이블 규칙)
- /setup의 withDemo 연결

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

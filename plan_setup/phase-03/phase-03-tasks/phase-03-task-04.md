---
id: phase-03-task-04
status: completed
phase: "03"
title: "데스크: 공지·인수인계·오픈/마감 체크리스트"
depends_on: [phase-01-task-05, phase-02-task-04]
files:
  - "server/modules/desk/{posts,checklists}*"
  - "server/db/migrations/030_desk.sql"
  - "web/src/pages/desk/{board,checklist}*"
  - "web/src/pages/print/checklist*"
acceptance_criteria:
  - "staff가 공지 작성 시도 → 403/버튼 없음, 인수인계는 작성 가능"
  - "staff가 공지를 열면 manager 화면의 읽음 수가 1 증가하고 안 읽은 사람 목록에서 빠진다"
  - "새 공지 등록 시 전 직원에게 알림이 생긴다"
  - "오늘 항목 체크 시 체크한 사람·시각이 보이고, 주입 시계로 다음 날이 되면 미체크로 시작하며 어제 기록은 읽기 전용으로 조회된다"
  - "체크리스트 항목 순서 변경 후 새로고침해도 순서가 유지된다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-04 — 데스크: 공지·인수인계·오픈/마감 체크리스트

- **관련 요구·결정**: FR-040, FR-041
- **설계 근거**: database.md §2, backend.md §3.4 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-05, phase-02-task-04

## 범위
- 공지(M 작성·고정)·인수인계(S 작성·처리 완료)·읽음 기록·읽은/안 읽은 사람
- 체크리스트 편집(M)·오늘 체크·지난 날짜 조회·인쇄
- 새 공지 알림
- demo seed

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

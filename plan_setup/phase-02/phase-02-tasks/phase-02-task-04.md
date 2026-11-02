---
id: phase-02-task-04
status: pending
phase: "02"
title: "알림 서비스·스케줄러"
depends_on: [phase-01-task-03]
files:
  - "server/modules/notifications/**"
  - "server/jobs/{scheduler,notify-job}.ts"
  - "web/src/layout/NotificationBell*"
acceptance_criteria:
  - "같은 dedupe_key로 두 번 emit해도 알림은 1건이다"
  - "알림을 누르면 링크로 이동하고 읽음 처리되어 배지 수가 줄어든다"
  - "새 알림이 생기면 새로고침 없이 60초 안에 배지에 반영된다(E2E, 폴링 주기 테스트 설정)"
  - "수신자 규칙: staff에게는 manager 전용 알림이 가지 않는다"
verification: [lint, unit, e2e, task_validation]
---

# phase-02-task-04 — 알림 서비스·스케줄러

- **관련 요구·결정**: FR-090(서버), overview §3.8
- **설계 근거**: backend.md §3.3·§6, database.md notifications (docs/ARCHITECTURE/)
- **선행**: phase-01-task-03

## 범위
- notify.emit(type, recipients 규칙, dedupe)
- summary/list/read API, 상단바 종 아이콘 30초 폴링·목록 팝오버·/notifications 화면
- scheduler(시작 시 + 매시 정각, clock 주입), notify-job 확장 지점(모듈이 scanner 등록)

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

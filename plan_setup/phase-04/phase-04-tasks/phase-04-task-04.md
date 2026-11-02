---
id: phase-04-task-04
status: pending
phase: "04"
title: "지출 기록·월간 요약"
depends_on: [phase-02-task-03, phase-03-task-02]
files:
  - "server/modules/finance/**"
  - "server/ai/features/monthly_summary.ts"
  - "server/db/migrations/070_finance.sql"
  - "web/src/pages/finance/**"
acceptance_criteria:
  - "staff는 지출 화면 접근 불가(메뉴 없음, API 403)"
  - "발주 입고 시 \"지출로도 기록\" 체크 → 지출 목록에 합계 금액·거래처·재료비 분류로 1건 생성"
  - "월간 요약 숫자가 해당 월 지출 합계 SQL 결과와 일치하고 데이터 없는 달은 빈 상태"
  - "AI 월간 요약 요청 본문(가짜 서버 수신)에 개별 메모 텍스트가 없고 집계 숫자만 있다"
verification: [lint, unit, e2e, task_validation]
---

# phase-04-task-04 — 지출 기록·월간 요약

- **관련 요구·결정**: FR-110, FR-111, FR-054 AC3 지출 연결
- **설계 근거**: database.md §9, backend.md §3.9 (docs/ARCHITECTURE/)
- **선행**: phase-02-task-03, phase-03-task-02

## 범위
- 지출 CRUD·분류 편집·영수증 첨부·CSV
- 발주 입고 시 지출 동시 기록 옵션 활성화
- 월간 요약(합계·분류 비중·전월/전년 대비·거래처 상위·재료비 추이 그래프), AI 월간 요약(집계 숫자만 전송)
- 대시보드 이번 달 지출 카드 연결

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

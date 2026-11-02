---
id: phase-02-task-03
status: pending
phase: "02"
title: "AI 관리 화면·AI 공용 화면 부품"
depends_on: [phase-02-task-02, phase-01-task-04]
files:
  - "web/src/pages/admin/ai*"
  - "web/src/components/{AiPanel,PrivacyGuard}*"
acceptance_criteria:
  - "E2E: 관리자가 키를 입력·저장하면 화면에 끝 4자리만 보이고 새로고침 후에도 원문이 보이지 않는다"
  - "E2E: 모델 단가를 수정 후 데모가 아닌 가짜 공급자 호출(테스트 서버 설정)의 비용이 새 단가로 계산된다"
  - "사용량 화면에 이번 달 비용·예산 대비 %·기능별 표가 보이고 데이터 없을 때 빈 상태가 보인다"
  - "AiPanel 입력에 전화번호를 치면 노란 경고가, 실행 후 \"전화번호 1건을 가리고 보냈습니다\"가 보인다"
  - "예산 초과 상태에서 실행하면 한국어 안내와 관리자 문의 문구가 보인다"
verification: [lint, unit, e2e, task_validation]
---

# phase-02-task-03 — AI 관리 화면·AI 공용 화면 부품

- **관련 요구·결정**: FR-030 AC3, FR-033, FR-034 AC3, FR-035, FR-036, FR-038, FR-032 AC5
- **설계 근거**: frontend.md §2(AiPanel, PrivacyGuard), §3 /admin/ai·/admin/ai-usage (docs/ARCHITECTURE/)
- **선행**: phase-02-task-02, phase-01-task-04

## 범위
- AI 설정(공급자, 키 입력/삭제, 연결 확인, 월 예산, 환율, 기능별 등급·역할 켜기/끄기), 모델·단가 표 편집, 사용량 대시보드(월·기능별·사용자별·일별)
- AiPanel(등급별 예상 비용·실행·중지·스트림 표시·오류·개인정보 처리 결과·고지), PrivacyGuard

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

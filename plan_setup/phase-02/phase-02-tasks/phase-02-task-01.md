---
id: phase-02-task-01
status: in_progress
phase: "02"
title: "개인정보 필터(서버·화면)"
depends_on: [phase-01-task-02]
files:
  - "shared/privacy-rules.ts"
  - "server/privacy/**"
  - "web/src/lib/privacy.ts"
acceptance_criteria:
  - "감지·미감지 예시 50개 이상 단위 테스트 통과(주민번호, 외국인등록번호, 휴대·지역 전화, 이메일, 카드(Luhn), 계좌, 여권 + 날짜·금액·발주번호·로트·사업자번호 미감지)"
  - "\"홍길동 010-1234-5678 연락\" → `[전화번호]`로 가려지고 findings에 phone 1건"
  - "주민번호가 포함되면 blocked=true"
  - "허용 목록의 대표번호는 가려지지 않는다"
verification: [lint, unit, e2e, task_validation]
---

# phase-02-task-01 — 개인정보 필터(서버·화면)

- **관련 요구·결정**: FR-032, NFR-001, TD-010
- **설계 근거**: overview.md §3.2 ④⑥ (docs/ARCHITECTURE/)
- **선행**: phase-01-task-02

## 범위
- 패턴·검증(Luhn, 날짜 유효성)·허용 목록·정책(block/redact)
- 오탐 대조 세트
- 화면 입력 중 경고용 경량 사본(같은 규칙 import)

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

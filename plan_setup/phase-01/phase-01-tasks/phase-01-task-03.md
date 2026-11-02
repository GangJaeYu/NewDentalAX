---
id: phase-01-task-03
status: completed
phase: "01"
title: "인증·세션·CSRF·권한·원내망·보안 헤더"
depends_on: [phase-01-task-02]
files:
  - "server/auth/**"
  - "server/security/**"
  - "shared/roles.ts"
  - "shared/schemas/auth.ts"
  - "server/modules/index.ts"
  - "server/modules/*/routes.ts(빈 스텁)"
acceptance_criteria:
  - "사용자 0명일 때 POST /api/setup이 admin을 만들고, 그 뒤 같은 요청은 409 SETUP_DONE이며 사용자 수가 늘지 않는다"
  - "틀린 비밀번호 5회 후 6번째는 맞는 비밀번호여도 423 LOCKED이고, 주입 시계로 15분 뒤에는 로그인된다; 감사 로그에 잠금이 남는다"
  - "주입 시계로 마지막 요청 8시간 1분 뒤 요청은 401이고 8시간 전 요청은 성공하며 만료가 연장된다"
  - "CSRF 헤더 없는 POST는 403 CSRF, 로그아웃 후 이전 쿠키로 요청하면 401이다"
  - "원격 주소 8.8.8.8로 흉내 낸 요청은 403 NETWORK_BLOCKED, 192.168.0.5와 127.0.0.1은 허용된다"
  - "모든 응답에 CSP·nosniff·frame-ancestors·Referrer-Policy 헤더가 있다"
  - "DB 어디에도 평문 비밀번호가 없다(사용한 비밀번호 문자열로 DB 파일 바이트 검색)"
  - "역할 × 대표 API 표 테스트에서 staff가 admin 전용 API(예: GET /api/audit) 호출 시 403이다"
verification: [lint, unit, e2e, task_validation]
---

# phase-01-task-03 — 인증·세션·CSRF·권한·원내망·보안 헤더

- **관련 요구·결정**: FR-001, FR-002, FR-003, FR-009, NFR-002, TD-006·007
- **설계 근거**: overview.md §3.1, backend.md §3.1, §2 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-02

## 범위
- shared/roles.ts: PRD §2 권한 표 전체를 CAPS로 정의(이후 태스크는 이 파일을 수정하지 않고 필요 시 STATE에 변경 요청 기록)
- server/modules/index.ts: backend.md §3 전 모듈을 등록하고 각 `routes.ts` 빈 플러그인 스텁 생성(모듈 태스크는 자기 폴더만 채움)
- setup/login/logout/session/password API, scrypt, 세션 슬라이딩 8h, 5회 15분 잠금, CSRF 토큰+Origin 검사, must_change_pw 차단, 비활성 사용자 세션 삭제
- 원내망 제한(allowExternal 설정), 보안 헤더(CSP 등 TD-007), 입력 검증 실패 400 한국어 응답 형식

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

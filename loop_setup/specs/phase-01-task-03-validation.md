# task_validation 인계서 — phase-01-task-03

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: c0d05a7
- 변경 범위(기준 c0d05a7~1):
```
server/app.ts                          |  19 ++
 server/auth/api-permissions.ts         | 104 ++++++++++
 server/auth/auth.test.ts               | 355 +++++++++++++++++++++++++++++++++
 server/auth/csrf.ts                    |  51 +++++
 server/auth/guard.ts                   | 119 +++++++++++
 server/auth/login-limit.ts             |  93 +++++++++
 server/auth/password.test.ts           |  26 +++
 server/auth/password.ts                |  52 +++++
 server/auth/permissions.test.ts        | 151 ++++++++++++++
 server/auth/routes.ts                  | 178 +++++++++++++++++
 server/auth/sessions.ts                | 138 +++++++++++++
 server/lib/errors.test.ts              |   7 +-
 server/main.ts                         |   2 +-
 server/modules/admin/routes.ts         |   7 +
 server/modules/ai/routes.ts            |   7 +
 server/modules/assistant/routes.ts     |   7 +
 server/modules/desk/routes.ts          |   7 +
 server/modules/docs/routes.ts          |   7 +
 server/modules/facility/routes.ts      |   7 +
 server/modules/finance/routes.ts       |   7 +
 server/modules/hr/routes.ts            |   7 +
 server/modules/index.test.ts           |  32 +++
 server/modules/index.ts                |  41 ++++
 server/modules/inventory/routes.ts     |   7 +
 server/modules/marketing/routes.ts     |   7 +
 server/modules/notifications/routes.ts |   7 +
 server/security/headers.ts             |  35 ++++
 server/security/network.ts             |  82 ++++++++
 server/security/security.test.ts       | 153 ++++++++++++++
 server/security/validate.ts            |  30 +++
 shared/roles.test.ts                   |  71 +++++++
 shared/roles.ts                        | 198 ++++++++++++++++++
 shared/schemas/auth.ts                 |  88 ++++++++
 tests/e2e/auth-api.spec.ts             |  95 +++++++++
 tests/helpers/auth.ts                  |  42 ++++
 35 files changed, 2236 insertions(+), 3 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-01-task-03` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-01-task-03
status: in_progress
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


## 참조 문서
- 요구: docs/PRD.md (위 태스크의 FR/NFR 절)
- 설계: docs/ARCHITECTURE/ (위 "설계 근거" 절)
- 디자인: docs/DESIGN.md

## 예산
- loop_started_at: 2026-11-02T18:55:20+09:00` (전체 24시간 중 일부). 검증은 필요한 범위만 한다.

## 반환 형식 (그대로 채워서 마지막 응답으로)
| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
- 게이트 결과: lint=…, unit=…(건수), e2e=…(건수)
- 환경 문제·판정 불가 사유:
- 재현 방법(실패 시):


## Orca 검증 워커 추가 지시
- 너는 검증할 커밋으로 새로 만든 작업 사본에 있다. 먼저 `npm ci`를 실행한다(설치는 테스트 데이터 준비로 허용된다).
- 슬롯 0
  - 화면 테스트: `E2E_PORT=18094`
  - 수동 서버: `PORT=18194`
  - 데이터: `.tmp/` 아래
  - gate.mjs를 실행할 때 환경 변수 `E2E_PORT`를 지정한다.
- 파일 수정 범위
  - `.tmp/`와 git이 무시하는 산출물(artifacts/ 등)만 만들 수 있다.
  - 제품·테스트·문서는 수정하지 않는다.
  - 커밋하지 않는다.
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed

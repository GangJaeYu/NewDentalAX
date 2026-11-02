# task_validation 인계서 — phase-02-task-02

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: 53ff9ce
- 변경 범위(기준 f17bd9a~1):
```
docs/ARCHITECTURE/backend.md          |   3 +-
 docs/DECISIONS.md                     |  10 +
 docs/TRD.md                           |   2 +-
 plan_setup/LOG.md                     |  10 +
 plan_setup/STATE.md                   |   4 +
 server/ai/budget.ts                   |  67 +++++
 server/ai/features/adcheck.ts         |  32 +++
 server/ai/features/assistant.ts       |  28 ++
 server/ai/features/doc_revise.ts      |  23 ++
 server/ai/features/doc_writer.ts      |  25 ++
 server/ai/features/hiring.ts          |  29 ++
 server/ai/features/index.ts           |  40 +++
 server/ai/features/minutes.ts         |  30 ++
 server/ai/features/monthly_summary.ts |  23 ++
 server/ai/features/onboarding.ts      |  22 ++
 server/ai/features/promo.ts           |  24 ++
 server/ai/features/quick.ts           |  22 ++
 server/ai/features/receipt.ts         |  44 +++
 server/ai/features/review_reply.ts    |  30 ++
 server/ai/features/script.ts          |  25 ++
 server/ai/features/template.ts        |  25 ++
 server/ai/features/types.ts           |  88 ++++++
 server/ai/gateway.test.ts             | 451 ++++++++++++++++++++++++++++++
 server/ai/gateway.ts                  | 509 ++++++++++++++++++++++++++++++++++
 server/ai/log.ts                      |  30 ++
 server/ai/pricing.ts                  | 160 +++++++++++
 server/ai/providers/anthropic.ts      |  68 +++++
 server/ai/providers/demo.ts           |  46 +++
 server/ai/providers/gemini.ts         |  65 +++++
 server/ai/providers/http.ts           | 130 +++++++++
 server/ai/providers/index.ts          |  13 +
 server/ai/providers/openai.ts         |  80 ++++++
 server/ai/settings.ts                 | 228 +++++++++++++++
 server/ai/stream.test.ts              | 143 ++++++++++
 server/ai/stream.ts                   |  53 ++++
 server/ai/types.ts                    |  99 +++++++
 server/ai/units.test.ts               | 144 ++++++++++
 server/ai/usage.ts                    | 173 ++++++++++++
 server/app.ts                         |   9 +
 server/db/migrations/010_ai.sql       |  55 ++++
 server/lib/crypto.ts                  |  70 +++++
 server/modules/ai/routes.ts           | 135 ++++++++-
 server/modules/notifications/emit.ts  |  51 ++++
 shared/ai-features.ts                 | 142 ++++++++++
 tests/fake-llm/server.ts              | 234 ++++++++++++++++
 tests/helpers/ai-app.ts               |  78 ++++++
 46 files changed, 3765 insertions(+), 7 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-02-task-02` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-02-task-02
status: in_progress
phase: "02"
title: "AI 게이트웨이·공급자 어댑터·비용·예산"
depends_on: [phase-02-task-01]
files:
  - "server/ai/**"
  - "shared/ai-features.ts"
  - "server/lib/crypto.ts"
  - "server/db/migrations/010_ai.sql"
  - "tests/fake-llm/**"
acceptance_criteria:
  - "키 없는 상태에서 POST /api/ai/run {feature:\"quick\"}이 \"[데모 응답]\" 텍스트와 demo:true를 돌려주고 ai_usage에 0원·demo로 기록된다"
  - "가짜 서버로 공급자 3종 각각: 요청 헤더·본문 형식 확인, usage 파싱 → cost_krw가 (토큰×단가÷1e6×환율)과 일치"
  - "가짜 서버 401→AI_AUTH, 429→AI_RATE_LIMIT, 500→AI_UNAVAILABLE, 지연→AI_TIMEOUT으로 각각 한국어 문구가 반환되고 ai_usage에 status=error"
  - "월 누적을 예산 80%로 만든 뒤 호출하면 admin에게 알림 1건(두 번째 호출에서 중복 없음), 100% 이상이면 402 AI_BUDGET_EXCEEDED, 예산을 올리면 즉시 성공"
  - "주민번호가 든 입력은 422 AI_PII_BLOCKED이고 공급자(가짜 서버)에 요청이 가지 않는다; 전화번호는 가려진 채 전송된다(가짜 서버 수신 본문으로 확인)"
  - "저장한 키 문자열이 /api/ai/settings 응답, 모든 HTML, 로그 파일 어디에도 없다(끝 4자리 마스킹만)"
  - "관리자가 기능 끄기/역할 제한 시 403 AI_DISABLED"
  - "SSE 스트림에서 delta 이벤트 여러 개 후 done 이벤트가 오고, 클라이언트 중지 시 가짜 서버 연결이 끊긴다"
verification: [lint, unit, e2e, task_validation]
---

# phase-02-task-02 — AI 게이트웨이·공급자 어댑터·비용·예산

- **관련 요구·결정**: FR-030, FR-031, FR-033, FR-034, FR-035, FR-036, FR-037, NFR-008, TD-008·009·021, OQ-009
- **설계 근거**: overview.md §3.2, backend.md §3.10·§4·§5, database.md §10 (docs/ARCHITECTURE/)
- **선행**: phase-02-task-01

## 범위
- shared/ai-features.ts 14개 기능 전부 정의(이후 태스크는 features/<id>.ts 본문만 작성; 이 태스크에서 각 파일을 데모 응답 포함 기본형으로 생성)
- providers: anthropic(Messages API), openai, gemini — 구현 직전 각 공식 API 문서로 요청/응답/usage/스트리밍 형식 확인 후 docs/DECISIONS.md 기록(OQ-009)
- demo provider, pricing(구간 단가), budget(80% 알림 1회/월, 100% 차단), usage 기록, 오류 변환, 시간 초과, SSE 스트림·중지
- API 키 AES-GCM 저장(secret.key 생성), /api/ai/settings·test·models·usage, ai_models seed(TD-021)
- 가짜 LLM HTTP 서버(tests/fake-llm): 정상·스트리밍·401·429·500·지연 응답

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
- 참고: 실제 공급자 키는 없다. 공급자 형식은 tests/fake-llm 가짜 서버로 관찰한다. 화면은 02-03 범위다.

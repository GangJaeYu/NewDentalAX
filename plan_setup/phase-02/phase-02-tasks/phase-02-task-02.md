---
id: phase-02-task-02
status: completed
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

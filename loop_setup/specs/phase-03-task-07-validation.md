# task_validation 인계서 — phase-03-task-07

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: 3551e3f
- 변경 범위(기준 84e0b91~1):
```
docs/DECISIONS.md                          |   2 +
 docs/DESIGN.md                             |   1 +
 plan_setup/LOG.md                          |   9 +
 scripts/screens/phase-03-task-07.ts        |  80 ++++
 server/ai/features/assistant.ts            |  20 +-
 server/db/migrations/041_kb.sql            |  45 ++
 server/modules/admin/demo.test.ts          |   3 +-
 server/modules/assistant/assistant.test.ts | 407 ++++++++++++++++
 server/modules/assistant/extract.ts        |  79 ++++
 server/modules/assistant/routes.ts         |  85 +++-
 server/modules/assistant/seed.ts           |  56 ++-
 server/modules/assistant/service.ts        | 467 ++++++++++++++++++
 shared/schemas/kb.ts                       | 138 ++++++
 tests/e2e/assistant.spec.ts                | 306 ++++++++++++
 tests/fixtures/kb-files/clinic-cleanup.pdf | Bin 0 -> 29615 bytes
 tests/fixtures/kb-files/xray-room.docx     | Bin 0 -> 1363 bytes
 web/src/pages/docs/AssistantPage.tsx       | 734 ++++++++++++++++++++++++++++-
 web/src/pages/docs/assistant.css           |  46 ++
 web/src/pages/docs/assistantLib.ts         | 105 +++++
 web/src/styles/components.css              |   4 +-
 web/src/styles/tokens.css                  |   5 +-
 21 files changed, 2566 insertions(+), 26 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-03-task-07` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-03-task-07
status: in_progress
phase: "03"
title: "원내 AI 도우미(문서 올리기·질문·근거)"
depends_on: [phase-01-task-06, phase-03-task-06]
files:
  - "server/modules/assistant/**"
  - "server/ai/features/assistant.ts"
  - "server/db/migrations/041_kb.sql"
  - "web/src/pages/docs/assistant*"
acceptance_criteria:
  - "E2E(데모): \"멸균기 B&D 테스트는 언제 해?\" → 답 아래 근거 카드에 \"멸균\" 매뉴얼 이름과 발췌가 보이고 링크로 원문이 열린다"
  - "관련 없는 질문 → \"원내 문서에서 찾지 못했습니다\" + 문서 올리기 안내, ai_usage에 기록 없음"
  - "visibility=manager 문서는 staff 질문의 근거로 쓰이지 않는다"
  - "pdf·docx 샘플 업로드가 ready가 되고 조각 수가 표시된다; 손상된 pdf는 failed + 이유"
  - "전화번호가 든 문서 업로드 시 needs_review와 감지 항목이 보이고 \"가리고 저장\" 후 검색 결과 발췌에 번호가 가려져 있다"
  - "문서를 삭제하면 이후 검색 근거에 나오지 않는다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-07 — 원내 AI 도우미(문서 올리기·질문·근거)

- **관련 요구·결정**: FR-070, FR-071
- **설계 근거**: overview.md §3.5, backend.md §3.6 kb/assistant, database.md §6 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-06, phase-03-task-06

## 범위
- 업로드(txt·md·pdf(unpdf)·docx(mammoth)·서식 보관함 문서 선택) → 추출 → 개인정보 검토 → 색인, 공개 범위, 삭제
- 질문 → 검색 → (근거 있으면) AI → 답 + 근거 카드(문서명·발췌·링크), 근거 없으면 AI 미호출
- 대화 기록·삭제
- demo seed: phase-01-task-06의 매뉴얼 5종

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
- 슬롯 2
  - 화면 테스트: `E2E_PORT=18096`
  - 수동 서버: `PORT=18196`
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
- 참고: 화면 태스크다. 병합 뒤 조정자가 다크 테마 알림 배지 대비 결함을 고쳤다(--on-danger 토큰, web/src/styles/tokens.css·components.css). 화면 대조와 axe에서 이 변경도 함께 판정한다(배지와 오류 토스트의 두 테마 대비). 가짜 LLM이나 데모만 쓴다.

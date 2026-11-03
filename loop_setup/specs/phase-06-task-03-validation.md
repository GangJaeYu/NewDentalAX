# task_validation 인계서 — phase-06-task-03

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: ff762f3
- 변경 범위(기준 63339a6):
```
docs/ARCHITECTURE/backend.md                    |   6 -
 docs/ARCHITECTURE/database.md                   |   2 +-
 docs/COST.md                                    |   2 -
 docs/DECISIONS.md                               |   4 -
 package-lock.json                               |  35 ---
 package.json                                    |   1 -
 plan_setup/LOG.md                               |   1 +
 scripts/screens/phase-06-task-01.ts             |  76 ------
 scripts/screens/phase-06-task-02.ts             |  58 ----
 scripts/screens/phase-06-task-03.ts             |  27 --
 server/ai/features/index.ts                     |   6 +-
 server/ai/features/roster_suggest.ts            | 123 ---------
 server/ai/features/transcribe.ts                |  52 ----
 server/ai/gateway.ts                            |  23 --
 server/ai/providers/audio.ts                    | 191 -------------
 server/ai/transcribe.test.ts                    | 312 ----------------------
 server/ai/transcribe.ts                         | 340 ------------------------
 server/ai/units.test.ts                         |   4 +-
 server/auth/api-permissions.ts                  |   3 -
 server/db/migrations/022_barcode.sql            |   6 -
 server/modules/docs/routes.ts                   |   3 -
 server/modules/docs/transcribe.routes.ts        |  22 --
 server/modules/hr/roster-suggest-routes.ts      |  33 ---
 server/modules/hr/roster-suggest.test.ts        | 308 ---------------------
 server/modules/hr/roster-suggest.ts             | 219 ---------------
 server/modules/hr/routes.ts                     |   2 -
 server/modules/inventory/barcode.test.ts        | 193 --------------
 server/modules/inventory/csv.test.ts            |   4 +-
 server/modules/inventory/csv.ts                 |  45 +---
 server/modules/inventory/routes.ts              |   9 -
 server/modules/inventory/seed.ts                |  30 +--
 server/modules/inventory/service.ts             |  40 +--
 shared/ai-features.ts                           |   9 +-
 shared/schemas/inventory-csv.ts                 |   7 +-
 shared/schemas/inventory.ts                     |  40 ---
 shared/schemas/roster-suggest.ts                | 256 ------------------
 tests/barcode-decode.test.ts                    |  49 ----
 tests/e2e/docs-minutes-audio.spec.ts            | 123 ---------
 tests/e2e/hr-roster-suggest.spec.ts             | 312 ----------------------
 tests/e2e/inventory-barcode.spec.ts             | 256 ------------------
 tests/fake-llm/audio.ts                         | 107 --------
 tests/fixtures/barcode/code128-photo.png        | Bin 460639 -> 0 bytes
 tests/fixtures/barcode/ean13-photo.png          | Bin 462762 -> 0 bytes
 tests/fixtures/barcode/ean13-sideways-photo.png | Bin 460868 -> 0 bytes
 tests/fixtures/barcode/make-barcodes.ts         | 269 -------------------
 tests/fixtures/barcode/no-barcode-photo.png     | Bin 429796 -> 0 bytes
 tests/fixtures/barcode/qr-photo.png             | Bin 452560 -> 0 bytes
 tests/security/exposure.test.ts                 |  24 +-
 web/src/pages/admin/AiSettingsPage.tsx          |   4 +-
 web/src/pages/docs/MinutesPage.tsx              |  16 +-
 web/src/pages/docs/MinutesRecording.tsx         | 139 ----------
 web/src/pages/docs/minutes.css                  |  13 -
 web/src/pages/docs/minutesLib.test.ts           |  26 --
 web/src/pages/docs/minutesLib.ts                |  64 -----
 web/src/pages/hr/RosterPage.tsx                 |  23 --
 web/src/pages/hr/RosterSuggestDialog.tsx        | 285 --------------------
 web/src/pages/hr/roster.css                     |  17 --
 web/src/pages/inventory/BarcodeOut.tsx          | 160 -----------
 web/src/pages/inventory/InventoryPage.tsx       |   5 +-
 web/src/pages/inventory/ItemDetailPage.tsx      |   2 +-
 web/src/pages/inventory/barcode.css             |  23 --
 web/src/pages/inventory/barcodeCore.ts          | 109 --------
 web/src/pages/inventory/barcodeDecode.ts        |  36 ---
 web/src/pages/inventory/inventory-ui.tsx        |  19 +-
 64 files changed, 46 insertions(+), 4527 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-06-task-03` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-06-task-03
status: in_progress
phase: "06"
title: "회의 녹음 파일 → 회의록"
depends_on: [phase-05-task-05]
files:
  - "server/ai/features/transcribe.ts"
  - "web/src/pages/docs/minutes*"
acceptance_criteria:
  - "데모 모드에서 음성 파일 업로드 → 예시 전사문 → 회의록 요약 화면으로 이어진다"
  - "음성 미지원 공급자면 비활성 안내"
  - "20MB 초과 파일 거부"
verification: [lint, unit, e2e, task_validation]
---

# phase-06-task-03 — 회의 녹음 파일 → 회의록

- **관련 요구·결정**: FR-132
- **설계 근거**: TD-017(http에서 마이크 접근 불가 → 녹음 파일 업로드) (docs/ARCHITECTURE/)
- **선행**: phase-05-task-05

## 범위
- 녹음 파일 업로드(휴대폰 녹음 앱 파일) → 음성 인식(지원 공급자만) → 기존 회의록 요약 흐름
- 개인정보 경고(환자 이야기 녹음 금지)

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
- 슬롯 3
  - 화면 테스트: `E2E_PORT=18097`
  - 수동 서버: `PORT=18197`
  - 데이터: `.tmp/` 아래
  - gate.mjs를 실행할 때 환경 변수 `E2E_PORT`를 지정한다.
- 파일 수정 범위
  - `.tmp/`와 git이 무시하는 산출물(artifacts/ 등)만 만들 수 있다.
  - 제품·테스트·문서는 수정하지 않는다.
  - 커밋하지 않는다.
- **포트와 프로세스(엄수)**
  - 화면 테스트·스크린샷·수동 서버는 위 슬롯 포트만 쓴다. 다른 번호(특히 18096, 18300 등)는 다른 세션이 쓰고 있을 수 있다.
  - 프로세스는 네가 띄운 자식 프로세스의 핸들로만 종료한다. PID를 보고 종료해야 한다면, 명령줄의 작업 폴더가 네 작업 사본 경로인지와 부모 프로세스가 네 것인지 먼저 확인한다. 확인할 수 없으면 종료하지 말고 보고한다(2026-11-03 사고 재발 방지).
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed
- 참고: 이 작업 사본은 P2 통합 브랜치 p2-integration@63339a6 기준이다(06-01·02·03 병합, 게이트 lint·unit 807·e2e 334 PASS). web/dist는 저장소에 있는 것이 이 커밋의 화면과 다를 수 있으니, 화면 확인 전에 npm run build:web을 실행한다(e2e·screenshots 명령은 스스로 빌드한다). 실제 LLM 공급자로 요청을 보내지 않는다(데모·가짜 서버만). OpenAI·Gemini·Anthropic 설정 각각에서 동작(지원·비활성 안내)을 가짜 서버로 확인한다.

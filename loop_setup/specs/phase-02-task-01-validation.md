# task_validation 인계서 — phase-02-task-01

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: b8b6b05
- 변경 범위(기준 3c4a78d~1):
```
docs/ARCHITECTURE/database.md           |   2 +-
 docs/ARCHITECTURE/overview.md           |   2 +-
 docs/DECISIONS.md                       |   3 +
 docs/TRD.md                             |  12 +-
 package.json                            |   3 +-
 plan_setup/LOG.md                       |   6 +
 scripts/kb-eval.ts                      | 246 +++++++++++++++
 server/modules/assistant/search.test.ts | 284 +++++++++++++++++
 server/modules/assistant/search.ts      | 520 ++++++++++++++++++++++++++++++++
 server/privacy/filter.test.ts           | 396 ++++++++++++++++++++++++
 server/privacy/filter.ts                | 158 ++++++++++
 shared/privacy-rules.ts                 | 347 +++++++++++++++++++++
 tests/fixtures/kb/eval-set.json         |  46 +++
 tests/fixtures/kb/front-desk.md         |  52 ++++
 tests/fixtures/kb/infection-control.md  |  57 ++++
 tests/fixtures/kb/inventory.md          |  52 ++++
 tests/fixtures/kb/leave-and-work.md     |  55 ++++
 tests/fixtures/kb/sterilization.md      |  52 ++++
 web/src/lib/privacy.test.ts             |  53 ++++
 web/src/lib/privacy.ts                  |  57 ++++
 20 files changed, 2399 insertions(+), 4 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-02-task-01` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
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

# task_validation 인계서 — phase-01-task-06

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
- 변경 범위(기준 7bfda09~1):
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
 tests/fixtures/kb/eval-set.json         |  46 +++
 tests/fixtures/kb/front-desk.md         |  52 ++++
 tests/fixtures/kb/infection-control.md  |  57 ++++
 tests/fixtures/kb/inventory.md          |  52 ++++
 tests/fixtures/kb/leave-and-work.md     |  55 ++++
 tests/fixtures/kb/sterilization.md      |  52 ++++
 15 files changed, 1388 insertions(+), 4 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-01-task-06` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-01-task-06
status: in_progress
phase: "01"
title: "[위험 해소] 한글 문서 검색 품질 실험 (OQ-008)"
depends_on: [phase-01-task-02]
files:
  - "server/modules/assistant/search.ts"
  - "server/modules/assistant/search.test.ts"
  - "tests/fixtures/kb/**"
  - "scripts/kb-eval.ts"
acceptance_criteria:
  - "`npm run kb-eval`이 질문 20개 각각의 상위 3개 결과와 정답 포함 여부, 전체 적중률을 출력한다"
  - "적중률이 80% 이상이면 통과; 미달이면 청크 크기·가중치(제목 가중)·질의 확장을 바꿔 재측정한 기록을 LOG에 남기고 최종값과 \"근거 없음\" 판정 임계값을 TRD TD-011/Architecture §6에 반영한다"
  - "2글자 질의(\"재고\", \"연차\")와 띄어쓰기 없는 질의가 정답 문서를 찾는 단위 테스트가 있다"
  - "관련 없는 질문(예: \"주식 시세\")에서 임계값 판정이 \"찾지 못함\"이 된다"
verification: [lint, unit, task_validation]
---

# phase-01-task-06 — [위험 해소] 한글 문서 검색 품질 실험 (OQ-008)

- **관련 요구·결정**: FR-071, TD-011, OQ-008
- **설계 근거**: overview.md §3.5 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-02

## 범위
- 2-gram 변환·청크 분할·FTS5 색인·BM25 검색 함수를 순수 모듈로 구현
- 데모용 원내 매뉴얼 5종(감염관리, 멸균, 재고 관리, 연차·근무 규정, 데스크 응대) 작성 — 이후 demo seed에 재사용
- 질문 20개와 정답 문서 라벨 세트, 평가 스크립트 `npm run kb-eval`

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
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
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed
- 참고(검증자 재량): 평가 세트는 매뉴얼 작성자가 만들었다. 기준 판정과는 별도로, 네가 새로 만든 질문 5~10개로 상위 3개 적중과 '찾지 못함' 판정을 관찰해서 견고성 참고 기록으로 남겨라. 이 기록은 판정 기준을 바꾸지 않는다.

# task_validation 인계서 — phase-03-task-06

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: ec629bf
- 변경 범위(기준 be9ed4f~1):
```
harness_setup/evidence/phase-03-task-06/README.md  |  18 +
 .../screens/docs-library-1440-dark.png             | Bin 0 -> 82774 bytes
 .../screens/docs-library-1440-light.png            | Bin 0 -> 83101 bytes
 .../screens/docs-library-390-dark.png              | Bin 0 -> 30778 bytes
 .../screens/docs-library-390-light.png             | Bin 0 -> 30788 bytes
 .../screens/docs-library-detail-1440-dark.png      | Bin 0 -> 90250 bytes
 .../screens/docs-library-detail-1440-light.png     | Bin 0 -> 91024 bytes
 .../screens/docs-library-detail-390-dark.png       | Bin 0 -> 49848 bytes
 .../screens/docs-library-detail-390-light.png      | Bin 0 -> 49928 bytes
 .../screens/docs-minutes-1440-dark.png             | Bin 0 -> 125710 bytes
 .../screens/docs-minutes-1440-light.png            | Bin 0 -> 126493 bytes
 .../screens/docs-minutes-390-dark.png              | Bin 0 -> 58390 bytes
 .../screens/docs-minutes-390-light.png             | Bin 0 -> 58253 bytes
 .../screens/docs-writer-1440-dark.png              | Bin 0 -> 158174 bytes
 .../screens/docs-writer-1440-light.png             | Bin 0 -> 158850 bytes
 .../screens/docs-writer-390-dark.png               | Bin 0 -> 43039 bytes
 .../screens/docs-writer-390-light.png              | Bin 0 -> 42999 bytes
 .../screens/print-document-1440-dark.png           | Bin 0 -> 40900 bytes
 .../screens/print-document-1440-light.png          | Bin 0 -> 41367 bytes
 .../screens/print-document-390-dark.png            | Bin 0 -> 35845 bytes
 .../screens/print-document-390-light.png           | Bin 0 -> 36102 bytes
 scripts/screens/phase-03-task-01.ts                |  59 ++
 scripts/screens/phase-03-task-06.ts                |  60 ++
 scripts/screenshots.ts                             |   2 +-
 server/ai/features/doc_revise.ts                   |  28 +-
 server/ai/features/doc_writer.ts                   | 109 +++-
 server/ai/features/minutes.ts                      |  74 ++-
 server/db/migrations/020_inventory.sql             |  53 ++
 server/db/migrations/040_docs.sql                  |  30 +
 server/lib/files.ts                                | 256 ++++++++
 server/modules/docs/docs.test.ts                   | 318 ++++++++++
 server/modules/docs/routes.ts                      | 134 ++++-
 server/modules/docs/seed.ts                        | 103 +++-
 server/modules/docs/service.ts                     | 232 ++++++++
 server/modules/inventory/inventory.test.ts         | 325 +++++++++++
 server/modules/inventory/notify.ts                 |  77 +++
 server/modules/inventory/routes.ts                 | 123 +++-
 server/modules/inventory/seed.ts                   | 253 +++++++-
 server/modules/inventory/service.ts                | 647 +++++++++++++++++++++
 server/modules/inventory/settings.ts               |  28 +
 server/modules/inventory/stock.test.ts             |  86 +++
 server/modules/inventory/stock.ts                  | 125 ++++
 shared/schemas/docs.ts                             | 104 ++++
 shared/schemas/inventory.ts                        | 263 +++++++++
 tests/e2e/app-shell.spec.ts                        |   4 +-
 tests/e2e/docs-handover.spec.ts                    |  31 +
 tests/e2e/docs-helpers.ts                          |  48 ++
 tests/e2e/docs-library.spec.ts                     | 150 +++++
 tests/e2e/docs-minutes.spec.ts                     |  94 +++
 tests/e2e/docs-writer.spec.ts                      | 217 +++++++
 tests/e2e/inventory.spec.ts                        | 378 ++++++++++++
 web/src/components/DataTable.tsx                   |   4 +-
 web/src/lib/api.ts                                 |  24 +-
 web/src/pages/docs/LibraryDetailPage.tsx           | 256 +++++++-
 web/src/pages/docs/LibraryPage.tsx                 | 281 ++++++++-
 web/src/pages/docs/MinutesPage.tsx                 | 189 +++++-
 web/src/pages/docs/WriterPage.tsx                  | 261 ++++++++-
 web/src/pages/docs/docs-pages.css                  |  45 ++
 web/src/pages/docs/docsLib.test.ts                 |  74 +++
 web/src/pages/docs/docsLib.ts                      | 229 ++++++++
 web/src/pages/inventory/InventoryPage.tsx          | 204 ++++++-
 web/src/pages/inventory/ItemDetailPage.tsx         | 210 ++++++-
 web/src/pages/inventory/MovesPage.tsx              | 148 ++++-
 web/src/pages/inventory/PricesPage.tsx             | 100 +++-
 web/src/pages/inventory/QuickOutDialog.tsx         | 139 +++++
 web/src/pages/inventory/VendorsPage.tsx            | 212 ++++++-
 web/src/pages/inventory/inventory-ui.tsx           | 559 ++++++++++++++++++
 web/src/pages/print/PrintDocumentPage.tsx          |  84 ++-
 68 files changed, 7354 insertions(+), 94 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-03-task-06` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-03-task-06
status: in_progress
phase: "03"
title: "AI 문서 작성기·회의록 요약·서식 보관함·문서 인쇄"
depends_on: [phase-02-task-03]
files:
  - "server/ai/features/{doc_writer,doc_revise,minutes}.ts"
  - "server/modules/docs/**"
  - "server/db/migrations/040_docs.sql"
  - "web/src/pages/docs/{writer,minutes,library}*"
  - "web/src/pages/print/document*"
acceptance_criteria:
  - "E2E: 문서 종류 \"환자 안내문\" + 요점 입력 → 스트리밍으로 초안이 점차 표시 → 중지 버튼이 동작 → 다시 생성 → 저장 → 서식 보관함에 나타나고 버전 1"
  - "수정 후 저장하면 버전 2가 생기고 이전 버전 내용을 볼 수 있다"
  - "회의 메모 → 결정 사항·할 일(역할·기한)·요약이 분리 표시되고, 할 일 하나를 인수인계로 보내면 보드에 나타난다"
  - ".exe 파일 업로드는 415, 21MB 파일은 413과 한국어 안내"
  - "<script>가 든 본문을 저장해도 미리보기/인쇄에서 실행되지 않는다(XSS E2E)"
  - "문서 인쇄 PDF에 A4·머리말(병원명)·쪽 번호가 있다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-06 — AI 문서 작성기·회의록 요약·서식 보관함·문서 인쇄

- **관련 요구·결정**: FR-060, FR-061, FR-062, FR-063
- **설계 근거**: backend.md §3.6, §4 doc_writer/doc_revise/minutes, frontend.md MarkdownEditor/PaperPreview (docs/ARCHITECTURE/)
- **선행**: phase-02-task-03

## 범위
- 문서 종류별 프롬프트(공문 형식 포함), 스트리밍·중지, 편집기·부분 수정, 저장·버전
- 회의록 → 결정/할 일/요약 JSON, 할 일을 인수인계·공지로 보내기
- 서식 보관함(폴더·태그·검색·업로드·파일 다운로드), 업로드 검사(TD-012)
- 문서 인쇄 경로

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
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed
- 참고: 화면 태스크다. 가짜 LLM(tests/fake-llm)이나 데모로 확인하고, 실제 공급자에 닿지 않는지도 확인한다. 회의록 → 인수인계 보내기는 03-04(병합됨)와 실제로 연결된 상태로 확인한다.

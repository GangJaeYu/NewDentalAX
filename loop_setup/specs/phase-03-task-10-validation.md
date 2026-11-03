# task_validation 인계서 — phase-03-task-10

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: b7bf4ed
- 변경 범위(기준 b7bf4ed):
```

```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-03-task-10` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-03-task-10
status: failed
phase: "03"
title: "대시보드"
depends_on: [phase-03-task-01, phase-03-task-02, phase-03-task-04, phase-03-task-08, phase-03-task-09, phase-02-task-03]
files:
  - "server/modules/dashboard/**"
  - "web/src/pages/dashboard*"
acceptance_criteria:
  - "데모 데이터 기준 1440×900에서 요약 숫자 줄과 첫 줄 카드 4개가 스크롤 없이 보인다(스크린샷 확인)"
  - "각 카드 항목 클릭 시 해당 화면/항목으로 이동한다"
  - "staff 로그인 시 승인 대기·발주·지출 카드가 없다"
  - "데이터가 빈 DB에서 모든 카드가 빈 상태 안내와 바로가기를 보인다"
  - "대시보드에서 출고 기록을 3번 클릭 이하로 완료한다(E2E 클릭 수 측정)"
  - "GET /api/dashboard p95 300ms 이하(10배 데이터, phase-05 측정과 연결)"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-10 — 대시보드

- **관련 요구·결정**: FR-008, NFR-009, DESIGN §4 대시보드 순서
- **설계 근거**: backend.md §3.3 GET /dashboard (docs/ARCHITECTURE/)
- **선행**: phase-03-task-01, phase-03-task-02, phase-03-task-04, phase-03-task-08, phase-03-task-09, phase-02-task-03

## 범위
- 요약 숫자 6개 + 카드 10개(DESIGN §4), 역할별 표시
- 아직 없는 P1 데이터(근무표·지출·멸균)는 해당 태스크 완료 전까지 빈 상태로 표시하고 연결 지점 유지
- 빠른 행동(출고 기록·공지 쓰기·AI 문서), AI 빠른 요청 카드(AiPanel 소형)

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
- **포트와 프로세스(엄수)**
  - 화면 테스트·스크린샷·수동 서버는 위 슬롯 포트만 쓴다. 다른 번호(특히 18096, 18300 등)는 다른 세션이 쓰고 있을 수 있다.
  - 프로세스는 네가 띄운 자식 프로세스의 핸들로만 종료한다. PID를 보고 종료해야 한다면, 명령줄의 작업 폴더가 네 작업 사본 경로인지와 부모 프로세스가 네 것인지 먼저 확인한다. 확인할 수 없으면 종료하지 말고 보고한다(2026-11-03 사고 재발 방지).
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed
- 참고: 이 작업 사본은 커밋 b7bf4ed 기준이다(03-10 수정·05-02·성능 테스트 수정 병합 뒤 main 게이트 lint·unit 757·e2e 255 PASS). 이번은 재검증이다. 직전 검증(harness_setup/evidence/phase-03-task-10/validation-2026-11-03T0832-fail-design.md)은 768px에서 카드 행이 넘쳐 FAIL이었다. 그 항목을 포함해 모든 기준을 처음부터 다시 판정한다. 390px 넘침 판정은 scrollWidth ≤ innerWidth와 함께 innerWidth가 390으로 유지되는지도 확인한다(모바일 흉내에서는 넘치면 화면이 축소되어 innerWidth가 커진다).

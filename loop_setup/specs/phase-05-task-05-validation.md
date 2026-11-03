# task_validation 인계서 — phase-05-task-05

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: bf300d3
- 변경 범위(기준 bf300d3):
```

```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-05-task-05` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-05-task-05
status: in_progress
phase: "05"
title: "깨끗한 설치 리허설·최종 보고 준비"
depends_on: [phase-05-task-01, phase-05-task-02, phase-05-task-04]
files:
  - "plan_setup/STATE.md"
  - "plan_setup/LOG.md"
  - "PROGRESS.md"
acceptance_criteria:
  - "새 폴더에서 `cmd /c .\\start.bat` → npm ci 자동 → 서버 응답 → /setup 표시까지 성공(로그 첨부, 소요 시간 기록)"
  - "그 상태에서 전체 lint·unit·e2e 통과 수치 기록"
  - "최종 보고용 \"검증한 것 / 미검증 / 사용자 할 일\" 목록이 PROGRESS.md에 있다"
verification: [lint, unit, e2e, task_validation]
---

# phase-05-task-05 — 깨끗한 설치 리허설·최종 보고 준비

- **관련 요구·결정**: NFR-003, NFR-012, 원문 10절·14절
- **설계 근거**: TD-019 (docs/ARCHITECTURE/)
- **선행**: phase-05-task-01, phase-05-task-02, phase-05-task-04

## 범위
- git으로 추적된 파일만 새 임시 폴더에 내보내기(node_modules·data 없음) → README 순서대로 start.bat 실행 → 첫 설정 → 데모 → 주요 화면 확인
- 전체 게이트 최종 실행 수치 기록, 미검증·한계 목록 정리

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
- 참고: 이 작업 사본은 main@bf300d3 기준이다(05-05 병합 뒤 main 게이트 lint·unit 771 PASS, e2e 대상 코드는 f13e0ae의 314 PASS 이후 바뀌지 않음). 설치 리허설은 직접 다시 한다: git archive HEAD를 이 작업 사본의 .tmp/ 아래 새 폴더에 풀고, 그 폴더에서 PORT=18194 NO_BROWSER=1로 cmd /c .\start.bat을 실행해 첫 설정 화면까지 확인한 뒤 그 폴더의 stop.bat으로 끈다. PROGRESS.md의 목록은 근거 파일이 실제로 있는지 대조한다. 이 PC는 다른 검증 세션 3개가 함께 돌아 메모리가 빠듯하다. 무거운 검사는 gate.mjs 자리 제한을 따르고, 메모리 부족으로 중단되면 한 번 다시 시도한 뒤 판정 불가로 보고한다.

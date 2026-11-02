# LOG — 변경·판정 기록 (덧붙이기만 함)

## 2026-11-02 계획 작성
- **입력 문서**: IDEA, PRD v1.1, TRD v1.0, ARCHITECTURE v1.0(overview·database·backend·frontend), DESIGN(승인)
- **생성 내용**: phase 6개, 태스크 37개(P0 21개, P1 8개, 검증·문서 5개, P2 3개)
- **자동 검사**(임시 스크립트, yaml 2.6.1로 파싱)
  - 결과: 태스크 37개, PRD 요구 ID 66개 중 누락 0, 구조 오류 0
  - 검사 항목: 필수 키 존재, id와 파일명 일치, 의존 대상 존재, 순환 없음, 뒤 단계 의존 없음
- **계획 단계에서 정한 것**
  - 공유 파일 규칙(PLAN.md §3): 병렬 작업 충돌을 막으려고 권한 표, AI 기능 목록, 모듈 등록, 화면 경로, seed 등록, 마이그레이션 번호 범위를 기반 태스크가 먼저 고정한다.
  - P2의 바코드와 녹음은 http 제약(TD-017) 때문에 실시간 카메라·마이크 대신 스캐너 입력과 파일 업로드로 계획했다. PRD FR-130·132의 결과(출고, 회의록)는 그대로다.
- **제품 게이트 실행**: 없음(계획 단계)

## 2026-11-02 하네스 준비
- harness_setup/에 만든 것
  - HARNESS.md
  - quality_gates/{lint,unit,e2e,task_validation}.md
  - scripts/{preflight,gate,task-brief}.mjs
  - evidence/design-baseline(승인 시안 8장)
- 실제 실행 결과는 harness_setup/evidence/README.md에 있다.
  - preflight: 12개 항목 OK
  - Playwright + Edge: 8장 촬영, 가로 스크롤 없음
  - gate 판정 로직: 8개 경우 모두 기대대로
  - INACTIVE 판정: 확인
  - task-brief: 확인
- phase-01-task-01 수용 기준 추가: gate.mjs 세 게이트 PASS, lint 단계 출력 계약, preflight Playwright 항목 활성. 범위에 Playwright 설정 계약을 추가했다.
- CLAUDE.md(에이전트용 문서 포인터)를 만들었다.
- 제품 게이트 실행: 없음(제품 코드 없음, 미활성 = 통과 아님)

## 2026-11-02 루프 준비
- 로컬 git 저장소를 만들었다(main). 첫 커밋 d6bbc52(문서), 3149871(.gitattributes). push는 없다.
- Orca 실행 경로 시험(Run run_de4176c8b3c0)
  - 워커 ①(current, 읽기 전용, claude-opus-5-5): 성공. 대화를 물려받지 않았다.
  - 워커 ②(new-child 작업 사본에서 쓰기): 성공. 커밋 b37a746이 그 브랜치에만 있고 main은 바뀌지 않았다.
  - 정리: worker-release, orca worktree rm, git branch -D로 완료했다.
- 발견: Orca 작업 사본이 C:\Users\main\orca\workspaces\ 아래(이 폴더 밖)에 만들어진다. 원문 "이 폴더 밖 수정 금지"와 겹쳐서 시작 전에 사용자에게 확인한다.
- 바꾼 것
  - preflight 포트 범위를 18090~18097로 넓혔다(재실행해서 전부 OK).
  - .gitignore에 .tmp/를 추가했다.
  - loop_setup/LOOP.md를 작성했다.

## 2026-11-02 19:18~ phase-01-task-01 통합
- **워커**: ctx_7e1ae0c73bdc, worker_done(outcome=succeeded), 커밋 1d06619·625ad4d. 워커 쪽 게이트: lint PASS, unit 23건, e2e 3건.
- **main 병합**: 1b905f1(--no-ff). main에서 `npm ci` 후 게이트를 다시 실행했다.
  - lint PASS: tsc-server 18, tsc-web 1, eslint 24, headers 24
  - unit PASS: 23건
  - e2e PASS: 3건(E2E_PORT 18094)
- **워커 변경 요청 반영**: `cmd /c start.bat` → `cmd /c .\start.bat`(TRD TD-019, HARNESS, 01-01·05-05 기준 문구). 실행 방법만 정정한 것이고 기준을 완화하지 않았다. YAML 이스케이프도 확인했다(계획 구조 검사 통과).
- **결정 반영**: 워커 결정 7건을 DECISIONS.md에 옮겼다.
- **다음**: task_validation 검증 워커(새 작업 사본, 병합 커밋 기준)

## 2026-11-02 19:30 phase-01-task-01 task_validation 시도 1 → FAIL
- 검증 워커 ctx_641dd1b22d58(대상 de2e72a). AC1·2·4·5·6·7은 PASS, AC3은 FAIL.
- AC3 결함: 새 콘솔(코드 페이지 949)에서 start.bat을 실행하면 첫 줄에 `'��료되면' is not recognized...`가 나온다. chcp 65001 뒤의 한국어 rem 줄을 cmd가 잘못된 위치에서 읽는다(2회 재현).
- 증거: harness_setup/evidence/phase-01-task-01/validation-2026-11-02T1930-fail.md
- 분류: 코드 결함. status=failed로 바꾸고 수정 워커를 배정한다(시도 2). 수정 뒤에는 다른 검증 워커가 lint부터 다시 판정한다.
- 19:35 phase-01-task-02 구현을 먼저 시작했다(슬롯 1). 01-01의 FAIL 범위(start.bat)와 01-02의 파일이 겹치지 않아서다. 01-02의 completed 판정은 01-01이 completed가 된 뒤에만 한다.

## 2026-11-02 19:42 phase-01-task-01 시도 2 통합
- 수정 워커 ctx_cea84a1662b8, 커밋 357c902
- start.bat·stop.bat을 ASCII 래퍼로 바꾸고, 한국어 로직은 새 cmd에서 실행되는 scripts/windows/*.cmd로 옮겼다.
- 새 콘솔(949) 재현 vitest를 추가했다. 수정 전 코드에서 실패하는 것도 워커가 확인했다.
- main 병합 후 게이트: lint PASS(19/1/25/27), unit 26건, e2e 3건
- DECISIONS·overview 폴더 지도 반영
- 다음: 새 검증 워커(시도 2 검증, 이전 검증자와 다른 세션)

## 2026-11-02 19:45 phase-01-task-02 통합과 병렬 배정
- 01-02 워커 ctx_e72706fe9123, 커밋 42682d9. main 병합 cd40371.
- main 게이트: lint PASS(46/2/52/55), unit 68건, e2e 3건
- DECISIONS에 5건을 옮겼다.
- 배정
  - 01-02 검증 워커(검증 슬롯 1)
  - 01-03(슬롯 2), 01-06(슬롯 3), 02-01(슬롯 0) 구현 워커
- 01-02가 아직 검증 전이므로 세 작업 모두 completed 판정은 선행이 completed가 된 뒤에만 한다. 파일 소유는 서로 겹치지 않는다(지시문에 명시).

## 2026-11-02 19:53 phase-01-task-02 task_validation → PASS(4/4)
- 검증 워커 ctx_18e1112307d1(대상 6f6c3f5, 제품 코드는 cd40371과 같음). 게이트: lint PASS, unit 68건, e2e 3건. AC1~4 모두 PASS.
  - AC1: 실제 서버를 두 번 시작해 확인
  - AC2: 실제 app.db 사본에서 UPDATE·DELETE가 막히는 것을 확인
  - AC3: 변조 사본으로 금지 열을 넣었을 때 FAIL을 재현
  - AC4: 날짜 계산 10건을 독립적으로 확인
- 증거: harness_setup/evidence/phase-01-task-02/validation-2026-11-02T1953-pass.md
- 상태: 선행 01-01이 아직 재검증 중이라 completed는 보류한다(검증 PASS 기록만 남김).
- 참고: npm ci가 moderate 취약점을 보고했다. high/critical 0 기준은 05-02에서 점검한다.

## 2026-11-02 20:00 phase-01-task-01 task_validation 시도 2 → FAIL(AC4)
- 검증 워커 ctx_48337e443893(대상 87ba834)
  - AC1·2·3·5·6·7 PASS. AC3(새 콘솔 949에서 start.bat 첫 줄 오류)은 해결됐다.
  - AC4 FAIL: 다른 프로그램이 `[::]:PORT`를 점유하면 서버가 0.0.0.0으로 따로 열리고 충돌을 감지하지 못한다. 안내한 localhost는 다른 프로그램으로 간다.
- 증거: harness_setup/evidence/phase-01-task-01/validation-2026-11-02T2000-fail2.md
- 조치
  - 시도 3 수정 워커: listen host를 '::'(이중 스택)로 바꾼다.
  - 01-03 워커에게 IPv4-mapped 주소 판별을 요청했다(send msg_61a2c49b1a56).
- 누적 재시도: 01-01은 2회. 실패 원인이 서로 다르므로(코드 페이지 / IPv6 점유) 같은 방식의 반복이 아니다.

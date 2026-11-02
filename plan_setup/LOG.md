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

## 2026-11-02 20:10 02-01·01-06 통합
- 02-01 커밋 e70f525: 필터 테스트 134건. 01-06 커밋 aa6ffb2: kb-eval 적중률 20/20, 기준값 0.4, `--sweep` 13개 설정 비교.
- main 병합 후 게이트: lint PASS(52/5/60/63), unit 227건, e2e 3건
- 문서 반영: TRD TD-011 실험 결과, database.md kb_fts 3열, overview §6 기준값, DECISIONS 3건
- 다음: 두 태스크의 검증 워커(검증 슬롯 2·3). 둘 다 선행 01-02 검증은 PASS이고, 01-02의 completed는 01-01을 기다린다. 그래서 두 태스크의 completed도 01-02 completed 이후에만 한다.

## 2026-11-02 20:15 01-03 통합과 다음 배정
- 01-03 커밋 c189ad9. main 병합 후 게이트: lint PASS(84/8/92/95), unit 266건, e2e 8건
- PRD FR-001 AC2의 API 거부 코드 표기를 403에서 409 SETUP_DONE으로 정정했다. 설계 계약에 맞춘 것이고 결과(거부)는 같다. DECISIONS에 6건을 옮겼다.
- 배정
  - 01-03 검증(검증 슬롯 0)
  - 01-04 구현(슬롯 0)
  - 02-02 구현(슬롯 2)
- 02-04(알림)는 web/src/layout이 01-04와 겹쳐서, 01-04 병합 뒤로 미뤘다.
- 메모리 여유는 14.5GB다.

## 2026-11-02 20:07 phase-01-task-06 task_validation → PASS(4/4)
- 검증 워커 ctx_3db61f21b801(대상 97df047). 게이트: lint PASS, unit 227건, e2e 3건(회귀 확인)
- 견고성 참고: 검증자가 새로 만든 관련 질문 13개 중 상위 3개 적중이 12/13이었다. 판정과는 무관하다.
- 증거: harness_setup/evidence/phase-01-task-06/
- completed는 선행 01-02가 completed가 된 뒤에 처리한다(체인: 01-01 → 01-02).

## 2026-11-02 20:08 phase-02-task-01 task_validation → PASS(4/4)
- 검증 워커 ctx_64d40da03f5a(대상 97df047). 게이트: lint PASS, unit 227건, e2e 3건
- 독립 예시 실행과 수동 서버 health도 확인했다.
- 증거: harness_setup/evidence/phase-02-task-01/
- completed 판정은 01-02가 completed가 된 뒤에 한다.
- 하네스 관찰(판정 영향 없음): e2e 로그 끝, 테스트 통과 뒤에 "[WebServer] 포트 18096 사용 중"이 찍힌다. e2e-server가 서버를 두 번 띄우는 것으로 보인다.
  - 기록: STATE "하네스 점검" 항목
  - 처리: 01-04 병합 뒤 harness-update 범위에서 원인을 조사한다.

## 2026-11-02 20:11 phase-01-task-03 task_validation → PASS(8/8)
- 검증 워커 ctx_5478f9653b7a(대상 b0433da). 게이트: lint PASS, unit 266건, e2e 8건
- 확인 방법: 실제 서버를 TEST_NOW를 바꿔 가며 다시 시작하는 방식과 inject 방식을 함께 썼다. 비밀번호 평문 검사는 DB·WAL·로그를 모두 검색했다.
- 참고(기준 밖)
  - 로그아웃 때 지우는 쿠키가 SameSite=Lax로 나간다. 발급할 때는 Strict다. 다음 auth를 건드리는 태스크(01-05)에서 맞춘다.
  - admin의 GET /api/audit는 아직 404다. 01-05 범위다.
- 증거: harness_setup/evidence/phase-01-task-03/
- completed는 01-02가 completed가 된 뒤에 한다.

## 2026-11-02 20:16 phase-01-task-01 시도 3 통합
- 수정 워커 ctx_53a7fb87dbbf, 커밋 0c307a9
- 수정 내용: listen 전에 5개 주소에서 포트 사용 여부를 먼저 확인하고, 기본 host를 '::'로 바꿨다.
  - Windows는 주소가 정확히 같을 때만 충돌을 감지한다. 그래서 권장안('::'만 쓰기)으로는 부족하다는 것을 워커가 실험으로 확인했다.
- 병합: server/main.ts에서 충돌 1건이 났다. 사전 확인 코드와 01-03의 allowExternal 인자를 함께 살려서 해결했다.
- main 게이트: lint PASS, unit 276건, e2e 8건
- TRD TD-007의 listen 문구를 고치고, DECISIONS에 기록했다.
- 다음: 3차 검증 워커(검증 슬롯 1, 이전 두 검증자와 다른 세션)

## 2026-11-02 20:22 phase-01-task-01 task_validation 시도 3 → FAIL(AC4, IPv6 전용 점유)
- 검증 워커 ctx_c5b44e3f8f11(대상 cba48c7). AC1·2·3·5·6·7 PASS. AC4는 [::] 이중 스택·0.0.0.0·127.0.0.1 점유는 감지했지만, [::] IPv6 전용 점유(.NET TcpListener IPv6Any 등)는 놓쳤다.
- 증거: harness_setup/evidence/phase-01-task-01/validation-2026-11-02T2022-fail3.md
- **심층 분석과 전략 전환**: AC4 포트 충돌로 2회 연속 실패했다(시도 2·3). 두 번 모두 "listen 전 주소별 미리 열기"를 늘리는 같은 계열이었다. Windows 소켓 규칙(정확한 주소 일치에서만 충돌, 이중 스택/IPv6 전용 공존) 때문에 이 방식으로는 경우를 다 덮을 수 없다는 가설을 세웠다.
  - 새 전략: listen 뒤 "자기 확인"이다. 서버가 켤 때마다 만든 표식(nonce)을 안내할 모든 주소로 직접 요청해서 대조하고, 다르거나 응답이 없으면 충돌로 판정한다.
  - 관찰 방법: 점유 5가지 경우((a)~(e))를 vitest로 자동화한다.
- 누적 재시도: 01-01은 3회 실패했다(AC3 1회, AC4 2회). 시도 4는 새 전략이다.

## 2026-11-02 20:32 phase-02-task-02 통합
- 워커 ctx_5410ef89381a, 커밋 6c1fd1e. 이 태스크 테스트 52건.
- main 병합 후 게이트: lint PASS(122/9/130/134), unit 328건, e2e 8건
- 문서 반영
  - backend.md: /ai/settings 본문 이름 정리, /ai/status 추가
  - TRD TD-009: OpenAI Responses API
  - DECISIONS 7건
- OQ-009의 형식 확인 부분을 해소했다. 데이터 정책은 05-04에서 확인한다.
- 하네스 문제 기록: e2e 공용 서버에서 계정이 잠기는 문제. STATE "하네스 점검"에 올렸다.

## 2026-11-02 20:37 02-02 검증 PASS(8/8), 01-01 시도 4 통합
- 02-02 검증 워커 ctx_822c541c2daf: 8/8 PASS(실제 서버와 가짜 공급자 3종으로 형식·비용·오류·예산·개인정보·키 노출·권한·SSE를 확인). 증거: evidence/phase-02-task-02/. completed는 01-02 이후다(선행 02-01이 01-02를 기다림).
- 01-01 시도 4(ctx_398bc053b3b6, e51c8e1)
  - 자기 확인 방식으로 바꿨다. 점유 7경우 vitest + 수동 확인
  - 병합 충돌: app.ts AppDeps 1건(02-02 ai 필드 + instanceId 필드를 모두 살림)
  - main 게이트: lint PASS, unit 342건, e2e 8건
- DECISIONS·TRD 반영. 다음: 01-01 4차 검증(이전 검증자들과 다른 세션)

## 2026-11-02 20:41 phase-01-task-04 통합 → main e2e FAIL(통합 실패)
- 01-04 워커 ctx_64fb05731874, 커밋 fe08046. 워커 쪽 게이트는 lint·unit 295·e2e 15 PASS였다. e2e 격리 fixture를 도입했다.
- main 병합(cadb5d6, 충돌 없음) 뒤 게이트: lint PASS, unit 371 PASS, **e2e FAIL**(11 passed, 1 failed, 3 not run)
  - AC4 axe 테스트에서 로그인 뒤 /inventory 스텁이 "화면 불러오는 중"에 머문다. 단독으로 다시 돌려도 재현된다.
  - 워커 브랜치(02-02 이전 기준)에서는 통과했으므로 통합 결함으로 분류한다.
- 조치: 통합 수정 워커(슬롯 0)를 배정했다. 01-04 검증은 수정 뒤에 한다.

## 2026-11-02 20:46 phase-02-task-04 구현 보고(서버 우선)
- 워커 ctx_bc71f40fc2cc, 커밋 1fbbd2b(브랜치는 01-04 이전 기준). 워커 쪽 게이트: lint PASS, unit 355건, e2e 11건
- 남은 일
  - 상단바 종·/notifications 라우트 연결
  - 새 e2e fixture로 spec 이전
  - 화면 e2e와 스크린샷
- 순서: main의 01-04 통합 실패를 먼저 고친다. 그 뒤 같은 워커에게 follow-up(send)으로 main을 반영하고 연결하게 한다. 01-05·02-05도 통합 수정 뒤에 배정한다.

## 2026-11-02 20:53 phase-01-task-01 task_validation 시도 4 → PASS(7/7). completed 일괄 판정
- 01-01 4차 검증 워커 ctx_2668d923dfe2(대상 b23bb51)
  - 7/7 PASS
  - 점유 7가지 확인: (a)~(e)에 더해 원내 IP 단독, SO_REUSEADDR 경우. 미리 확인을 켠 경우와 끈 경우 모두 확인
  - 증거: evidence/phase-01-task-01/validation-2026-11-02T2053-pass4.md
- **completed 처리**: 01-01, 01-02, 01-03, 01-06, 02-01, 02-02
  - 근거: 각 태스크의 독립 검증 PASS 원문(evidence/<ID>/)이 있다.
  - 근거: 선행 체인 01-01 → 01-02 → (01-03, 01-06, 02-01 → 02-02)이 모두 PASS다.
  - **유효성 재확인**: 검증 뒤에 병합이 이어졌으므로 현재 main(cadb5d6) 기준으로 다시 봤다.
    - unit 371건 전부 PASS(이 태스크들의 단위 테스트 포함)
    - e2e: 01-01·01-03 spec(smoke·auth-api) 8건 PASS
    - 유일한 e2e 실패는 01-04 app-shell spec(통합 수정 중)이고, 위 태스크들의 범위와 무관하다.
- 누적: 01-01은 시도 4로 완료(검증 FAIL 3회: AC3 1회, AC4 2회).

## 2026-11-02 20:58 01-04 통합 수정 병합, 다음 배정
- 통합 수정 워커 ctx_880d57f10e6f, 커밋 682ec2b
  - 원인: PC 부하로 axe 1회가 2.6~5.3초 걸려 테스트 하나에 몰린 10회가 30초 제한을 넘었다. 화면·서버 결함이 아니다(trace에서 청크·API 모두 200).
  - 조치: 검사 기준은 그대로 두고 테스트를 6개로 나눴다(시간 제한은 늘리지 않음).
- main 게이트: lint PASS, unit 371건, e2e 20건
- 배정
  - 01-04 검증(검증 슬롯 0)
  - 01-05 구현(슬롯 0), 02-05 구현(슬롯 1), 02-03 구현(슬롯 2)
  - 02-04 연결 follow-up(send, 슬롯 3)
- 충돌 예상: server/modules/admin/routes.ts(01-05·02-05 등록 줄). 조정자가 해결한다.

## 2026-11-02 21:06 phase-01-task-04 task_validation → PASS(6/6) → completed
- 검증 워커 ctx_cbeea8c2fbb6(대상 31b5678, 코드는 1b8aa5e와 같음). 게이트: lint PASS, unit 371건, e2e 20건
- 확인 내용
  - 스크린샷 32장을 기준선과 대조
  - axe 18회 모두 위반 0
  - 키보드만으로 로그인 가능, 포커스 표시 #0c7c76
  - 인터넷 차단 상태에서 Pretendard 렌더 확인(글자 폭 측정)
  - 연결 끊김 띠 표시 확인
- 증거: evidence/phase-01-task-04/
- 선행 01-03이 completed라서 01-04를 completed로 바꿨다.
- npm audit
  - --omit=dev: moderate 3건(minimatch 등), high/critical 0
  - 전체: moderate 16건
  - NFR-002 AC6(high/critical 0)은 지금 충족한다. 05-02에서 다시 점검한다.

## 2026-11-02 21:12 phase-02-task-04 통합
- 같은 워커의 follow-up(ctx_f8574d0415d4), 커밋 278ca71
  - 종 팝오버와 /notifications 화면을 연결하고 e2e를 fixture로 옮겼다.
  - AC3: page.clock으로 실제 30초 폴링을 확인했다.
- main 병합 후 게이트: lint PASS, unit 399건, e2e 27건
- DECISIONS 5건(01-04·02-04 결정)을 옮겼다.
- 다음: 02-04 검증(검증 슬롯 3)

## 2026-11-02 21:21 phase-02-task-04 task_validation → PASS(4/4) → completed
- 검증 워커 ctx_463ec6ac5289(대상 2cc9068 = 제품 cba8533). 게이트: lint PASS, unit 399건, e2e 27건
- 확인 내용
  - AC3: 시계를 빨리 감지 않고 실제 시간으로 확인했다. 28.7초 만에 배지가 2가 됐고, 폴링 간격은 30.005초였다.
  - 스크린샷 16장을 대조했다.
- 선행 01-03이 completed라서 02-04를 completed로 바꿨다.

## 2026-11-02 21:25 02-03·01-05 통합, 사고 기록
- 02-03 커밋 efe0693(워커 ctx_639308e3eaea). 01-05 커밋 a570f28(워커 ctx_2851fc797d8f).
- 병합 충돌: scripts/screenshots.ts PAGES가 2회 충돌해서 양쪽 항목을 모두 살렸다.
- main 게이트: lint PASS(143/105/246/255), unit 422건, e2e 53건
- **사고(정직 보고)**: 02-03 워커가 처음 e2e를 돌릴 때 가짜 공급자 주소가 테스트 서버에 전달되지 않았다. 그래서 가짜 키(sk-ant-e2e-ONLYFAKE…)를 단 요청 2건이 실제 api.anthropic.com으로 나갔다.
  - 결과: 둘 다 401로 끝났다. 실제 키는 쓰지 않았고 비용도 없다.
  - 합의 위반 여부: "실제 LLM API 유료 호출 금지"를 어기지는 않았다(유료 호출 아님). 다만 외부 공급자로 요청이 나간 것은 의도하지 않은 일이다.
  - 재발 방지
    - scripts/e2e-server.ts가 AI_BASE_URL_*가 없으면 http://127.0.0.1:9(닫힌 주소)를 쓴다.
    - fixture extraEnv를 추가했다.
    - 이후 e2e는 가짜 서버가 받은 요청 수로 확인한다.
    - 최종 보고에 명시한다.
- 변경 요청(01-05) 처리
  - api.page()(total 받기)와 DataTable 가로 스크롤 영역 포커스(axe scrollable-region-focusable)는 03-01에 맡긴다(DataTable을 가장 많이 쓰는 태스크).
  - 상단바 DemoBadge의 "AI 키 미설정" 연결(02-03 요청)은 조정자가 03-10 전에 반영한다(STATE 점검 항목).

## 2026-11-02 21:35 02-05 병합 → main unit FAIL 2건(통합)
- 02-05 커밋 fcbfd61(워커 ctx_4b13f5013150). 병합 충돌 3파일을 조정자가 해결했다.
  - main.ts: 백업 타이머와 scheduler를 둘 다 쓰고, scheduler에는 app.db(교체되는 래퍼)를 넘긴다.
  - admin/routes.ts: 5개를 등록한다.
  - screenshots.ts
- main 게이트: lint PASS, **unit FAIL 2건**(backup-job AC3, backup 503 범위), e2e 63건 PASS
  - 두 파일만 따로 돌리면 18건 PASS → 전체 실행 때 간섭이나 시간 의존으로 보인다.
- 조치: 같은 워커에게 follow-up을 보냈다(원인 수정, 전체 unit 3회 연속 PASS 확인).
- 02-03·01-05 검증은 02-05 병합 전 커밋 ddd48a0를 기준으로 진행한다(그 커밋은 main 게이트 PASS).
- 21:40 조정자가 DemoBadge AI 상태 연결을 main에서 직접 시도했다(TopBar). e2e에서 app-shell AC6와 backup-reset AC5·AC6이 깨져서 커밋하지 않고 되돌렸다(검사를 약하게 만들지 않음). 03-10에 테스트 기대값과 함께 맡긴다.

## 2026-11-02 21:41 phase-02-task-03 task_validation → PASS(5/5) → completed
- 검증 워커 ctx_290ebf99aa13(대상 ddd48a0, 02-05 병합 전). 게이트: lint PASS, unit 422건, e2e 53건
- 독립 실행으로 확인한 것
  - 단가를 바꾸면 비용이 0.91원에서 156원으로 바뀐다.
  - 예산 초과 안내가 나온다.
  - 실제 공급자에는 닿지 않는다(가짜 서버만 3건 수신).
- 02-05 병합 뒤 main(c40830b)에서 e2e 63건 PASS를 확인했다. 그 안에 02-03 spec이 들어 있다.
- 선행 02-02·01-04가 completed라서 02-03을 completed로 바꿨다.

## 2026-11-02 21:42 phase-01-task-05 task_validation → PASS(6/6) → completed. phase-01 완료
- 검증 워커 ctx_967fb158d74d(대상 ddd48a0). 게이트: lint PASS, unit 422건, e2e 53건
- 수동 서버와 Edge로 6개 기준과 화면을 확인했다.
- 02-05 병합 뒤 main(c40830b) e2e 63건 PASS(01-05 spec 포함)
- 선행 01-04가 completed라서 01-05를 completed로 바꿨다.
- **phase-01 묶음 판정**: 6/6 태스크 completed
  - 묶음 기준 1 "첫 설정 → 셸": 01-04 검증 AC1에서 확인
  - 묶음 기준 2 "역할별 메뉴·403": 01-03 AC8, 01-04 AC3에서 확인
  - 묶음 기준 3 "게이트 실제 실행": 매 통합 때 확인
  - 결과: phase-01 완료
- 21:45 phase-03 시작: 03-01 재고(슬롯 0), 03-04 데스크(슬롯 2), 03-06 문서(슬롯 3)
  - main unit의 알려진 실패 2건(02-05 수정 중)을 지시문에 명시했다.
  - 03-06의 인수인계 보내기 e2e는 03-04 병합 뒤에 통합 검증한다.

## 2026-11-02 21:53 02-05 간헐 실패 수정 통합
- follow-up 워커 ctx_2fd228c5536a, 커밋 09f0b57
- 원인: 백업 폴더 rename이 Windows 파일 잠김(백신·색인 등)으로 EPERM이 난다. 부하에 따른 간헐 실패다. 테스트 간 간섭이 아니라 실제 운영 결함이었다.
- 수정
  - rename을 없애고 manifest를 마지막에 쓴다.
  - 잠김에는 재시도한다.
  - 정각 백업을 scheduler로 옮겼다.
- 회귀 테스트: "백신 흉내" 감시 프로세스를 두면 수정 전에는 결정적으로 FAIL, 수정 후에는 PASS다.
- 워커가 전체 unit 452건 3회 연속 PASS를 확인했다.
- main 게이트: lint PASS, unit 452건, e2e 63건
- DECISIONS 4건을 옮겼다.
- 다음: 02-05 검증(검증 슬롯 1). phase-03 워커 3명에게 main 수정 사실을 알린다.

## 2026-11-02 22:08 phase-02-task-05 task_validation → AC1~6 PASS, 화면 행 FAIL(하네스 결함)
- 검증 워커 ctx_84058217a092(대상 e43d882)
  - AC1~6은 실서버·DB·zip을 직접 관찰해서 PASS였다. unit 452건 3회 연속 PASS(간헐 실패 없음), e2e 63건 PASS.
  - 화면 행 FAIL: `npm run screenshots`가 admin-reset에서 결정적으로 시간 초과됐다.
    - 원인: 02-04의 seedNotifications가 업무 데이터를 넣어서 화면이 "업무 데이터 있음"이 되는데, 02-05는 준비 글자로 "비어 있음"을 기다렸다(통합 결함).
    - 검증자가 직접 찍은 화면 24장은 기준선과 일치했다.
- 조정자 수정: scripts/screenshots.ts admin-reset의 준비 글자를 "지금 상태"(공통 카드 제목)로 바꿨다(하네스 파일, 제품 코드 변경 없음).
  - 확인: `npm run screenshots` 전체 exit 0, 104장 OK. lint PASS
- **02-05는 아직 completed 아님**: 조정자가 직접 고쳤으므로 화면 행은 다른 검증자가 다시 판정한다. 다음 검증 묶음(03-xx 검증 워커)에 "02-05 화면 행 재판정"을 넣는다.
- 증거: evidence/phase-02-task-05/validation-2026-11-02T2208-fail-screens.md

## 2026-11-02 22:27 03-04 PASS, 02-05 화면 행 PASS → 03-04·02-05 completed. phase-02 완료
- 검증 워커 ctx_5e5866b8affc(대상 167bf96)
  - 03-04: AC1~5와 화면 모두 PASS(수동 서버 관찰, 다음 날 재시작 관찰 포함)
  - 02-05 화면 행: 조정자가 고친 스크린샷 스크립트로 16장 성공, 기준선 대조 PASS
- 증거
  - evidence/phase-03-task-04/
  - evidence/phase-02-task-05/validation-2026-11-02T2227-screens-pass.md
- completed: 03-04(선행 01-05·02-04 completed), 02-05(선행 01-02·01-04 completed)
- **phase-02 묶음 판정**: 5/5 completed. 묶음 기준을 모두 충족했다.
  - 데모 AI 기록과 가짜 공급자 3종: 02-02 검증
  - 필터 50개 이상: 02-01
  - 백업·복원·보관: 02-05
- 개선 후보(05-03): 768·390px에서 표가 카드 안에서 가로로 스크롤되어 오른쪽 열이 처음에 가려진다. 허용된 공통 패턴이다.

## 2026-11-02 22:35 03-06·03-01 통합, 03-07·03-02 배정
- 03-06 커밋 aa5feec(워커 ctx_317565207ae1). 03-01 커밋 df58f4c(워커 ctx_95780d0bc401). 둘 다 충돌 없이 병합했다.
- main 게이트(두 태스크 병합 뒤): lint PASS(183/114/291/306), unit 506건, e2e 115건
- DECISIONS에 5건을 옮겼다. 변경 요청 처리
  - api.page·DataTable 접근성: 03-01이 반영했다.
  - AiPanel .ai-out tabIndex와 JSON 결과 표시 옵션: 03-05에 맡긴다.
  - screenshots.ts가 action에 DATA_DIR을 넘기는 개선: 하네스 점검 항목에 올렸다.
- 배정
  - 검증: 03-06(검증 슬롯 3), 03-01(검증 슬롯 0)
  - 구현: 03-07(슬롯 0), 03-02(슬롯 3). 03-08·03-09는 구현 중이다.

## 2026-11-02 22:56 03-01 PASS → completed. 03-09 통합. 포트 경쟁 수정
- 03-01 검증 워커 ctx_9505b74cef59(대상 4341237): 7/7 PASS
  - 화면 조작으로 출고, 초과 확인 대화상자, FEFO D-12 → D-48, ▲6%, 사용 안 함, 알림 중복 없음을 확인했다.
  - 증거: evidence/phase-03-task-01/
- 03-01 completed(선행 01-05·02-04 completed)
- 03-09 커밋 17657a9(워커 ctx_3f41fd045418)를 충돌 없이 병합했다.
- 포트 경쟁 수정(조정자): server/db/migrate.test.ts에 PortRaceError 재시도(최대 3회)를 넣었다.
  - 원인: freePort와 spawn 사이에 다른 프로세스가 포트를 잡는다(03-09 보고).
  - main.test·batch-scripts.test는 포트 충돌 자체를 시험하므로 그대로 둔다.
- main 게이트: lint PASS(190/116/299/316), unit 519건, e2e 121건
- 22:58 03-08 커밋 f1cec58(워커 ctx_f19eddabd894)를 충돌 없이 병합했다. main 게이트: lint PASS, unit 532건, e2e 126건
  - 03-08이 02-05 demo.test.ts를 고쳤다(050 마이그레이션의 실제 legal_tasks와 충돌. 같은 의도로 바꿈).
- 배정
  - 검증: 03-09(검증 슬롯 0), 03-08(검증 슬롯 1)
  - 구현: 03-05(슬롯 1, AiPanel 보완 포함), 03-03(슬롯 2)

## 2026-11-02 23:05 03-06 PASS(6/6) → completed
- 검증 워커 ctx_14fc113743a6(대상 4341237)
  - 직접 띄운 서버와 가짜 LLM으로 스트리밍·중지·버전·인수인계 보내기·업로드 거부·XSS·A4 PDF(3쪽 머리말·쪽 번호)를 확인했다.
  - 증거: evidence/phase-03-task-06/
- 03-06 completed(선행 02-03 completed)
- 개선 후보(판정 영향 없음)
  - 스트리밍 첫 글자 표시가 늦다. 가짜 서버 첫 조각은 2.1초인데 화면 첫 표시는 6.6초이고, 끝 조각이 한꺼번에 붙는다. 서버 응답 가림 보류(48자)나 압축·버퍼링이 의심된다.
    - 처리: STATE 개선 항목에 올렸다. 03-07(같은 스트림 사용) 또는 05-03에서 원인을 조사한다.
  - 데모 회의록의 괄호 없는 형식은 담당·기한이 분리되지 않는다(데모 한정).
  - PDF 텍스트 추출에서 일부 숫자 글리프가 빠진다(화면은 정상).

## 2026-11-02 23:15 03-07 통합 → e2e axe 1건 FAIL → 조정자 수정
- 03-07 커밋 ac0d7f5(워커 ctx_8782521d469d)를 충돌 없이 병합했다. lint PASS, unit 552건
- e2e: assistant.spec의 dark axe에서 `color-contrast: .dot`(알림 배지) 1건이 FAIL이었다.
  - 원인: 다크 --danger #EE7D74 위의 흰 글자(대비 약 2.7). 02-04의 배지 결함이 읽지 않은 알림이 있는 상태에서 처음 드러났다.
- 수정(조정자): --on-danger 토큰을 추가(라이트 #FFF, 다크 #2A0D0B)하고 배지·오류 토스트에 적용했다. DESIGN.md 토큰표·DECISIONS에 기록했다.
- 수정 뒤 main 게이트: lint PASS, e2e 145건 PASS
- 조정자가 바꾼 제품 코드는 03-07 검증 워커가 화면 대조에서 함께 판정한다.
- 스트리밍 지연 원인 후보(03-07 보고): gateway StreamRedactor.HOLD=48과 경계 출력 방식. 원내 도우미는 스트림을 쓰지 않는다. STATE 개선 항목을 유지한다.

## 2026-11-02 23:30 03-09·03-08 PASS → completed. 03-02 통합
- 03-09 검증 워커 ctx_98c317902593: 4/4 PASS(API와 Edge 화면, 경고 승인, 403)
- 03-08 검증 워커 ctx_dbf67633af52: 5/5 PASS
- 증거: evidence/phase-03-task-09/, evidence/phase-03-task-08/
- completed: 03-09(선행 01-05·02-04), 03-08(선행 01-05·02-04)
- 03-02 커밋 2bf6aed(워커 ctx_b4daec176a0d)를 충돌 없이 병합했다. main 게이트: lint PASS, unit 567건, e2e 151건
- 배정
  - 03-02 검증(검증 슬롯 0)
  - phase-04 시작: 04-01 근무표(슬롯 0, 선행 03-09 completed), 04-06 광고 점검(슬롯 3, 선행 02-03 completed)
- 23:45 03-03 커밋 4ca95bf(워커 ctx_03f6e7d3f4cb) 병합
  - 충돌: inventory/routes.ts import 1건(orders·csv 둘 다 살림)
  - 같은 병합 커밋 e76708e에 03-03 변경 요청 2건을 조정자가 반영했다.
    - 재고 화면 "CSV 가져오기·내보내기" 진입 버튼(실장 이상)
    - .filedrop position:relative
  - main 게이트: lint PASS, unit 578건, e2e 159건
  - 03-03 검증(검증 슬롯 1)에서 조정자 반영분도 함께 판정한다.

## 2026-11-03 00:20 03-07 completed, 03-05 통합, e2e 환경 문제 대응
- 03-07 검증 워커 ctx_32282a612e93: 6/6과 화면, 조정자의 --on-danger 수정까지 PASS → completed(선행 01-06·03-06)
- 04-01 워커 질문(대시보드 오늘 근무 카드)에 DashboardPage.tsx 최소 수정을 허용했다(03-10 시작 전이라 충돌 없음).
- 03-05 커밋 c6d402d(워커 ctx_e63db788a188)를 충돌 없이 병합했다. lint PASS, unit 593건
- e2e 실패 2회(환경)
  - 1회차: docs-library AC4에서 콘솔 `net::ERR_NO_BUFFER_SPACE`가 났다. 단독 실행은 18건 PASS였다.
  - 2회차: app-shell AC4에서 `ERR_CONNECTION_REFUSED`가 났다.
  - 원인 분류: 환경(자원·포트)
    - 워커 7개가 동시에 e2e·Edge를 돌렸다(Edge 프로세스 27개, TIME_WAIT 약 1000).
    - 조정자 통합 포트 18096이 검증 슬롯 2의 기준값과 같았다.
  - 조치(새 전략, 검사 약화 없음)
    - gate.mjs에 PC 전체 e2e 동시 2개 제한(자리 표시 파일)을 넣었다.
    - 조정자 통합 포트를 18300으로 바꿨다(LOOP §4).
  - 재확인: E2E_PORT=18300으로 e2e 170건 PASS

## 2026-11-03 00:22 03-02·03-03 PASS → completed. 검증자 사고 기록
- 03-02 검증 워커 ctx_1d79fba108e3: AC1~4와 DESIGN PASS
- 03-03 검증 워커 ctx_5574a4171c3a: AC1~4, 조정자 반영 2건, 화면 모두 PASS
- completed: 03-02, 03-03(둘 다 선행 03-01 completed)
- **사고(정직 보고)**: 03-03 검증자가 지시된 슬롯 포트(18095) 대신 18096으로 스크린샷을 돌렸다. 그 뒤 18096에서 기다리던 e2e-server(PID 33612, 부모는 원본 저장소의 Playwright = 조정자의 통합 e2e)를 자기 것으로 잘못 보고 종료했다.
  - 앞선 통합 e2e 2회차의 ERR_CONNECTION_REFUSED는 이 사고 때문이다.
  - 피해: 통합 검사 1회 실패. 데이터 손실은 없다. 전용 포트 18300으로 다시 돌려 PASS를 확인했다.
  - 재발 방지
    - 검증 지시문(validation-appendix)에 포트·프로세스 종료 규칙을 명시했다(자기 자식 핸들로만 종료, PID 종료 전 작업 폴더·부모 확인).
    - 조정자는 전용 포트 18300을 쓴다.
- 하네스 결함 수정: screenshots.ts의 stub 항목이 03-02로 실제 화면이 된 /inventory/orders를 가리켜서 /finance/monthly로 옮겼다. 04-04 지시문에 다시 옮기라고 넣는다.

## 2026-11-03 00:40 04-06·04-01 통합, 04-04·04-02 배정
- 04-06 커밋 978c10b(워커 ctx_2cb28408d351)
  - ad_rules는 080에만 있다(030·031은 주석만).
  - 병합 뒤 게이트: lint PASS, unit 611건, e2e 176건(E2E_PORT 18300)
  - 리뷰 답글 화면의 AdCheckButton 연결은 04-07에 맡긴다.
- 04-01 커밋 adc5ad2(워커 ctx_569e8e9f1681)를 충돌 없이 병합했다. 게이트는 백그라운드에서 실행 중이다.
- 배정: 04-04 지출(슬롯 0, stub 스크린샷 갱신 포함), 04-02 교육·온보딩(슬롯 3)
- 00:50 04-01 병합 뒤 main 게이트: lint PASS, unit 628건, e2e 183건. 검증 배정: 04-06(검증 슬롯 1, 리뷰 화면 버튼은 04-07 후속), 04-01(검증 슬롯 2)

## 2026-11-03 00:52 03-05 PASS(5/5) → completed
- 검증 워커 ctx_22b719d722ba(대상 a2986e5)
  - 병원 정보 치환 확인
  - 전화번호가 DB 35개 테이블 어디에도 없음을 확인
  - 바이트 계산(109) 확인
  - 환자 이름 치환자 400 확인
  - AiPanel 보완이 02-03·03-06 회귀를 일으키지 않음을 확인
- 03-05 completed(선행 02-03·03-04 completed)
- 개선(기준 밖): 데모 답글 조사 오류("응대을(를)", "하늘숲치과이"). 04-07에서 받침에 따라 조사를 고르는 처리로 고친다.

## 2026-11-03 01:02 04-06 검증: AC1~3 PASS, AC4 일부 판정 불가 → completed 보류
- 검증 워커 ctx_9985a773487c(대상 db05097)
  - AC4에서 리뷰 답글 화면 버튼이 0개라 판정 불가였다(04-07에서 연결 예정).
  - 나머지(홍보 글 자동 점검, 문서 작성기 버튼, 같은 API로 답글 점검)는 PASS
  - 증거: evidence/phase-04-task-06/validation-2026-11-03T0102-partial.md
- 04-06은 04-07 연결 뒤 AC4 리뷰 화면 행을 다른 검증자가 판정하면 completed로 바꾼다.
- 하네스 조정: migrate.test.ts의 서버 준비 대기를 15초에서 45초로, 테스트 제한을 60초에서 150초로 늘렸다.
  - 이유: CPU 88% 부하에서 준비 대기가 시간 초과로 1회 실패했다(검증자 관찰).
  - 판정 단언은 바꾸지 않았다.

## 2026-11-03 01:06 04-01 PASS(5/5) → completed
- 검증 워커 ctx_9336a69c27ae(대상 db05097): 독립 시나리오로 5개 기준과 인쇄 PDF(A4 가로 1쪽)를 확인했다.
- 04-01 completed(선행 03-09 completed)
- 참고 관찰 처리
  - 대시보드 요약 "오늘 근무"가 비어 있는 문제와 인사말 날짜가 브라우저 시계를 따르는 문제: 03-10에 send로 전달했다.
  - PDF 텍스트 추출에서 숫자가 빠지는 문제는 03-06과 같은 현상이다(글꼴 ToUnicode). 05-03 화면 점검 항목으로 둔다.

## 2026-11-03 01:12 04-03 통합, 04-07 배정
- 04-03 커밋 67b46d8(워커 ctx_9c96699200d0)를 충돌 없이 병합했다. 게이트는 백그라운드에서 실행 중이다.
- 04-03은 02-05 demo.test·03-08 legal.test의 기대값을 실제 표에 맞게 고쳤다(의도는 같음).
- backend.md에 04-03이 추가한 경로 2개를 반영했고, DECISIONS에 기록했다.
- 03-10에 장비·멸균 연결 함수를 알렸다(send).
- 배정
  - 04-07 채용 공고(슬롯 2). 04-06 AC4 리뷰 화면 버튼 연결과 데모 답글 조사 수정을 포함한다.
  - 04-03 검증(검증 슬롯 0). 대시보드 표시 부분은 03-10 뒤에 판정한다.
- 01:25 04-03 병합 뒤 게이트: lint PASS, unit 641건, e2e 190건. e2e 자리 제한으로 대기한 뒤 실행됐다(동작 확인).
- 04-02 커밋 3ae0dbc(워커 ctx_3115f6466ce2) 병합
  - 충돌: hr/routes.ts·seed.ts에서 04-01과 줄 단위로 겹쳤다. 양쪽을 모두 살렸다.
  - 게이트는 백그라운드에서 실행 중이다.

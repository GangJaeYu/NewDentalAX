# task_validation 결과 — phase-06-task-02 (AI 근무표 배정 제안)

- 검증 커밋: 63339a6 (작업 사본 HEAD, p2-integration). 인계서의 "HEAD ff762f3"은 63339a6의 조상이고, 변경 범위 표는 방향이 뒤집혀 있다(63339a6에 기능 코드가 있음).
- 검증자: 독립 세션(Orca 검증 워커 슬롯 2, E2E_PORT=18096, 수동 서버 PORT=18196, 데이터 .tmp/ 아래)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | 제안 미리보기에서 승인 휴가일에 근무가 배정되지 않는다 | PASS(관찰) | 실제 서버 프로세스(PORT 18196, TEST_NOW 2026-11-02)에 HTTP로 요청. 정하늘 11/3, 임채은 11/5·11/6 연차 승인. **데모 모드**: `POST /api/roster/suggest` 200, 세 휴가 칸 모두 `shiftTypeId:null, leave:연차`, 적용할 칸(cells)에도 없음, 위반 0건, 진료일 인원 6/5/6/5/5/3명. **틀린 AI 응답(가짜 서버가 휴가일 포함 전원 "종일")**: 200, `demo:false`, fixes에 "정하늘 11월 3일(화)에는 승인된 연차가 있어서 AI가 넣은 "종일" 근무를 뺐어요." 등 3건, 위반 0건. 적용 요청에 휴가일 칸(정하늘 11/3 종일)을 일부러 끼워 넣어도 `skipped:1`, 적용 뒤 DB의 휴가일 근무 행 0건. 증거: `.tmp/manual/result.json`, `.tmp/manual/verify-roster-suggest.ts`. 화면: `artifacts/screens/hr-roster-suggest-preview-*.png`(휴가 칸에는 "연차"만 표시). e2e `hr-roster-suggest.spec.ts` AC1 통과(3회 모두). |
| 2 | 적용 전에는 근무표가 바뀌지 않는다 | PASS(관찰) | 제안 전후 `SELECT … FROM roster` 행과 `GET /api/roster`가 같음(데모·가짜 AI 모두 `rosterRowsUnchanged:true`, `rosterViewUnchanged:true`). 미리 넣은 서다온 11/4 "야간" 1행은 제안 뒤에도 그대로. 직원 계정은 suggest·apply 모두 403. `POST /api/roster/apply` 뒤에야 1행에서 33행으로 바뀜(`saved:33, replaced:1, skipped:1`). 적용 뒤 인원 합계가 미리보기와 같음. e2e AC2(취소 뒤 그대로, "적용하기" 뒤 바뀜, 새로 고쳐도 유지) 통과(3회 모두). |
| 3 | AI 요청 본문에 직원 이름이 없다(가짜 서버 수신 확인) | PASS(관찰) | 가짜 LLM 서버(tests/fake-llm)가 받은 요청은 1건(`/v1/messages`). 원문은 `.tmp/manual/fake-llm-request-body.txt`. users 6명(한원장·윤실장·정하늘·오소담·임채은·서다온)의 이름·아이디와 이름 두 글자 조각을 검색한 결과 0건. 본문에는 `S1: 치과위생사(hygienist) / 휴가(근무 불가): 2026-11-03`처럼 내부 번호·직무·휴가일만 있음. 병원 이름("검증치과")은 공통 시스템 프롬프트에 들어 있으나 직원 이름은 아님. e2e AC3 통과(3회 모두). |

- 게이트 결과: lint=PASS(tsc-server 330, tsc-web 205, eslint 469, headers 509, docs 7) / unit=PASS 807건(4회차. 1~3회차는 다른 세션의 unit 게이트와 동시에 돌아 시간 초과 40·49·19건으로 FAIL, 실패 목록이 매번 달랐음) / **e2e=FAIL**(3회 모두 FAIL. 1회차 310 통과·3 실패·21 실행 안 됨, 2회차 322 통과·1 실패·11 실행 안 됨, 3회차 329 통과·1 실패·4 실행 안 됨. 이 태스크의 `hr-roster-suggest.spec.ts` 6건은 3회 모두 통과)
- 화면 기준(DESIGN §5): `npm run screenshots`(hr-roster-suggest·hr-roster-suggest-preview, 4너비×2테마 16장) 모두 OK. 가로 스크롤 경고 없음. 1440·768 라이트, 1024·390 다크를 직접 열람. 기준선(preview-dashboard-1440-light)과 색(청록)·칩 글자·간격이 같고, 주 행동 버튼은 하나("제안 받기"/"적용하기"). 390px에서는 표가 상자 안에서만 가로로 움직임. 불일치 없음.
- 환경 문제·판정 불가 사유:
  - e2e 게이트 실패는 모두 이 태스크와 무관한 spec의 30초 시간 초과이고, 매번 다른 테스트가 실패했다. 1회차: ai-panel AC4, app-shell AC1, backup-reset AC3(isoServer 준비 시간 초과). 2회차: app-shell AC1. 3회차: auth-api AC1. 같은 시각에 다른 세션(06-01·05-05 검증 워커 등)이 e2e·unit 게이트를 돌리고 있었다.
  - app-shell.spec.ts는 혼자 돌리면 12건 모두 통과하지만, AC1 테스트가 28.9초 걸려 30초 한도에 거의 닿는다. 다른 세션이 동시에 돌면 실패하기 쉬운 테스트다(하네스 쪽 확인 필요).
  - 규칙상 e2e 게이트가 PASS가 아니므로, 이 태스크를 완료로 판정하지 않는다. 수용 기준 세 가지는 실제 관찰에서 모두 만족했다.
  - `npm run build:web`이 저장소에 들어 있는 web/dist를 바꾸므로, 검증 뒤 `git checkout -- web/dist`와 `git clean`으로 HEAD 상태로 되돌렸다(작업 트리 깨끗함).
- 재현 방법(실패 시): 다른 게이트가 돌지 않을 때 `E2E_PORT=18096 node harness_setup/scripts/gate.mjs e2e phase-06-task-02`. 로그: `harness_setup/evidence/runs/2026-11-03T04-38-25-578Z-…-e2e.log`, `…T05-42-24-203Z-…`, `…T06-12-35-448Z-…`. AC 수동 재현: `node --disable-warning=ExperimentalWarning .tmp/manual/verify-roster-suggest.ts`.

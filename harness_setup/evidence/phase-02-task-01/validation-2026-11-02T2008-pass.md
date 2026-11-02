# phase-02-task-01 task_validation 결과 (검증 워커 슬롯 2, 2026-11-02)

대상: 작업 사본 HEAD 97df047 (b8b6b05 + loop_setup/specs 인계서 2개만 추가, 제품 코드 차이 없음, dirty=no)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | 감지·미감지 예시 50개 이상 단위 테스트 통과(주민번호, 외국인등록번호, 휴대·지역 전화, 이메일, 카드(Luhn), 계좌, 여권 + 날짜·금액·발주번호·로트·사업자번호 미감지) | PASS | `npx vitest run server/privacy web/src/lib/privacy.test.ts --reporter=verbose` → 2 files, 134 passed, skip 0. 그중 `AC1 감지:` 51건 + `AC1 미감지:` 51건(=102건, .tmp/privacy-unit-verbose.txt). 단언은 종류 배열 정확 일치 + 감지 원문 조각 일치, 미감지는 `detectPii=[]`·원문 그대로·blocked=false. 종류 집합 rrn/phone/email/card/account/passport 단언 포함. 독립 예시 28개(감지 15: 주민·외국인(7)·윤년 000229·휴대/지역/+82·이메일·카드 Luhn 2·계좌 2·여권 2, 미감지 13: 날짜·금액·발주번호·로트·사업자번호·Luhn 틀린 카드·주문번호·시간범위) 직접 실행 → 28/28 일치 (`node .tmp/probe.ts`, .tmp/probe-output.txt) |
| 2 | "홍길동 010-1234-5678 연락" → `[전화번호]`로 가려지고 findings에 phone 1건 | PASS | `filterText('홍길동 010-1234-5678 연락')` 실행 출력: `{"redactedText":"홍길동 [전화번호] 연락","findings":[{"type":"phone","count":1}],"blocked":false,...}` (.tmp/probe-output.txt AC2). 단위 테스트 filter.test.ts:184 통과 |
| 3 | 주민번호가 포함되면 blocked=true | PASS | `850315-1234567`·`8503151234567`(붙여 씀)·외국인 `920505-5123456` → 각각 `blocked:true, blockedTypes:["rrn"]`; 날짜가 틀린 `991399-1234567`은 미감지(blocked:false). 여러 글 묶음 `filterTexts([...,'주민 850315-1234567'])` → blocked=true (.tmp/probe-output.txt AC3a~d, multi). 단위 테스트 filter.test.ts:225·234 통과 |
| 4 | 허용 목록의 대표번호는 가려지지 않는다 | PASS | `parsePrivacySettings('{"allowlist":["02-555-1234",...]}')` 설정으로 `대표번호 02-555-1234로 문의` → 원문 그대로, findings [] ; `(02) 555 1234 / 직원 010-9876-5432` → 대표번호는 유지, 직원 번호만 `[전화번호]`(phone 1건). 허용 목록 없으면 같은 글이 `[전화번호]`로 가려짐(대조군). 화면 사본 `inputPrivacyWarning(..., {allowlist})` → null(경고 없음), 허용 목록 없으면 전화번호 경고 (.tmp/probe-output.txt AC4a~e). 단위 테스트 filter.test.ts:262·268, privacy.test.ts AC4 통과 |

- 게이트 결과: lint=PASS (tsc-server 52, tsc-web 5, eslint 60, headers 63; harness_setup/evidence/runs/2026-11-02T11-05-06-541Z-phase-02-task-01-lint.log), unit=PASS (227건, 15 files; …T11-05-17-302Z-phase-02-task-01-unit.log), e2e=PASS (3건, E2E_PORT=18096; …T11-05-31-616Z-phase-02-task-01-e2e.log)
- 수동 서버: `DATA_DIR=.tmp/manual-data2 PORT=18196 node server/main.ts` → `GET /api/health` = `{"ok":true,"version":"0.1.0","db":"ok"}`. 띄운 프로세스만 종료했고 18096·18196 LISTEN 없음 확인.
- 화면 기준(DESIGN §5): 이 태스크는 화면 컴포넌트가 없다(web/src/lib/privacy.ts는 문구 생성 함수만, 사용처 PrivacyGuard·AI 화면은 01-04·02-03). 스크린샷 대조 대상 아님.
- 환경 문제·판정 불가 사유: 없음. 참고 관찰(판정 영향 없음): e2e 로그 끝에 `[WebServer] [문제] 서버를 켜지 못했어요. 포트 18096이(가) 이미 사용 중이에요` 문구가 테스트 3건 통과 뒤에 찍힘. playwright `reuseExistingServer:false`라 테스트는 이 실행이 띄운 서버(DATA_DIR=.tmp/e2e/run-1793617533947-36076)에 접속했고, 실행 전후 18096 LISTEN은 없었음. 이 태스크 범위 밖(하네스/e2e-server)이며 원인은 조사하지 않음. 필터는 아직 HTTP 경로에 연결되지 않아(게이트웨이는 phase-02-task-02) API 수준 관찰은 하지 않고 함수 직접 실행으로 판정함.
- 재현 방법(실패 시): 해당 없음. 재현: `npm ci` → `E2E_PORT=18096 node harness_setup/scripts/gate.mjs lint|unit|e2e phase-02-task-01` → `node .tmp/probe.ts`

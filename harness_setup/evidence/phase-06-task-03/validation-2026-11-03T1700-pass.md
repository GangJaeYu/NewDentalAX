# task_validation 결과 — phase-06-task-03 (회의 녹음 파일 → 회의록), 재검증

- 검증 대상: lint·unit·수동 확인은 4df48b6에서 했다. 조정자 지시로 e2e 재실행만 main@48036ee에서 했다. 4df48b6과 48036ee 사이에서 plan_setup·docs·evidence·loop_setup·PROGRESS를 빼면 바뀐 파일은 playwright.config.ts뿐이고, 바뀐 내용은 timeout 30000→60000 한 줄과 주석이다(git diff --stat로 직접 확인).
- 2026-11-03, 슬롯 3: E2E_PORT=18097, 수동 서버 PORT=18197, 데이터 .tmp/ 아래. 실제 LLM 호출 없음(데모 + tests/fake-llm/audio.ts 가짜 서버)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | 데모 모드에서 음성 파일 업로드 → 예시 전사문 → 회의록 요약 화면으로 이어진다 | PASS | HTTP(.tmp/manual/run.mts → .tmp/manual/run-output.txt, 서버 18197): GET /api/ai/transcribe/status → state "ready", demo true. confirmed=false → 400 VALIDATION "환자 이야기가 들어간 녹음이 아닌지 확인하고 체크해 주세요.". POST /api/ai/transcribe(4KB m4a) → 200, demo, 0원, "[데모 응답] 예시 회의 녹음을 받아쓴 글입니다…" 9줄. 이 글을 넣은 POST /api/ai/run minutes → 200, 결정 2건, 할 일 3건(데스크 11-06·치과위생사 11-07·치과조무사 11-10). DATA_DIR에 녹음 파일이 남지 않음([]). 화면(라이트·다크): 받아쓰기 완료 안내 → 메모 칸 첫 줄이 데모 글 → "정리하기" → 할 일 3건과 "회의록 저장" 버튼. 4너비 가로 넘침 없음(sw=iw). E2E docs-minutes-audio.spec.ts:29 ok. 스크린샷: .tmp/manual/shots/demo-transcribed-1440-*.png, demo-result-*-*.png, artifacts/screens/docs-minutes-recording-*.png, docs-minutes-transcribed-*.png(4너비×2테마) |
| 2 | 음성 미지원 공급자면 비활성 안내 | PASS | 가짜 서버로 공급자 세 곳을 확인. OpenAI: ready → 200, 가짜 서버가 POST /v1/audio/transcriptions 1건을 받음, 전화번호 1건 가림, 120초에 13원. Gemini: ready → 200, POST /v1beta/models/gemini-3.1-flash-lite:generateContent 1건, 가림 안내. Anthropic: state "unsupported", 메시지 "지금 설정된 AI(Anthropic Claude)는 음성을 지원하지 않아요…". 그래도 POST를 보내면 403 AI_DISABLED이고 가짜 서버가 받은 요청은 0건. 화면(라이트·다크): recording-off 안내, 파일 고르기 칸 0개, 회의 메모 편집 가능(.tmp/manual/shots/anthropic-1440-*.png). E2E spec:109 ok |
| 3 | 20MB 초과 파일 거부 | PASS | HTTP: 정확히 20MB → 200(경계값 허용). 20MB+1바이트 → 413 FILE_TOO_LARGE "녹음 파일이 너무 커요(최대 20MB)…". 30MB → 413 FILE_TOO_LARGE. txt → 415 FILE_TYPE. 화면(라이트·다크): 20MB+1을 고르면 alert "긴 회의.m4a: 파일이 너무 커요(20MB). 20MB 이하로 올려 주세요."가 뜨고 받아쓰기 버튼이 꺼짐(.tmp/manual/shots/demo-20mb-reject-1440-*.png). E2E spec:64 ok |
| 4 | 화면 기준 DESIGN §5(태스크 완료 판정 조건) | PASS | **직전 FAIL 항목 §5-4 해소**: Playwright로 /api/ai/transcribe/status를 500으로 흉내 내면 녹음 카드에 ErrorState "받아쓰기 상태를 확인하지 못했어요 / 잠시 문제가 생겼어요. 다시 시도해 주세요. / [다시 시도]"가 보이고, "확인하고 있어요…" 글은 0건이다. 연결 실패(abort)는 "서버에 연결할 수 없어요…"와 다시 시도를 보인다. 막은 것을 풀고 다시 시도를 누르면 실제 상태(비활성 안내)로 돌아오고 alert는 0건이다. 응답을 3초 늦추면 aria-busy 뼈대 2줄이 보인다(.tmp/manual/shots/status-500-card-*.png, loading-card-*.png). E2E DESIGN5 spec:124 ok. 그 밖에: 4너비×2테마 가로 넘침 0. axe 위반 0건(spec:82 light/dark, docs-library /docs/minutes light/dark). 포커스 외곽선 라이트 "solid 2px rgb(12,124,118)", 다크 "solid 2px rgb(69,189,179)". 칩에 글자 있음. 채워진 주 버튼은 "정리하기" 하나. 390px 첫 화면에서 헤더·하단 메뉴 정상(artifacts/screens/docs-minutes-transcribed-390-light.png). 기준선 preview-dashboard-1440-dark.png와 비교해 색·카드·간격 위계가 같다 |

- 게이트 결과:
  - lint=PASS: tsc-server 331, tsc-web 206, eslint 471, headers 511, docs 7. 로그 harness_setup/evidence/runs/2026-11-03T06-16-26-933Z-phase-06-task-03-lint.log
  - unit=PASS 812건. 로그 2026-11-03T06-18-19-190Z-phase-06-task-03-unit.log
  - e2e=PASS 335건(22.8분, 48036ee, docs-minutes-audio 6건 ok). 로그 2026-11-03T07-36-21-897Z-phase-06-task-03-e2e.log
- 환경 문제·판정 불가 사유:
  - 4df48b6에서 돌린 첫 e2e 게이트는 FAIL이었다. 결과는 316 passed / 2 failed / 17 did not run(로그 2026-11-03T06-21-39-338Z-…-e2e.log). 실패 2건 docs-handover.spec.ts:9와 docs-library.spec.ts:21은 둘 다 "Test timeout of 30000ms exceeded while setting up isoServer"였다. PC 부하 때문으로 본다.
  - 두 spec만 따로 다시 돌리니 19/19 PASS였다(.tmp/rerun-e2e.txt).
  - 조정자 지시(B)로 48036ee(제품·테스트 동일, 시간 한도만 60초)에서 e2e 게이트를 한 번 다시 돌려 335 PASS를 얻었다.
  - build:web·e2e를 돌린 뒤에도 web/dist에 변경은 없었다(git status 깨끗함).
  - 띄운 수동 서버와 가짜 서버는 자식 프로세스 핸들로 종료했다. 18097·18197 포트에 열린 연결 0건을 확인했다.
  - 작업 사본은 지금 48036ee(detached)에 있다.
- 재현 방법(실패 시): 해당 없음(모든 기준 PASS)

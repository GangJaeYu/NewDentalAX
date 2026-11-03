# 설치 리허설 기록 (phase-05-task-05, NFR-003)

> 2026-11-03 12:19~12:22(KST) · 기준 커밋 `96d929c` · Windows 11 Pro · Node 24.13.0 · npm 11.6.2

## 1. 준비

| 항목 | 값 |
|---|---|
| 내보내기 | `git archive HEAD \| tar -x -C .tmp/install-rehearsal` (git에 올린 파일만) |
| 시작 상태 | `node_modules` 없음, `data` 없음, `backups` 없음. `web/dist`는 저장소에 있는 그대로(따로 빌드하지 않음) |
| 실행 | 그 폴더에서 PowerShell로 `cmd /c .\start.bat` |
| 환경 변수 | `PORT=18190`, `NO_BROWSER=1`(브라우저 자동 열기 끔, `server/main.ts`), `DATA_DIR` 비움(기본값 `<폴더>\data` 사용) |

## 2. 결과

| 확인 | 결과 | 근거 |
|---|---|---|
| 패키지 자동 설치 | `npm ci --omit=dev` 실행됨(`node_modules\vitest` 없음 → 실행용만). **105개, npm 표시 8초** | `rehearsal/start-bat-output.txt` "added 105 packages in 8s". 설치 뒤 `node_modules`에 vitest·vite·playwright·eslint·typescript 없음 |
| 실행부터 응답까지 | 12:19:53 시작 → 12:20:02 설치 표시 파일(.install-stamp) → 12:20:04 `/api/health` 응답. **약 11초** | 같은 파일, 서버 로그 |
| `/api/health` | `{"ok":true,"version":"0.1.0","db":"ok","now":"2026-11-03T03:20:04.565Z"}` | curl |
| DB 준비 | "데이터 구조를 준비했어요(버전 80, 15개 적용)", 자동 백업 `20261103-122003-auto` 생성 | `rehearsal/server.log` |
| `/` → `/setup` | 이동함, "첫 설정" 제목 보임 | `rehearsal/browser-check.txt`, `rehearsal/01-setup-1280.png` |
| 첫 설정(데모 데이터 넣기) | 병원 이름·관리자·아이디·비밀번호 입력 + "데모 데이터 넣기" → 1.2초 만에 대시보드 | `rehearsal/02-dashboard-1280.png` |
| 주요 화면 | 재고 현황(83품목)·공지·인수인계·근무표·원내 AI 도우미·장비 점검·지출 기록·백업·복원·AI 설정·예산 모두 제목이 보이고 가로 스크롤 없음 | `rehearsal/03`~`10-*.png`, `browser-check.txt` |
| 설정 뒤 새 브라우저 | `/` → `/login`(첫 설정을 다시 띄우지 않음), 390px | `rehearsal/11-login-390.png` |
| 브라우저 오류 | 콘솔 오류·페이지 오류·5xx 응답 **0건** | `browser-check.txt` "problems: 0" |
| 끄기 | 그 폴더의 `cmd /c .\stop.bat` → "서버(PID 31136)에 종료를 요청했어요... 서버가 꺼졌어요." 2초. start 창도 "stop.bat 요청으로 서버를 껐어요."로 종료 코드 0 | `start-bat-output.txt`, 서버 로그 "서버 종료 (stop.bat 요청)" |
| 정리 | `.tmp/install-rehearsal` 삭제함(잠긴 파일 없음) | — |

화면 확인 스크립트는 `rehearsal/browser-check.mjs.txt`(Playwright + Edge, 1280×800)다.

## 3. 주의할 점 (한계)

- 이 PC는 npm 캐시가 이미 차 있어서 8초가 걸렸다. 처음 쓰는 PC는 실행용 패키지(약 45MB)를 인터넷에서 받으므로 더 오래 걸린다. README의 "몇 분"이라는 안내는 그대로 둔다.
- 더블클릭이 아니라 `cmd /c .\start.bat`으로 흉내 냈다. 이 PC에서는 `cmd /c start.bat`(점·역슬래시 없이)이 cmd 내장 명령 `start`와 이름이 겹쳐 실패한다. 사용자의 더블클릭에는 해당하지 않는다.
- 브라우저 자동 열기는 `NO_BROWSER=1`로 껐기 때문에 확인하지 않았다.
- 실제 포트 8090과 실제 `data/` 폴더는 쓰지 않았다(PORT=18190, 폴더 안 data).

## 4. 같은 작업 사본의 게이트 최종 수치

| 게이트 | 판정 | 건수 | 로그 |
|---|---|---|---|
| lint | PASS | tsc-server 310 · tsc-web 155 · eslint 443 · headers 481 · docs 7 | `harness_setup/evidence/runs/2026-11-03T04-15-42-760Z-phase-05-task-05-lint.log` |
| unit | PASS | 771건(이 태스크의 기록 확인 테스트 3건 포함) | `harness_setup/evidence/runs/2026-11-03T04-23-03-012Z-phase-05-task-05-unit.log` |
| e2e | PASS | 314건(23.5분, E2E_PORT=18090) | `harness_setup/evidence/runs/2026-11-03T03-25-05-578Z-phase-05-task-05-e2e.log` |

세 게이트는 커밋 `96d929c`에 리허설 증거·PROGRESS.md·기록 확인 테스트(`tests/final-report.test.ts`)만 더한 상태에서 돌렸다(제품 코드 변경 없음). 테스트를 더하기 전 첫 회차도 lint·unit(768건)·e2e(314건) 모두 PASS였다(`runs/2026-11-03T03-23-26-240Z-…-lint.log`, `03-23-56-100Z-…-unit.log`, `03-25-05-578Z-…-e2e.log`). e2e가 화면 파일을 다시 빌드한 뒤에도 `web/dist`에 git 변경이 없었다.

e2e 수치는 첫 회차(기록 확인 테스트를 더하기 전)의 값이다. 더한 뒤 다시 돌린 e2e는 이 PC의 메모리가 부족해져 실행 도구가 중간에 멈췄다(판정 로그 없음, 남은 프로세스 없음). 그 사이 바뀐 파일은 `tests/final-report.test.ts`(vitest 전용, Playwright `testDir: 'tests/e2e'` 밖)와 Markdown 기록뿐이라 e2e 대상은 같다.

최종 문서로 돌린 unit 첫 시도(`runs/2026-11-03T04-17-16-971Z-…-unit.log`)는 FAIL이었다. `server/main.test.ts`의 실제 서버 실행 테스트 2건(phase-01-task-01 AC4 포트 충돌 종료 코드 2, 설정 오류 종료 코드 3)이 20~30초 시간 초과로 멈췄고, 그 파일이 196초 걸렸다. 그때 PC에서 다른 작업 사본의 node 프로세스 72개가 함께 돌아 CPU 부하가 47%였다. 코드를 바꾸지 않고 다시 돌린 회차는 771건 모두 PASS다. 부하가 큰 PC에서 이 두 테스트가 시간 초과로 실패할 수 있다는 점을 남긴다.

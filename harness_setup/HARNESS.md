# HARNESS — 검증 하네스

> 상태: **준비 완료(2026-11-02). 제품 게이트는 미활성**(제품 코드가 없음). 활성화 담당은 phase-01-task-01이다.
> 미활성은 통과가 아니다. 아래 "확인한 것"은 하네스 자체가 준비됐다는 증거이고, 제품이 완성됐다는 증거가 아니다.

## 1. 실행 전제 (2026-11-02 실제 확인)

| 항목 | 값 | 확인 방법 |
|---|---|---|
| OS·셸 | Windows 11 Pro, PowerShell 5.1 + Git Bash | `$PSVersionTable` |
| 런타임 | Node 24.13.0, npm 11.6.2, git 2.54 | preflight |
| DB | node:sqlite(SQLite 3.50.4), FTS5 사용 가능 | preflight |
| 브라우저 | Microsoft Edge(설치됨), Playwright `channel:'msedge'` 조종 가능 | 시안 8장 촬영 실험 |
| 독립 세션 | Claude CLI 2.1.316(`-p` 지원), Orca 런타임 ready, Agent 도구(general-purpose) | `claude --help`, `orca status` |
| 자원 | 논리 CPU 20개, 메모리 32GB, C: 여유 45GB | CIM, preflight |
| 포트 | 8090(제품), 18090~18097(구현·검증 워커 E2E 슬롯, LOOP.md §4) 모두 비어 있음 | preflight |
| 외부 서비스 | 없음. LLM은 데모 또는 `tests/fake-llm` 가짜 서버만 쓰고 실제 키는 쓰지 않는다 | PRD 자율운영 합의 |
| 다른 OS | 대상 아님. 서버는 Windows 전용이고, 클라이언트는 브라우저다. WSL이 있지만 쓰지 않는다 | — |

사전 점검(읽기 전용, 반복해도 안전):
```
node harness_setup/scripts/preflight.mjs
```

## 2. 로컬 실행·상태·로그·종료

| 목적 | 명령 / 위치 | 비고 |
|---|---|---|
| 의존성 설치 | `npm ci` | 01-01 이후 |
| 개발 실행 | `npm run dev` | Vite + 서버 감시 |
| 실제 실행(사용자 방식) | `start.bat` 더블클릭. 에이전트는 `cmd /c .\start.bat`으로 흉내 낸다 | 기본 포트 8090 |
| 직접 실행 | `npm start`. 환경 변수 `DATA_DIR`, `BACKUP_DIR`, `PORT`, `TEST_NOW`(테스트 전용), `AI_BASE_URL_*`(테스트 전용) | |
| 접속 주소 | 이 PC: `http://localhost:8090`. 원내 다른 기기: `http://<이 PC의 원내 IP>:8090`(start.bat이 출력) | E2E는 `http://localhost:18090` |
| 준비 상태 확인 | `GET /api/health` → `{ok:true, version, db:'ok'}` | 포트가 열린 것만으로는 준비로 보지 않는다 |
| 로그 | `<DATA_DIR>/logs/server.log` | 키·비밀번호는 기록하지 않음(TD-008) |
| 종료 | `stop.bat`(PID 파일과 프로세스 이름·명령줄을 모두 확인), 또는 직접 띄운 자식 프로세스 핸들로 종료 | 이름만 보고 종료 금지 |
| 데이터 초기화 | 임시 DATA_DIR 폴더를 삭제한다. 실제 `data/` 폴더는 테스트에서 쓰지 않는다 | |

## 3. 검증 목록

판정 순서는 **lint → unit → e2e → task_validation**이다. 앞 게이트가 실패하면 뒤 게이트로 완료 판정을 하지 않는다. 코드를 바꾸면 그 커밋 기준으로 lint부터 다시 돌린다.

| 게이트 | 정의 | 실행 명령 | 실행 시점 | 상태 |
|---|---|---|---|---|
| lint | [quality_gates/lint.md](quality_gates/lint.md) | `node harness_setup/scripts/gate.mjs lint <ID>` | 모든 태스크, 커밋마다 | 미활성 → 01-01 |
| unit | [quality_gates/unit.md](quality_gates/unit.md) | `node harness_setup/scripts/gate.mjs unit <ID>` | 모든 태스크(05-04 문서 태스크 제외) | 미활성 → 01-01 |
| e2e | [quality_gates/e2e.md](quality_gates/e2e.md) | `node harness_setup/scripts/gate.mjs e2e <ID>` | 화면·흐름이 있는 태스크 | 미활성 → 01-01(기본), 01-04(반응형·axe) |
| task_validation | [quality_gates/task_validation.md](quality_gates/task_validation.md) | `node harness_setup/scripts/task-brief.mjs <ID> <기준커밋>` → 별도 세션 | 모든 태스크의 마지막 | 절차 활성, 제품 판정 없음 |

`gate.mjs`는 다음을 모두 확인하고, 로그를 `harness_setup/evidence/runs/`에 남긴다(커밋 해시와 미커밋 여부 포함).
- 종료 코드
- 실행 건수가 0보다 큰지
- skip·flaky가 0인지
- lint 단계별 실행 여부
- 자동 수정 옵션이 섞여 있지 않은지

판정은 PASS / FAIL / INACTIVE(종료 코드 3, 통과 아님)이다.

### 게이트 밖의 측정 (태스크의 task_validation에 포함)

| 요구 | 측정 | 명령·수단 | 담당 태스크 |
|---|---|---|---|
| NFR-005 성능(p95 300ms 이하, 동시 20명 오류 0, 첫 화면 2초) | 10배 데이터 부하 | `npm run perf` → `docs/PERF.md` | 05-01 |
| NFR-002 보안 | `npm audit --omit=dev`, 보안 통합 테스트 | unit 게이트 + 명령 출력 | 05-02 |
| NFR-006 화면 품질 | 4너비 × 2테마 스크린샷을 직접 열람 | `npm run screenshots` + 기준선 대조 | 01-04, 각 화면 태스크, 05-03 |
| NFR-003 설치 | 새 폴더에 git 추적 파일만 내보낸 뒤 `cmd /c .\start.bat` | 기록: 소요 시간, 출력 | 05-05 |
| NFR-011 문서 | 필수 소제목 검사 | lint의 `docs` 단계(`scripts/check-docs.ts`, 05-04에서 활성·gate.mjs 필수 단계) | 05-04 |
| OQ-008 검색 품질 | 질문 20개 적중률 80% 이상 | `npm run kb-eval` | 01-06 |

## 4. 디자인 대조 수단

- **기준선**: `harness_setup/evidence/design-baseline/preview-dashboard-<너비>-<테마>.png`
  - 승인 시안 v2를 2026-11-02에 Edge로 촬영한 8장이다.
  - 8장 모두 가로 스크롤이 없고, Pretendard 글꼴이 로드됐다.
- **대조 방법**: 화면 태스크는 `npm run screenshots` 결과를 직접 열어 DESIGN §5 여덟 항목과 기준선의 정보 위계·색·간격을 비교한다.
  - 불일치하면 FAIL과 증거를 남긴다.
  - 기준선은 사용자가 승인한 범위에서만 바뀐다. 검증자는 바꾸지 않는다.

## 5. 테스트 데이터

| 데이터 | 내용 |
|---|---|
| 데모 seed | 가상 "하늘숲치과". 환자 데이터는 없다. `seedDemo(scale=1)`, 성능 측정은 `scale=10` |
| 고정 기준일 | `TEST_NOW=2026-11-02T09:00:00+09:00`. 수용 기준의 D-day 예시가 이 날짜 기준이다 |
| fixture | `tests/fixtures/`: kb 매뉴얼, CSV(UTF-8·CP949), 영수증 이미지, 손상 PDF |
| 가짜 LLM | `tests/fake-llm/`: 정상·스트리밍·401·429·500·지연 응답 |

## 6. 한계와 미검증 (현재)

- **실제 LLM 공급자 응답**: 키가 없고 유료 호출이 금지돼서 검증하지 않는다. 요청·응답 형식은 공식 문서와 가짜 서버로만 확인한다(OQ-006, OQ-009).
- **사용자 더블클릭**: 에이전트는 `cmd /c .\start.bat`으로 흉내 낸다. 탐색기에서 실제로 더블클릭하는 동작은 사용자 확인 항목이다.
- **실제 태블릿·휴대폰 브라우저**(iOS Safari, Android Chrome): Edge 뷰포트 에뮬레이션으로만 확인한다. 실제 기기의 "홈 화면 추가"는 미검증이다.
- **원내 다른 PC에서 접속**: 같은 PC의 원내 IP 주소로 접속되는지만 확인할 수 있다. 다른 기기와 방화벽 허용은 사용자 확인 항목(README)이다.
- **Windows 방화벽 허용 팝업**: 처음 실행할 때 사용자가 허용해야 할 수 있다(README에 안내). 전역 설정이라 에이전트가 바꾸지 않는다.
- 이 하네스 문서와 스크립트는 2026-11-02에 실행해서 확인했다. 실행 결과는 [evidence/README.md](evidence/README.md)에 있다.

## 무거운 검사 자리 제한 (2026-11-03 갱신)
- e2e·unit 게이트, `npm run screenshots`, `npm run perf`, `scripts/readme-shots.ts`는 이 PC 전체에서 동시에 2개까지만 돈다(OS 임시 폴더 `dentalax-heavy-slots`, `E2E_SLOT_LIMIT`으로 조정).
- 여러 작업 사본이 함께 돌 때 소켓 부족(ERR_NO_BUFFER_SPACE), 메모리 부족, 실제 서버 실행 테스트의 시간 초과가 생겨서 넣었다. 자리를 기다리는 것은 정상이다.

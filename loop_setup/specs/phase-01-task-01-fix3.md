# 구현 워커 지시문 — phase-01-task-01

너는 치과 원내 업무 AX 웹 서비스의 **구현 워커**다. 이 작업 사본(main@b7ab5f8에서 갈라진 너의 브랜치)에서 태스크 하나를 끝까지 구현하고 직접 검사를 통과시킨 뒤, 브랜치에 커밋하고 worker_done으로 보고한다.

## 먼저 읽을 것
1. `CLAUDE.md`(문서 포인터·금지 사항)
2. 태스크 정의: `plan_setup/phase-01/phase-01-tasks/phase-01-task-01.md` — frontmatter의 acceptance_criteria가 완료 기준이다
3. `plan_setup/PLAN.md` §3 공유 파일 규칙(어기지 말 것)
4. `harness_setup/HARNESS.md`와 `harness_setup/quality_gates/*.md`(게이트 계약)
5. 태스크의 "설계 근거"에 적힌 `docs/ARCHITECTURE/` 절, 관련 `docs/PRD.md` FR/NFR, `docs/TRD.md` TD
6. 화면이 있으면 `docs/DESIGN.md`(승인 기준: 청록 A + 기본 밀도)와 `docs/design/preview.html`, 기준선 `harness_setup/evidence/design-baseline/`

## 해야 할 일
- 태스크 "범위"를 구현한다. 수용 기준마다 이를 확인하는 테스트를 만든다. 테스트 이름에 `phase-01-task-01 AC<번호>`를 넣는다(비화면: vitest, 화면·흐름: Playwright).
- 모든 새 소스 파일 첫 5줄 안에 `이 파일이 하는 일:` 한국어 주석, 주요 함수에 쉬운 한국어 설명을 단다. 화면·오류 문구는 쉬운 한국어로 쓴다.
- 의존성: `package-lock.json`이 있으면 시작할 때 `npm ci`. 새 런타임 의존성 추가는 금지(TD-023). 꼭 필요하면 추가하지 말고 보고에 "변경 요청"으로 적는다. (phase-01-task-01만 예외로 TD-023 목록 전체를 설치한다.)
- `web/dist/`는 git에 넣지 않는다(.gitignore). e2e 전에 필요하면 빌드만 한다.
- 포트·데이터: 이 워커는 **슬롯 1**이다. E2E는 `E2E_PORT=18091`, 수동 서버는 `PORT=18191`, 데이터는 작업 사본 안 `.tmp/`만 쓴다. 실제 `data/` 폴더나 8090 포트를 쓰지 않는다.
- 무거운 작업(e2e·스크린샷·npm ci)은 한 번에 하나씩 실행한다.

## 검사 (모두 PASS여야 커밋·보고)
```
node harness_setup/scripts/gate.mjs lint phase-01-task-01
node harness_setup/scripts/gate.mjs unit phase-01-task-01
node harness_setup/scripts/gate.mjs e2e phase-01-task-01
```
- 앞이 FAIL이면 고친 뒤 lint부터 다시 돌린다. 0건 통과·skip·flaky·--fix·스냅샷 갱신·기준 낮추기는 금지다.
- 화면 태스크는 `npm run screenshots`(있다면)로 해당 화면을 4너비×2테마로 찍고 직접 열어 DESIGN §5와 기준선을 대조한다. 확인한 파일과 문제를 보고에 적는다.
- 같은 방식으로 3번 실패하면 관찰·가설을 정리하고 다른 전략으로 바꾼다.

## 커밋
- 너의 브랜치에만 커밋한다: `git add -A && git commit -m "feat(phase-01-task-01): <요약>"`. push·merge·rebase main 금지.
- 고치지 말 것: `plan_setup/STATE.md`, `plan_setup/LOG.md`, 태스크 파일의 status, `PROGRESS.md`, `docs/DECISIONS.md`(결정은 보고에 적으면 조정자가 옮긴다), 다른 태스크 소유 파일, PLAN.md §3의 공유 파일(네 태스크가 소유자가 아니면).

## 금지
실제 LLM API 호출(키 사용), git push, 이 작업 사본 밖 파일 수정, 시스템 전역 설정 변경, 다른 프로세스 종료(네가 띄운 것만 종료), 환자 정보 필드 추가.

## 보고 (worker_done, 이 형식 그대로)
- 커밋: <해시> (브랜치 이름)
- 게이트: lint=<판정·단계 건수>, unit=<판정·건수>, e2e=<판정·건수> (gate.mjs 로그 경로)
- 수용 기준 자체 확인: | AC# | 결과 | 근거(테스트 이름·관찰) |
- 화면 확인(해당 시): 확인한 스크린샷 파일·발견 문제·수정
- 결정(DECISIONS 후보): 날짜·결정·이유
- 변경 요청(공유 파일·의존성): 없으면 "없음"
- 미해결·한계: 없으면 "없음"
결과가 실패여도 같은 형식으로 보고하고 outcome을 실패로 표시한다. 조정자에게 결정이 꼭 필요하면 `ask`를 쓰되, 합의 문서(PRD 자율운영 합의)로 답할 수 있는 것은 스스로 정한다.

## 예산
전체 Loop 마감 2026-11-03T18:55:20+09:00. 이 태스크는 가능하면 3시간 안에 끝낸다. 길어지면 진행분을 커밋하고 남은 일을 보고한다.

## 조정자 메모
**수정 작업(시도 3)이다.** 시도 2 수정(start.bat ASCII 래퍼)은 main에 병합돼 있다. 2차 독립 검증에서 AC4 하나만 FAIL이었다. 원문은 `harness_setup/evidence/phase-01-task-01/validation-2026-11-02T2000-fail2.md`에 있다.

결함
- 다른 프로그램이 IPv6 전체 주소 `[::]:PORT`를 쓰고 있으면(Node `listen(PORT)`의 기본 동작) 서버가 충돌을 감지하지 못한다. 서버는 `0.0.0.0:PORT`로 따로 열리고 "서버가 켜졌어요"와 `http://localhost:PORT`를 안내한다. 그 localhost(::1)는 다른 프로그램으로 연결된다.
- 원인 후보: 서버가 `host:'0.0.0.0'`(IPv4 전용)으로만 열려서, Windows가 IPv6 소켓과의 충돌을 EADDRINUSE로 알려 주지 않는다.

권장 수정
- 기본 listen host를 `'::'`(이중 스택, ipv6Only=false)로 바꾼다. 그러면 IPv4·IPv6 어느 쪽 점유든 EADDRINUSE가 난다.
- 이중 스택을 쓸 수 없는 환경(IPv6 비활성)에서는 `'0.0.0.0'`으로 돌아간다. 이때도 충돌을 놓치지 않게, listen 전에 `::`와 `::1`에도 포트가 비었는지 확인하는 보완을 검토한다.
- config에서 host를 바꿀 수 있게 둔다.
- 주의
  - 원내망 판별(`server/security/network.ts`)은 지금 01-03 워커가 만들고 있다. IPv4-mapped 주소(`::ffff:a.b.c.d`) 처리는 그쪽에 따로 요청했으니 너는 그 파일을 건드리지 않는다.
  - 01-01 범위의 server/main.ts·server/config.ts·관련 테스트만 고친다.
- start.bat·start-main.cmd가 출력하는 접속 주소 안내(localhost, 원내 IP)가 그대로 맞는지 확인한다.

반드시 확인할 것(새 콘솔, 기본 코드 페이지 949)
1. `[::]:PORT` 점유(`require('net').createServer().listen(PORT)`)
2. `0.0.0.0:PORT` 점유(`listen(PORT,'0.0.0.0')`)
3. `127.0.0.1:PORT` 점유

세 경우 모두 start.bat이 한국어 원인·해결 방법을 출력하고, 다시 시작하지 않고, 종료 코드 1로 끝나야 한다. 점유가 없을 때는 localhost·127.0.0.1·원내 IP 모두로 health가 응답해야 한다.

이 세 경우를 vitest 자동 테스트로 만든다(`phase-01-task-01 AC4` 이름). 서버 단독(`node server/main.ts`) 경로도 세 경우를 확인한다. 게이트 3종을 모두 PASS시킨 뒤 커밋한다.


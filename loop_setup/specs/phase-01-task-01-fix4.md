# 구현 워커 지시문 — phase-01-task-01

너는 치과 원내 업무 AX 웹 서비스의 **구현 워커**다. 이 작업 사본(main@f16520c에서 갈라진 너의 브랜치)에서 태스크 하나를 끝까지 구현하고 직접 검사를 통과시킨 뒤, 브랜치에 커밋하고 worker_done으로 보고한다.

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
**수정 작업(시도 4). 전략을 바꾼다.** 원문: `harness_setup/evidence/phase-01-task-01/validation-2026-11-02T2022-fail3.md`

현재 상태
- 시도 3의 사전 점유 확인(`planListen`/`probePort`, 5개 주소)은 main에 병합돼 있다.
- 3차 독립 검증에서 AC4가 다시 FAIL이었다. 다른 프로그램이 `[::]:PORT`를 **IPv6 전용**으로 점유하면 충돌을 놓친다.
  - 예: .NET `TcpListener(IPAddress.IPv6Any, port)`, Node `listen({host:'::', ipv6Only:true})`
  - 결과: 서버는 "서버가 켜졌어요"와 localhost를 안내하지만, localhost(::1)는 다른 프로그램으로 간다.

분석(조정자)
- 시도 2·3은 "listen 전에 주소별로 미리 열어 보기"를 늘려 온 방식이다. Windows 소켓 규칙(주소가 정확히 같을 때만 충돌, 이중 스택/IPv6 전용 공존 등) 때문에 빠지는 경우가 계속 나온다.
- 같은 방식을 한 번 더 늘리는 것은 새 전략이 아니다.

새 전략(필수): 자기 확인
1. 서버가 시작할 때 무작위 표식(nonce)을 만든다. 테스트·내부 확인용으로만 노출한다. 예: `GET /api/health`에 `X-Instance` 응답 헤더를 두거나, 내부 전용 경로를 둔다. 키나 개인정보는 넣지 않는다.
2. 실제 listen 뒤, "서버가 켜졌어요"를 출력하기 **전에** 안내할 모든 주소로 직접 HTTP 요청을 보낸다. 대상: `localhost`(실제로 해석되는 ::1과 127.0.0.1 각각), `127.0.0.1`, `[::1]`, 각 원내 IPv4. 짧은 시간 초과를 둔다.
3. 응답이 없거나 표식이 다르면, 다른 프로그램이 그 주소를 가로챈 것으로 본다. 그때는 서버를 닫고, 기존과 같은 한국어 포트 문제 안내([원인]·[해결 방법])를 출력하고, 종료 코드 2로 끝낸다(start.bat은 재시작하지 않고 1).
   - 예외: 원내 IP는 방화벽 상황에 따라 자기 접속이 실패할 수 있다. 원내 IP에서 "응답 없음"(연결 거부·시간 초과)은 경고 로그만 남기고 진행한다. "다른 표식 응답"은 충돌로 본다. 루프백(localhost, 127.0.0.1, ::1)은 응답 없음도 충돌로 본다.
4. 시도 3의 사전 확인은 빠른 1차 거름망으로 유지해도 된다. 여기에 `::` ipv6Only:true 확인을 더해도 좋다. 최종 판정은 자기 확인이 한다.

반드시 확인할 것(새 콘솔, 코드 페이지 949, start.bat과 `node server/main.ts` 둘 다)
- (a) `[::]` 이중 스택 점유
- (b) `0.0.0.0` 점유
- (c) `127.0.0.1` 점유
- (d) `[::]` IPv6 전용 점유: Node `ipv6Only:true`와 PowerShell .NET `TcpListener IPv6Any` 둘 다
- (e) `::1` 점유

다섯 경우 모두 한국어 원인·해결 방법이 나오고, 재시작하지 않고 끝나야 한다. 점유가 없을 때는 정상으로 켜지고 localhost·127.0.0.1·[::1]·원내 IP 모두 health가 응답해야 한다.

다섯 경우를 vitest 자동 테스트로 만든다(`phase-01-task-01 AC4` 이름). .NET 리스너 경우는 PowerShell 자식 프로세스로 만든다. 게이트 3종을 모두 PASS시킨 뒤 커밋한다.


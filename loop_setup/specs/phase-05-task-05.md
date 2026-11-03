# 구현 워커 지시문 — phase-05-task-05

너는 치과 원내 업무 AX 웹 서비스의 **구현 워커**다. 이 작업 사본(main@e1aa623에서 갈라진 너의 브랜치)에서 태스크 하나를 끝까지 구현하고 직접 검사를 통과시킨 뒤, 브랜치에 커밋하고 worker_done으로 보고한다.

## 먼저 읽을 것
1. `CLAUDE.md`(문서 포인터·금지 사항)
2. 태스크 정의: `plan_setup/phase-05/phase-05-tasks/phase-05-task-05.md` — frontmatter의 acceptance_criteria가 완료 기준이다
3. `plan_setup/PLAN.md` §3 공유 파일 규칙(어기지 말 것)
4. `harness_setup/HARNESS.md`와 `harness_setup/quality_gates/*.md`(게이트 계약)
5. 태스크의 "설계 근거"에 적힌 `docs/ARCHITECTURE/` 절, 관련 `docs/PRD.md` FR/NFR, `docs/TRD.md` TD
6. 화면이 있으면 `docs/DESIGN.md`(승인 기준: 청록 A + 기본 밀도)와 `docs/design/preview.html`, 기준선 `harness_setup/evidence/design-baseline/`

## 해야 할 일
- 태스크 "범위"를 구현한다. 수용 기준마다 이를 확인하는 테스트를 만든다. 테스트 이름에 `phase-05-task-05 AC<번호>`를 넣는다(비화면: vitest, 화면·흐름: Playwright).
- 모든 새 소스 파일 첫 5줄 안에 `이 파일이 하는 일:` 한국어 주석, 주요 함수에 쉬운 한국어 설명을 단다. 화면·오류 문구는 쉬운 한국어로 쓴다.
- 의존성: `package-lock.json`이 있으면 시작할 때 `npm ci`. 새 런타임 의존성 추가는 금지(TD-023). 꼭 필요하면 추가하지 말고 보고에 "변경 요청"으로 적는다. (phase-01-task-01만 예외로 TD-023 목록 전체를 설치한다.)
- `web/dist/`는 git에 넣지 않는다(.gitignore). e2e 전에 필요하면 빌드만 한다.
- 포트·데이터: 이 워커는 **슬롯 0**이다. E2E는 `E2E_PORT=18090`, 수동 서버는 `PORT=18190`, 데이터는 작업 사본 안 `.tmp/`만 쓴다. 실제 `data/` 폴더나 8090 포트를 쓰지 않는다.
- 무거운 작업(e2e·스크린샷·npm ci)은 한 번에 하나씩 실행한다.

## 검사 (모두 PASS여야 커밋·보고)
```
node harness_setup/scripts/gate.mjs lint phase-05-task-05
node harness_setup/scripts/gate.mjs unit phase-05-task-05
node harness_setup/scripts/gate.mjs e2e phase-05-task-05
```
- 앞이 FAIL이면 고친 뒤 lint부터 다시 돌린다. 0건 통과·skip·flaky·--fix·스냅샷 갱신·기준 낮추기는 금지다.
- 화면 태스크는 `npm run screenshots`(있다면)로 해당 화면을 4너비×2테마로 찍고 직접 열어 DESIGN §5와 기준선을 대조한다. 확인한 파일과 문제를 보고에 적는다.
- 같은 방식으로 3번 실패하면 관찰·가설을 정리하고 다른 전략으로 바꾼다.

## 커밋
- 너의 브랜치에만 커밋한다: `git add -A && git commit -m "feat(phase-05-task-05): <요약>"`. push·merge·rebase main 금지.
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
- 목적: 사용자가 받을 그대로의 폴더에서 설치가 되는지 리허설하고, 최종 수치와 "검증한 것 / 미검증 / 사용자 할 일" 목록을 PROGRESS.md에 정리한다.
- 리허설 방법
  - `git archive HEAD`를 이 작업 사본 안 `.tmp/install-rehearsal/`에 푼다. node_modules·data가 없어야 한다.
  - web/dist는 이제 저장소에 들어 있다(c7f7326). 따로 빌드하지 않은 상태로 화면이 떠야 한다.
  - 그 폴더에서 `cmd /c .\start.bat`을 실행한다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패하므로 `.\`를 붙인다.
  - 환경 변수
    - `PORT=18190`
    - 브라우저 자동 열기를 끄는 변수가 있으면 쓴다. server/main.ts에서 확인한다.
    - 서버 PC처럼 `--omit=dev` 설치가 일어나는지 확인한다(start-main.cmd는 node_modules\vitest가 없으면 --omit=dev).
  - 기록할 것
    - 출력 로그 전체
    - npm ci 소요 시간
    - 서버 응답(/api/health)
    - / → /setup 이동과 "첫 설정" 화면(스크린샷)
  - 첫 설정(데모 데이터 넣기)을 마친 뒤 주요 화면 몇 개를 열어 확인한다.
  - 끄기는 그 폴더의 stop.bat으로 한다.
  - 끝나면 .tmp/install-rehearsal를 지운다(파일을 쥐고 있으면 남겨 두고 보고).
- 그 상태(이 작업 사본)에서 lint·unit·e2e 게이트 최종 수치를 기록한다.
- PROGRESS.md의 최종 보고용 목록
  - **검증한 것**: 각 phase 완료 태스크와 독립 검증 근거 경로(harness_setup/evidence/<ID>/validation-*.md), 성능(docs/PERF.md), 보안(docs/SECURITY.md), 설치 리허설
  - **미검증**
    - 실제 AI 품질·실제 유료 키 동작(키 없음)
    - 실제 휴대폰 기기 PWA 설치와 알림
    - 다른 PC에서의 방화벽 허용 실제 접속
    - 더블클릭 실행(자동화는 cmd /c로만 확인)
    - 실제 바코드 스캐너·카메라 사진(phase-06 병합 시)
  - **사용자 할 일**
    - API 키 발급·입력(docs/LLM_GUIDE.md)
    - Windows 방화벽 개인 네트워크 허용
    - start.bat 더블클릭 확인
    - 관리자 2명 만들기
    - 백업 위치 확인
    - 실제 AI 답 품질 점검
    - 데모 데이터 초기화 후 실사용
    - 외부 공개 금지(docs/SECURITY.md 5절)
  - **사고·특이 사항**(조정자 기록 요약)
    - 2026-11-02 테스트용 가짜 키로 실제 Anthropic API에 요청 1건이 나갔다. 401로 거절되어 비용은 없었다. 이후 e2e 서버가 실제 공급자를 기본 차단한다.
    - 2026-11-03 검증 세션이 조정자의 e2e 서버 프로세스를 종료한 사고가 있었다. 이후 포트·프로세스 규칙을 추가했다.
  - plan_setup/LOG.md·STATE.md는 조정자가 관리하므로 건드리지 않는다(태스크 files 목록과 달리, 결과는 보고로만 넘긴다).
- phase-06(P2) 3건은 다른 작업 사본에서 구현 중이고 05-05 뒤에 병합한다. PROGRESS.md에는 "P2 진행 중"으로 적어 두면 조정자가 병합 뒤 갱신한다.
- 제품 코드는 고치지 않는다. 리허설에서 결함을 찾으면 재현 방법과 함께 보고한다(작은 문서 오류는 고쳐도 된다).


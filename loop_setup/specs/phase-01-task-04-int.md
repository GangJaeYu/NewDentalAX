# 구현 워커 지시문 — phase-01-task-04

너는 치과 원내 업무 AX 웹 서비스의 **구현 워커**다. 이 작업 사본(main@cadb5d6에서 갈라진 너의 브랜치)에서 태스크 하나를 끝까지 구현하고 직접 검사를 통과시킨 뒤, 브랜치에 커밋하고 worker_done으로 보고한다.

## 먼저 읽을 것
1. `CLAUDE.md`(문서 포인터·금지 사항)
2. 태스크 정의: `plan_setup/phase-01/phase-01-tasks/phase-01-task-04.md` — frontmatter의 acceptance_criteria가 완료 기준이다
3. `plan_setup/PLAN.md` §3 공유 파일 규칙(어기지 말 것)
4. `harness_setup/HARNESS.md`와 `harness_setup/quality_gates/*.md`(게이트 계약)
5. 태스크의 "설계 근거"에 적힌 `docs/ARCHITECTURE/` 절, 관련 `docs/PRD.md` FR/NFR, `docs/TRD.md` TD
6. 화면이 있으면 `docs/DESIGN.md`(승인 기준: 청록 A + 기본 밀도)와 `docs/design/preview.html`, 기준선 `harness_setup/evidence/design-baseline/`

## 해야 할 일
- 태스크 "범위"를 구현한다. 수용 기준마다 이를 확인하는 테스트를 만든다. 테스트 이름에 `phase-01-task-04 AC<번호>`를 넣는다(비화면: vitest, 화면·흐름: Playwright).
- 모든 새 소스 파일 첫 5줄 안에 `이 파일이 하는 일:` 한국어 주석, 주요 함수에 쉬운 한국어 설명을 단다. 화면·오류 문구는 쉬운 한국어로 쓴다.
- 의존성: `package-lock.json`이 있으면 시작할 때 `npm ci`. 새 런타임 의존성 추가는 금지(TD-023). 꼭 필요하면 추가하지 말고 보고에 "변경 요청"으로 적는다. (phase-01-task-01만 예외로 TD-023 목록 전체를 설치한다.)
- `web/dist/`는 git에 넣지 않는다(.gitignore). e2e 전에 필요하면 빌드만 한다.
- 포트·데이터: 이 워커는 **슬롯 0**이다. E2E는 `E2E_PORT=18090`, 수동 서버는 `PORT=18190`, 데이터는 작업 사본 안 `.tmp/`만 쓴다. 실제 `data/` 폴더나 8090 포트를 쓰지 않는다.
- 무거운 작업(e2e·스크린샷·npm ci)은 한 번에 하나씩 실행한다.

## 검사 (모두 PASS여야 커밋·보고)
```
node harness_setup/scripts/gate.mjs lint phase-01-task-04
node harness_setup/scripts/gate.mjs unit phase-01-task-04
node harness_setup/scripts/gate.mjs e2e phase-01-task-04
```
- 앞이 FAIL이면 고친 뒤 lint부터 다시 돌린다. 0건 통과·skip·flaky·--fix·스냅샷 갱신·기준 낮추기는 금지다.
- 화면 태스크는 `npm run screenshots`(있다면)로 해당 화면을 4너비×2테마로 찍고 직접 열어 DESIGN §5와 기준선을 대조한다. 확인한 파일과 문제를 보고에 적는다.
- 같은 방식으로 3번 실패하면 관찰·가설을 정리하고 다른 전략으로 바꾼다.

## 커밋
- 너의 브랜치에만 커밋한다: `git add -A && git commit -m "feat(phase-01-task-04): <요약>"`. push·merge·rebase main 금지.
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
**통합 수정 작업이다.** 01-04(디자인 시스템·앱 셸)를 main에 병합했고(cadb5d6), main에는 02-02(AI 게이트웨이)와 01-01 시도 4도 들어 있다. 01-04 워커 브랜치에서는 e2e 15건이 모두 통과했다. 그런데 병합된 main에서는 1건이 실패한다.

실패
- 테스트: `tests/e2e/app-shell.spec.ts` "phase-01-task-04 AC4: 로그인 화면과 셸(라이트·다크) axe 위반이 0건이다"
- 증상: 로그인한 뒤 `/` 셸은 정상이다. 그런데 `/inventory`(스텁 페이지)로 이동하면 main 영역이 `status "화면 불러오는 중"`에 머물러 "준비 중인 화면이에요"가 끝내 나오지 않는다(30초 시간 초과).
- 재현: `E2E_PORT=18090 npx playwright test tests/e2e/app-shell.spec.ts -g "axe"`. 이 실패 때문에 같은 describe의 뒤 테스트 3건(AC4 Tab, AC5 글꼴, AC6 연결 띠)이 실행되지 않는다(serial).

조사할 것
- 지연 로딩 청크 요청이 실패하는지(404, CSP, 원내망, 정적 파일 처리)
- 02-02가 app.ts에 넣은 변경(decorate, 라우트)이 정적 파일이나 SPA 폴백 경로를 가리는지
- `/api/...` 요청 하나가 끝나지 않는지(예: 새 API 규칙 때문에 403·401 처리 중 무한 대기)

trace는 `artifacts/e2e/test-results/` 아래 trace.zip에 있다.

원인을 고치고 다음을 확인한다.
- 위 spec 전체(15건)와 게이트 3종이 PASS한다.
- 수정이 01-04 화면 동작(스크린샷 기준)을 바꾸지 않는다.
- 원인이 테스트 쪽(기대값·대기)이면 근거를 남긴다. 기준을 낮춰서 통과시키지 않는다.
- 커밋 메시지: `fix(phase-01-task-04): 통합 후 ...`
- 진행 중인 02-04(알림) 워커의 파일(server/modules/notifications/**, server/jobs/**, web/src/lib/useNotifications.ts, web/src/pages/notifications/**)은 건드리지 않는다.


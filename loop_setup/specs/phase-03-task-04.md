# 구현 워커 지시문 — phase-03-task-04

너는 치과 원내 업무 AX 웹 서비스의 **구현 워커**다. 이 작업 사본(main@d12e007에서 갈라진 너의 브랜치)에서 태스크 하나를 끝까지 구현하고 직접 검사를 통과시킨 뒤, 브랜치에 커밋하고 worker_done으로 보고한다.

## 먼저 읽을 것
1. `CLAUDE.md`(문서 포인터·금지 사항)
2. 태스크 정의: `plan_setup/phase-03/phase-03-tasks/phase-03-task-04.md` — frontmatter의 acceptance_criteria가 완료 기준이다
3. `plan_setup/PLAN.md` §3 공유 파일 규칙(어기지 말 것)
4. `harness_setup/HARNESS.md`와 `harness_setup/quality_gates/*.md`(게이트 계약)
5. 태스크의 "설계 근거"에 적힌 `docs/ARCHITECTURE/` 절, 관련 `docs/PRD.md` FR/NFR, `docs/TRD.md` TD
6. 화면이 있으면 `docs/DESIGN.md`(승인 기준: 청록 A + 기본 밀도)와 `docs/design/preview.html`, 기준선 `harness_setup/evidence/design-baseline/`

## 해야 할 일
- 태스크 "범위"를 구현한다. 수용 기준마다 이를 확인하는 테스트를 만든다. 테스트 이름에 `phase-03-task-04 AC<번호>`를 넣는다(비화면: vitest, 화면·흐름: Playwright).
- 모든 새 소스 파일 첫 5줄 안에 `이 파일이 하는 일:` 한국어 주석, 주요 함수에 쉬운 한국어 설명을 단다. 화면·오류 문구는 쉬운 한국어로 쓴다.
- 의존성: `package-lock.json`이 있으면 시작할 때 `npm ci`. 새 런타임 의존성 추가는 금지(TD-023). 꼭 필요하면 추가하지 말고 보고에 "변경 요청"으로 적는다. (phase-01-task-01만 예외로 TD-023 목록 전체를 설치한다.)
- `web/dist/`는 git에 넣지 않는다(.gitignore). e2e 전에 필요하면 빌드만 한다.
- 포트·데이터: 이 워커는 **슬롯 2**이다. E2E는 `E2E_PORT=18092`, 수동 서버는 `PORT=18192`, 데이터는 작업 사본 안 `.tmp/`만 쓴다. 실제 `data/` 폴더나 8090 포트를 쓰지 않는다.
- 무거운 작업(e2e·스크린샷·npm ci)은 한 번에 하나씩 실행한다.

## 검사 (모두 PASS여야 커밋·보고)
```
node harness_setup/scripts/gate.mjs lint phase-03-task-04
node harness_setup/scripts/gate.mjs unit phase-03-task-04
node harness_setup/scripts/gate.mjs e2e phase-03-task-04
```
- 앞이 FAIL이면 고친 뒤 lint부터 다시 돌린다. 0건 통과·skip·flaky·--fix·스냅샷 갱신·기준 낮추기는 금지다.
- 화면 태스크는 `npm run screenshots`(있다면)로 해당 화면을 4너비×2테마로 찍고 직접 열어 DESIGN §5와 기준선을 대조한다. 확인한 파일과 문제를 보고에 적는다.
- 같은 방식으로 3번 실패하면 관찰·가설을 정리하고 다른 전략으로 바꾼다.

## 커밋
- 너의 브랜치에만 커밋한다: `git add -A && git commit -m "feat(phase-03-task-04): <요약>"`. push·merge·rebase main 금지.
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
- 소유
  - `server/modules/desk/{posts,checklists}*`
  - `server/modules/desk/routes.ts`(등록부. saved-texts는 03-05가 나중에 붙인다)
  - `server/db/migrations/030_desk.sql`
  - `web/src/pages/desk/{BoardPage,BoardDetailPage,ChecklistPage}.tsx`
  - `web/src/pages/print/` 아래 체크리스트 인쇄 페이지. routes.tsx에 등록된 load 경로를 확인한다.
- 03-06(문서)이 동시에 "회의록의 할 일을 인수인계로 보내기"를 만든다. 그쪽은 화면에서 `POST /api/posts {kind:'handover', ...}`를 부른다. 이 API 계약(backend.md §3.4)을 그대로 지킨다.
- 현재 main(01-01·01-02·01-03·01-06·02-01·02-02 completed, 01-04 병합)의 공통 규칙
  - **e2e는 `tests/e2e/fixtures.ts`의 `test`·`expect`를 import한다.** spec 파일마다 격리 서버가 뜬다. 역할별 계정은 `addUser()`로 만든다. 자세한 내용은 `harness_setup/quality_gates/e2e.md`.
  - 화면: `web/src/routes.tsx`(01-04 소유)에 모든 경로가 이미 등록돼 있다. **네 태스크의 `web/src/pages/.../*.tsx` 파일만 교체**한다(routes.tsx, layout/**는 수정 금지). 공용 컴포넌트는 `web/src/components/`(01-04)를 쓰고, 고칠 일이 있으면 보고에 변경 요청으로 적는다.
  - API 권한: 중앙 표 `server/auth/api-permissions.ts`(API_RULES)와 `server/auth/guard.ts`. 응답은 `{data}`, 오류는 `AppError`(server/lib/errors.ts). 감사 기록은 `server/lib/audit.ts`.
  - 알림: `server/modules/notifications/emit.ts`의 emitNotification(02-04가 확장 중)
  - AI 호출: `server/ai/gateway.ts`(02-02), 화면용 상태는 `GET /api/ai/status`
- 무거운 검사(e2e·스크린샷)를 돌릴 때 PC 부하가 크면 axe 같은 검사가 느려진다. 한 테스트에 오래 걸리는 검사를 몰지 말고 화면 단위로 나눈다.
- **알려진 실패(조정자가 다른 워커에게 수정을 맡김)**: 지금 main 전체 unit에서 백업 테스트 2건이 다른 파일과 간섭해서 실패한다.
  - `server/jobs/backup-job.test.ts`의 AC3 날짜 변경
  - `server/modules/admin/backup.test.ts`의 503 범위
  - 따로 돌리면 통과한다.
  - 네 게이트 unit이 **이 2건 때문에만** 실패하면 다음 순서로 한다.
    1. 마지막 커밋 전에 `git merge main`으로 최신 main을 받는다(수정이 들어왔을 수 있음).
    2. 다시 돌린다.
    3. 그래도 이 2건만 실패하면 커밋하고, 보고에 "알려진 실패 2건 외 PASS"와 건수를 정확히 적는다.
  - 그 밖의 실패는 네가 고친다.
- `scripts/screenshots.ts` PAGES에는 네 화면을 **배열 맨 끝**에 추가한다(병합 충돌은 조정자가 정리한다).
- 데모 데이터: 네 모듈의 `server/modules/<m>/seed.ts`에서 `tables`와 `seedDemo`를 채운다(database.md §11, 하늘숲치과, 환자 정보 없음). 02-05가 만든 registry·초기화가 이 정보를 쓴다.
- 기한형 알림: `server/jobs/notify-job.ts`(02-04)의 scanner 등록 지점을 쓴다. 즉시 알림은 `server/modules/notifications/emit.ts`를 쓴다.


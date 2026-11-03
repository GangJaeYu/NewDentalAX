# 구현 워커 지시문 — phase-06-task-03

너는 치과 원내 업무 AX 웹 서비스의 **구현 워커**다. 이 작업 사본(main@c7f7326에서 갈라진 너의 브랜치)에서 태스크 하나를 끝까지 구현하고 직접 검사를 통과시킨 뒤, 브랜치에 커밋하고 worker_done으로 보고한다.

## 먼저 읽을 것
1. `CLAUDE.md`(문서 포인터·금지 사항)
2. 태스크 정의: `plan_setup/phase-06/phase-06-tasks/phase-06-task-03.md` — frontmatter의 acceptance_criteria가 완료 기준이다
3. `plan_setup/PLAN.md` §3 공유 파일 규칙(어기지 말 것)
4. `harness_setup/HARNESS.md`와 `harness_setup/quality_gates/*.md`(게이트 계약)
5. 태스크의 "설계 근거"에 적힌 `docs/ARCHITECTURE/` 절, 관련 `docs/PRD.md` FR/NFR, `docs/TRD.md` TD
6. 화면이 있으면 `docs/DESIGN.md`(승인 기준: 청록 A + 기본 밀도)와 `docs/design/preview.html`, 기준선 `harness_setup/evidence/design-baseline/`

## 해야 할 일
- 태스크 "범위"를 구현한다. 수용 기준마다 이를 확인하는 테스트를 만든다. 테스트 이름에 `phase-06-task-03 AC<번호>`를 넣는다(비화면: vitest, 화면·흐름: Playwright).
- 모든 새 소스 파일 첫 5줄 안에 `이 파일이 하는 일:` 한국어 주석, 주요 함수에 쉬운 한국어 설명을 단다. 화면·오류 문구는 쉬운 한국어로 쓴다.
- 의존성: `package-lock.json`이 있으면 시작할 때 `npm ci`. 새 런타임 의존성 추가는 금지(TD-023). 꼭 필요하면 추가하지 말고 보고에 "변경 요청"으로 적는다. (phase-01-task-01만 예외로 TD-023 목록 전체를 설치한다.)
- `web/dist/`는 git에 넣지 않는다(.gitignore). e2e 전에 필요하면 빌드만 한다.
- 포트·데이터: 이 워커는 **슬롯 3**이다. E2E는 `E2E_PORT=18093`, 수동 서버는 `PORT=18193`, 데이터는 작업 사본 안 `.tmp/`만 쓴다. 실제 `data/` 폴더나 8090 포트를 쓰지 않는다.
- 무거운 작업(e2e·스크린샷·npm ci)은 한 번에 하나씩 실행한다.

## 검사 (모두 PASS여야 커밋·보고)
```
node harness_setup/scripts/gate.mjs lint phase-06-task-03
node harness_setup/scripts/gate.mjs unit phase-06-task-03
node harness_setup/scripts/gate.mjs e2e phase-06-task-03
```
- 앞이 FAIL이면 고친 뒤 lint부터 다시 돌린다. 0건 통과·skip·flaky·--fix·스냅샷 갱신·기준 낮추기는 금지다.
- 화면 태스크는 `npm run screenshots`(있다면)로 해당 화면을 4너비×2테마로 찍고 직접 열어 DESIGN §5와 기준선을 대조한다. 확인한 파일과 문제를 보고에 적는다.
- 같은 방식으로 3번 실패하면 관찰·가설을 정리하고 다른 전략으로 바꾼다.

## 커밋
- 너의 브랜치에만 커밋한다: `git add -A && git commit -m "feat(phase-06-task-03): <요약>"`. push·merge·rebase main 금지.
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
- **P2 선행 시작 안내**: 이 태스크의 선행 05-05(설치 리허설)는 아직 진행 전이다. 조정자가 파일이 겹치지 않는 범위에서 먼저 시작시킨다. 병합은 05-05가 끝난 뒤에 한다.
- **web/dist(중요)**: web/dist는 이제 저장소에 들어 있다(설치 PC용 최종 빌드). e2e가 다시 빌드해서 작업 사본이 바뀌어도 **web/dist 변경은 커밋하지 않는다.** 커밋 전에 `git checkout -- web/dist`와 `git clean -fdq web/dist`로 되돌린다. 병합 뒤 조정자가 다시 빌드해 커밋한다.
- 새 의존성을 추가해야 하면, 순수 JS만 쓴다(네이티브 빌드 금지). CSP(eval·wasm 금지)를 지키는 것을 고르고, 근거를 worker_done 보고의 "결정 후보"에 적는다. package.json·잠금 파일 변경은 허용한다.
- 실제 LLM 공급자로 요청을 보내지 않는다(유료 호출 금지). 공급자 동작은 기존 가짜 서버 방식(AI_BASE_URL, 02-02·02-03 테스트 참고)으로 확인한다.
- 화면은 docs/DESIGN.md §5 기준(4너비×2테마, 390px은 innerWidth 390 유지까지 확인, tests/e2e/layout.ts 사용)과 axe 0건을 지킨다.
- 새 AI 기능 `transcribe`를 shared/ai-features.ts와 server/ai/features/transcribe.ts에 추가한다(이 태스크에 공유 파일 수정을 허용한다. 06-02도 같은 파일에 `roster_suggest`를 추가하므로, 목록 끝에 한 줄로 덧붙여 병합 충돌을 작게 한다).
- 공급자: OpenAI(음성 받아쓰기 API)와 Gemini(오디오 입력)는 지원, Anthropic은 음성 입력이 없으므로 "지금 설정된 AI는 음성을 지원하지 않아요" 같은 비활성 안내. 공식 문서로 현재 엔드포인트·모델 이름·가격을 확인하고, 가격표(server/ai/pricing.ts 방식)에 분 단위 또는 토큰 단위 비용을 넣어 비용 기록·예산 차단이 동작하게 한다.
- 데모 모드: 예시 전사문(환자 정보 없는 회의 내용)을 돌려주고, 기존 회의록 요약 화면(minutes)으로 이어지게 한다.
- 20MB 넘는 파일은 서버와 화면 둘 다에서 거부하고 쉬운 안내를 보인다. 받는 형식은 휴대폰 녹음 앱 파일(m4a·mp3·wav·webm 등)이다.
- 업로드 화면에 "환자 이야기가 들어간 녹음은 올리지 마세요" 경고를 보인다. 전사문은 기존 개인정보 가림을 거친 뒤 요약에 넘긴다.
- 음성 파일은 서버에 오래 남기지 않는다(처리 뒤 지운다).


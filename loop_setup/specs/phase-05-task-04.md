# 구현 워커 지시문 — phase-05-task-04

너는 치과 원내 업무 AX 웹 서비스의 **구현 워커**다. 이 작업 사본(main@7c2214e에서 갈라진 너의 브랜치)에서 태스크 하나를 끝까지 구현하고 직접 검사를 통과시킨 뒤, 브랜치에 커밋하고 worker_done으로 보고한다.

## 먼저 읽을 것
1. `CLAUDE.md`(문서 포인터·금지 사항)
2. 태스크 정의: `plan_setup/phase-05/phase-05-tasks/phase-05-task-04.md` — frontmatter의 acceptance_criteria가 완료 기준이다
3. `plan_setup/PLAN.md` §3 공유 파일 규칙(어기지 말 것)
4. `harness_setup/HARNESS.md`와 `harness_setup/quality_gates/*.md`(게이트 계약)
5. 태스크의 "설계 근거"에 적힌 `docs/ARCHITECTURE/` 절, 관련 `docs/PRD.md` FR/NFR, `docs/TRD.md` TD
6. 화면이 있으면 `docs/DESIGN.md`(승인 기준: 청록 A + 기본 밀도)와 `docs/design/preview.html`, 기준선 `harness_setup/evidence/design-baseline/`

## 해야 할 일
- 태스크 "범위"를 구현한다. 수용 기준마다 이를 확인하는 테스트를 만든다. 테스트 이름에 `phase-05-task-04 AC<번호>`를 넣는다(비화면: vitest, 화면·흐름: Playwright).
- 모든 새 소스 파일 첫 5줄 안에 `이 파일이 하는 일:` 한국어 주석, 주요 함수에 쉬운 한국어 설명을 단다. 화면·오류 문구는 쉬운 한국어로 쓴다.
- 의존성: `package-lock.json`이 있으면 시작할 때 `npm ci`. 새 런타임 의존성 추가는 금지(TD-023). 꼭 필요하면 추가하지 말고 보고에 "변경 요청"으로 적는다. (phase-01-task-01만 예외로 TD-023 목록 전체를 설치한다.)
- `web/dist/`는 git에 넣지 않는다(.gitignore). e2e 전에 필요하면 빌드만 한다.
- 포트·데이터: 이 워커는 **슬롯 0**이다. E2E는 `E2E_PORT=18090`, 수동 서버는 `PORT=18190`, 데이터는 작업 사본 안 `.tmp/`만 쓴다. 실제 `data/` 폴더나 8090 포트를 쓰지 않는다.
- 무거운 작업(e2e·스크린샷·npm ci)은 한 번에 하나씩 실행한다.

## 검사 (모두 PASS여야 커밋·보고)
```
node harness_setup/scripts/gate.mjs lint phase-05-task-04
node harness_setup/scripts/gate.mjs unit phase-05-task-04
node harness_setup/scripts/gate.mjs e2e phase-05-task-04
```
- 앞이 FAIL이면 고친 뒤 lint부터 다시 돌린다. 0건 통과·skip·flaky·--fix·스냅샷 갱신·기준 낮추기는 금지다.
- 화면 태스크는 `npm run screenshots`(있다면)로 해당 화면을 4너비×2테마로 찍고 직접 열어 DESIGN §5와 기준선을 대조한다. 확인한 파일과 문제를 보고에 적는다.
- 같은 방식으로 3번 실패하면 관찰·가설을 정리하고 다른 전략으로 바꾼다.

## 커밋
- 너의 브랜치에만 커밋한다: `git add -A && git commit -m "feat(phase-05-task-04): <요약>"`. push·merge·rebase main 금지.
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
- 원문 12·13절의 문서를 비개발자(코딩을 모르는 치과의사)가 읽을 수 있게 쓴다. 문장은 쉽고 짧게 쓰고, 클릭 단위로 안내한다.
- 만들거나 갱신할 문서
  - `README.md`(원문 12절 항목 전부)
    - 할 수 있는 일(스크린샷 포함)
    - Windows 설치 단계와 막히기 쉬운 지점
    - 매일 켜고 끄기, 직원 PC·태블릿 접속(서버 주소 찾기, Windows 방화벽 허용 안내)
    - 첫 설정(관리자, 직원 추가, AI 키 입력)
    - 백업·복원, 업데이트, FAQ, 문제 해결
    - 폴더 지도("이 기능을 고치려면 이 파일")
    - 나중에 Claude Code로 수정을 요청하는 요령
    - 외부 공개 위험: `docs/SECURITY.md` 5절 문구를 옮긴다(05-02 요청).
    - Node.js는 24 LTS를 안내한다.
    - start.bat 확인 결과와 http 한계(TD-017)를 반영한다.
  - `docs/LLM_GUIDE.md`
    - LLM API를 쉬운 비유로 설명
    - 공급자 3곳의 키 발급 단계
    - 토큰·요금 구조
    - 키 관리 안전 수칙
  - `docs/COST.md`(원문 13절 항목 전부)
    - 공급자·모델 비교표: TRD TD-021 가격, 확인일, 출처 링크. 웹으로 다시 확인할 수 있으면 확인일을 오늘로 갱신한다.
    - 기능별 1회 평균 토큰 추정: 각 `server/ai/features/*.ts`의 프롬프트 크기와 최대 출력 기준
    - 소형(5명)·중형(10명)·대형(20명) 월 비용(원화, 환율 1,450원 가정 명시, 사용 횟수 가정 명시)
    - 추천 조합 하나와 이유
    - 절약 팁(기능별 저가 모델, 프롬프트 캐싱 등)
    - **공급자별 데이터 정책**: 입력을 학습에 쓰는지, 얼마나 보관하는지. 공식 페이지를 웹으로 확인하고 출처·확인일을 적는다(OQ-009의 남은 부분).
    - 서버 운영 비용 비교(원내 PC 0원 vs 클라우드)
  - `docs/PLAN.md`, `docs/DECISIONS.md`, `PROGRESS.md`: 최신 상태에 맞춘다(조정자 기록과 충돌하지 않게 요약 부분만).
  - `scripts/check-docs.ts`: 문서별 필수 소제목을 검사한다. lint의 `docs` 단계에 연결한다(quality_gates/lint.md, gate.mjs need 목록에 'docs' 추가).
- 스크린샷: README용 대표 화면은 `docs/images/`에 둔다(데모 데이터, 1440 라이트 중심, 휴대폰 1장).
  - 05-03(화면 점검)이 동시에 진행 중이라 마지막에 화면이 조금 바뀔 수 있다. 촬영 스크립트(어떤 화면을 어떤 이름으로 찍는지)를 남겨서 조정자가 05-03 병합 뒤 다시 찍을 수 있게 한다.
- 제품 코드는 고치지 않는다(문서와 검사 스크립트만).
- **스크린샷 화면 목록은 `scripts/screens/<태스크ID>.ts`에 `export const pages: ShotPage[]`로 둔다**(타입은 `scripts/screens/types.ts`). `scripts/screenshots.ts`는 고치지 않는다. 데모 데이터가 필요하면 `action`에서 넣는다. 03-04 방식(withDeskDemo)을 참고한다.
- 데모 데이터: 네 모듈의 `server/modules/<m>/seed.ts`에서 `tables`와 `seedDemo`를 채운다(database.md §11, 하늘숲치과, 환자 정보 없음). 02-05가 만든 registry·초기화가 이 정보를 쓴다.
- 기한형 알림: `server/jobs/notify-job.ts`(02-04)의 scanner 등록 지점을 쓴다. 즉시 알림은 `server/modules/notifications/emit.ts`를 쓴다.
- **포트와 프로세스(엄수)**
  - 네 슬롯 포트만 쓴다.
  - 프로세스는 네가 띄운 자식의 핸들로만 종료한다. PID로 종료해야 하면, 명령줄의 작업 폴더가 네 작업 사본인지 먼저 확인한다. 확인할 수 없으면 종료하지 않는다.
  - e2e는 gate.mjs가 PC 전체에서 동시에 2개까지만 돌린다. 자리가 날 때까지 기다리는 것이 정상이다.


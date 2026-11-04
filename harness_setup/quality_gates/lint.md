# Gate 1 — lint (정적 오류)

- **대상·근거**: 모든 태스크의 정적 품질 기준. NFR-010(머리 주석), NFR-011(문서 소제목, 05-04 이후), TD-018, TD-007(`dangerouslySetInnerHTML` 금지)
- **명령**: `node harness_setup/scripts/gate.mjs lint <태스크ID>` (내부에서 `npm run lint` 실행)
- **`npm run lint`의 계약**(phase-01-task-01이 만든다)
  - 각 단계를 실행하고 단계마다 `[lint:<단계>] checked <N>`을 출력한다.

    | 단계 | 내용 | 활성 시점 |
    |---|---|---|
    | `tsc-server` | `tsc --noEmit -p config/tsconfig.server.json` | 01-01 |
    | `tsc-web` | `tsc --noEmit -p web/tsconfig.json` | 01-01 |
    | `eslint` | `eslint .`(쓰기 옵션 없음). 규칙: typescript-eslint 권장, react-hooks, `react/no-danger`, `no-restricted-syntax`(`.only`·`.skip` 금지) | 01-01 |
    | `headers` | `scripts/check-file-headers.ts`(모든 소스의 첫 5줄 안에 "이 파일이 하는 일") | 01-01 |
    | `docs` | `scripts/check-docs.ts`(원문 12·13절 필수 소제목) | 05-04 |
  - `docs` 단계는 phase-05-task-04가 `scripts/lint.ts`에 연결하고 gate.mjs의 `need` 목록에 추가했다(2026-11-03). 검사 항목: 문서 7개의 필수 소제목, COST.md 가격·데이터 정책 표 줄마다 확인일·출처 URL, README 그림 파일 존재(5장 이상).
- **통과 조건**: 종료 코드 0, 그리고 필수 단계 모두 N > 0. 단계 줄이 없거나 N=0이면 FAIL이다(검사가 돌지 않은 것을 통과로 세지 않는다).
- **금지**: `--fix`, 포매터 쓰기, 규칙을 끄는 주석을 판정 중에 추가하는 것. 규칙 예외가 필요하면 구현 단계에서 근거와 함께 추가하고 DECISIONS.md에 기록한다.
- **상태**
  - **미활성(2026-11-02)**: `package.json`이 없다. gate.mjs가 `INACTIVE`(종료 코드 3)를 낸다. 이것은 통과가 아니다.
  - **활성화 담당**: phase-01-task-01

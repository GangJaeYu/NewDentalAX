# evidence — 채택한 검증 증거

- `runs/`: gate.mjs 실행 로그. 파일 이름은 `<시각>-<태스크ID>-<게이트>.log`이고, 첫 줄에 판정·커밋·미커밋 여부가 있다.
- `<태스크ID>/`: 그 태스크의 task_validation 결과 원문, 채택한 스크린샷·PDF
- `design-baseline/`: 승인 시안 v2 기준선(8장)

## 하네스 준비 실행 기록 (2026-11-02)

| 확인 | 명령 | 결과 |
|---|---|---|
| 사전 점검 | `node harness_setup/scripts/preflight.mjs` | 12개 항목 OK. Playwright 항목은 프로젝트 설치 전이라 건너뜀이고, 별도 실험으로 확인했다 |
| Playwright + Edge | 임시 폴더의 playwright-core 1.49.1로 시안 촬영 | 8장 생성. 8장 모두 가로 스크롤 없음, 글꼴 확인 true |
| 미활성 판정 | `gate.mjs unit phase-01-task-01` | INACTIVE(종료 코드 3), 로그 `runs/2026-11-02T09-28-11-333Z-phase-01-task-01-unit.log` |
| 판정 로직 | 가짜 package.json 출력 8가지로 gate.mjs 실행 | 기대한 대로 판정함: unit PASS, skip FAIL, 0건 FAIL, 종료 코드 FAIL, e2e PASS, flaky FAIL, lint PASS, lint 단계 누락 FAIL |
| 인계서 | `task-brief.mjs phase-03-task-01` / 잘못된 ID | 정상 출력 / 종료 코드 2 |

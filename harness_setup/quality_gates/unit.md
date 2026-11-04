# Gate 2 — unit (기능·계약)

- **대상·근거**: 서버 service·route 계약(backend.md), DB 계산 규칙(database.md), 개인정보 필터(FR-032 AC6), AI 게이트웨이(가짜 공급자), 날짜 계산, 권한 표(FR-003 AC1), 스키마 개인정보 검사(NFR-001), 화면 순수 로직
- **명령**: `node harness_setup/scripts/gate.mjs unit <태스크ID>` (내부에서 `npm run test:unit` = `vitest run --config config/vitest.config.ts`. 파일 하나만 돌릴 때도 `--config config/vitest.config.ts`를 붙인다)
- **실행 전제**
  - 테스트마다 임시 DATA_DIR을 쓰고, 실제 `data/` 폴더를 건드리지 않는다.
  - 시간은 주입 clock을 쓴다.
  - 공급자 호출은 `tests/fake-llm` 가짜 HTTP 서버로 한다. 실제 API 키는 쓰지 않는다.
  - 통합 테스트는 `fastify.inject`로 실제 라우트·DB를 거친다. 원격 IP는 `remoteAddress`로 흉내 낸다.
- **통과 조건**
  - 종료 코드 0
  - `Tests N passed`에서 N > 0
  - skipped·todo 0
- **태스크 대응**: 각 태스크의 수용 기준 중 비화면 기준(저장값, 응답 코드, 계산 결과, 감사 로그, 알림 생성)은 테스트 이름에 태스크 ID와 기준 번호를 넣는다(예: `phase-03-task-01 AC3: 적정 6 현재 5 → 부족`). 검증자가 기준과 테스트를 바로 대응시키게 하기 위해서다.
- **금지**: `-u`(스냅샷 갱신), `.only`, `.skip`, 기대값을 구현에 맞춰 낮추는 수정. 기대값 변경은 PRD·태스크 기준이 바뀐 경우에만 하고, 그 근거를 LOG에 남긴다.
- **상태**
  - **미활성(2026-11-02)**
  - **활성화 담당**: phase-01-task-01(health 테스트 1건 이상)

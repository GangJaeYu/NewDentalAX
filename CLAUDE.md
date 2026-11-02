# 작업 지침 포인터 (에이전트용)

- 재개 지점: `plan_setup/STATE.md` → 태스크 파일(`plan_setup/phase-NN/phase-NN-tasks/`) 상태가 정본
- 루프 운영: `loop_setup/LOOP.md`
- 검증: `harness_setup/HARNESS.md` (게이트 순서 lint → unit → e2e → task_validation, `node harness_setup/scripts/gate.mjs <gate> <태스크ID>`)
- 요구·기술·설계·디자인: `docs/PRD.md`(자율운영 합의 포함) · `docs/TRD.md` · `docs/ARCHITECTURE/` · `docs/DESIGN.md`
- 공유 파일 규칙: `plan_setup/PLAN.md` §3 (권한 표·AI 기능 목록·라우트·seed·마이그레이션 번호)
- 결정 기록: `docs/DECISIONS.md`에 덧붙인다
- 모든 소스 파일 첫 5줄 안에 `이 파일이 하는 일:` 한국어 주석을 둔다. 화면 문구와 오류 문구는 쉬운 한국어로 쓴다
- 금지: 환자 정보 필드, 실제 LLM API 유료 호출, git push, 이 폴더 밖 수정, 시스템 전역 설정 변경

---
id: phase-01-task-02
status: pending
phase: "01"
title: "DB 래퍼·마이그레이션·공통 라이브러리"
depends_on: [phase-01-task-01]
files:
  - "server/db/**"
  - "server/lib/**"
  - "shared/enums.ts"
  - "tests/schema-privacy.test.ts"
acceptance_criteria:
  - "빈 폴더에서 서버를 시작하면 data/app.db가 생성되고 schema_version이 최신이며, 두 번째 시작에서는 마이그레이션이 다시 적용되지 않는다"
  - "audit_log 행에 UPDATE나 DELETE를 실행하면 오류가 나고 행이 그대로 남는다(테스트)"
  - "스키마 개인정보 검사 테스트가 실행되어 통과하고, 금지어 열(예: patient_name)을 임시 마이그레이션으로 추가하면 실패한다"
  - "dates 단위 테스트: 2026-01-31+1개월, 윤년, KST 자정 경계, D-day(오늘=0, 지남=음수)가 기대값과 일치한다"
verification: [lint, unit, e2e, task_validation]
---

# phase-01-task-02 — DB 래퍼·마이그레이션·공통 라이브러리

- **관련 요구·결정**: NFR-001, NFR-004, FR-005(기반), TD-003·020
- **설계 근거**: database.md §1·§4·§5, overview.md §2 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-01

## 범위
- server/db/index.ts(open/close/tx/all/get/run, WAL, foreign_keys), migrate.ts, migrations/001_core.sql(settings, users, sessions, login_attempts, audit_log+트리거, notifications, files)
- 마이그레이션 번호 예약표(모듈별 파일명)를 plan_setup/PLAN.md "공유 파일 규칙"대로 따른다
- seed 등록 구조: server/db/seed/registry.ts — 각 모듈이 `server/modules/<m>/seed.ts`에서 `{ tables, seedDemo(db, ctx) }`를 export하면 등록 목록에서 호출(이 태스크에서 모든 모듈 이름을 미리 등록하고 빈 seed 파일 생성)
- lib: clock(주입), dates(KST, D-day, 월 경계, 주기 더하기), errors(AppError + 한국어 코드표 backend.md §2), audit(ctx, ...)
- tests/schema-privacy.test.ts(database.md §4 금지어 검사, 마이그레이션 전체 적용 후 실행)

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

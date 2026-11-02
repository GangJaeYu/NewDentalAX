# phase-02 — 공통 플랫폼: AI 게이트웨이·개인정보·알림·백업

**목표**: 모든 AI 기능이 지나갈 단일 통로(권한·예산·개인정보·비용·오류)와 알림·백업·데모 데이터 틀을 완성해 모듈 태스크가 호출만 하면 되게 한다.

## 묶음 수용 기준
- 키 없이 데모 모드로 AI 호출이 기록되고, 가짜 공급자 서버로 세 공급자 형식이 검증된다
- 개인정보 감지 테스트 50개 이상 통과
- 백업 생성·복원·보관 개수 정리가 테스트로 확인된다
- 소속 태스크가 모두 completed(각자 네 게이트·별도 세션 검증 통과)여야 phase 완료로 판정한다.

## 태스크
| ID | 제목 | 선행 |
|---|---|---|
| [phase-02-task-01](phase-02-tasks/phase-02-task-01.md) | 개인정보 필터(서버·화면) | phase-01-task-02 |
| [phase-02-task-02](phase-02-tasks/phase-02-task-02.md) | AI 게이트웨이·공급자 어댑터·비용·예산 | phase-02-task-01 |
| [phase-02-task-03](phase-02-tasks/phase-02-task-03.md) | AI 관리 화면·AI 공용 화면 부품 | phase-02-task-02, phase-01-task-04 |
| [phase-02-task-04](phase-02-tasks/phase-02-task-04.md) | 알림 서비스·스케줄러 | phase-01-task-03 |
| [phase-02-task-05](phase-02-tasks/phase-02-task-05.md) | 백업·복원·데모 데이터 적재/초기화 | phase-01-task-02, phase-01-task-04 |

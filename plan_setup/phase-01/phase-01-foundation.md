# phase-01 — 기반: 골격·DB·인증·디자인 시스템

**목표**: 빈 서비스를 실행해 첫 설정 → 로그인 → 역할별 메뉴가 보이는 앱 셸까지 동작하게 하고, 이후 모듈이 충돌 없이 붙을 공통 규칙(권한 표, 모듈 등록, 마이그레이션 번호, seed 등록, 화면 경로)을 고정한다.

## 묶음 수용 기준
- 새 data 폴더로 `npm start` 후 브라우저에서 /setup → 관리자 생성 → 대시보드 셸(빈 카드 상태)까지 진행된다
- 역할 3종 계정으로 로그인했을 때 메뉴가 shared/roles.ts 표대로 다르게 보이고, 숨겨진 API는 403이다
- lint·unit·e2e 게이트가 실제 테스트를 1개 이상씩 실행해 통과한다(0건 통과는 불인정)
- 소속 태스크가 모두 completed(각자 네 게이트·별도 세션 검증 통과)여야 phase 완료로 판정한다.

## 태스크
| ID | 제목 | 선행 |
|---|---|---|
| [phase-01-task-01](phase-01-tasks/phase-01-task-01.md) | 프로젝트 골격·도구·실행 스크립트 | — |
| [phase-01-task-02](phase-01-tasks/phase-01-task-02.md) | DB 래퍼·마이그레이션·공통 라이브러리 | phase-01-task-01 |
| [phase-01-task-03](phase-01-tasks/phase-01-task-03.md) | 인증·세션·CSRF·권한·원내망·보안 헤더 | phase-01-task-02 |
| [phase-01-task-04](phase-01-tasks/phase-01-task-04.md) | 디자인 시스템·앱 셸·첫 설정/로그인 화면 | phase-01-task-03 |
| [phase-01-task-05](phase-01-tasks/phase-01-task-05.md) | 사용자 관리·병원 정보·활동 기록 화면 | phase-01-task-04 |
| [phase-01-task-06](phase-01-tasks/phase-01-task-06.md) | [위험 해소] 한글 문서 검색 품질 실험 (OQ-008) | phase-01-task-02 |

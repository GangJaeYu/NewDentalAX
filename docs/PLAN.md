# PLAN — 계획 요약 (원문 0단계 산출물)

이 문서는 원문 요구서가 요구한 "계획" 문서의 요약본이다. 자세한 내용은 아래 정본 문서에 있다.

| 원문이 요구한 항목 | 정본 위치 |
|---|---|
| 기능 목록 (필수 MVP / 확장 구분) | `docs/PRD.md` §4(P0·P1·P2)·§5(FR-001~132) |
| 화면 목록 | `docs/ARCHITECTURE/frontend.md` §3(경로 40여 개), 시안 `docs/design/preview.html` |
| 데이터 구조 | `docs/ARCHITECTURE/database.md` |
| API·처리 흐름 | `docs/ARCHITECTURE/backend.md`, `overview.md` §3 |
| 단계별 완료 기준 | `plan_setup/PLAN.md`(phase 01~06), 각 phase 문서의 "묶음 수용 기준", 각 태스크 frontmatter의 `acceptance_criteria` |
| 진행 상황 | `PROGRESS.md`(사람용 요약), `plan_setup/STATE.md`(재개 지점) |
| 결정과 이유 | `docs/DECISIONS.md`, `docs/TRD.md` |

## 단계 요약

| 단계 | 내용 | 완료 기준 요약 |
|---|---|---|
| 0 계획 | IDEA·PRD·TRD·Architecture·Plan·디자인 시안 승인 | 이 문서들과 사용자 확인(2026-11-02) |
| 1 기반 (phase-01) | 골격, DB, 로그인·권한, 디자인 시스템, 실행 스크립트 | 첫 설정 → 로그인 → 역할별 메뉴, 게이트 3종 실제 통과 |
| 2 공통 플랫폼 (phase-02) | AI 게이트웨이, 개인정보 필터, 알림, 백업·데모 | 데모 AI 기록, 필터 테스트 50개 이상, 백업·복원 확인 |
| 3 핵심 모듈 (phase-03) | 재고·발주·CSV, 데스크, AI 문서, 도우미, 법정 일정, 연차, 대시보드 | P0 수용 기준 전부, 핵심 E2E |
| 4 확장 (phase-04) | 근무표, 교육·온보딩, 장비·멸균, 지출, 알림센터, 광고 점검, 채용, 사진 입고 | P1 수용 기준 전부 |
| 5 최종 검증 (phase-05) | 성능, 보안, 전체 E2E·스크린샷, 문서, 깨끗한 설치 | 원문 10절 최종 통합 검증 항목 전부 |
| 6 나중 (phase-06) | 바코드, AI 근무표, 녹음 회의록 | 시간이 남으면 진행 |

## 현재 상태

- 진행 상황 요약은 [PROGRESS.md](../PROGRESS.md), 재개 지점·태스크별 상태 정본은 `plan_setup/STATE.md`와 각 태스크 frontmatter에 있다.
- 2026-11-03 17:00 기준 phase 01~06 전체 37개 태스크 완료(Loop 종료).
- 원문 12·13절 사용자 문서
  | 문서 | 내용 |
  |---|---|
  | `README.md` | 공개 저장소 첫 화면: 만든 방법·숫자·할 수 있는 일·빠른 시작·문서 목록(2026-11-03 개편) |
  | `docs/GUIDE.md` | (예전 README) 할 수 있는 일(화면 그림), Windows 설치, 매일 켜고 끄기, 원내 접속·방화벽, 첫 설정, 백업·복원, 업데이트, 보안·주의, FAQ, 문제 해결, 폴더 지도, Claude Code 요청 요령 |
  | `docs/LLM_GUIDE.md` | LLM API 비유, 공급자 3곳 키 발급, 토큰·요금, 키 안전 수칙 |
  | `docs/COST.md` | 가격 비교(확인일·출처), 기능별 토큰, 5·10·20명 월 비용, 추천 조합, 절약 팁, 데이터 정책, 서버 비용 |
  | `docs/SECURITY.md` | 보안 점검 체크리스트(05-02) |
- 문서 필수 소제목은 `npm run lint`의 `docs` 단계(`scripts/check-docs.ts`)가 검사한다(05-04).
- 안내서(GUIDE)·README 그림은 `node scripts/readme-shots.ts`로 다시 찍는다(목록: `scripts/screens/phase-05-task-04.ts`).

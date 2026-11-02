---
id: phase-01-task-04
status: pending
phase: "01"
title: "디자인 시스템·앱 셸·첫 설정/로그인 화면"
depends_on: [phase-01-task-03]
files:
  - "web/src/styles/**"
  - "web/src/components/**"
  - "web/src/layout/**"
  - "web/src/lib/**"
  - "web/src/routes.tsx"
  - "web/src/pages/**(빈 페이지 스텁)"
  - "web/public/**"
acceptance_criteria:
  - "E2E: 새 서버에서 /setup으로 관리자 생성 → 대시보드 셸이 보이고, 로그아웃 → 로그인이 된다"
  - "1440·1024·768·390px × 라이트·다크 스크린샷에서 셸에 가로 스크롤·겹침이 없다(스크린샷 파일을 직접 열어 확인하고 LOG에 기록)"
  - "staff 계정 사이드바에 관리 묶음이 보이지 않고, /admin/users 직접 접근 시 권한 없음 안내가 보인다"
  - "axe 검사(로그인·셸) 위반 0건, Tab 키만으로 로그인 완료 가능"
  - "인터넷 차단 상태(외부 요청 차단 라우트)에서도 Pretendard 글꼴이 적용된다(computed font-family와 로드된 폰트 확인)"
  - "서버를 멈추면 앱에 \"원내 와이파이 연결 확인\" 띠가 나타나고 재시작 후 사라진다"
verification: [lint, unit, e2e, task_validation]
---

# phase-01-task-04 — 디자인 시스템·앱 셸·첫 설정/로그인 화면

- **관련 요구·결정**: DESIGN.md 전체, NFR-006, NFR-007, FR-001·002 화면, FR-091(매니페스트), TD-005·017
- **설계 근거**: frontend.md §1·§2·§3·§4·§5 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-03

## 범위
- tokens.css(DESIGN §2 값 그대로), base.css(Pretendard 로컬), print.css, 테마 3상태
- frontend.md §2 공용 컴포넌트 전부(EmptyState·Skeleton·ErrorState 포함)와 lib(api·useApi·format·clipboard·image·privacy 자리)
- AppShell(상단바·사이드바 7묶음·태블릿 아이콘막대·휴대폰 하단탭), OfflineBanner, 데모 모드 배지
- routes.tsx: frontend.md §3의 모든 경로 등록 + 각 페이지 빈 스텁("준비 중" EmptyState) — 모듈 태스크는 자기 페이지 파일만 교체
- /setup, /login, /change-password 화면, 세션 만료 시 ?next 복귀
- manifest.webmanifest·아이콘·apple-touch-icon

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

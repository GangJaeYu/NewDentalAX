# task_validation 인계서 — phase-01-task-04

너는 이 태스크를 구현하지 않은 독립 검증자다. 아래 수용 기준을 실제로 실행·관찰해 판정한다.

## 규칙
- 제품 코드, 테스트, 수용 기준, 통과 단언을 고치지 않는다(--fix·스냅샷 갱신 금지). 고칠 곳을 찾으면 FAIL과 증거만 돌려준다.
- 코드·diff는 읽어도 된다. 판정은 실제 실행 결과(명령 출력, HTTP 응답, DB 조회, 브라우저 화면·스크린샷)로 한다. 코드만 읽고 PASS를 주지 않는다.
- 데이터는 임시 DATA_DIR만 쓴다. 실제 LLM API 키를 쓰지 않는다(데모 모드 또는 tests/fake-llm).
- 띄운 서버는 네가 띄운 프로세스만 종료한다.
- 화면 기준은 docs/DESIGN.md §5와 harness_setup/evidence/design-baseline/의 승인 시안 스크린샷을 기준선으로 대조한다. 기준선을 바꾸지 않는다.

## 대상 코드
- 저장소: C:\Users\main\Desktop\DentalAX_with_Skills
- HEAD: 1b8aa5e
- 변경 범위(기준 cadb5d6~1):
```
PROGRESS.md                                        |   9 +-
 .../validation-2026-11-02T2053-pass4.md            |  15 +
 .../evidence/phase-01-task-04/screens/README.md    |  13 +
 .../screens/dashboard-1024-dark.png                | Bin 0 -> 76877 bytes
 .../screens/dashboard-1024-light.png               | Bin 0 -> 77782 bytes
 .../screens/dashboard-1440-dark.png                | Bin 0 -> 140121 bytes
 .../screens/dashboard-1440-light.png               | Bin 0 -> 142207 bytes
 .../screens/dashboard-390-dark.png                 | Bin 0 -> 45452 bytes
 .../screens/dashboard-390-light.png                | Bin 0 -> 45376 bytes
 .../screens/dashboard-768-dark.png                 | Bin 0 -> 82966 bytes
 .../screens/dashboard-768-light.png                | Bin 0 -> 84357 bytes
 .../phase-01-task-04/screens/login-1024-dark.png   | Bin 0 -> 21627 bytes
 .../phase-01-task-04/screens/login-1024-light.png  | Bin 0 -> 21883 bytes
 .../phase-01-task-04/screens/login-1440-dark.png   | Bin 0 -> 23672 bytes
 .../phase-01-task-04/screens/login-1440-light.png  | Bin 0 -> 23964 bytes
 .../phase-01-task-04/screens/login-390-dark.png    | Bin 0 -> 19664 bytes
 .../phase-01-task-04/screens/login-390-light.png   | Bin 0 -> 19795 bytes
 .../phase-01-task-04/screens/login-768-dark.png    | Bin 0 -> 22133 bytes
 .../phase-01-task-04/screens/login-768-light.png   | Bin 0 -> 22323 bytes
 .../phase-01-task-04/screens/setup-1024-dark.png   | Bin 0 -> 40556 bytes
 .../phase-01-task-04/screens/setup-1024-light.png  | Bin 0 -> 40772 bytes
 .../phase-01-task-04/screens/setup-1440-dark.png   | Bin 0 -> 48695 bytes
 .../phase-01-task-04/screens/setup-1440-light.png  | Bin 0 -> 49121 bytes
 .../phase-01-task-04/screens/setup-390-dark.png    | Bin 0 -> 42909 bytes
 .../phase-01-task-04/screens/setup-390-light.png   | Bin 0 -> 42749 bytes
 .../phase-01-task-04/screens/setup-768-dark.png    | Bin 0 -> 46521 bytes
 .../phase-01-task-04/screens/setup-768-light.png   | Bin 0 -> 46785 bytes
 .../phase-01-task-04/screens/stub-1024-dark.png    | Bin 0 -> 26163 bytes
 .../phase-01-task-04/screens/stub-1024-light.png   | Bin 0 -> 26393 bytes
 .../phase-01-task-04/screens/stub-1440-dark.png    | Bin 0 -> 58412 bytes
 .../phase-01-task-04/screens/stub-1440-light.png   | Bin 0 -> 58806 bytes
 .../phase-01-task-04/screens/stub-390-dark.png     | Bin 0 -> 20356 bytes
 .../phase-01-task-04/screens/stub-390-light.png    | Bin 0 -> 20423 bytes
 .../phase-01-task-04/screens/stub-768-dark.png     | Bin 0 -> 26619 bytes
 .../phase-01-task-04/screens/stub-768-light.png    | Bin 0 -> 26834 bytes
 harness_setup/quality_gates/e2e.md                 |   6 +-
 ...phase-01-task-04.md => phase-01-task-04-int.md} |  38 +--
 plan_setup/LOG.md                                  |  29 ++
 plan_setup/STATE.md                                |  12 +-
 .../phase-01/phase-01-tasks/phase-01-task-01.md    |   2 +-
 .../phase-01/phase-01-tasks/phase-01-task-02.md    |   2 +-
 .../phase-01/phase-01-tasks/phase-01-task-03.md    |   2 +-
 .../phase-01/phase-01-tasks/phase-01-task-06.md    |   2 +-
 .../phase-02/phase-02-tasks/phase-02-task-01.md    |   2 +-
 .../phase-02/phase-02-tasks/phase-02-task-02.md    |   2 +-
 playwright.config.ts                               |  19 +-
 scripts/e2e-server.ts                              |  10 +-
 scripts/make-icons.ts                              |  33 +++
 scripts/screenshots.ts                             |  49 +++-
 tests/e2e/app-shell.spec.ts                        | 319 +++++++++++++++++++++
 tests/e2e/auth-api.spec.ts                         |   8 +-
 tests/e2e/fixtures.ts                              | 158 ++++++++++
 tests/e2e/smoke.spec.ts                            |  15 +-
 tests/web-assets.test.ts                           | 141 +++++++++
 web/index.html                                     |  16 +-
 web/public/fonts/OFL.txt                           |  94 ++++++
 web/public/fonts/PretendardVariable.woff2          | Bin 0 -> 2057688 bytes
 web/public/icons/apple-touch-icon.png              | Bin 0 -> 2283 bytes
 web/public/icons/icon-192.png                      | Bin 0 -> 3934 bytes
 web/public/icons/icon-512.png                      | Bin 0 -> 11286 bytes
 web/public/icons/icon-maskable-512.png             | Bin 0 -> 6556 bytes
 web/public/icons/icon.svg                          |   1 +
 web/public/manifest.webmanifest                    |  16 ++
 web/public/theme-init.js                           |  11 +
 web/src/boot.css                                   |  43 ---
 web/src/components/Button.tsx                      |  70 +++++
 web/src/components/Card.tsx                        |  80 ++++++
 web/src/components/Charts.tsx                      | 112 ++++++++
 web/src/components/Chip.tsx                        |  71 +++++
 web/src/components/CopyButton.tsx                  |  26 ++
 web/src/components/DataTable.tsx                   | 155 ++++++++++
 web/src/components/Dialog.tsx                      | 129 +++++++++
 web/src/components/Field.tsx                       | 123 ++++++++
 web/src/components/FileDrop.tsx                    |  88 ++++++
 web/src/components/Icon.tsx                        | 180 ++++++++++++
 web/src/components/Markdown.tsx                    | 180 ++++++++++++
 web/src/components/PaperPreview.tsx                |  29 ++
 web/src/components/States.tsx                      |  87 ++++++
 web/src/components/Toast.tsx                       |  57 ++++
 web/src/components/Toolbar.tsx                     |  44 +++
 web/src/components/index.ts                        |  17 ++
 web/src/layout/AppShell.tsx                        |  71 +++++
 web/src/layout/NotificationBell.tsx                |  20 ++
 web/src/layout/OfflineBanner.tsx                   |  21 ++
 web/src/layout/Sidebar.tsx                         | 129 +++++++++
 web/src/layout/TopBar.tsx                          | 182 ++++++++++++
 web/src/lib/api.ts                                 | 188 ++++++++++++
 web/src/lib/clipboard.ts                           |  36 +++
 web/src/lib/connection.ts                          | 120 ++++++++
 web/src/lib/format.ts                              | 100 +++++++
 web/src/lib/image.ts                               |  75 +++++
 web/src/lib/lib.test.ts                            | 132 +++++++++
 web/src/lib/nav.ts                                 | 151 ++++++++++
 web/src/lib/session.tsx                            | 141 +++++++++
 web/src/lib/shell.test.ts                          | 128 +++++++++
 web/src/lib/theme.ts                               |  76 +++++
 web/src/lib/useApi.ts                              | 116 ++++++++
 web/src/main.tsx                                   |  34 ++-
 web/src/pages/DashboardPage.tsx                    |  85 ++++++
 web/src/pages/NotificationsPage.tsx                |   8 +
 web/src/pages/StubPage.tsx                         |  76 +++++
 web/src/pages/admin/AiSettingsPage.tsx             |   8 +
 web/src/pages/admin/AiUsagePage.tsx                |   8 +
 web/src/pages/admin/AuditPage.tsx                  |   8 +
 web/src/pages/admin/BackupPage.tsx                 |   8 +
 web/src/pages/admin/ClinicPage.tsx                 |   8 +
 web/src/pages/admin/ResetPage.tsx                  |   8 +
 web/src/pages/admin/UsersPage.tsx                  |   8 +
 web/src/pages/auth/AuthLayout.tsx                  |  55 ++++
 web/src/pages/auth/ChangePasswordPage.tsx          |  93 ++++++
 web/src/pages/auth/LoginPage.tsx                   |  84 ++++++
 web/src/pages/auth/SetupPage.tsx                   |  99 +++++++
 web/src/pages/desk/BoardDetailPage.tsx             |   8 +
 web/src/pages/desk/BoardPage.tsx                   |   8 +
 web/src/pages/desk/ChecklistPage.tsx               |   8 +
 web/src/pages/desk/ReviewPage.tsx                  |   8 +
 web/src/pages/desk/ScriptPage.tsx                  |   8 +
 web/src/pages/desk/TemplatesPage.tsx               |   8 +
 web/src/pages/docs/AdcheckPage.tsx                 |   8 +
 web/src/pages/docs/AssistantPage.tsx               |   8 +
 web/src/pages/docs/LibraryDetailPage.tsx           |   8 +
 web/src/pages/docs/LibraryPage.tsx                 |   8 +
 web/src/pages/docs/MinutesPage.tsx                 |   8 +
 web/src/pages/docs/PromoPage.tsx                   |   8 +
 web/src/pages/docs/WriterPage.tsx                  |   8 +
 web/src/pages/facility/EquipmentPage.tsx           |   8 +
 web/src/pages/facility/LegalPage.tsx               |   8 +
 web/src/pages/facility/SterilizerPage.tsx          |   8 +
 web/src/pages/finance/ExpensesPage.tsx             |   8 +
 web/src/pages/finance/MonthlyPage.tsx              |   8 +
 web/src/pages/hr/HiringPage.tsx                    |   8 +
 web/src/pages/hr/LeavePage.tsx                     |   8 +
 web/src/pages/hr/OnboardingPage.tsx                |   8 +
 web/src/pages/hr/RosterPage.tsx                    |   8 +
 web/src/pages/hr/TrainingPage.tsx                  |   8 +
 web/src/pages/inventory/ImportPage.tsx             |   8 +
 web/src/pages/inventory/InventoryPage.tsx          |   8 +
 web/src/pages/inventory/ItemDetailPage.tsx         |   8 +
 web/src/pages/inventory/MovesPage.tsx              |   8 +
 web/src/pages/inventory/OrderDetailPage.tsx        |   8 +
 web/src/pages/inventory/OrdersPage.tsx             |   8 +
 web/src/pages/inventory/PricesPage.tsx             |   8 +
 web/src/pages/inventory/ReceiptPage.tsx            |   8 +
 web/src/pages/inventory/VendorsPage.tsx            |   8 +
 web/src/pages/print/PrintChecklistPage.tsx         |   8 +
 web/src/pages/print/PrintDocumentPage.tsx          |   8 +
 web/src/pages/print/PrintEquipmentPage.tsx         |   8 +
 web/src/pages/print/PrintOrderPage.tsx             |   8 +
 web/src/pages/print/PrintRosterPage.tsx            |   8 +
 web/src/pages/print/PrintSterilizerPage.tsx        |   8 +
 web/src/pages/print/PrintStub.tsx                  |  41 +++
 web/src/routes.tsx                                 | 198 +++++++++++++
 web/src/styles/base.css                            |  62 ++++
 web/src/styles/components.css                      | 206 +++++++++++++
 web/src/styles/layout.css                          | 143 +++++++++
 web/src/styles/print.css                           |  26 ++
 web/src/styles/tokens.css                          |  83 ++++++
 157 files changed, 5719 insertions(+), 135 deletions(-)
```

## 실행 방법 (harness_setup/HARNESS.md §2·§3)
- 게이트: `node harness_setup/scripts/gate.mjs lint phase-01-task-04` → `unit` → `e2e` (앞이 FAIL이면 뒤는 판정하지 않는다)
- 서버 수동 실행: `$env:DATA_DIR="<임시폴더>"; $env:PORT="18093"; npm start` → `GET http://localhost:18093/api/health`
- 스크린샷: `npm run screenshots` (화면 태스크)

## 태스크 정의 (원문)
---
id: phase-01-task-04
status: in_progress
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


## 참조 문서
- 요구: docs/PRD.md (위 태스크의 FR/NFR 절)
- 설계: docs/ARCHITECTURE/ (위 "설계 근거" 절)
- 디자인: docs/DESIGN.md

## 예산
- loop_started_at: 2026-11-02T18:55:20+09:00` (전체 24시간 중 일부). 검증은 필요한 범위만 한다.

## 반환 형식 (그대로 채워서 마지막 응답으로)
| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
- 게이트 결과: lint=…, unit=…(건수), e2e=…(건수)
- 환경 문제·판정 불가 사유:
- 재현 방법(실패 시):


## Orca 검증 워커 추가 지시
- 너는 검증할 커밋으로 새로 만든 작업 사본에 있다. 먼저 `npm ci`를 실행한다(설치는 테스트 데이터 준비로 허용된다).
- 슬롯 0
  - 화면 테스트: `E2E_PORT=18094`
  - 수동 서버: `PORT=18194`
  - 데이터: `.tmp/` 아래
  - gate.mjs를 실행할 때 환경 변수 `E2E_PORT`를 지정한다.
- 파일 수정 범위
  - `.tmp/`와 git이 무시하는 산출물(artifacts/ 등)만 만들 수 있다.
  - 제품·테스트·문서는 수정하지 않는다.
  - 커밋하지 않는다.
- start.bat을 확인할 때는 `cmd /c .\start.bat`을 쓴다. 이 PC에서는 `cmd /c start.bat`이 cmd 내장 명령과 이름이 겹쳐 실패한다.
- 보고
  - 결과 원문(반환 형식 표 전체)을 `.tmp/validation-result.md`에 저장한다.
  - 같은 내용을 worker_done 본문으로 보고한다.
  - outcome: 모든 기준이 PASS면 succeeded, 하나라도 FAIL이나 판정 불가가 있으면 failed
- 참고: 화면 태스크다. npm run screenshots로 4너비×2테마를 찍어 harness_setup/evidence/design-baseline/ 기준선과 DESIGN §5를 대조한다. 워커가 채택한 스크린샷은 harness_setup/evidence/phase-01-task-04/screens/에 있다(참고용, 너는 직접 다시 찍어 판정한다). e2e는 tests/e2e/fixtures.ts 격리 서버를 쓴다.

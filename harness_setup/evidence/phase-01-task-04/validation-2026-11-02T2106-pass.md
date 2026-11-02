# task_validation 결과 — phase-01-task-04 (검증 커밋 31b5678, 대상 HEAD 1b8aa5e 이후 코드 변경 없음)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | 새 서버에서 /setup으로 관리자 생성 → 대시보드 셸, 로그아웃 → 로그인 | PASS | 직접 띄운 서버(PORT 18194, 임시 DATA_DIR `.tmp/val-data-*`)에서 `node .tmp/verify.ts` 실행. `/`로 들어가자 `/setup`으로 이동했고, 화면 양식으로 관리자를 만들자 `/`에 h1 "오늘도 수고 많으셨어요, 검증관리님"과 nav "주 메뉴"·"아래쪽 메뉴"가 나왔다. 사용자 메뉴에서 로그아웃하자 `/login`으로 갔고 `/api/auth/me`는 401 UNAUTHENTICATED였다. 다시 로그인하자 `/` 대시보드가 나왔다. 스크린샷: `.tmp/val-shots/ac1-after-setup.png`, `ac1-after-login.png`. e2e AC1 테스트도 통과했다. |
| 2 | 1440·1024·768·390 × 라이트·다크에서 셸 가로 스크롤·겹침 없음 | PASS | `npm run screenshots`(E2E_PORT=18094)로 32장을 찍었다(setup·login·dashboard·stub × 4너비 × 2테마). 32장 모두 "OK"였다(scrollWidth ≤ innerWidth, Pretendard 확인). `artifacts/screens/`의 dashboard 8장, stub 4장, setup·login 4장을 직접 열어 봤다. 글자 잘림·겹침이 없고 카드 가장자리가 맞았다. 기준선 `harness_setup/evidence/design-baseline/preview-dashboard-*`과 구조가 같았다(1440 펼친 사이드바, 1024·768 아이콘 막대, 390 하단 탭 5개, 요약 6칸, 카드 3열/2열/1열). 기준선과 다른 점은 데모 데이터가 없어 빈 상태와 "-"가 보이는 것뿐이다(스크린샷 스크립트가 withDemo:false로 찍는다). e2e AC2도 통과했다. |
| 3 | staff 사이드바에 관리 묶음 없음, /admin/users 직접 접근 시 권한 없음 안내 | PASS | DB에 staff 계정을 넣고 로그인했다. 1440px과 390px(더보기 열림) 모두 `a[href^="/admin"]`이 0개였고 nav 글에 "관리" 묶음이 없었다. 대조로 본 admin 계정에서는 /admin 링크 9개가 있었다. staff가 `/admin/users`로 바로 가자 "권한 없음 / 이 화면을 볼 권한이 없어요 / 이 화면은 원장·실장 또는 관리자만 쓸 수 있어요…"가 나왔다. 스크린샷: `.tmp/val-shots/ac3-staff-nav-1440.png`, `ac3-staff-admin-users-390.png`. |
| 4 | axe(로그인·셸) 위반 0건, Tab 키만으로 로그인 | PASS | AxeBuilder 기본 규칙 전부로 검사했다. 로그인(light·dark)은 violations=0이었다. 셸 `/`·`/inventory`도 4너비 × 2테마 전부 violations=0이었다(18회 모두 0). 키보드만 쓴 로그인: 아이디 칸 → Tab → 비밀번호 칸 → Tab → [로그인] 버튼 순으로 이동했고, Enter로 `/` 대시보드에 들어갔다. 버튼 포커스는 outline solid 2px rgb(12,124,118)으로 `--accent` #0c7c76과 같았고 :focus-visible이었다. 스크린샷: `.tmp/val-shots/ac4-tab-focus-button.png`. |
| 5 | 인터넷 차단 상태에서도 Pretendard 적용 | PASS | localhost 밖으로 가는 요청을 모두 abort하는 route를 걸었다. 외부 요청 시도는 0건이었고, 글꼴 요청은 로컬 `/fonts/PretendardVariable.woff2` 하나뿐이었다. body·h1의 computed font-family는 `"Pretendard Variable", Pretendard, …`였다. document.fonts는 "Pretendard Variable:loaded"였고 fonts.check는 true였다. 실제 렌더 폭도 다르게 나와 Pretendard로 그려진 것을 확인했다(measureText 폭: Pretendard 247.7, sans-serif·맑은 고딕 278.7). |
| 6 | 서버 정지 시 "원내 와이파이 연결 확인" 띠, 재시작 후 사라짐 | PASS | 로그인한 대시보드에서 띠는 처음에 0개였다. 내가 띄운 서버 프로세스를 끄자 11.5초 뒤 role=alert인 "원내 와이파이 연결 확인" 띠가 나타났다(`.tmp/val-shots/ac6-offline-banner.png`). 같은 DATA_DIR로 서버를 다시 켜자 health가 정상이 되고 2.1초 뒤 띠가 DOM에서 사라졌다(`ac6-after-restart.png`). e2e AC6도 통과했다. |

- 게이트 결과: lint=PASS(tsc-server 126, tsc-web 95, eslint 221, headers 228), unit=PASS(371건), e2e=PASS(20건 통과, skipped 0, flaky 0; E2E_PORT=18094)
  - 로그: `harness_setup/evidence/runs/2026-11-02T12-00-25-321Z-phase-01-task-04-lint.log`, `…12-00-41-506Z-…-unit.log`, `…12-01-09-867Z-…-e2e.log`
- DESIGN §5 대조
  - 1 가로 스크롤·잘림·겹침·카드 가장자리: 이상 없음
  - 2 대비: axe color-contrast 위반 0건(두 테마)
  - 3 포커스 `--accent` 2px: 확인
  - 5 칩 글자: AI 칩 "AI" 글자 있음
  - 7 주 행동 버튼: 대시보드는 "AI 문서 작성" 하나만 채워진 청록, 로그인·첫 설정은 제출 버튼 하나
  - 6 1440×900 첫 화면: 요약 6칸과 첫 줄 카드 3개가 스크롤 없이 보임(기준선 시안도 3열)
  - 4 빈/로딩/오류 상태와 8 움직임은 이 태스크의 수용 기준 밖이라 빈 상태만 화면으로 확인했다.
- 환경 문제·판정 불가 사유: 없음. `npm ci` 정상(경고: moderate 취약점 16건, 판정과 무관). 띄운 서버는 모두 내가 띄운 자식 프로세스만 종료했고 18094·18194 포트가 비었음을 확인했다. git 작업 사본은 수정이 없다(.tmp·artifacts·evidence/runs는 git 제외).
- 재현 방법(실패 시): 해당 없음. 관찰 재실행은 `npm run build:web` 후 `node .tmp/verify.ts`(PORT 18194, 임시 DATA_DIR)로 한다.

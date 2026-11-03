# phase-05-task-03 — 전체 E2E·스크린샷 전수 점검·접근성 증거

- 작성: 2026-11-03, 구현 워커(슬롯 3), 브랜치 `phase-05-task-03-worker`
- 기준: docs/DESIGN.md §5 여덟 항목, 기준선 `harness_setup/evidence/design-baseline/preview-dashboard-*.png`(청록 A·기본 밀도)

## 1. 로그인 → 모듈별 핵심 작업 E2E 묶음 (기존 spec이 덮는 흐름)

| 모듈 | 핵심 흐름 | 덮는 spec |
|---|---|---|
| 인증·셸 | 첫 설정 → 로그인 → 로그아웃, 권한 없음, Tab 로그인, 연결 끊김 띠 | smoke, app-shell, auth-api |
| 대시보드 | 요약 숫자·카드, 빠른 출고, 오늘 근무 | dashboard |
| 데스크 | 공지·인수인계 작성/읽음, 체크리스트 체크·인쇄, 전화 스크립트·리뷰 답글·템플릿 | desk-board, desk-checklist, desk-ai |
| 재고·구매 | 출고·입고·FEFO, 거래처·단가, CSV 가져오기, 명세서 사진 입고, 발주서 작성→발주→입고·인쇄 | inventory, inventory-csv, inventory-receipt, orders |
| 문서·AI | AI 문서 작성(스트림·중지·저장·인쇄), 원내 AI 도우미, 회의록, 서식 보관함, 인수인계 보내기, 광고 문구 점검·홍보 글 | docs-writer, assistant, docs-minutes, docs-library, docs-handover, marketing-adcheck, ai-panel |
| 인사 | 근무표(편집·월간·인쇄), 연차 신청→승인, 교육 이수·온보딩, 채용 공고 | hr-roster, hr-leave, hr-training, hr-hiring |
| 시설·법정 | 장비 점검·멸균기 기록·인쇄, 법정 일정 | facility-equipment, facility-legal |
| 운영 지표 | 지출 기록·월간 요약 | finance |
| 관리 | 사용자·권한·활동 기록, AI 설정·사용량, 백업·복원·초기화 | admin, ai-admin, backup-reset |
| 알림 | 종·목록·출처별 알림, 휴대폰 홈 화면 추가 | notifications, notifications-api, notifications-sources, notifications-pwa |

빠진 흐름으로 이번에 더한 것
- `final-keyboard.spec.ts`: 마우스 없이 로그인 → 메뉴 → 재고 출고 → AI 문서 생성·저장, 직원 로그인 → 연차 신청(AC4)
- `final-screens.spec.ts`: 전 화면 51개(경로 전체 + 첫 설정·권한 없음·없는 주소·임시 비밀번호 변경) × 두 테마 axe, 휴대폰 흉내 390px 넘침(AC3)
- `final-common-css.spec.ts`: 인쇄 숫자 글리프(발주서·근무표·멸균기 PDF), 도넛 호 채움(공통 CSS 확인)

## 2. 전 화면 axe(두 테마)·휴대폰 390px (AC3)

- 명령: `E2E_PORT=18093 npx playwright test tests/e2e/final-screens.spec.ts` → **53 passed (7.1m)** (로그: `final-screens-run.txt`)
- 화면마다 1440×900 라이트·다크 axe 위반 0건, 휴대폰 흉내(390×844, isMobile·터치·DPR 3) 라이트·다크에서 `innerWidth === 390` 그리고 `scrollWidth ≤ innerWidth`
- 처음 실행에서 찾은 위반 1건과 수정
  - `/hr/roster` label-content-name-mismatch: 칸 버튼의 이름("종일 · 반차(오후)")에 보이는 글자("종일반차(오후)")가 그대로 들어 있지 않음 → 칩 사이 띄어쓰기, 이름은 "종일 반차(오후)"로 맞춤(RosterPage.tsx)

## 3. 390px 판정 함정 (04-05 발견)

- 공용 판정 `tests/e2e/layout.ts`의 `expectNoHorizontalScroll(page)`: `innerWidth === viewport 너비`와 `scrollWidth ≤ innerWidth`를 함께 본다
- 바꾼 spec(측정식에 "창 너비 그대로" 조건 추가): admin, ai-admin, app-shell, backup-reset, desk-board, desk-checklist, docs-helpers(assistant·desk-ai·docs-library가 사용), facility-equipment, facility-legal, finance, hr-hiring, hr-leave, hr-roster, hr-training, inventory, inventory-csv, inventory-receipt, marketing-adcheck, notifications-sources, orders
- dashboard.spec.ts는 03-10 워커가 동시에 수정 중이라 건드리지 않았다(대시보드 390px은 final-screens가 isMobile로 확인)
- 휴대폰 흉내에서 넘친 화면: 0개(final-screens 51개 화면 × 2테마)

## 4. 키보드만으로 4작업 (AC4)

- `final-keyboard.spec.ts` 2건 통과: Tab·Enter·글자 입력만 사용(click 없음), 메뉴 이동도 사이드바 묶음 버튼 Enter → 링크 Enter
- 포커스 링: 로그인 버튼·메뉴 링크·출고 기록·저장·신청하기에서 `outline 2px solid rgb(12,124,118)`(--accent) 확인
- 찾은 결함과 수정: 대화상자를 열면 입력칸의 autoFocus가 무시되고 닫기 버튼에 포커스가 갔다(`showModal()`이 React autoFocus를 덮어씀). `components/Dialog.tsx`가 showModal 뒤에 내용을 그리도록 고쳐 출고 대화상자는 바로 품목 찾기 칸, 품목을 고르면 수량 칸에 포커스가 간다. autoFocus가 없는 대화상자는 예전처럼 첫 버튼(닫기)에 포커스

## 5. STATE "하네스 점검" 화면 관련 4건

| 항목 | 처리 | 확인 |
|---|---|---|
| 인쇄 PDF 숫자 글리프 | `styles/print.css`에서 인쇄 때 모든 요소의 `font-feature-settings`·`font-variant-numeric`을 normal로. orders.css·equipment.css 지역 처리 삭제 | final-common-css: 발주서·근무표·멸균기 인쇄에서 인쇄 매체 숫자 기능 남은 요소 0, 화면의 2자리 이상 숫자 묶음이 PDF 글자에 모두 있음 |
| .c1~.c6 fill이 도넛 호를 채움 | `components.css`에 `.chart [fill="none"] { fill: none; }`. finance.css 지역 보정 삭제 | final-common-css: 월간 요약 도넛의 fill=none 도형 계산값 fill none, 색 호는 stroke 있음. 스크린샷 finance-monthly 링 모양 |
| 768·390 표 첫 열 잘림 | 카드 안 가로 넘김은 허용. 첫 열·핵심 칸이 눌려 읽기 어려운 표 2개 개선: 원내 문서 표 상태 칸(`assistant.css` 최소 180px), 체크리스트 인쇄 미리보기(`checklist.css` 화면 520px 이하 표 최소 520px) | 재촬영 docs-assistant-docs·print-checklist |
| 스트리밍 첫 글자 지연 | `StreamRedactor`: 숫자·@가 아직 없는 앞부분은 HOLD(48자)를 기다리지 않고 띄어쓰기 경계까지 먼저 보냄. 첫 숫자·@ 앞 24글자(가림 규칙 문맥 범위 20글자보다 넉넉히)는 남겨 번호와 문맥이 같은 조각에 들어감 | `server/ai/stream-redactor.test.ts` 3건: 7종 문장 × 조각 크기 6가지에서 결과가 전체를 한 번에 가린 것과 같고 번호가 남지 않음, 숫자 없는 글은 48글자 전에 첫 조각, 계좌 문맥 유지 |

## 6. 스크린샷 점검표 (화면 × 너비 × 테마)

- 명령: `E2E_PORT=18193 npm run screenshots` (전체 80화면 × 4너비 × 2테마 = 640장, 종료 코드 0, 가로 스크롤 0·글꼴 미적용 0, 로그 `screenshots-run.txt`)
- 1차 전체 실행은 facility-equipment-drawer에서 멈춤(다른 화면 목록이 같은 이름 장비를 먼저 넣어 행 2개 → strict mode). `scripts/screens/phase-04-task-03.ts` 선택자 `.first()`로 고친 뒤 재실행 통과
- 직접 열람: 화면별 8장을 한 장에 모은 시트(1차 전 화면, 수정 후 재촬영분)로 DESIGN §5와 기준선 정보 위계·색·간격을 대조. 표의 ✓는 자동 판정(가로 스크롤 없음·Pretendard 적용), 오른쪽 칸은 직접 열람 결과

| 화면 | 1440 라이트 | 1440 다크 | 1024 라이트 | 1024 다크 | 768 라이트 | 768 다크 | 390 라이트 | 390 다크 | 직접 열람(DESIGN §5·기준선) |
|---|---|---|---|---|---|---|---|---|---|
| admin-ai | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| admin-ai-usage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| admin-backup | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| admin-reset | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| audit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| clinic | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 03-10 워커가 동시에 수정 중이라 이 태스크에서 고치지 않음. 현재 main 상태에서 넘침·잘림 없음 |
| dashboard-demo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | dashboard와 같음(03-10 담당). 넘침·잘림 없음 |
| dashboard-quickout | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | dashboard와 같음(03-10 담당). 넘침·잘림 없음 |
| dashboard-roster | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | dashboard와 같음(03-10 담당). 넘침·잘림 없음 |
| desk-board | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| desk-board-detail | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| desk-checklist | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| desk-checklist-past | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| desk-review | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| desk-script | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| desk-templates | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| docs-adcheck | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| docs-adcheck-rules | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 768·390에서 '찾는 말'(정규식) 첫 열이 여러 줄로 길어지나 글자는 온전히 읽힘. 표는 카드 안 가로 넘김(허용 패턴) |
| docs-assistant | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| docs-assistant-docs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1차: 768·1024에서 원내 문서 표의 '상태' 칸이 눌려 실패 사유가 한 줄에 2~3글자씩 쌓임 → assistant.css .as-status 최소 너비 180px(표는 카드 안 가로 넘김) → 재촬영 확인 |
| docs-assistant-review | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| docs-assistant-viewer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| docs-library | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| docs-library-detail | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| docs-minutes | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| docs-promo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| docs-writer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| facility-equipment | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| facility-equipment-drawer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1차 전체 촬영이 이 화면에서 멈춤(다른 목록이 같은 이름 장비를 먼저 넣어 행 2개 → strict mode 위반) → scripts/screens/phase-04-task-03.ts 선택자 .first() → 재촬영 확인 |
| facility-legal | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| facility-legal-add | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| facility-legal-drawer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| facility-sterilizer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| finance-expense-dialog | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| finance-expenses | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| finance-monthly | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 도넛 호가 선(링)으로만 그려짐 — 공용 components.css로 옮긴 fill=none 처리 확인 |
| finance-monthly-empty | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-hiring | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-hiring-draft | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-leave | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-leave-approve | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-leave-request | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-onboarding | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1차: 390·768에서 'AI로 체크리스트 초안 만들기' 카드 제목이 긴 보조 문구에 눌려 한 줄에 2~4글자씩 쌓임 → 공용 components.css 카드 머리글을 줄바꿈 허용·제목 줄지 않게 수정 → 재촬영 확인 |
| hr-onboarding-draft | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | hr-onboarding과 같은 카드 머리글 문제 → 같은 수정으로 재촬영 확인 |
| hr-roster | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-roster-month | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-roster-pick | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-roster-types | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-training | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| hr-training-record | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-import | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-import-preview | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-item | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-moves | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-order-draft | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-order-ordered | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-order-receive | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-order-received | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1024·768에서 요약 숫자 카드 4개가 3+1로 줄바꿈(카드 가장자리는 맞음, 허용) |
| inventory-orders | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-prices | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-quick-out | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-receipt-review | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-receipt-upload | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| inventory-vendors | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| login | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| not-found | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| notification-popover | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| notifications | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| notifications-kinds | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| notifications-read-all | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| print-checklist | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 1차: 390에서 인쇄 미리보기 표의 '항목' 칸이 두세 글자 너비로 눌려 읽기 어려움 → checklist.css 화면 520px 이하에서 표 최소 너비 520px(표 상자 안 가로 넘김, 종이 인쇄 영향 없음) → 재촬영 확인 |
| print-document | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| print-equipment | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| print-order | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| print-roster | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| print-sterilizer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| setup | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |
| users | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 문제 없음 |

DESIGN §5 항목별 종합
1. 4너비 × 2테마 가로 스크롤 없음·잘림·겹침: 위 표(수정 후 0건). 카드 가장자리 맞음
2. 대비 4.5:1: axe color-contrast 포함 전 화면 두 테마 위반 0(§2)
3. 포커스 --accent 2px: §4
4. 빈·불러오는 중·오류 상태: 빈 상태 화면(finance-monthly-empty, notifications-read-all, admin-ai-usage, 대시보드 빈 카드)에 안내 문구 + 첫 행동 버튼 확인. final-screens는 뼈대(aria-busy)가 사라질 때까지 기다림
5. 색만으로 구분 안 함: 칩마다 글자 있음(부족·곧 부족·정상, 승인 대기 등)
6. 대시보드 1440×900 요약 줄 + 첫 줄 카드 4개: dashboard·dashboard-demo 1440에서 확인(대시보드는 03-10 담당)
7. 주 행동 버튼 하나: 화면별 채워진 청록 버튼 1개 확인(대화상자·서랍은 그 안의 주 행동 1개)
8. 움직임: 공용 CSS의 150~300ms 전환·prefers-reduced-motion 유지(이번 변경 없음)

## 7. 전체 E2E (AC1)

- 명령: `E2E_PORT=18093 node harness_setup/scripts/gate.mjs e2e phase-05-task-03` (커밋 b9e9551, main@60af70b 병합 상태. 로그 머리의 dirty=yes는 실행 중에 이 증거 문서만 작성했기 때문이고 코드 변경은 없음)
- 결과: **PASS — 303 passed, skipped 0, flaky 0, 소요 19.3분**(09:54:36 → 10:13:55, spec 36개, workers 1)
- 같은 커밋 lint PASS(tsc-server 301·tsc-web 155·eslint 433·headers 472), unit PASS 735건
- 게이트 로그: `harness_setup/evidence/runs/2026-11-03T00-54-36-394Z-phase-05-task-03-e2e.log`(git 제외), 요약 `e2e-gate-summary.txt`

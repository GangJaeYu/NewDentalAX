# phase-01-task-04 화면 확인 기록 (구현 워커 자체 확인, 2026-11-02)

- 생성: `npm run screenshots` (화면 크기 캡처. 같은 이름의 `-full.png` 전체 길이 캡처는 `artifacts/screens/`에만 있음)
- 대상: setup·login·dashboard(셸)·stub(/inventory) × 1440·1024·768·390 × light·dark = 32장
- 스크립트 자동 판정: 32장 모두 가로 스크롤 없음, `document.fonts.check('14px "Pretendard Variable"')` 참
- 직접 열어 본 파일: dashboard-1440-light, dashboard-1024-dark, dashboard-768-dark, dashboard-390-light/dark, stub-768-light, setup-1440-dark, login-390-light
- 기준선 대조(design-baseline/preview-dashboard-*): 상단바 56px·메뉴 232px/64px 아이콘 막대·휴대폰 아래쪽 탭(홈·재고·AI·근무·더보기), 7묶음 순서, 요약 숫자 6칸(6→3→2열), 카드 격자(3→2→1열), 주 행동 1개(AI 문서 작성), 색·간격 일치
- 발견·수정
  1. 요약 숫자 칸 글자가 가운데 정렬됨 → 빈 값 class 이름이 EmptyState의 `.empty`와 겹침 → `no-data`로 바꿈
  2. 전체 길이 캡처에서 메뉴 배경이 첫 화면 높이에서 끊김 → 메뉴 바깥은 높이 끝까지, 안쪽 목록만 sticky로 바꿈
  3. 768px에서 메뉴 찾기 안내 글자가 잘림 → "메뉴 찾기"로 줄임
  4. 휴대폰 전체 길이 캡처에서 아래쪽 탭이 중간에 찍힘 → 고정 요소의 캡처 특성(실제 겹침 아님). 기준선과 같은 화면 크기 캡처를 기본 파일로 바꿈
- 남은 차이: 카드 내용은 빈 상태(03-10 담당). 데모 배지는 데모 데이터를 넣었을 때만 보임(이 캡처는 데모 없이 첫 설정)

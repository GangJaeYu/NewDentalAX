# phase-04-task-01 구현 워커 증거 (2026-11-03)

- 게이트 로그(같은 폴더, 기준 커밋 ea30adb): lint PASS(tsc-server 217·tsc-web 127·eslint 333·headers 358), unit PASS 584건, e2e PASS 158건(전체 spec, `E2E_PORT=18090`).
- 근무표 e2e: `tests/e2e/hr-roster.spec.ts` 7건(AC1~AC5, 근무 유형 추가·월간 보기·390px 라이트/다크 가로 스크롤 없음, 인쇄 PDF A4 가로 1쪽, 화면마다 axe 0건).
- 서버: `server/modules/hr/roster.test.ts` 13건(칸 저장·유지, 지난주 복사(휴가 미복사), 승인 휴가 덧씌움·인원 합계, 직원 403, 오늘 근무, 근무 유형 저장·입력 오류, 날짜 계산, 데모 4주). 화면 순수 로직: `web/src/pages/hr/rosterLib.test.ts` 4건.

## 화면 확인(DESIGN §5, 기준선 design-baseline 대조)

확인한 파일: `screens/` 24장(6화면 × 1440·390 × 라이트·다크). 전체 48장은 `node scripts/screenshots.ts hr-roster hr-roster-month hr-roster-pick hr-roster-types dashboard-roster print-roster`로 `artifacts/screens/`에 생성(모두 가로 스크롤 없음·Pretendard 로드 OK). 1024·768도 직접 열어 봤다.

| 문제 | 수정 |
|---|---|
| 대시보드 "오늘 근무" 카드에서 직무·근무 시간이 두 줄로 접혀 카드가 길어지고 옆 공지 카드까지 늘어남 | 보조 글은 직무만, 근무 시간은 칩 title로 |
| 1024·768(아이콘 메뉴 폭)에서 오늘 근무 목록이 1열로 길어짐 | 2열 유지, 420px 이하만 1열 |
| "오후" 칩(청록 채움)이 주 행동 버튼처럼 무거워 보임 | 테두리형 칩(surface 바탕 + accent 테두리·글자) |
| 휴대폰에서 카드 안쪽 여백 + 도구줄 여백이 겹쳐 표 폭이 좁음 | 근무표 카드 본문 여백 0(도구줄·첫 열이 자기 여백을 가짐) |

- 주 행동(채워진 청록): 근무표 "지난주 복사"(실장 이상, 직원 화면에는 없음), 인쇄 "인쇄하기", 대화상자 "저장하기".
- 칸 상태는 칩 글자로 구분(종일·오전·오후·야간·휴무·연차·반차(오후)), 휴진일 열은 회색 바탕 + "휴진" 글자, 오늘 열은 머리줄 밑줄 + 옅은 바탕.
- 남은 한계: 월간 보기(최대 42열)와 휴대폰 주간 보기는 표가 카드 안에서 가로로 밀린다(화면 전체 가로 스크롤은 없음, 직원 이름 열 고정).

# task_validation 결과 — phase-03-task-03 (검증 커밋 e76708e, 작업 사본 HEAD 6cd6a6d = e76708e + 루프 기록 문서만)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | 내보낸 CSV 첫 3바이트가 BOM이고 한글 열 이름이 들어 있다 | PASS | 수동 서버(PORT=18195, DATA_DIR=.tmp/val/data, TEST_NOW 고정)에 실장으로 로그인한 뒤 GET /api/export/items.csv·vendors.csv·moves.csv, /api/import/items/template.csv, /api/inventory/moves?format=csv를 받았다. 모두 200 응답이고 `text/csv; charset=utf-8`이며 첫 3바이트가 `ef bb bf`였다. 첫 줄 예: items "품목명,분류,단위,적정 재고,유효기간 관리,기본 거래처,보관 위치,메모,현재고,…", vendors "상호,담당자,업무용 연락처,…", moves "일시,구분,품목명,…"(입출고 1건: "2026-11-02 09:00,입고,니트릴 장갑(M),박스,3,1200,한빛덴탈,,,,검증실장"). 직원 계정은 같은 주소에서 403을 받았다. 파일: .tmp/val/out/export-*.csv, .tmp/val/out/verify.log |
| 2 | CP949로 저장한 예제 CSV를 올리면 한글이 깨지지 않고 미리보기에 신규/변경/오류 줄이 구분된다 | PASS | Edge로 /inventory/import에 tests/fixtures/csv/items-cp949.csv(EUC-KR 바이트 확인)를 올렸다. 미리보기 표에 "2 변경 니트릴 장갑(M) 적정 재고: 6 → 10 / 3 신규 치과용 거즈 / 4 오류 레진 A2 / 5 신규 일회용 석션팁"이 나왔고, 요약은 신규 2·변경 1·변경 없음 0·오류 1, 안내는 "엑셀 기본 형식(CP949)으로 읽었어요"였다. 본문에 U+FFFD(깨진 글자)가 없었다. 스크린샷: .tmp/val/out/import-preview-1440.png |
| 3 | 오류 줄(적정 재고에 문자)이 이유와 함께 표시되고 "오류 줄 건너뛰고 확정" 시 나머지만 반영된다 | PASS | 오류 줄 이유로 `적정 재고는 숫자로 적어 주세요(지금 값: "다섯").`가 보였다. "오류 줄 건너뛰고 확정"을 누르자 "신규 2개, 변경 1개를 반영했어요. 건너뛴 줄 1개(오류 줄 4번 포함)."가 나왔다. API로 다시 읽은 품목: 니트릴 장갑(M) 적정 6→10, 치과용 거즈 20팩(소독실 서랍)과 일회용 석션팁 15봉이 새로 생겼고, 레진 A2는 없다. 스크린샷: .tmp/val/out/import-committed-1440.png |
| 4 | `=HYPERLINK(...)`로 시작하는 품목명을 내보내면 앞에 작은따옴표가 붙는다 | PASS | 품목 `=HYPERLINK("http://evil.example","눌러 보세요")`를 내보낸 줄이 `"'=HYPERLINK(""http://evil.example"",""눌러 보세요"")",소모품,개,1,…`였다. 추가로 `+SUM(1,2)`는 `"'+SUM(1,2)"`로 나왔다. 파일: .tmp/val/out/export-items.csv |
| 5 | (조정자 반영 1) /inventory의 'CSV 가져오기·내보내기' 진입 버튼은 실장 이상에게만 보인다 | PASS | 실장의 /inventory에서 버튼 1개를 찾았고, 누르면 /inventory/import로 이동했다. 직원 화면에서는 0개였다. 직원이 /inventory/import로 바로 들어가면 "이 화면을 볼 권한이 없어요"가 보였다. 스크린샷: .tmp/val/out/inventory-manager-1440.png, inventory-staff-1440.png, import-staff-1440.png |
| 6 | (조정자 반영 2) .filedrop position:relative — 넓은 화면에서 가로 스크롤이 없다 | PASS | 미리보기 상태에서 scrollWidth와 clientWidth를 쟀다. 1920·2560·1440·1024·768·390, 라이트·다크 모두 두 값이 같았다(hscroll=false). 스크린샷: .tmp/val/out/import-preview-{1920,2560,1024,768,390}-{light,dark}.png |
| 7 | 화면 품질(DESIGN §5, 기준선 preview-dashboard-*) | PASS | 기준선과 비교해 청록 강조, 카드 테두리·간격, 칩에 글자 있음, 주 행동 버튼 하나("오류 줄 건너뛰고 확정"만 채워진 청록)가 맞았다. 다크 테마 대비도 정상이고 콘솔·페이지 오류는 0건이었다. 390px에서는 미리보기 표(706px)가 `.tablewrap`(overflow-x:auto) 안에서만 가로로 넘치고 페이지 전체에는 가로 스크롤이 없다. 768px에서도 오류 이유 칸 끝이 표 상자 안 스크롤 영역에 걸친다(잘림이 아니라 내부 스크롤). |

- 게이트 결과: lint=PASS(tsc-server 217, tsc-web 123, eslint 329, headers 353), unit=PASS(578건), e2e=PASS(159건, E2E_PORT=18095)
  - 로그: harness_setup/evidence/runs/2026-11-02T14-51-40-986Z-phase-03-task-03-lint.log, …14-52-04-285Z-…-unit.log, …14-52-44-195Z-…-e2e.log
- 환경 문제·판정 불가 사유:
  - `npm run screenshots`가 exit 1로 끝났다. 원인은 이 태스크가 아니라 기존 통합 결함이다.
    - scripts/screenshots.ts:29의 `stub` 항목이 /inventory/orders에서 '준비 중인 화면이에요'를 기다린다. 그런데 이 화면은 phase-03-task-02에서 실제 발주서 화면으로 바뀌었다.
    - 그래서 dashboard 다음에서 TimeoutError가 났고, phase-03-task-03 화면은 이 스크립트로 찍히지 않았다.
    - 대신 위 7번처럼 Edge로 4너비×2테마(+1920·2560)를 직접 찍어 대조했다.
    - 조치 제안: stub 항목 삭제 또는 교체(하네스·스크립트 담당).
  - 검증자 운영 실수(보고 필요):
    - 슬롯 1 화면 테스트 포트(18095)가 아니라 E2E_PORT=18096으로 screenshots를 돌렸다.
    - 그 뒤 18096에서 대기 중이던 `scripts/e2e-server.ts` 프로세스(PID 33612)를 내가 띄운 것으로 잘못 보고 종료했다.
    - 종료 후 확인해 보니 그 부모는 원본 저장소(C:\Users\main\Desktop\DentalAX_with_Skills)의 Playwright 워커(PID 34696)였다. 다른 세션의 E2E 실행이 그 시각에 실패했을 수 있으니 재실행이 필요할 수 있다.
  - 참고(이 태스크 범위 밖): 검증 준비 중 POST /api/inventory/moves에 vendorId를 함께 보낸 요청 하나가 400을 받았다. vendorId 없이 보낸 요청은 201이었다. 원인은 조사하지 않았다(03-01 범위).
- 재현 방법(실패 시): 해당 없음. 수용 기준 실패는 없다.
  - 검증 스크립트: `node --disable-warning=ExperimentalWarning .tmp/val/verify.ts`
  - 조건: 서버 PORT=18195, DATA_DIR=.tmp/val/data, TEST_NOW=2026-11-02T09:00:00+09:00

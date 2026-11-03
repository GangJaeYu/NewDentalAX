# task_validation 결과 — phase-06-task-01 (바코드 출고: 스캐너·사진)

검증 커밋: 63339a6 (p2-integration, 기준 ff762f3 대비 06-01·02·03 병합). 검증 일시 2026-11-03. 검증자: Orca 검증 워커(슬롯 1, E2E_PORT=18095, 수동 서버 PORT=18195).

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | 바코드 입력란에 스캐너 입력(테스트: 키보드 타이핑+Enter) 시 해당 품목 출고 Dialog가 수량 1로 열린다 | PASS | 직접 띄운 서버(DATA_DIR=.tmp/data-manual, PORT=18195, 데모 seed) + 독립 스크립트 `node .tmp/verify-barcode.mjs`(Edge): 재고 화면 "바코드로 출고" 입력란에 `2001000000029`를 5ms 간격으로 치고 Enter → "출고 기록" Dialog "니트릴 글러브 M · 현재 2박스", 출고 수량 값 `1`. 저장 후 재고 2→1(API `/api/items/by-barcode`), 입력란 ""으로 비워지고 포커스 유지. 없는 바코드 `8800000000000` → 출고 창 없이 쉬운 안내. 스크린샷 `.tmp/shots/ac1-scan-dialog-1440.png`, 출력 `.tmp/verify-barcode.out`. e2e `inventory-barcode.spec.ts:84` AC1 ok |
| 2 | 바코드 사진 파일을 올리면 품목이 찾아진다(fixture 이미지) | PASS | 같은 스크립트로 "사진으로 찾기"(file input, accept=image/*, capture=environment)에 fixture 업로드: `ean13-photo.png`→니트릴 글러브 M, `code128-photo.png`→멸균 파우치 90×260, `ean13-sideways-photo.png`(90° 회전)→덴탈 마스크, 모두 출고 Dialog 수량 1. `qr-photo.png`→`HS-QR-0001`로 해독(데모에 없는 코드라 "등록된 품목이 없어요" 안내), `no-barcode-photo.png`→"바코드를 찾지 못했어요" 안내. 390px 모바일 뷰포트에서도 code128 사진 → Dialog 수량 1, 가로 넘침 0px. 스크린샷 `.tmp/shots/ac2-*.png`, `.tmp/shots/ac2-mobile-390.png`. unit `tests/barcode-decode.test.ts` 8건, e2e `inventory-barcode.spec.ts:148` AC2 ok |
| — | DESIGN §5 시각 기준(화면 태스크) | PASS | `E2E_PORT=18095 node scripts/screenshots.ts inventory-barcode-out inventory-barcode-notfound inventory-item-barcode-edit` → 24장 OK, 가로 스크롤·글꼴 경고 없음(`artifacts/screens/inventory-barcode-*`, `.tmp/screenshots.log`). 1440 라이트, 1024 다크, 768 라이트, 390 라이트를 직접 열어 `design-baseline/preview-dashboard-1440-dark.png`와 대조: 청록 강조색, 카드 가장자리, 글자 있는 상태 칩(부족·곧 부족·정상), 채워진 주 버튼은 화면당 "출고 기록" 하나, 글자 잘림·겹침 없음. e2e 화면 품질(4너비×2테마, axe 0건) ok |

- 게이트 결과: lint=PASS (tsc-server 330, tsc-web 205, eslint 469, headers 509, docs 7), unit=PASS (807건, 4번째 실행), e2e=PASS (334건, 28.0분, E2E_PORT=18095)
  - 로그: `harness_setup/evidence/runs/2026-11-03T04-10-21-296Z-phase-06-task-01-lint.log`, `...04-39-29-361Z-phase-06-task-01-unit.log`, `...04-42-22-499Z-phase-06-task-01-e2e.log`
- 환경 문제·판정 불가 사유:
  - unit 게이트는 처음 3번 FAIL이었다(24건, 49건, 1건 실패). 모두 바코드와 무관한 테스트(health, main.ts 포트 점유, start.bat, 백업 등)의 20~30초 시간 초과였고, 같은 시각에 다른 작업 사본(phase-05-task-05, phase-06-task-02 검증, 원본 저장소 integration)이 unit·e2e 게이트를 동시에 돌리고 있었다. 실패 테스트를 따로 돌리면 통과했다(`server/app.test.ts` 9/9, `server/main.test.ts` 26/26). 4번째 실행에서 807/807 PASS. 동시 실행 부하에 시간 초과가 민감하다는 점은 하네스 쪽 확인 거리로 남긴다(제품 결함 근거는 없음).
  - 실제 USB 바코드 스캐너와 휴대폰 카메라는 없다. 스캐너는 키보드 빠른 타이핑+Enter로, 휴대폰 촬영은 fixture PNG 업로드와 390px 모바일 뷰포트 에뮬레이션으로만 판정했다. 실제 기기의 카메라 앱 연동(capture 속성 동작)은 미검증이다.
  - 브라우저 확인은 관리자(원장) 계정으로 했다. 직원 권한의 바코드 조회는 unit `barcode.test.ts`("직원도 바코드로 그 품목을 찾는다")와 e2e(직원 계정 AC1)로 확인됐다.
  - 화면 확인 전에 `npm run build:web`을 실행해 추적 중인 web/dist가 바뀌었으나, 검증 후 `git restore web/dist` + 빌드가 만든 미추적 파일 삭제로 원래대로 돌려 놓았다(git status 깨끗함). 수동 서버(18195)는 내가 띄운 백그라운드 작업 핸들로 종료했고 포트가 비었음을 확인했다.
- 재현 방법(실패 시): 해당 없음(모든 기준 PASS). 재확인: `$env:DATA_DIR=".tmp/data-manual"; $env:PORT="18195"; npm start` 후 `node .tmp/verify-barcode.mjs`.

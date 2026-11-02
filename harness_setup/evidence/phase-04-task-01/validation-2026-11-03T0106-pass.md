# task_validation 결과 — phase-04-task-01 근무표

- 검증 커밋: db05097(작업 사본 HEAD. 7750bce 대비 차이는 loop_setup/specs·LOG 문서 3개뿐이고 제품 코드는 같음)
- 검증일: 2026-11-03, 독립 검증 세션(구현하지 않음). 제품·테스트·문서는 고치지 않음, git 추적 파일 변경 없음
- 수동 서버: 포트 18196, 임시 DATA_DIR `.tmp/manual/data-1793635247381`, TEST_NOW=2026-11-02T09:00:00+09:00, AI 주소는 127.0.0.1:9로 막음. 스크립트가 띄운 자식 프로세스 핸들로만 종료함(종료 뒤 18196 리슨 없음 확인)
- 독립 시나리오: 테스트(spec)와 다른 계정·직원·날짜·유형 조합을 썼다(`.tmp/manual/verify.ts`, 기록 `.tmp/manual/verify-log.txt`, `.tmp/manual/verify-results.json`)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | manager가 칸을 클릭해 "오전"을 고르면 1~2번 클릭으로 저장되고 새로고침 후 유지된다 | PASS | Edge에서 실장 로그인 → /hr/roster의 나래 11/4 칸 클릭(1) → 대화상자에서 "오전" 클릭(2). 클릭 수=2. 저장 직후 칸="오전", 새로고침 후 칸="오전", 합계 "1명". DB `roster(user=4, 2026-11-04)` = {shift_type_id:2, label:"오전"}. 스크린샷 `.tmp/manual/shots/ac1-pick-dialog.png`, `ac1-after-reload.png`. e2e hr-roster.spec.ts:111 ok |
| 2 | 지난주 복사 후 이번 주 칸이 지난주와 같다(휴가는 복사되지 않음) | PASS | 지난주 7칸 입력 + 10/28(수) 가람 야간 칸에 연차 승인(API 응답상 leave 덧씌움 확인) + 이번 주 11/6 실장 야간 미리 입력 → 화면 "지난주 복사" → 확인창 "…휴가는 복사되지 않아요" → 복사하기. API `GET /api/roster` 지난주·이번 주 7일×4명 shiftTypeId 전부 일치(diff=[]), 이번 주 leave 덧씌움 0건, 화면 11/4 가람="야간"(연차 아님), 미리 넣은 11/6 실장 칸은 "-"로 대체. 스크린샷 `.tmp/manual/shots/ac2-after-copy.png`. e2e :149 ok |
| 3 | 승인된 연차 날짜 칸에 "연차"가 표시되고 인원 합계에서 빠진다 | PASS | 11/5 3명 종일 → 합계 "3명". 나래 연차 신청(승인 대기) 동안 칸 "종일"·합계 "3명" 유지. 승인 후 칸="연차", 합계 "2명", API totals[2026-11-05]=2, cell={shiftTypeId:1, leave:{type:annual,label:연차,fullDay:true}}. 스크린샷 `.tmp/manual/shots/ac3-annual.png`, `ac3-month.png`. 인쇄 PDF에도 "연차"·"2명" 표시. e2e :214 ok |
| 4 | staff는 조회만 가능(편집 시도 403) | PASS | 직원 화면: 조회됨(11/5 나래 "연차"), "…바꾸기" 버튼 0, "지난주 복사" 0, "근무 유형" 0. 직원 API: PUT /api/roster/cell=403, POST /api/roster/copy-week=403, PUT /api/shift-types=403, PUT cell(null)=403, 본문 {"error":{"code":"FORBIDDEN","message":"이 기능을 사용할 권한이 없습니다."}}. 거부 뒤 DB 11/3 가람=종일 그대로. GET /api/roster=200. 스크린샷 `.tmp/manual/shots/ac4-staff-view.png`. e2e :241 ok |
| 5 | 대시보드 오늘 근무 카드에 오늘 근무자와 유형이 보인다 | PASS | 직원 로그인 / 대시보드 "오늘 근무" 카드 텍스트: "오늘 근무 근무표 11월 2일(월) 근무 2명 검실장 기타 종일 가람 기타 오후". /api/roster/today = [["검실장","종일",working], ["가람","오후",working]] working=2(복사된 11/2 칸과 일치). 1440·390 × light·dark에서 가로 스크롤 없음. 스크린샷 `.tmp/manual/shots/ac5-card-*.png`, `ac5-dashboard-*.png`. e2e :267 ok |

- 게이트 결과: lint=PASS(tsc-server 238, tsc-web 135, eslint 358, headers 389), unit=PASS(628건), e2e=PASS(183건, skipped·flaky 0, 근무표 spec 7건 포함. E2E_PORT=18096). 로그 `harness_setup/evidence/runs/2026-11-02T15-46-00-377Z-…-lint.log`, `…15-46-35-620Z-…-unit.log`, `…15-47-49-412Z-…-e2e.log`
- 인쇄(범위 항목): 인쇄 화면 PDF = 1쪽, 297×210mm(A4 가로). pdf.js로 그린 그림에 병원명·근무·연차·근무 인원·서명란이 보이고 메뉴·버튼 없음(`.tmp/manual/shots/print-pdf-render.png`, PDF `.tmp/manual/shots/print-roster.pdf`)
- 화면 대조(DESIGN §5·기준선): `npm run screenshots -- hr-roster hr-roster-month hr-roster-pick hr-roster-types dashboard-roster print-roster`(E2E_PORT=18096) 48장 모두 OK(가로 스크롤·글꼴 경고 없음). 직접 연 파일: `artifacts/screens/hr-roster-1440-light.png`, `dashboard-roster-1440-dark.png`, `dashboard-roster-390-light.png`, `hr-roster-pick-390-dark.png`, `hr-roster-month-768-light.png`, `hr-roster-month-390-light.png`. 기준선 `preview-dashboard-1440-light.png`과 같은 셸·카드 모양·청록 색. 채운 청록 버튼은 화면마다 1개("지난주 복사"), 근무 유형 칩에 글자 있음, 다크에서도 대비 정상. 문제 없음
- 환경 문제·판정 불가 사유: 없음
- 참고(판정에 영향 없음, 다른 태스크 범위):
  1. 대시보드 위 요약 숫자 "오늘 근무" 칸은 "-/아직 자료가 없어요"로 남아 있다(카드에는 근무자가 보임). 요약 숫자는 진행 중인 phase-03-task-10(대시보드) 범위다.
  2. 대시보드 인사말 날짜는 브라우저 시계(2026-11-03)를 따라 TEST_NOW(11/2)와 다르게 찍힌다(03-10 범위).
  3. unpdf 텍스트 추출에서 일부 숫자가 빠져 나온다(예: "09:30"→"0:30", "2명"→"명"). 그림으로 그리면 숫자는 정상이고 기존 e2e 단언도 통과한다. 글꼴 ToUnicode 매핑 문제로 보이며 PDF를 검색·복사할 때만 영향.
  4. 월간 보기 768·390px에서 표는 카드 안에서 가로로 넘겨 본다(페이지 가로 스크롤은 없음).
- 재현 방법(실패 시): 해당 없음(FAIL 없음). 독립 시나리오 재실행: `node --disable-warning=ExperimentalWarning .tmp/manual/verify.ts`

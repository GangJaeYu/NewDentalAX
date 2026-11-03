# task_validation 결과 — phase-03-task-10 대시보드 (작업 사본 6315aa6, TEST_NOW 2026-11-02T09:00+09:00)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | 데모 1440×900에서 요약 숫자 줄과 첫 줄 카드 4개가 스크롤 없이 보인다 | PASS | 수동 Edge(.tmp/verify-ui.ts, 포트 18194). `.main` scrollTop 0, scrollWidth 1440. KPI 6칸이 모두 y145~240 한 줄. 카드: 오늘 할 일·재고 경고·점검·의무는 y256~565, 오늘 근무는 y581~844로 모두 900 안(1440은 DESIGN §4 3열이라 4번째 카드는 둘째 줄, 승인 시안 preview-dashboard-1440-light.png와 같은 배치). 스크린샷 .tmp/shots/demo-1440x900-light.png·-dark.png, artifacts/screens/dashboard-demo-1440-*.png. e2e dashboard.spec AC1 ok |
| 2 | 각 카드 항목 클릭 시 해당 화면/항목으로 이동 | PASS | 대시보드 카드 링크 37개 중 고유한 33개를 하나씩 클릭함. 모두 href와 같은 URL로 이동했고 맞는 h1이 보임: 재고 경고→/inventory/items/2 "니트릴 글러브 M", 인수인계→/desk/board/7, 승인 대기→/hr/leave, 멸균 불합격→/facility/sterilizer?…&focus=171, 장비→/facility/equipment?open=3, 발주→/inventory/orders/2 "발주서 PO-2610-002", 최근 입출고→품목 상세, 지출→/finance/monthly 등(.tmp/verify-ui.log). e2e AC2 3건 ok |
| 3 | staff 로그인 시 승인 대기·발주·지출 카드 없음 | PASS | API: staff의 GET /api/dashboard에서 approvals·orders·expenseMonth가 null. 원장·실장은 null 없음. staff가 /api/orders·/api/finance/monthly·/api/expenses를 직접 부르면 403. 화면: staff 카드 8개(발주 진행·이번 달 지출 없음). KPI "승인 대기" 자리에 "내 휴가 신청". "승인 대기"·"PO-"·"지출" 글자 0건(.tmp/shots/staff-1440x900-light.png). e2e AC3 ok |
| 4 | 빈 DB에서 모든 카드가 빈 상태 안내와 바로가기를 보인다 | PASS | 빈 DB 원장 화면: 카드 10개 중 9개에 제목, 설명, 바로가기 링크 1개가 있음. 바로가기 9개를 모두 눌러 해당 화면 h1을 확인(체크리스트·재고 현황·법정 일정·근무표·공지·발주서·지출 기록). "AI 빠른 요청"은 입력 도구라 빈 상태 대신 입력창이 바로 보임(e2e와 같은 예외). KPI도 "근무표를 만들면 보여요" 등으로 안내함. .tmp/shots/empty-1440-light(-full).png. e2e AC4 2건 ok |
| 5 | 대시보드에서 출고 기록을 3번 클릭 이하로 완료 | PASS | 수동(staff, 키보드 입력 없이 마우스만): ① "출고 기록" ② 처음 보이는 품목 목록(8개) 중 "거즈 2×2" ③ "저장" = 3번. 토스트 "거즈 2×2 1팩 출고를 기록했어요. 남은 재고 24팩", 최근 입출고 맨 위 "출고 거즈 2×2 · 1팩 · 검증직원". e2e 로그 "[phase-03-task-10 AC5] 대시보드 출고 기록 클릭 수: 3" |
| 6 | GET /api/dashboard p95 ≤ 300ms(10배 데이터) | PASS | .tmp/verify-perf10.ts(포트 18194, 실제 HTTP, seedDemoAll scale 10: items 830·stock_moves 57,726·sterilizer_logs 1,842·expenses 283). 예열 10회를 뺀 150회: p50 90.1ms, **p95 104.1ms**, 최대 123.7ms. scale 1에서 100회: p95 11.1ms. 커밋된 증거 perf-dashboard.txt(p95 102.8ms)와 비슷함. 최종 NFR-005 부하 판정은 phase-05-task-01 소관 |
| 7 | (화면 기준) DESIGN §5-1 "글자 잘림·겹침 없음"·카드 가장자리 | **FAIL** | 768px(라이트·다크)에서 "다가오는 점검·의무 일정" 카드의 목록 행이 카드보다 넓음(행 오른쪽 440px, 카드 오른쪽 408px, 32px 넘침). 멸균 불합격 행의 "조치 필요" 칩이 "조치"로 잘리고, 다른 행의 날짜 끝도 가장자리에 붙음. 390px에서도 2px 넘쳐 칩이 테두리에 붙음. 1440·1024는 넘침 0. 증거: .tmp/shots/clip-768-light-due-card.png, clip-768-dark-due-card.png, clip-390-light-due-card.png, artifacts/screens/dashboard-demo-768-dark.png. **커밋된 태스크 증거 harness_setup/evidence/phase-03-task-10/dashboard-demo-768-dark.png에도 같은 잘림이 보임.** e2e "4너비 카드 넘침 없음"은 카드 상자가 .wrap 안에 있는지만 보고, 카드 안 내용 넘침은 보지 않아 놓침 |

- 게이트 결과: lint=PASS(tsc-server 290, tsc-web 155, eslint 422, headers 461), unit=PASS(720건), e2e=PASS(243건, 실패·skip·flaky 0. 로그 harness_setup/evidence/runs/2026-11-02T23-17-46-199Z-phase-03-task-10-e2e.log)
- 스크린샷: `E2E_PORT=18094 npm run screenshots -- dashboard dashboard-demo dashboard-quickout`가 24장 OK이고 가로 스크롤 경고 없음. 1440 라이트를 승인 시안과 비교한 결과, 순서·밀도·색·카드 정렬이 시안과 맞음
- 환경 문제·판정 불가 사유: 판정 불가 항목은 없음. 인계서의 HEAD(e431b64)와 달리 작업 사본은 6315aa6(phase-04 병합 후)이라 6315aa6 기준으로 판정함. 모든 서버는 내가 띄운 자식 프로세스 핸들로만 종료했고, 데이터는 .tmp/ 아래에만 둠. 실제 LLM 키는 쓰지 않음(데모 공급자)

## phase-04-task-03 AC2 대시보드 행

| 단계 | 판정 | 관찰 증거 |
|---|---|---|
| 불합격 저장 → 대시보드에 조치 전까지 경고 | PASS | 화면(.tmp/verify-ster.ts, staff): 멸균 기록 화면에서 BI 불합격을 저장하자 "불합격을 기록했어요. 실장님께 알림을 보냈어요…"가 뜸. 대시보드 점검 카드에 "경고 오토클레이브 1호기 BI(생물학적 지표) 불합격 11/2(월) · 조치를 기록할 때까지 보여요 · 조치 필요" 행이 생기고, KPI가 "멸균 불합격 1"에서 "멸균 불합격 2"로 바뀜. API도 sterilizerAlerts.total이 1에서 2로 늘었고, staff 응답에도 2로 보임 |
| 조치 기록 → 사라짐 | PASS | 대시보드 행을 누르자 /facility/sterilizer?…&focus=로 가서 "불합격 조치 기록" 창이 열림. 저장하자 "조치 내용을 기록했어요. 경고에서 빠졌어요." 표시. 대시보드에서 그 행이 사라지고 KPI가 "멸균 불합격 1"로 돌아옴. 데모 불합격까지 조치하자 불합격 행 0건, KPI "10건 · 기한 지남 2". API 경로도 같음(POST …/action 200 뒤 total이 2에서 1로 줄어듦) |

## 데모 배지·바뀐 e2e 기대값 검토(검사 약화 여부)

- **backup-reset AC5·AC6**: 약화 아님. 예전 단언 "초기화 뒤 상단바 '데모 모드' 0건"은 FR-030 AC1("키가 없으면 '데모 모드' 표시")과 충돌했음. 새 단언은 배지가 보이는지, 처음에 '데모 모드'·'가상 데이터'·'AI 키 미설정'이 모두 있는지, 초기화 뒤 '가상 데이터'가 없어지고 'AI 키 미설정'은 남는지, 다시 넣으면 '가상 데이터'가 돌아오는지를 봄. 오히려 더 세분화됨. 실제 화면에서도 같았음: 빈 DB 원장은 "데모 모드 · AI 키 미설정", 데모를 넣은 원장·staff는 "데모 모드 · 가상 데이터 · AI 키 미설정"(/api/ai/status는 staff도 읽을 수 있음). 390px은 시안처럼 "데모 모드"만 보임
- **app-shell**: 스텁 화면 axe 검사를 지운 것은 정당함. web/src에서 StubPage.tsx는 ForbiddenNotice·NotFoundPage만 export해 쓰이고, 스텁 경로는 남아 있지 않음. 재연결 테스트의 링크 선택자를 "주 메뉴" 안의 exact "재고 현황"으로 좁힌 것은 대시보드 빈 상태 버튼 "재고 현황 보기"와의 중복 매칭을 피하려는 것이라 의도는 같음
- 남은 빈틈(참고, FAIL 아님): "AI 키가 있고 데모 데이터가 없으면 배지 없음"은 단위 테스트(demoBadgeDetail(false,false)=null)로만 확인됨. 키를 저장한 상태의 e2e는 없음

## 재현 방법(실패 시)
1. `E2E_PORT=18094 npm run screenshots -- dashboard-demo`를 실행한 뒤 artifacts/screens/dashboard-demo-768-light.png(또는 -dark)를 연다. "다가오는 점검·의무 일정" 카드 첫 행(멸균 불합격)의 "조치 필요" 칩이 카드 오른쪽에서 잘려 있다.
2. 수치 확인: 768×1024에서 데모 대시보드를 열고 `article.card` "다가오는 점검·의무 일정" 안 `li`의 getBoundingClientRect().right(440)를 카드 right(408)와 비교한다(.tmp/verify-clip.ts).
3. 고칠 곳(추정): web/src/pages/dashboardCards.tsx 210~240행 점검 카드 행. 긴 제목과 칩이 줄바꿈되거나 줄어들지 않는다(min-width:0 또는 ellipsis 없음). 관련 커밋은 04c2e71.

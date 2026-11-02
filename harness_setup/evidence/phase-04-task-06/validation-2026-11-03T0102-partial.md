# phase-04-task-06 task_validation 결과 (독립 검증, 2026-11-03)

대상: HEAD db05097(= 7750bce + 문서 2개만 추가, 코드 동일). 작업 사본: C:\Users\main\orca\workspaces\DentalAX_with_Skills\phase-04-task-06-validation-worker. `npm ci` 후 실행. 실제 LLM 키 미사용(AI_BASE_URL_* = 127.0.0.1:9, 데모 공급자).

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | "국내 최고 임플란트, 100% 성공, 지금 50% 할인" 입력 → 규칙 3건 이상 하이라이트와 이유·대체 표현 | PASS | 수동 서버(PORT 18195, DATA_DIR .tmp/manual-*) `node .tmp/manual-check.mjs`: POST /api/adcheck 200, ruleHits 3건 = "국내 최고"(0–5, 최고·유일, high) / "100%"(12–16, 효과 보장, high) / "50% 할인"(24–30, 할인 강조, high), start·end 슬라이스가 원문과 일치, 각 건 reason·suggestion 있음. AI 2차(데모) issues 3, 비용 0원. 화면(직원, /docs/adcheck): mark 3개 "국내 최고1·100%2·50% 할인3", 카드 3개에 이유·바꿀 말, "위험 3건". 스크린샷 .tmp/manual-out/adcheck-staff-1440.png. e2e marketing-adcheck.spec.ts:68 ok |
| 2 | 결과에 "법률 자문이 아니며 사전심의 대상 여부는 관련 기관 확인" 고지 | PASS | API notice = "이 결과는 법률 자문이 아니며, 의료광고 사전심의 대상 여부는 관련 기관에 확인하세요. AI 초안은 참고용이며 법률 자문을 대신하지 않습니다." — AI 켬/걸린 표현 0건·AI 끔(ai=null) 두 경우 모두. 화면 adcheck-notice, 홍보 글·문서 작성기 결과에도 같은 고지 보임. e2e :103 ok |
| 3 | admin이 규칙을 추가하면 다음 점검부터 적용된다 | PASS | API: "마법같은 회복" 점검 0건 → admin PUT /api/ad-rules(새 규칙 추가) 200 → 다시 점검 1건(검증용 이유·바꿀 말 그대로). 화면(admin): "기적의 치료로 새 치아를 드려요" 점검 "규칙에 걸린 표현 없음" → "규칙 추가" 대화상자로 저장 → 알림 "규칙을 추가했어요. 다음 점검부터 적용돼요." → 다시 점검 1건 "기적의 치료"(효과 보장). 규칙 표 "규칙 16개 · 켜짐 16개". 직원: GET 200, PUT 403 FORBIDDEN, "규칙 추가" 버튼 0개. 스크린샷 .tmp/manual-out/adcheck-admin-rule-added-1440.png. e2e :123 ok |
| 4 | 홍보 글 생성 후 점검 결과가 자동으로 함께 보인다; 리뷰 답글 화면의 점검 버튼이 동작한다 | 부분 PASS + 판정 불가(후속 연결) | 홍보 글: /docs/promo에서 주제 입력 → "초안 만들기"만 누르면 추가 클릭 없이 점검 결과(위험 4건: 지역 최고·무료 스케일링 ×2) + AI 2차 + 고지 표시(.tmp/manual-out/promo-auto-check-1440.png). 문서 작성기: /docs/writer 본문에서 "광고 문구 점검" 버튼 → 결과 2건(국내 최고·100%) + 고지(.tmp/manual-out/writer-adcheck-1440.png). 리뷰 답글 글을 같은 API로 점검(직원): 200, "지역 최고"·"100%" 걸림, AI·고지 있음. **리뷰 답글 화면(/desk/review)에는 점검 버튼이 0개이고 "자동 점검 기능이 아직 연결되지 않아 안내만 드려요" 안내만 있다 → 버튼 동작은 판정 불가(후속 연결, 04-07 담당)**(.tmp/manual-out/review-1440.png). e2e :192, :227 ok. 화면 오류(pageerror·console error) 0건 |

- 게이트 결과: lint=PASS(tsc-server 238, tsc-web 135, eslint 358, headers 389), unit=PASS(628건; 단 첫 실행은 FAIL 1건 — 아래 참고), e2e=PASS(183건, skipped·flaky 0, 그중 marketing-adcheck 6건)
  - 로그: harness_setup/evidence/runs/2026-11-02T15-45-53-581Z-phase-04-task-06-lint.log, …15-46-30-500Z-…-unit.log(FAIL), …15-47-59-486Z-…-unit.log(PASS), …15-49-18-880Z-…-e2e.log
- 화면 대조(DESIGN §5, 기준선 preview-dashboard-*): `npm run screenshots` → `node scripts/screenshots.ts docs-adcheck docs-adcheck-rules docs-promo`(E2E_PORT 18095)로 artifacts/screens/ 48장 생성. 직접 연 파일: docs-adcheck-1440-dark, docs-promo-390-light-full, (수동) adcheck-staff-1440, promo-auto-check-1440. 기준선과 같은 청록 강조색·카드 모서리·간격, 칩에 글자 있음(색만으로 구분 안 함), 화면당 채워진 청록 버튼 1개(점검하기 / 다시 만들기), 글자 잘림·겹침 없음. 가로 스크롤 없음은 e2e :252(4너비×2테마)로 확인. 문제 없음.
  - 참고: 390 full-page 사진에서 하단 고정 탭바가 페이지 중간에 찍히는 것은 전체 페이지 캡처 방식 때문에 생긴 것이고, 결함은 아님.
- 환경 문제·판정 불가 사유:
  - AC4 "리뷰 답글 화면의 점검 버튼": 화면 연결이 04-07 범위라 아직 버튼이 없음 → 판정 불가(후속 연결). 같은 API로 리뷰 답글 글을 점검하는 경로는 동작함.
  - unit 첫 실행: server/db/migrate.test.ts(phase-01-task-02 AC1, 이번 변경 범위 밖) 1건이 "서버가 준비되지 않음"(15초 안에 /api/health 응답 없음)과 그 뒤 EPERM 정리 오류로 FAIL. 그 시각 PC CPU 부하 88%(다른 세션 동시 실행)였고, 곧바로 다시 돌렸을 때 628건 모두 PASS. 부하에 따른 시간 초과로 보이며, 이 태스크 결함은 아님. 다만 고정 15초 대기는 부하에 약하므로 조정자에게 알린다.
  - 관찰(결함 아님): 문서 작성기에서 "첫 상담은 무료예요"는 무료 규칙(무료 뒤에 검진·진료·시술 등이 와야 함)에 걸리지 않음.
- 재현 방법(실패 시): unit 시간 초과 — 부하가 높은 상태에서 `$env:E2E_PORT="18095"; node harness_setup/scripts/gate.mjs unit phase-04-task-06`. 수동 점검 — `node .tmp/manual-check.mjs`(서버를 자식으로 띄우고 stop.flag로 끔, 종료 코드 0 확인).

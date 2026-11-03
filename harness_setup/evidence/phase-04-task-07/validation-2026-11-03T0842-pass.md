# task_validation 결과 — phase-04-task-07 (검증 커밋 6315aa6, 2026-11-03 검증 워커 슬롯 1)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | 데모 모드로 공고와 질문 목록(직무·태도·상황 구분)이 표시된다 | PASS | 수동 서버(PORT=18195, DATA_DIR=.tmp/manual-data, AI 키 없음) + Edge `node .tmp/manual-check.mjs`: /hr/hiring에서 초안을 만들자 공고 "## 하늘숲치과 치과위생사 채용 … ### 근무 조건 - 주 5일(월~금 9:30~18:30) … ### 우대 사항 - 치과 근무 경력 1년 이상"이 나왔다. hiring-qgroup-직무·태도·상황이 각 1묶음, 질문은 2개씩이다. "AI 키가 없어 예시 초안을 넣었어요." 안내가 보이고, 깨끗한 조건에서는 경고 0건이다. 스크린샷 .tmp/shots/ac1-clean-1440.png. e2e hr-hiring.spec.ts:61 ok |
| 2 | 조건에 "20대 여성 우대"를 넣으면 차별 소지 경고가 보인다 | PASS | 근무 조건에 "…, 20대 여성 우대"를 입력하자 만들기 전에도 hiring-risk-conditions에 "근무 조건에 차별 소지 표현이 있어요 · 빼야 해요 2건"이 떴다. 내용은 ①"20대"(나이·연령차별금지법) ②"여성 우대"(성별·남녀고용평등법)이고, 하이라이트·이유·바꿀 말이 함께 보인다. 만든 공고에도 hiring-risk-posting에 같은 2건 경고가 붙는다. API는 POST /api/hiring/check → 200, hits=[{20대,age,high},{여성 우대,gender,high}]. 스크린샷 .tmp/shots/ac2-input-warning-1440.png, .tmp/shots/ac2-posting-warning-1440.png. e2e hr-hiring.spec.ts:108 ok |
| 3 | 저장한 초안이 보관함(saved_texts kind=hiring)에서 다시 열린다 | PASS | 공고에 표식 "VAL-0407"을 덧붙여 "검증용 채용 공고 VAL"로 저장했다. GET /api/saved-texts?kind=hiring → [{id:1,kind:"hiring",…,hasMarker:true}]. DB 직접 조회(.tmp/manual-data/app.db saved_texts) → {id:1,kind:"hiring",title:"검증용 채용 공고 VAL",category:"치과위생사",marker:1}. 새로고침 뒤 "검증용 채용 공고 VAL 불러오기"를 누르자 "다시 열었어요" 안내가 뜨고, 공고 본문이 저장값과 완전히 같았다(equals=true). 질문 3묶음도 복원됐다. 스크린샷 .tmp/shots/ac3-reopened-1440.png. e2e hr-hiring.spec.ts:157 ok |
| D | 화면 기준 DESIGN §5 / 기준선 대조 | PASS | `E2E_PORT=18195 node scripts/screenshots.ts hr-hiring hr-hiring-draft`로 16장(4너비×2테마)을 찍었다. 모두 OK(가로 스크롤 없음, Pretendard 로드). 경로: artifacts/screens/hr-hiring-*.png, hr-hiring-draft-*.png. 기준선 preview-dashboard-390-dark와 비교했다. 청록 강조, 카드 모서리, 하단 탭, 다크 토큰이 같다. 칩에 글자가 있고("빼야 해요"·"나이"·"성별"), 채워진 주 버튼은 하나("공고 초안 만들기/다시 만들기")다. e2e hr-hiring.spec.ts:203 light·dark에서 axe 위반 0건 ok |

## phase-04-task-06 AC4 리뷰 답글 행

| # | 수용 기준 | 판정 | 관찰 증거 |
|---|---|---|---|
| 04-06 AC4(리뷰 답글) | 리뷰 답글 화면의 점검 버튼이 동작한다 | PASS | /desk/review에서 "직원분들이 친절했어요. 설명도 자세했어요." → 초안 3개, 초안마다 "광고 문구 점검" 버튼 1개(총 3). 초안0에 "100% 무통 치료를 보장하고, 국내 최고 임플란트를 지금 50% 할인해 드려요."를 붙여 점검 → "광고 문구 점검 결과 위험 4건", 하이라이트 mark 4개(100%·무통·국내 최고·50% 할인), 항목마다 이유·바꿀 말, AI 2차 점검(데모), 고지 "이 결과는 법률 자문이 아니며, 의료광고 사전심의 대상 여부는 관련 기관에 확인하세요…". 다른 초안에는 결과 0건. 스크린샷 .tmp/shots/ac4-review-adcheck-1440.png. e2e desk-ai.spec.ts:105 ok |
| 추가 | 데모 답글 조사 | PASS | 데모 답글(따뜻하게) 원문: "…직원 응대를 좋게 봐 주셔서 … 편안한 하늘숲치과가 되도록 …"이다. "을(를)"·"치과이 "는 없다. e2e desk-ai.spec.ts:105 ok |

- 게이트 결과: lint=PASS(tsc-server 290, tsc-web 155, eslint 422, headers 461), unit=PASS(720건, 71파일), e2e=PASS(243건, 실패·skip 0, 12.5분, E2E_PORT=18095). 로그는 harness_setup/evidence/runs/2026-11-02T23-15-21-893Z-phase-04-task-07-lint.log, …23-16-00-427Z-…-unit.log, …23-17-56-266Z-…-e2e.log
- 환경 문제·판정 불가 사유: 없음. 인계서의 HEAD는 e431b64이지만, Orca 지시대로 이 작업 사본(6315aa6)을 검증했다. e2e는 PC 전체 heavy 자리를 기다린 뒤 실행됐다. 수동 서버(18195)는 내가 띄운 백그라운드 작업 핸들로 종료했고, 종료를 확인했다.
- 참고(수용 기준 밖, 판정에 넣지 않음): 보관함 제목이 영문으로 끝나면(예: "…VAL") 불러오기 안내가 "“검증용 채용 공고 VAL”을(를) 다시 열었어요."로 나온다. 받침을 판단할 수 없을 때 쓰는 대체 표기다.
- 재현 방법(실패 시): 해당 없음. 수동 확인 재현: `DATA_DIR=.tmp/manual-data PORT=18195 npm start` 후 `node .tmp/manual-check.mjs`

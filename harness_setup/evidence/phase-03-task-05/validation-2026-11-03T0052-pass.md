# task_validation 결과 — phase-03-task-05 (검증 커밋 a2986e5 = c23f474 + 루프 기록 커밋, 2026-11-03)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | 병원 정보에 "토요일 9:30~14:00"을 저장하면 데모 스크립트 결과에 그 값이 들어간다 | PASS | 수동 서버(PORT 18194, DATA_DIR=.tmp/data, 키 없음=demo 공급자). PUT /api/settings/clinic 200 → POST /api/ai/run {feature:script} 응답 text에 "토요일 9:30~14:00"·대표번호 02-987-6543 포함(provider:"demo"). 브라우저 /desk/script "스크립트 만들기" 결과 상자에도 포함. 토요일을 10:00~13:00으로 바꾸고 다시 실행하면 "토요일 10:00~13:00"만 나오고 9:30~14:00은 사라짐(실제 치환 확인). 스크린샷 .tmp/shots/ac1-script.png |
| 2 | 리뷰에 전화번호가 있으면 가려진 뒤 처리되고 안내가 보인다 | PASS | /desk/review에 "…010-9876-5432로 연락주세요" 입력 → 보내기 전 노란 경고 "전화번호로 보이는 내용이 있어요. 보내면 자동으로 가려집니다". 실행 후 안내 "전화번호 1건을 가리고 보냈습니다". 초안 3개 모두 "5432" 없음. API 직접 호출(010-1111-2222)도 응답에 번호 없음. DB 35개 테이블 전체 조회에서 원래 번호 0건(.tmp/dbcheck.mjs). 스크린샷 .tmp/shots/ac2-review-before.png, ac2-review-after.png |
| 3 | 답글 초안이 2개 이상 말투별로 보이고 복사·저장된다 | PASS | 초안 3개(정중하게·따뜻하게·간결하게), 내용 서로 다름 3/3. "복사" 후 navigator.clipboard 내용 = 초안1 원문 일치. 초안2 "보관함에 저장" → GET /api/saved-texts?kind=review_reply에 "리뷰 답글 초안(따뜻하게)" 1건, body가 초안2와 정확히 일치, 보관함 목록에도 표시. e2e AC3(말투 2개 미만 불가, 진료 사실 표현 경고)도 통과. 스크린샷 .tmp/shots/ac3-review-saved.png |
| 4 | 템플릿에 {진료시간} 치환 결과 미리보기와 90바이트 초과 시 "장문" 표시 | PASS | /desk/templates: "안녕하세요 {병원이름}입니다." → 미리보기 치환, "28바이트 / 단문 90바이트 · 단문". {진료시간} 추가 → 미리보기 "…토요일 9:30~14:00, 일요일 휴진", 남은 "{진료시간}" 없음, "109바이트 / 단문 90바이트 · 장문 · 90바이트를 넘어 장문 문자로 보내져요." 내가 따로 계산한 바이트(한글 2·그 외 1)도 109로 일치. 스크린샷 .tmp/shots/ac4-template-short.png, ac4-template-long.png |
| 5 | 환자 이름 치환자는 선택 목록에 없다 | PASS | 치환자 목록 10개: {병원이름},{대표번호},{진료시간},{점심시간},{휴진안내},{주차안내},{위치안내},{보험안내},{날짜},{시간} — 환자 이름·성함 없음. API로 {환자이름}·{이름} 템플릿 저장 시도 → 둘 다 400 VALIDATION "환자 개인 정보 치환자는 쓸 수 없어요". |

- 게이트 결과: lint=PASS(tsc-server 224, tsc-web 126, eslint 337, headers 363), unit=PASS(593건), e2e=PASS(170건, E2E_PORT=18094, desk-ai 11건 포함). 로그: harness_setup/evidence/runs/2026-11-02T15-22-35-140Z-phase-03-task-05-lint.log, …15-23-01-919Z-…-unit.log, …15-24-03-135Z-…-e2e.log
- 화면 대조: `npm run screenshots`(E2E_PORT=18094) 종료 코드 0, artifacts/screens 800장. desk-script/review/templates를 1440·1024·768·390 × light·dark로 열람 — 청록 A 색·카드·간격·정보 위계가 기준선(design-baseline/preview-dashboard-*)과 일치, 내가 찍은 12장(3화면×2너비×2테마) 모두 가로 스크롤 없음, 페이지 오류 0건. e2e axe 위반 0건(3화면×2테마).
- AiPanel 보완 회귀: 02-03(ai-panel.spec AC4·AC5)·03-06(docs-writer·docs-minutes) e2e 모두 통과. 스크린샷 docs-writer·admin-ai·docs-minutes 정상. 회의록 결과 상자가 안 보이는 것은 03-06의 의도된 CSS(.minutes-done .ai-out{display:none})라 회귀 아님.
- 환경 문제·판정 불가 사유: 없음. (참고, 기준 밖) 데모 답글 문구에 조사 처리 어색함이 있음: "직원 응대을(를)", "하늘숲치과이 되도록"(API 응답 review_reply 데모). 수동 서버(PID 36800)는 Start-Process 핸들의 PID·18194 리슨·DATA_DIR pid 파일 일치를 확인하고 종료함.
- 재현 방법(실패 시): 해당 없음. 관찰 스크립트 .tmp/verify.mjs, .tmp/dbcheck.mjs

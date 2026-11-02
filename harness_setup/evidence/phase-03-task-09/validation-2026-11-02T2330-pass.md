# task_validation 결과 — phase-03-task-09 (연차·휴가 신청과 승인)

- 검증 대상: 작업 사본 HEAD 020b81c (검증 대상 9f04ada 이후 변경은 loop_setup/specs·plan_setup·docs/DECISIONS 문서만이고 제품 코드 차이는 없음)
- 기준일: TEST_NOW=2026-11-02T09:00:00+09:00, 임시 데이터 `.tmp/val/data`, 수동 서버 PORT=18194, E2E_PORT=18094, 실제 LLM 키 사용 안 함

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | staff 신청 → manager 알림 → 승인 → 신청자 알림, 잔여 일수 감소(반차 0.5) | PASS | `.tmp/val/api-check.ts` → `.tmp/val/api-check.out`: 직원 반차(오전) 11/6 신청 201·days 0.5·pending → 실장 알림 "가직원 님이 휴가를 신청했어요"(leave_requested) → 승인 200·approved → 직원 알림 "11월 6일(금) 반차(오전) 신청이 승인됐어요"(leave_result, 승인 전 0건) → 잔여 15 → 14.5, used 0.5. e2e `hr-leave.spec.ts:67` 화면 흐름 통과 |
| 2 | 반려 시 사유를 비우면 저장되지 않고 오류 문구가 보인다 | PASS | Edge 직접 확인 `.tmp/val/ui-check.ts`: 빈 사유로 "반려하기" → 대화상자에 "반려 사유를 적어 주세요."·aria-invalid=true, 새로 고침 뒤에도 승인 대기 유지(1건). 스크린샷 `.tmp/val/ac2-reject-empty.png`. API: reason ''·'   '·누락 모두 400 VALIDATION `fields.reason="반려 사유를 적어 주세요."`, 상태 pending 유지, 사유 적으면 200 rejected. e2e `hr-leave.spec.ts:133` 통과 |
| 3 | 같은 날 이미 승인 2건(maxPerDay=2)인 날 승인하려 하면 경고가 보인다(승인은 가능) | PASS | 설정 GET `/api/settings/leave` = maxPerDay 2. 11/12에 2건 승인(경고 없음) 후 3번째 승인 → 200 approved + warnings "11월 12일(목)에 이미 2명이 휴가예요. 승인하면 하루 최대 2명을 넘어요." Edge(11/16 재현): 목록에 "경고 1건"·경고 문구, 승인 대화상자에 "승인 전에 확인해 주세요 … 경고가 있어도 승인할 수 있어요" → "경고를 확인했고 승인하기" 후 3명 모두 approved. 스크린샷 `.tmp/val/ac3-approve-warning.png`, `artifacts/screens/hr-leave-approve-*.png`. e2e `hr-leave.spec.ts:184` 통과 |
| 4 | staff는 다른 사람 신청을 승인할 수 없다(403) | PASS | API: staff1이 staff4 신청 approve → 403 FORBIDDEN "이 기능을 사용할 권한이 없습니다.", reject → 403, 본인 신청 approve도 403, 이후 상태 pending 유지. 직원 목록은 본인 것만 반환. Edge 직원 화면: "승인" 버튼 0개·"승인 대기" 제목 0개(`.tmp/val/ac4-staff-view.png`). e2e `hr-leave.spec.ts:222` 통과 |

- 게이트 결과: lint=PASS(tsc-server 197, tsc-web 117, eslint 306, headers 325), unit=PASS(532건), e2e=PASS(126건, hr-leave 6건 포함, skip·flaky 0) — 로그 `harness_setup/evidence/runs/2026-11-02T14-05-25-284Z-phase-03-task-09-lint.log`, `…14-05-53-436Z-…-unit.log`, `…14-07-08-875Z-…-e2e.log`
- 화면 기준(DESIGN §5): `npm run screenshots`(E2E_PORT=18094) — hr-leave·hr-leave-approve·hr-leave-request × 4너비 × 2테마 24장 모두 "OK"(가로 스크롤 없음, Pretendard 적용). 1440 라이트를 기준선 `preview-dashboard-1440-light.png`와 대조: 사이드바·상단바·요약 숫자 카드·카드 테두리·청록 강조가 일치하고 주 행동 버튼(채워진 청록)은 "휴가 신청" 하나, 경고는 글자 있는 칩·문구로 표시. 390px에서 표는 `.tablewrap`(overflow-x:auto) 안에서만 가로로 넘친다(페이지 가로 스크롤 아님). 다크 승인 대화상자 글자·경고 대비 정상
- 환경 문제·판정 불가 사유: 없음. 참고: 검증 스크립트에서 본문 없는 POST /cancel이 400(형식 오류)으로 끝난 것은 스크립트 요청 모양 탓이며 수용 기준과 무관
- 재현 방법(실패 시): 해당 없음(모두 PASS). 수동 재현: `DATA_DIR=.tmp/val/data PORT=18194 TEST_NOW=2026-11-02T09:00:00+09:00 node server/main.ts` 후 `node .tmp/val/api-check.ts`, `node .tmp/val/ui-check.ts`

phase-03-task-04 독립 검증(HEAD 167bf96, 대상 변경 8504a1c 포함, 미커밋 변경 없음)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | staff가 공지 작성 시도 → 403/버튼 없음, 인수인계는 작성 가능 | PASS | 수동 서버(.tmp/manual-verify.ts, 임시 DATA_DIR, PORT 18196, TEST_NOW=2026-11-02T09:00+09:00): staff POST /api/posts kind=notice → 403 FORBIDDEN "공지는 실장 이상만 쓸 수 있어요. 인수인계로 남겨 주세요."; staff handover pinned:true → 400 VALIDATION; staff handover → 201(id=1, author=검직원); staff PATCH 공지 → 403. e2e desk-board.spec.ts:57 통과(직원 화면에 "공지 쓰기"·"첫 공지 쓰기" 버튼 0개, 화면에서 인수인계 올리기 성공). 출력 원문 .tmp/manual-verify.out.txt |
| 2 | staff가 공지를 열면 manager 화면의 읽음 수가 1 증가하고 안 읽은 사람 목록에서 빠진다 | PASS | 수동: mgr 상세(전) readCount=1/4, unread=[검원장,검직원,검직원둘] → staff GET /api/posts/2(readByMe=true, staff 응답엔 readers 없음) → mgr 상세(후) readCount=2/4, readers=[검실장,검직원], unread=[검원장,검직원둘]. staff가 다시 열어도 2 유지(중복 집계 없음). e2e desk-board.spec.ts:142 통과(실장 화면 읽음 수 +1, 안 읽은 목록에서 빠짐) |
| 3 | 새 공지 등록 시 전 직원에게 알림이 생긴다 | PASS | 수동: mgr 공지 등록 후 admin·mgr·staff·staff2 4명 모두 GET /api/notifications 0→1, {type:"notice", title:"새 공지: 검증용 감염관리 공지", link:"/desk/board/2"}. e2e desk-board.spec.ts:102 통과(화면에서 올린 공지 → 전 직원 알림센터) |
| 4 | 오늘 항목 체크 시 체크한 사람·시각이 보이고, 주입 시계로 다음 날이 되면 미체크로 시작하며 어제 기록은 읽기 전용으로 조회된다 | PASS | 수동: staff 체크 → checked=true by=검직원 at=2026-11-02T00:00Z, done 1/3; mgr 재체크해도 by=검직원 유지. 같은 DATA_DIR로 TEST_NOW=2026-11-03T09:00+09:00 재시작(health now=2026-11-03T00:00Z) → 오늘 date=2026-11-03 done=0/3 체크 0개; ?date=2026-11-02 → readOnly=true done=1/3 by=검직원; 11-03 체크 뒤에도 11-02 done=1 불변; 미래 날짜 → 400. 화면: e2e desk-checklist.spec.ts:102·147 통과, 스크린샷 desk-checklist-past-*(“지난 날짜(2026년 11월 1일 일요일) 기록이에요. 조회만 할 수 있어요.” 안내, 체크한 사람·시각 표시) |
| 5 | 체크리스트 항목 순서 변경 후 새로고침해도 순서가 유지된다 | PASS | 수동: mgr PUT /api/checklists/open/items 순서 뒤집기 → 200, 재조회 [3,2,1] 유지, 서버 재시작(다음 날) 후에도 [3:예약 확인, 2:컴프레서 켜기, 1:조명 켜기] 유지. staff 편집 시도 → 403. e2e desk-checklist.spec.ts:67 통과(화면에서 순서 바꿔 저장 → 새로 고침 후 유지) |
| 화면 | DESIGN §5 시각 기준·기준선 대조 | PASS | `E2E_PORT=18096 npm run screenshots -- desk-board desk-board-detail desk-checklist desk-checklist-past print-checklist admin-backup admin-reset` exit 0, 56장 모두 OK, 가로 스크롤·글꼴 경고 없음(artifacts/screens/desk-*·print-checklist-*). 4너비×2테마 묶음표(.tmp/contact/*.png)와 개별 파일 desk-board-768-light, print-checklist-390-dark를 직접 봄. 기준선 preview-dashboard-*와 상단바·사이드바(1440)·아이콘 막대(1024/768)·아래 탭 막대(390), 청록 강조, 카드 모서리·간격, 칩 글자 표기(고정·분류·담당 직무) 일치. 채워진 주 버튼은 화면당 최대 1개(보드 "공지 쓰기", 인쇄 "인쇄하기"; 상세·체크리스트는 0개). 다크 테마 대비 정상, 페이지 잘림·겹침 없음. 참고: 768·390px 보드 표는 카드 안 표 래퍼(.tablewrap overflow-x:auto)에서 가로로 넘쳐 오른쪽 열이 가려 보임(페이지 가로 스크롤은 없음). 01-05 검증에서 허용된 공통 표 패턴과 같아 FAIL로 보지 않음. 390px 인쇄 미리보기는 표 칸이 좁아 글자가 여러 줄로 감김(잘림 없음). e2e axe 위반 0·휴대폰 너비 넘침 없음(desk-board.spec.ts:183, desk-checklist.spec.ts:185) |

- 게이트 결과: lint=PASS(tsc-server 164, tsc-web 108, eslint 268, headers 280), unit=PASS(466건), e2e=PASS(72건, desk 9건 포함). 로그 harness_setup/evidence/runs/2026-11-02T13-19-27-108Z-phase-03-task-04-lint.log, …13-19-49-655Z-…-unit.log, …13-20-27-903Z-…-e2e.log (E2E_PORT=18096)
- 환경 문제·판정 불가 사유: 없음. 데이터는 .tmp/ 아래 임시 폴더만 썼고(실행 후 삭제), 실제 LLM 키는 쓰지 않음. 띄운 서버(18196·18096)는 스크립트가 직접 종료함
- 재현 방법(실패 시): 해당 없음. 수동 관찰 재현: `node --disable-warning=ExperimentalWarning .tmp/manual-verify.ts`

### phase-02-task-05 화면 행

| 항목 | 판정 | 증거 |
|---|---|---|
| `npm run screenshots -- admin-backup admin-reset` 성공 | PASS | `E2E_PORT=18096 npm run screenshots -- admin-backup admin-reset` exit 0, OK 16줄, 가로 스크롤·글꼴 경고 없음(로그 .tmp/screens-0205.log). admin-reset 준비 글자 "지금 상태"에서 멈추지 않음 |
| 4너비×2테마 16장 DESIGN §5·기준선 대조 | PASS | artifacts/screens/admin-backup-{1440,1024,768,390}-{light,dark}.png, admin-reset-…png를 묶음표(.tmp/contact/admin-*.png)로 직접 봄. 백업: 채워진 주 버튼 "지금 백업" 1개, 칩 "자동" 글자, 카드 2열(1440)→1열 쌓임. 초기화: 위험 동작은 빨간 테두리 보조 버튼, 칩 "데모 데이터 없음"·"업무 데이터 있음" 글자, 1440 3열→1024/768 2열→390 1열. 두 테마 모두 잘림·겹침·가로 넘침 없음, 기준선과 골격·색·간격 일치 |

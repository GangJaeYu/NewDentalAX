# PROGRESS — 진행 상황

> 사람이 읽는 요약이다. 이어서 작업할 때는 `plan_setup/STATE.md`부터 읽는다.

## 지금
- 2026-11-03 15:50 기준: phase-01~05의 필수 태스크(P0·P1) 34개 모두 completed
- P2(phase-06) 3건(바코드 출고·AI 근무표 배정 제안·회의 녹음 → 회의록)도 구현해 main에 병합했다. 06-01은 completed, 06-02·06-03은 독립 재검증 중
- 마감: 2026-11-04 00:20(중단 시간 제외)

## 완료한 단계
| 단계 | 산출물 | 사용자 확인 |
|---|---|---|
| 아이디어 | docs/IDEA.md | 완료 |
| 요구(PRD)·디자인 | docs/PRD.md, docs/DESIGN.md, docs/design/preview.html | 완료(시안 v2 승인) |
| 기술(TRD) | docs/TRD.md | 완료 |
| 설계 | docs/ARCHITECTURE/*.md | 완료 |
| 계획 | plan_setup/(37개 태스크), docs/PLAN.md, docs/DECISIONS.md | 완료 |

## 구현 진행
| Phase | 태스크 | 완료 |
|---|---|---|
| 01 기반 | 6 | 6 (phase 완료) |
| 02 공통 플랫폼 | 5 | 5 (phase 완료) |
| 03 핵심 모듈 | 10 | 10 (phase 완료) |
| 04 확장 | 8 | 8 (phase 완료) |
| 05 최종 검증·문서 | 5 | 5 (phase 완료) |
| 06 나중(P2) | 3 | 1 (06-02·06-03 재검증 중) |

## 사용자 문서 (phase-05-task-04)
- 2026-11-03: README.md(설치·사용·문제 해결, 실제 화면 그림 10장), docs/LLM_GUIDE.md, docs/COST.md(가격·데이터 정책 2026-11-03 확인) 작성
- 문서 필수 소제목 검사를 `npm run lint`의 docs 단계에 연결
- phase-05-task-05 설치 리허설에서 README "설치하기" 순서를 그대로 따라 확인함(아래)

## 최종 게이트 수치 (phase-05-task-05, 2026-11-03)
- 기준: 커밋 `96d929c`에 리허설 증거·이 문서·기록 확인 테스트만 더한 작업 사본(제품 코드 변경 없음)
- lint PASS: tsc-server 310 · tsc-web 155 · eslint 443 · headers 481 · docs 7
- unit PASS: 771건
- e2e PASS: 314건(23.5분). 기록 확인 테스트(vitest 전용)를 더하기 전 회차의 값이고, 더한 뒤의 재실행은 PC 메모리 부족으로 중간에 멈췄다(e2e 대상 파일은 같음)
- 로그: `harness_setup/evidence/runs/*-phase-05-task-05-{lint,unit,e2e}.log`, 요약 `harness_setup/evidence/phase-05-task-05/install-rehearsal.md`

## 검증한 것

### 태스크별 독립 검증
구현하지 않은 별도 세션이 수용 기준마다 관찰 증거를 남겼다. 경로는 `harness_setup/evidence/<ID>/`이고, 여러 개면 마지막 파일이 최종 판정이다.

| 태스크 | 내용 | 최종 독립 검증 |
|---|---|---|
| phase-01-task-01 | 프로젝트 골격·도구·실행 스크립트 | validation-2026-11-02T2053-pass4.md |
| phase-01-task-02 | DB 래퍼·마이그레이션·공통 라이브러리 | validation-2026-11-02T1953-pass.md |
| phase-01-task-03 | 인증·세션·CSRF·권한·원내망·보안 헤더 | validation-2026-11-02T2011-pass.md |
| phase-01-task-04 | 디자인 시스템·앱 셸·첫 설정/로그인 화면 | validation-2026-11-02T2106-pass.md |
| phase-01-task-05 | 사용자 관리·병원 정보·활동 기록 화면 | validation-2026-11-02T2142-pass.md |
| phase-01-task-06 | 한글 문서 검색 품질 실험(OQ-008) | validation-2026-11-02T2007-pass.md |
| phase-02-task-01 | 개인정보 필터(서버·화면) | validation-2026-11-02T2008-pass.md |
| phase-02-task-02 | AI 게이트웨이·공급자 어댑터·비용·예산 | validation-2026-11-02T2037-pass.md |
| phase-02-task-03 | AI 관리 화면·AI 공용 화면 부품 | validation-2026-11-02T2141-pass.md |
| phase-02-task-04 | 알림 서비스·스케줄러 | validation-2026-11-02T2121-pass.md |
| phase-02-task-05 | 백업·복원·데모 데이터 적재/초기화 | validation-2026-11-02T2227-screens-pass.md |
| phase-03-task-01 | 재고: 품목·입출고·상태·거래처·단가 | validation-2026-11-02T2256-pass.md |
| phase-03-task-02 | 발주서 자동 작성·인쇄·입고 처리 | validation-2026-11-03T0020-pass.md |
| phase-03-task-03 | CSV 가져오기·내보내기 | validation-2026-11-03T0020-pass.md |
| phase-03-task-04 | 데스크: 공지·인수인계·오픈/마감 체크리스트 | validation-2026-11-02T2227-pass.md |
| phase-03-task-05 | 데스크 AI: 응대 스크립트·리뷰 답글·안내문 템플릿 | validation-2026-11-03T0052-pass.md |
| phase-03-task-06 | AI 문서 작성기·회의록 요약·서식 보관함·인쇄 | validation-2026-11-02T2305-pass.md |
| phase-03-task-07 | 원내 AI 도우미(문서 올리기·질문·근거) | validation-2026-11-02T2351-pass.md |
| phase-03-task-08 | 법정 의무 일정 | validation-2026-11-02T2330-pass.md |
| phase-03-task-09 | 연차·휴가 신청과 승인 | validation-2026-11-02T2330-pass.md |
| phase-03-task-10 | 대시보드 | validation-2026-11-03T1040-pass.md |
| phase-04-task-01 | 근무표 | validation-2026-11-03T0106-pass.md |
| phase-04-task-02 | 교육 이수 기록·신규 직원 온보딩 | validation-2026-11-03T0832-pass.md |
| phase-04-task-03 | 장비 점검·유지보수·멸균기 기록 | validation-2026-11-03T0155-partial.md + 남은 기준 재검증 validation-2026-11-03T0832-dashboard-row.md |
| phase-04-task-04 | 지출 기록·월간 요약 | validation-2026-11-03T0232-pass.md |
| phase-04-task-05 | 알림센터 완성·휴대폰 홈 화면(PWA) | validation-2026-11-03T0843-pass.md |
| phase-04-task-06 | 의료광고 문구 점검·홍보 글 초안 | validation-2026-11-03T0102-partial.md + 남은 기준 재검증 validation-2026-11-03T0842-review-row-pass.md |
| phase-04-task-07 | 채용 공고·면접 질문 초안 | validation-2026-11-03T0842-pass.md |
| phase-04-task-08 | 명세서·영수증 사진 → 입고·지출 입력 | validation-2026-11-03T0913-pass.md |
| phase-05-task-01 | 성능·부하 측정 | validation-2026-11-03T1100-pass.md |
| phase-05-task-02 | 보안 점검·SECURITY.md | validation-2026-11-03T1030.md |
| phase-05-task-03 | 전체 E2E·스크린샷 전수 점검·접근성 | validation-2026-11-03T1150-pass.md |
| phase-05-task-04 | 사용자 문서 | validation-2026-11-03T1130-pass.md |
| phase-05-task-05 | 설치 리허설·최종 보고 준비 | validation-2026-11-03T1400-pass.md |
| phase-06-task-01 | 바코드 출고(USB 스캐너·사진) | validation-2026-11-03T1400-pass.md |
| phase-06-task-02 | AI 근무표 배정 제안 | 재검증 중(1차: 기준 관찰 PASS, 동시 부하로 e2e 시간 초과) |
| phase-06-task-03 | 회의 녹음 파일 → 회의록 | 재검증 중(1차: 상태 오류 화면 FAIL → 수정) |

### 성능 (docs/PERF.md)
- 10배 데이터에서 주요 목록 API p95 최악 114.8ms(대시보드), 기준 300ms 이하
- 동시 연결 20개 60초 3회 모두 오류 0건
- 로그인 뒤 대시보드 첫 화면 최악 508ms, 기준 2초 이내

### 보안 (docs/SECURITY.md)
- 19개 영역 모두 점검, 미점검 0. 찾아서 고친 결함 3건
- 실제 등록된 /api 경로 150개 전수 점검(권한·CSRF·입력 검증)
- `npm audit --omit=dev` high 0 · critical 0(moderate 3, 도달 불가)

### 설치 리허설 (harness_setup/evidence/phase-05-task-05/install-rehearsal.md)
- git에 올린 파일만 새 폴더에 풀고(node_modules·data 없음) `cmd /c .\start.bat` 실행
- `npm ci --omit=dev` 자동 실행(105개, 8초) → 약 11초 뒤 `/api/health` 응답 `{"ok":true,"db":"ok"}`
- `/` → `/setup` "첫 설정" 표시 → 데모 데이터 넣기로 설정 → 대시보드와 주요 화면 8개 확인(콘솔 오류 0)
- 그 폴더의 `stop.bat`으로 정상 종료

## 미검증
- 실제 AI 답 품질과 실제 유료 키 동작: API 키가 없어 데모 응답과 가짜 서버(tests/fake-llm)로만 확인했다
- 실제 휴대폰 기기에서 홈 화면 설치(PWA)와 알림
- 다른 PC·태블릿에서 Windows 방화벽 허용 뒤 실제 접속
- `start.bat` 더블클릭 실행: 자동화는 `cmd /c .\start.bat`으로만 확인했다
- 처음 쓰는 PC의 내려받기 시간: 리허설 PC는 npm 캐시가 차 있어 8초였다
- 실제 바코드 스캐너·휴대폰 카메라 사진: 키보드 입력과 직접 만든 바코드 그림으로만 확인했다
- 실제 음성 받아쓰기(OpenAI·Gemini)와 AI 근무표 배정 품질: 가짜 서버와 데모 응답으로만 확인했다

## 사용자 할 일
1. AI 키 발급·입력: docs/LLM_GUIDE.md 순서대로(관리 → AI 설정·예산)
2. Windows 방화벽에서 "개인 네트워크"만 허용(README "Windows 방화벽 허용")
3. `start.bat`을 직접 더블클릭해 켜지는지 확인
4. 관리자 2명 만들기(한 명이 비밀번호를 잊어도 들어올 수 있게)
5. 백업 위치 확인(관리 → 백업·복원, README "백업과 복원")
6. 실제 키로 AI 답 품질 점검(문서 작성·원내 AI 도우미·광고 문구 점검)
7. 데모 데이터 초기화(관리 → 데모 데이터 초기화) 뒤 실제 사용 시작
8. 인터넷에 외부 공개하지 않기(docs/SECURITY.md 5절, README "보안·주의")

## 사고·특이 사항
- 2026-11-02: 테스트용 가짜 키로 실제 Anthropic API에 요청 1건이 나갔다. 401로 거절되어 비용은 없었다. 이후 e2e 서버가 실제 공급자를 기본으로 막는다.
- 2026-11-03: 조정자가 main 게이트의 e2e가 도는 중에 화면 빌드를 실행했다. 그 회차를 멈추고 버린 뒤 다시 돌렸다(남은 프로세스 없음 확인).
- 2026-11-03: 여러 검증 세션이 동시에 돌 때 무관한 테스트가 시간 초과로 번갈아 실패했다. unit도 PC 공용 자리 제한을 따르게 하고 e2e 테스트 시간 한도를 60초로 늘렸다.
- 2026-11-03: 검증 세션이 조정자의 e2e 서버 프로세스를 종료한 사고가 있었다. 이후 포트·프로세스 규칙(작업 사본마다 포트 슬롯, 직접 띄운 프로세스만 종료)을 더했다.

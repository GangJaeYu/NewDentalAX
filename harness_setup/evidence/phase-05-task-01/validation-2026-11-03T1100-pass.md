# task_validation 결과 — phase-05-task-01 (검증 2026-11-03, 작업 사본 HEAD 60af70b)

| # | 수용 기준 | 판정(PASS/FAIL/판정 불가) | 관찰 증거(명령·출력 요약·파일 경로) |
|---|---|---|---|
| 1 | 품목 1,000·입출고 2만 건에서 주요 목록 API p95 ≤ 300ms(측정 출력 첨부) | PASS | `PERF_PORT=18195 npm run perf`(2차, 10:46 KST, 직전 CPU 7%) → API 15개 최악 p95 110.3ms(대시보드), 입출고 기록 48.1ms, 재고 목록 69.7ms. 데이터는 DB 직접 조회(`--prepare .tmp/verify-data` + node:sqlite count)로 items 1000, stock_moves 61,296, audit_log 20000, purchase_orders 300 확인. 모든 호출이 200인지 검사함(callEndpoint). 출력: `.tmp/perf-run2.log`, `artifacts/perf/perf-2026-11-03T01-54-21-383Z.json/.txt`. 참고: 1차(09:49, 측정 중 다른 세션 e2e 2개가 시작돼 측정 중 평균 CPU 57~59%·최대 100%)는 입출고 기록 p95 488.6ms·대시보드 341.5ms로 FAIL(`.tmp/perf-run.log`, `artifacts/perf/perf-2026-11-03T00-55-02-061Z.*`). 이 회차는 perf.ts의 65% 기준에 걸리지 않아 버려지지 않았고, 지시에 따라 겹침이 끝난 뒤 다시 잰 값으로 판정함 |
| 2 | 20 동시 연결 60초 시나리오 오류 0건 | PASS | 2차 측정 3회 모두 autocannon 20연결×60초 오류 0·시간 초과 0(요청 2183/1960/1940건, 최악 p99 1638ms). 1차(겹친 측정)도 3회 모두 오류 0·시간 초과 0(최악 p99 4823ms) |
| 3 | 첫 화면(로그인 후 대시보드) 2초 이내 | PASS | 2차 측정 Playwright(Edge headless, 1440×900, 빈 캐시) 회차당 5번×2방식: 최악 1261ms(1회차 로그인→대시보드), 2·3회차 최악 529/476ms. 1차도 최악 469ms |
| 4 | 측정 환경·수치를 docs/PERF.md에 기록 | PASS | `docs/PERF.md` 열람: 측정 환경(CPU·메모리·OS·Node·브라우저·서버·PC 부하), 데이터 규모 표, 측정 명령·방법, ①②③ 수치 표, 겹친 측정 기록, 판정 표가 있음. 기록 수치(최악 p95 114.8ms·오류 0·첫 화면 508ms)는 직접 잰 값(110.3ms·0·1261ms)과 같은 범위이고 모두 기준 안 |

- 게이트 결과: lint=PASS(tsc-server 295·tsc-web 155·eslint 427·headers 466), unit=PASS(732건), e2e=PASS(244건, E2E_PORT=18095). 로그: `harness_setup/evidence/runs/2026-11-03T00-15-54-749Z-phase-05-task-01-lint.log`, `…00-16-34-087Z-…-unit.log`, `…00-17-22-963Z-…-e2e.log`
- 환경 문제·판정 불가 사유: 판정 불가 없음. ① 이 PC에서 다른 작업 사본의 e2e가 거의 쉬지 않고 돌아 완전히 조용한 구간이 없었다. 2차 측정도 약 75% 시간 동안 다른 e2e 1개가 함께 돌았다(`.tmp/slot-watch2.log`, 10초 간격 기록). 측정 중 평균 CPU 45.7/47.6/47.7%, 1회 겹침이 심한 회차(평균 68.3%, API p95 1221ms)는 perf.ts가 버리고 다시 잼. ② `npm run perf`는 무거운 검사 자리 제한(heavy-slot)을 따르지 않아, 측정 중에 다른 e2e가 시작될 수 있다. 1차 FAIL이 그 경우다. 대시보드·입출고 기록 API는 CPU 경합에 민감하다(관찰, 기준 판정에는 영향 없음). ③ 인계서 HEAD는 7f3c4d0이나 이 작업 사본은 지시대로 60af70b다. 7f3c4d0은 60af70b 위에 phase-03-task-10 대시보드 카드 CSS/TSX 수정과 e2e 1건만 더한 것이고, perf 관련 파일(scripts/perf*.ts, docs/PERF.md)은 두 커밋에서 같다. ④ PERF_PORT 기본값 18190 대신 슬롯 포트 18195를 지정해 실행함.
- 재현 방법(실패 시): 해당 없음(전 기준 PASS). 1차 FAIL 재현: 다른 e2e 2개가 도는 중에 `PERF_PORT=18195 npm run perf`.

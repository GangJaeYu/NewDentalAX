# phase-04-task-06 구현 워커 증거 (2026-11-03)

- 게이트(기준 커밋 `61a00ba`, dirty=no): lint PASS(tsc-server 217·tsc-web 126·eslint 332·headers 358), unit PASS 585건, e2e PASS 157건(전체 spec, `E2E_PORT=18093`).
  - 로그: `harness_setup/evidence/runs/2026-11-02T15-10-43-342Z-phase-04-task-06-lint.log`, `…15-11-00-202Z-…-unit.log`, `…15-11-43-724Z-…-e2e.log`(같은 폴더에 사본, `*.log`라 git 제외).
- 수용 기준 테스트
  - 서버: `server/modules/marketing/marketing.test.ts`(14건: 규칙 엔진·기본 사전·POST /api/adcheck·GET/PUT /api/ad-rules·홍보 글 데모·자동 점검)
  - 화면 순수 로직: `web/src/components/adcheck.test.ts`(3건: 하이라이트 조각·겹침·데모 표시)
  - 브라우저: `tests/e2e/marketing-adcheck.spec.ts`(6건: AC1·AC2·AC3·AC4 홍보 글·AC4 문서 작성기 버튼·4너비×2테마, axe 0건)
- 리뷰 답글 화면(`web/src/pages/desk/ReviewPage.tsx`, 03-05 소유) 연결은 하지 않았다. 연결 지점: 답글 초안마다 `<AdCheckButton text={답글} />`(`web/src/components/AdCheckResult.tsx`). 같은 API가 답글 글을 점검하는 것은 marketing.test.ts AC4 테스트로 확인했다.

## 화면 확인(DESIGN §5, 기준선 design-baseline 대조)

확인한 파일: `screens/` 12장(점검·규칙 사전·홍보 글 × 1440·390 × 라이트·다크). 전체 24장은 `npm run screenshots -- docs-adcheck docs-adcheck-rules docs-promo`로 `artifacts/screens/`에 생성(모두 가로 스크롤 없음). 768·1024도 직접 열어 봄.

| 문제 | 수정 |
|---|---|
| 점검 화면에서 카드 제목과 입력칸 이름이 둘 다 "점검할 글", 결과 카드 안에 "점검 결과 보기"가 겹침 | 카드 제목 "글 붙여 넣기", 결과 머리 "1차 규칙 점검"(아래 "AI 2차 점검"과 짝) |
| 홍보 글 화면에서 왼쪽 AI 원문과 오른쪽 초안이 같은 글을 두 번 보여 줌 | 다 받으면 왼쪽 원문 상자를 숨기고(비용·복사 줄은 남김), 다시 만들 때는 오른쪽을 비워 받는 글이 보이게 함 |

- 주 행동(채워진 청록)은 화면마다 하나: 점검("점검하기"), 홍보 글("초안 만들기/다시 만들기"). 규칙 고치기 대화상자의 "저장"은 대화상자 안에서만 보인다.
- 위험·주의는 색과 함께 번호(하이라이트 위첨자)·글자 칩("위험", "주의")으로 구분한다.
- 남은 한계: 규칙 사전 표는 정규식 원문을 보여 주어 직원에게는 읽기 어렵다(390px에서는 표만 가로 스크롤). 관리자 화면 성격이라 그대로 두었다.

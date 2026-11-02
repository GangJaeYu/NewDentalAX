# phase-03-task-02 구현 워커 증거 (2026-11-02)

- 게이트 로그(같은 폴더): lint PASS(tsc-server 190·tsc-web 117·eslint 300·headers 317), unit PASS 521건, e2e PASS 121건(전체 spec, `E2E_PORT=18093`). 기준 커밋은 각 로그 머리의 `commit=`(c087928, dirty는 이 증거 폴더만).
- 발주서 e2e: `tests/e2e/orders.spec.ts`(AC1~AC4, axe 목록·상세·편집·입고 대화상자·인쇄, 390px 가로 스크롤, 직원 권한 없음).
- 서버·화면 순수 로직: `server/modules/inventory/orders.test.ts`(10건), `web/src/pages/inventory/ordersLib.test.ts`(5건).
- 앱 셸 스텁 axe 검사(`tests/e2e/app-shell.spec.ts`)는 발주서가 실제 화면이 되어 아직 스텁인 `/finance/monthly`로 옮김(03-01 선례 cb3f3e5와 같은 방식).

## 화면 확인(DESIGN §5, 기준선 design-baseline 대조)

확인한 파일: `screens/` 24장(6화면 × 1440·390 × 라이트·다크). 전체 48장은 `npm run screenshots -- inventory-orders inventory-order-received inventory-order-ordered inventory-order-draft inventory-order-receive print-order`로 `artifacts/screens/`에 생성(모두 가로 스크롤 없음·Pretendard 로드 OK).

| 문제 | 수정 |
|---|---|
| 편집 화면 거래처 고르기 상자가 메모 칸 높이만큼 늘어남 | `.po-fields`에 `align-items: start` |
| 표 안 수량 입력이 기본 브라우저 모양(다크 테마에서 회색 상자) | `className="input num"` |
| 입고 처리 대화상자에서 도움말 없는 칸(수량·로트)이 늘어나 줄이 어긋남 | `.po-receive-grid`에 `align-items: start` |
| PDF로 저장하면 본문 글꼴의 대체 숫자(ss06·tabular)가 글자 정보 없이 찍혀 숫자를 검색·복사할 수 없음 | 인쇄할 때만 발주서 종이의 `font-feature-settings`·`font-variant-numeric`을 기본값으로 |
| 입고 완료 발주서 합계 타일 보조 문구가 "최근 입고 단가 기준" | 작성 중만 "최근 입고 단가", 나머지는 "발주서 단가 기준" |

남은 한계: 390px 인쇄 미리보기에서 긴 품목 이름이 좁은 칸 때문에 여러 줄로 나뉜다(A4 인쇄물에는 해당 없음).
주 행동(채워진 청록)은 화면마다 하나: 목록("발주서 만들기"), 작성 중("발주함"), 발주함("입고 처리"), 인쇄("인쇄하기").

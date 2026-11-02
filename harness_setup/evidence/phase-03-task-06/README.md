# phase-03-task-06 구현 워커 증거 (2026-11-02)

- 게이트 로그(같은 폴더): lint PASS(4단계), unit PASS 484건, e2e PASS 100건(전체 spec, `E2E_PORT=18093`). 기준 커밋은 각 로그 머리의 `commit=`.
- 문서 화면 e2e: `tests/e2e/docs-writer.spec.ts`(AC1·AC2·AC5·AC6), `docs-minutes.spec.ts`(AC3 화면·보낼 글), `docs-handover.spec.ts`(AC3 실제 보드, main의 03-04 병합 뒤 통과), `docs-library.spec.ts`(AC4, axe 5화면×2테마, 4너비 가로 스크롤).
- 서버·화면 순수 로직: `server/modules/docs/docs.test.ts`(13건), `web/src/pages/docs/docsLib.test.ts`(5건).

## 화면 확인(DESIGN §5, 기준선 design-baseline 대조)

확인한 파일: `screens/` 20장(5화면 × 1440·390 × 라이트·다크). 전체 40장은 `npm run screenshots`로 `artifacts/screens/docs-*`, `print-document-*`에 생성(모두 가로 스크롤 없음·Pretendard 로드 OK).

| 문제 | 수정 |
|---|---|
| 서식 보관함 도구줄의 고르기 상자가 기본 브라우저 모양(작고 테두리 다름) | `select.input.doc-filter` 클래스 적용 |
| 회의록 정리 뒤 AI 결과 상자에 날 JSON이 길게 남아 세 칸 결과와 중복 | 정리가 끝나면 `.ai-out` 숨김(받는 중에는 보임) |
| 상세 화면 "목록" 버튼 아이콘이 아래 화살표로 보여 의미가 어긋남 | 아이콘 제거 |
| AI 결과 상자(높이 제한 스크롤 영역)가 axe `scrollable-region-focusable` 위반 | 문서 화면에서만 높이 제한 해제(공용 AiPanel 변경 요청) |

주 행동(채워진 청록)은 화면마다 하나: 작성(초안 전 "초안 만들기" → 초안 후 "저장"), 회의록("정리하기" → "회의록 저장"), 보관함("새 문서 쓰기"), 상세("인쇄" 또는 "파일 내려받기").

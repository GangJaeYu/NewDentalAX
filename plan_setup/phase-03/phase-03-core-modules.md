# phase-03 — 핵심 모듈(P0): 재고·데스크·AI 문서·도우미·법정 일정·연차·대시보드

**목표**: PRD P0 기능을 모두 실제 데이터 흐름으로 완성하고 대시보드에 모은다.

## 묶음 수용 기준
- P0 FR의 수용 기준이 각 태스크 검증으로 확인된다
- 데모 데이터로 대시보드의 모든 카드가 실제 값으로 채워진다
- E2E: 로그인 → 출고 → 발주서 → 입고, 문서 생성 → 저장 → 인쇄, 도우미 질문 → 근거 표시, 연차 신청 → 승인
- 소속 태스크가 모두 completed(각자 네 게이트·별도 세션 검증 통과)여야 phase 완료로 판정한다.

## 태스크
| ID | 제목 | 선행 |
|---|---|---|
| [phase-03-task-01](phase-03-tasks/phase-03-task-01.md) | 재고: 품목·입출고·상태·거래처·단가 | phase-01-task-05, phase-02-task-04 |
| [phase-03-task-02](phase-03-tasks/phase-03-task-02.md) | 발주서 자동 작성·인쇄·입고 처리 | phase-03-task-01 |
| [phase-03-task-03](phase-03-tasks/phase-03-task-03.md) | CSV 가져오기·내보내기 | phase-03-task-01 |
| [phase-03-task-04](phase-03-tasks/phase-03-task-04.md) | 데스크: 공지·인수인계·오픈/마감 체크리스트 | phase-01-task-05, phase-02-task-04 |
| [phase-03-task-05](phase-03-tasks/phase-03-task-05.md) | 데스크 AI: 응대 스크립트·리뷰 답글·문자/안내문 템플릿 | phase-02-task-03, phase-03-task-04 |
| [phase-03-task-06](phase-03-tasks/phase-03-task-06.md) | AI 문서 작성기·회의록 요약·서식 보관함·문서 인쇄 | phase-02-task-03 |
| [phase-03-task-07](phase-03-tasks/phase-03-task-07.md) | 원내 AI 도우미(문서 올리기·질문·근거) | phase-01-task-06, phase-03-task-06 |
| [phase-03-task-08](phase-03-tasks/phase-03-task-08.md) | 법정 의무 일정 | phase-01-task-05, phase-02-task-04 |
| [phase-03-task-09](phase-03-tasks/phase-03-task-09.md) | 연차·휴가 신청과 승인 | phase-01-task-05, phase-02-task-04 |
| [phase-03-task-10](phase-03-tasks/phase-03-task-10.md) | 대시보드 | phase-03-task-01, phase-03-task-02, phase-03-task-04, phase-03-task-08, phase-03-task-09, phase-02-task-03 |

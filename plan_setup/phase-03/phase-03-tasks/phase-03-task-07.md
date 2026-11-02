---
id: phase-03-task-07
status: in_progress
phase: "03"
title: "원내 AI 도우미(문서 올리기·질문·근거)"
depends_on: [phase-01-task-06, phase-03-task-06]
files:
  - "server/modules/assistant/**"
  - "server/ai/features/assistant.ts"
  - "server/db/migrations/041_kb.sql"
  - "web/src/pages/docs/assistant*"
acceptance_criteria:
  - "E2E(데모): \"멸균기 B&D 테스트는 언제 해?\" → 답 아래 근거 카드에 \"멸균\" 매뉴얼 이름과 발췌가 보이고 링크로 원문이 열린다"
  - "관련 없는 질문 → \"원내 문서에서 찾지 못했습니다\" + 문서 올리기 안내, ai_usage에 기록 없음"
  - "visibility=manager 문서는 staff 질문의 근거로 쓰이지 않는다"
  - "pdf·docx 샘플 업로드가 ready가 되고 조각 수가 표시된다; 손상된 pdf는 failed + 이유"
  - "전화번호가 든 문서 업로드 시 needs_review와 감지 항목이 보이고 \"가리고 저장\" 후 검색 결과 발췌에 번호가 가려져 있다"
  - "문서를 삭제하면 이후 검색 근거에 나오지 않는다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-07 — 원내 AI 도우미(문서 올리기·질문·근거)

- **관련 요구·결정**: FR-070, FR-071
- **설계 근거**: overview.md §3.5, backend.md §3.6 kb/assistant, database.md §6 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-06, phase-03-task-06

## 범위
- 업로드(txt·md·pdf(unpdf)·docx(mammoth)·서식 보관함 문서 선택) → 추출 → 개인정보 검토 → 색인, 공개 범위, 삭제
- 질문 → 검색 → (근거 있으면) AI → 답 + 근거 카드(문서명·발췌·링크), 근거 없으면 AI 미호출
- 대화 기록·삭제
- demo seed: phase-01-task-06의 매뉴얼 5종

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

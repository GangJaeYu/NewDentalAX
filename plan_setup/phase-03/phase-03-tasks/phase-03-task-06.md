---
id: phase-03-task-06
status: in_progress
phase: "03"
title: "AI 문서 작성기·회의록 요약·서식 보관함·문서 인쇄"
depends_on: [phase-02-task-03]
files:
  - "server/ai/features/{doc_writer,doc_revise,minutes}.ts"
  - "server/modules/docs/**"
  - "server/db/migrations/040_docs.sql"
  - "web/src/pages/docs/{writer,minutes,library}*"
  - "web/src/pages/print/document*"
acceptance_criteria:
  - "E2E: 문서 종류 \"환자 안내문\" + 요점 입력 → 스트리밍으로 초안이 점차 표시 → 중지 버튼이 동작 → 다시 생성 → 저장 → 서식 보관함에 나타나고 버전 1"
  - "수정 후 저장하면 버전 2가 생기고 이전 버전 내용을 볼 수 있다"
  - "회의 메모 → 결정 사항·할 일(역할·기한)·요약이 분리 표시되고, 할 일 하나를 인수인계로 보내면 보드에 나타난다"
  - ".exe 파일 업로드는 415, 21MB 파일은 413과 한국어 안내"
  - "<script>가 든 본문을 저장해도 미리보기/인쇄에서 실행되지 않는다(XSS E2E)"
  - "문서 인쇄 PDF에 A4·머리말(병원명)·쪽 번호가 있다"
verification: [lint, unit, e2e, task_validation]
---

# phase-03-task-06 — AI 문서 작성기·회의록 요약·서식 보관함·문서 인쇄

- **관련 요구·결정**: FR-060, FR-061, FR-062, FR-063
- **설계 근거**: backend.md §3.6, §4 doc_writer/doc_revise/minutes, frontend.md MarkdownEditor/PaperPreview (docs/ARCHITECTURE/)
- **선행**: phase-02-task-03

## 범위
- 문서 종류별 프롬프트(공문 형식 포함), 스트리밍·중지, 편집기·부분 수정, 저장·버전
- 회의록 → 결정/할 일/요약 JSON, 할 일을 인수인계·공지로 보내기
- 서식 보관함(폴더·태그·검색·업로드·파일 다운로드), 업로드 검사(TD-012)
- 문서 인쇄 경로

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

---
id: phase-01-task-05
status: completed
phase: "01"
title: "사용자 관리·병원 정보·활동 기록 화면"
depends_on: [phase-01-task-04]
files:
  - "server/modules/admin/**"
  - "web/src/pages/admin/{users,clinic,audit}*"
  - "server/db/migrations/002_admin.sql(필요 시)"
acceptance_criteria:
  - "admin이 직원을 추가하면 그 직원이 임시 비밀번호로 로그인 → 비밀번호 변경 화면으로 강제 이동 → 변경 후 대시보드 진입"
  - "직원 추가 폼에 이름·아이디·역할·직무·입사일 외 입력란이 없다"
  - "마지막 admin을 비활성화/강등하면 409 LAST_ADMIN과 안내가 보이고 상태가 바뀌지 않는다"
  - "비활성화한 직원의 열린 세션은 다음 요청에서 401이 된다"
  - "활동 기록에서 기간·사용자 필터가 동작하고 CSV를 엑셀 형식(UTF-8 BOM)으로 받는다; staff는 접근 불가"
  - "병원 정보를 저장하고 새로고침해도 값이 유지된다"
verification: [lint, unit, e2e, task_validation]
---

# phase-01-task-05 — 사용자 관리·병원 정보·활동 기록 화면

- **관련 요구·결정**: FR-003 AC2·3, FR-004, FR-005, FR-042 AC1(병원 정보)
- **설계 근거**: backend.md §3.2, database.md §5 (docs/ARCHITECTURE/)
- **선행**: phase-01-task-04

## 범위
- 사용자 CRUD·비활성화·비밀번호 초기화(다음 로그인 변경 강제)·마지막 admin 보호
- 병원 기본 정보(진료시간·점심·휴진·주차·위치·보험 일반 안내·대표번호)
- 감사 로그 목록·필터·CSV 내보내기

## 완료 판정
- frontmatter의 acceptance_criteria를 `lint → unit → e2e → task_validation` 순서로 확인한다. 게이트 정의는 `harness_setup/HARNESS.md`.
- task_validation은 이 태스크를 구현하지 않은 별도 세션이 수행하고, 기준별 관찰 증거(명령 출력·스크린샷 경로·응답 값)를 LOG에 남긴다.
- 화면이 있는 태스크는 docs/DESIGN.md(승인: 청록 A + 기본 밀도, 시안 v2) §5 시각 기준을 함께 만족해야 한다.
- 공유 파일 규칙(plan_setup/PLAN.md §3)을 지킨다.

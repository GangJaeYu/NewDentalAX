// 이 파일이 하는 일: AI 기능 "온보딩 초안"(backend.md §4 onboarding, FR-083 AC2)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사.
// 입력 {jobType, notes?} → 응답 JSON {items[]}(신규 직원이 첫 몇 주 동안 익히고 확인할 체크리스트 항목 10개 안팎).
// 화면(/hr/onboarding)은 이 초안을 고친 뒤 직무별 템플릿으로 저장한다. 데모 응답은 직무(치과위생사·간호조무사·데스크 등)에 맞는 예시 항목을 돌려준다.
import { z } from 'zod';
import { baseSystem, DEMO_MARK, demoJson, jsonOnly, optionalText, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({ jobType: textField(50, '직무'), notes: optionalText(1000, '추가 요청') });
const outputSchema = z.object({ items: z.array(z.string()).min(1) });

/** 모든 직무 공통 첫 주 항목 */
const COMMON_ITEMS = ['비상 연락망·근무 시간·휴게 시간 확인', '감염관리 기본 수칙(손 위생·보호구 착용) 익히기', '개인정보 보호 수칙 확인(환자 정보는 원내 시스템에만 기록)'];

/** 직무별 데모 항목(직무 이름에 이 낱말이 들어 있으면 그 목록을 쓴다) */
const DEMO_BY_JOB: ReadonlyArray<{ match: RegExp; items: readonly string[] }> = [
  {
    match: /위생사/,
    items: [
      '진료실·소독실 동선과 기구 위치 익히기',
      '스케일링 기구·초음파 장비 준비와 정리 방법 익히기',
      '멸균기 사용법과 멸균 기록(BI·CI) 쓰는 법 배우기',
      '구강 검진 보조와 칫솔질 교육 순서 익히기',
      '방사선 촬영 보조와 방호 수칙 확인',
      '진료 후 유닛 체어 소독 순서 실습',
      '선배 위생사 진료 보조 참관 3회',
    ],
  },
  {
    match: /조무사|어시스턴트|보조/,
    items: [
      '진료실·소독실 동선과 물품 위치 익히기',
      '기본 기구 세팅(검진·충전·발치) 익히기',
      '멸균기 사용법과 멸균 기록 쓰는 법 배우기',
      '재료 재고 확인과 입출고 기록 방법 익히기',
      '진료 후 유닛 체어 소독 순서 실습',
      '선배 진료 보조 참관 3회',
    ],
  },
  {
    match: /데스크|접수|코디/,
    items: [
      '예약 접수·변경·취소 응대 순서 익히기',
      '전화 응대 스크립트 읽고 따라 해 보기',
      '수납·영수증 발행 절차 익히기',
      '진료 시간·휴진일·주차 안내 내용 외우기',
      '인수인계 게시판 쓰는 법 익히기',
      '선배 데스크 응대 참관 하루',
    ],
  },
];

/** 직무에 맞는 데모 항목 목록 */
export function demoItems(jobType: string): string[] {
  const job = DEMO_BY_JOB.find((j) => j.match.test(jobType));
  const own = job ? [...job.items] : [`${snippet(jobType, 20)} 업무 공간·물품 위치 익히기`, '담당 업무 순서를 선배와 함께 정리하기', '선배 업무 참관 3회'];
  return [...COMMON_ITEMS, ...own, '첫 주 마치고 멘토와 면담하기'];
}

export const onboarding: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'onboarding',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    return {
      system: [
        baseSystem(ctx),
        '치과 신규 직원 온보딩 체크리스트 항목을 10개 안팎으로 씁니다.',
        '항목은 한 줄짜리 할 일로, "~ 익히기", "~ 확인" 처럼 끝냅니다. 첫 주 → 둘째 주 → 한 달 순서로 늘어놓습니다.',
        '환자 정보는 쓰지 않습니다.',
        jsonOnly('{"items":["..."]}'),
      ].join('\n'),
      user: `직무: ${input.jobType}${input.notes ? `\n추가 요청: ${input.notes}` : ''}`,
    };
  },
  demo(input) {
    const items = demoItems(input.jobType);
    items[0] = `${DEMO_MARK} ${items[0]}`;
    return demoJson({ items });
  },
};

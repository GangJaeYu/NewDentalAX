// 이 파일이 하는 일: AI 기능 "온보딩 초안"(backend.md §4 onboarding)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사 기본형.
// 입력 {jobType} → 응답 JSON {items[]}(신입 직원이 첫 주에 익힐 항목).
import { z } from 'zod';
import { baseSystem, demoJson, jsonOnly, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({ jobType: textField(50, '직무') });
const outputSchema = z.object({ items: z.array(z.string()).min(1) });

export const onboarding: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'onboarding',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n치과 신입 직원 온보딩 체크리스트 항목을 10개 안팎으로 씁니다.\n${jsonOnly('{"items":["..."]}')}`,
      user: `직무: ${input.jobType}`,
    };
  },
  demo(input) {
    return demoJson({ items: [`[데모 응답] ${input.jobType} 업무 공간·물품 위치 익히기`, '감염관리 기본 수칙 확인', '전화 응대 스크립트 읽기', '비상 연락망 확인'] });
  },
};

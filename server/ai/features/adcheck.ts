// 이 파일이 하는 일: AI 기능 "의료광고 점검 2차"(backend.md §4 adcheck)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사 기본형.
// 입력 {text, ruleHits?(규칙 점검 결과)} → 응답 JSON {issues[{phrase, reason, suggestion}], overall}. 결과는 참고용이며 법률 자문이 아니다(FR-038).
import { z } from 'zod';
import { baseSystem, demoJson, jsonOnly, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  text: textField(8000, '점검할 글'),
  ruleHits: z.array(z.looseObject({ phrase: z.string(), reason: z.string().optional() })).max(200).default([]),
});
const outputSchema = z.object({
  issues: z.array(z.object({ phrase: z.string(), reason: z.string(), suggestion: z.string() })),
  overall: z.string(),
});

export const adcheck: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'adcheck',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    const hits = input.ruleHits.length ? `\n규칙 점검에서 찾은 표현: ${input.ruleHits.map((h) => h.phrase).join(', ')}` : '';
    return {
      system: `${baseSystem(ctx)}\n의료법 제56조 의료광고 기준으로 글을 살펴 문제 될 수 있는 표현과 바꿀 말을 제안합니다. 법률 자문이 아닌 참고 의견입니다.\n${jsonOnly('{"issues":[{"phrase":"...","reason":"...","suggestion":"..."}],"overall":"..."}')}`,
      user: `점검할 글:\n${input.text}${hits}`,
    };
  },
  demo(input) {
    return demoJson({
      issues: input.ruleHits.slice(0, 3).map((h) => ({ phrase: h.phrase, reason: '[데모 응답] 과장으로 보일 수 있는 표현입니다.', suggestion: '사실만 담백하게 적어 주세요.' })),
      overall: '[데모 응답] 큰 문제는 보이지 않지만, 효과를 장담하는 표현은 피해 주세요.',
    });
  },
};

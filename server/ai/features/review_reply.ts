// 이 파일이 하는 일: AI 기능 "리뷰 답글"(backend.md §4 review_reply)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사 기본형.
// 입력 {review, tones[]} → 응답 JSON {replies:[{tone, text}]}.
import { z } from 'zod';
import { baseSystem, demoJson, jsonOnly, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  review: textField(3000, '리뷰'),
  tones: z.array(z.string().trim().min(1).max(30)).min(1).max(3).default(['정중하게']),
});
const outputSchema = z.object({ replies: z.array(z.object({ tone: z.string(), text: z.string() })).min(1) });

export const review_reply: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'review_reply',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n온라인 리뷰에 병원 이름으로 답글을 씁니다. 치료 효과를 장담하거나 다른 병원과 비교하지 않습니다.\n${jsonOnly('{"replies":[{"tone":"말투","text":"답글"}]}')}`,
      user: `리뷰: ${input.review}\n말투(각각 하나씩): ${input.tones.join(', ')}`,
    };
  },
  demo(input) {
    return demoJson({
      replies: input.tones.map((tone) => ({
        tone,
        text: `[데모 응답] "${snippet(input.review, 20)}" 리뷰 남겨 주셔서 감사합니다. 말씀 주신 부분은 직원들과 함께 살피겠습니다.`,
      })),
    });
  },
};

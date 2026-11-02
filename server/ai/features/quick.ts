// 이 파일이 하는 일: AI 기능 "빠른 요청"(대시보드, backend.md §4 quick)의 입력 검사·프롬프트·데모 응답 기본형.
// 입력은 글 하나(문자열) 또는 {text}. 응답은 그냥 글이다.
import { z } from 'zod';
import { baseSystem, DEMO_MARK, snippet, type AiFeatureModule } from './types.ts';

const inputSchema = z
  .union([z.string(), z.object({ text: z.string() })])
  .optional()
  .transform((v) => ({ text: (typeof v === 'string' ? v : (v?.text ?? '')).trim() }))
  .pipe(z.object({ text: z.string().max(4000, '요청은 4000자 이하로 줄여 주세요.') }));

export const quick: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'quick',
  inputSchema,
  buildPrompt(input, ctx) {
    return { system: `${baseSystem(ctx)}\n직원의 짧은 업무 요청에 바로 쓸 수 있는 답을 줍니다.`, user: input.text };
  },
  demo(input) {
    const topic = input.text ? `"${snippet(input.text)}" 요청` : '요청';
    return `${DEMO_MARK} ${topic}에 대한 예시 답변입니다. 실제 AI 키를 설정하면 이 자리에 AI가 쓴 답이 나옵니다.\n1. 할 일을 짧게 나눠 적습니다.\n2. 담당자와 마감일을 정합니다.\n3. 끝나면 인수인계에 남깁니다.`;
  },
};

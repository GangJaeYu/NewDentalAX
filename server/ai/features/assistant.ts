// 이 파일이 하는 일: AI 기능 "원내 AI 도우미"(backend.md §4 assistant)의 입력 검사·프롬프트·데모 응답 기본형.
// 입력 {question, chunks[{n, title?, text}]}(원내 매뉴얼에서 찾은 조각) → 근거 번호([1])를 인용한 답. 조각에 없는 내용은 모른다고 답한다.
import { z } from 'zod';
import { baseSystem, DEMO_MARK, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  question: textField(1000, '질문'),
  chunks: z
    .array(z.object({ n: z.number().int().min(1).optional(), title: z.string().max(200).optional(), text: z.string().max(4000) }))
    .max(10)
    .default([]),
});

export const assistant: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'assistant',
  inputSchema,
  buildPrompt(input, ctx) {
    const refs = input.chunks.map((c, i) => `[${c.n ?? i + 1}] ${c.title ? `${c.title}: ` : ''}${c.text}`).join('\n\n');
    return {
      system: `${baseSystem(ctx)}\n아래 원내 자료 조각만 근거로 답합니다. 답 끝에 근거 번호를 [1]처럼 붙입니다. 자료에 없으면 "원내 자료에서 찾지 못했습니다"라고 답합니다.`,
      user: `질문: ${input.question}\n\n원내 자료:\n${refs || '(찾은 자료 없음)'}`,
    };
  },
  demo(input) {
    const ref = input.chunks.length ? ` [${input.chunks[0]?.n ?? 1}]` : '';
    return `${DEMO_MARK} "${snippet(input.question)}"에 대한 예시 답변입니다. 원내 매뉴얼의 순서대로 진행해 주세요.${ref}`;
  },
};

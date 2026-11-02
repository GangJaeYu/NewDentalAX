// 이 파일이 하는 일: AI 기능 "문서 부분 수정"(backend.md §4 doc_revise)의 입력 검사·프롬프트·데모 응답 기본형.
// 입력 {text(고칠 부분), instruction(어떻게)} → 고친 마크다운.
import { z } from 'zod';
import { baseSystem, DEMO_MARK, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  text: textField(8000, '고칠 글'),
  instruction: textField(500, '고칠 방법'),
});

export const doc_revise: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'doc_revise',
  inputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n주어진 글을 지시대로 고쳐서, 고친 글만 마크다운으로 돌려줍니다.`,
      user: `지시: ${input.instruction}\n고칠 글:\n${input.text}`,
    };
  },
  demo(input) {
    return `${DEMO_MARK} ("${snippet(input.instruction, 20)}" 지시를 반영한 예시)\n${input.text}`;
  },
};

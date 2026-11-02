// 이 파일이 하는 일: AI 기능 "회의록 요약"(backend.md §4 minutes)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사 기본형.
// 입력 {notes} → 응답 JSON {decisions[], todos[{text, role, due}], summary}.
import { z } from 'zod';
import { baseSystem, demoJson, jsonOnly, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({ notes: textField(12000, '회의 메모') });
const outputSchema = z.object({
  decisions: z.array(z.string()),
  todos: z.array(z.object({ text: z.string(), role: z.string().nullable().optional(), due: z.string().nullable().optional() })),
  summary: z.string(),
});

export const minutes: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'minutes',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n회의 메모를 결정 사항·할 일·요약으로 정리합니다. 마감일은 YYYY-MM-DD로 씁니다.\n${jsonOnly('{"decisions":["..."],"todos":[{"text":"...","role":"담당 직무","due":"YYYY-MM-DD"}],"summary":"..."}')}`,
      user: input.notes,
    };
  },
  demo(input, ctx) {
    return demoJson({
      decisions: [`[데모 응답] "${snippet(input.notes, 20)}" 내용대로 진행하기로 함`],
      todos: [{ text: '결정 사항을 공지에 올리기', role: '데스크', due: ctx.today }],
      summary: '[데모 응답] 회의 내용을 짧게 정리한 예시입니다.',
    });
  },
};

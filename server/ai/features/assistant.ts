// 이 파일이 하는 일: AI 기능 "원내 AI 도우미"(backend.md §4 assistant)의 입력 검사·프롬프트·데모 응답.
// 입력 {question, chunks[{n, title?, text}]}(원내 매뉴얼에서 찾은 조각) → 근거 번호([1])를 인용한 답. 조각에 없는 내용은 모른다고 답한다.
// 데모 모드(키 없음)에서는 검색으로 찾은 첫 조각의 앞부분을 그대로 옮겨 답 형식을 만든다(FR-071 AC3: 검색·근거는 실제, 답 문장만 예시).
import { z } from 'zod';
import { baseSystem, DEMO_MARK, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  question: textField(1000, '질문'),
  chunks: z
    .array(z.object({ n: z.number().int().min(1).optional(), title: z.string().max(200).optional(), text: z.string().max(4000) }))
    .max(10)
    .default([]),
});

/** 데모 답에 옮길 글자 수 */
const DEMO_QUOTE_CHARS = 160;

/** 조각 글을 한 줄로 펴고 앞부분만 자른다 */
function quote(text: string, max = DEMO_QUOTE_CHARS): string {
  const flat = text.replace(/^\s*[-*]\s+/gm, '').replace(/\s*\n\s*/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).trim()}…` : flat;
}

export const assistant: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'assistant',
  inputSchema,
  buildPrompt(input, ctx) {
    const refs = input.chunks.map((c, i) => `[${c.n ?? i + 1}] ${c.title ? `${c.title}: ` : ''}${c.text}`).join('\n\n');
    return {
      system: `${baseSystem(ctx)}\n아래 원내 자료 조각만 근거로 짧고 쉬운 말로 답합니다. 문장 끝에 근거 번호를 [1]처럼 붙입니다. 자료에 없는 내용은 지어내지 않고 "원내 자료에서 찾지 못했습니다"라고 답합니다.`,
      user: `질문: ${input.question}\n\n원내 자료:\n${refs || '(찾은 자료 없음)'}`,
    };
  },
  demo(input) {
    const first = input.chunks[0];
    if (!first) return `${DEMO_MARK} "${snippet(input.question)}"에 대한 원내 자료를 찾지 못했습니다.`;
    const where = first.title ? `"${first.title}"` : '원내 매뉴얼';
    return `${DEMO_MARK} ${where}에 따르면 다음과 같습니다. ${quote(first.text)} [${first.n ?? 1}]\n자세한 내용은 아래 근거 문서를 확인해 주세요.`;
  },
};

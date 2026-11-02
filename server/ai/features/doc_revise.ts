// 이 파일이 하는 일: AI 기능 "문서 부분 수정"(backend.md §4 doc_revise, FR-060 AC2)의 입력 검사·프롬프트·데모 응답.
// 입력 {text(고칠 부분), instruction(어떻게: "더 짧게", "더 공손하게", "다시 쓰기" 등)} → 고친 마크다운. 고친 글만 돌려받아 화면이 그 부분을 바꿔 끼운다.
import { z } from 'zod';
import { baseSystem, DEMO_MARK, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  text: textField(8000, '고칠 글'),
  instruction: textField(500, '고칠 방법'),
});
type Input = z.output<typeof inputSchema>;

/** 데모용: 지시에 맞춰 글을 아주 단순하게 바꾼다(실제 AI 대신 모양만 흉내) */
function demoRevise(input: Input): string {
  const lines = input.text.split('\n');
  if (/짧게|줄여/.test(input.instruction)) {
    const kept = lines.filter((l) => l.trim()).slice(0, Math.max(1, Math.ceil(lines.filter((l) => l.trim()).length / 2)));
    return kept.join('\n');
  }
  if (/공손|정중/.test(input.instruction)) {
    return lines.map((l) => (l.trim() && !/^#/.test(l.trim()) && !/(요|니다)[.!]?$/.test(l.trim()) ? `${l.trimEnd()} 부탁드립니다.` : l)).join('\n');
  }
  return input.text;
}

export const doc_revise: AiFeatureModule<Input> = {
  id: 'doc_revise',
  inputSchema,
  buildPrompt(input, ctx) {
    return {
      system: [
        baseSystem(ctx),
        '주어진 글을 지시대로 고쳐서, 고친 글만 마크다운으로 돌려줍니다. 설명이나 머리말은 붙이지 않습니다.',
        '원래 글의 제목(#)·목록(-) 모양은 지시가 없으면 그대로 둡니다. HTML 태그는 쓰지 않습니다.',
      ].join('\n'),
      user: `지시: ${input.instruction}\n고칠 글:\n${input.text}`,
    };
  },
  demo(input) {
    return `${DEMO_MARK} ("${snippet(input.instruction, 20)}" 지시를 반영한 예시)\n${demoRevise(input)}`;
  },
};

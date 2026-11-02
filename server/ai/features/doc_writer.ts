// 이 파일이 하는 일: AI 기능 "AI 문서 작성"(backend.md §4 doc_writer)의 입력 검사·프롬프트·데모 응답 기본형.
// 입력 {kind, points, length?, tone?} → 마크다운 문서. 사용자가 등급(빠름·표준·고급)을 고를 수 있다(요청의 tier로 받음).
import { z } from 'zod';
import { baseSystem, DEMO_MARK, optionalText, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  kind: textField(100, '문서 종류'),
  points: textField(8000, '들어갈 내용'),
  length: z.enum(['short', 'medium', 'long']).default('medium'),
  tone: optionalText(50, '말투'),
});

export const doc_writer: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'doc_writer',
  inputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n원내 문서를 마크다운으로 씁니다. 제목(#)과 소제목(##)을 쓰고, 표가 필요하면 마크다운 표를 씁니다.`,
      user: `문서 종류: ${input.kind}\n들어갈 내용:\n${input.points}\n길이: ${input.length}\n말투: ${input.tone ?? '공식적이고 쉬운 말'}`,
    };
  },
  demo(input) {
    return `${DEMO_MARK}\n# ${snippet(input.kind, 40)}\n\n## 목적\n${snippet(input.points, 60)} 내용을 정리한 예시 문서입니다.\n\n## 내용\n- 첫째 항목\n- 둘째 항목\n\n## 확인\n작성자와 확인자가 날짜를 적고 서명합니다.`;
  },
};

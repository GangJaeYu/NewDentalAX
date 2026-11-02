// 이 파일이 하는 일: AI 기능 "문자·안내문 템플릿"(backend.md §4 template)의 입력 검사·프롬프트·데모 응답 기본형.
// 입력 {purpose, length?} → 치환자({이름}, {날짜} 등)를 쓴 안내 문구. 환자 실명·연락처는 넣지 않는다.
import { z } from 'zod';
import { baseSystem, clinicInfo, DEMO_MARK, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  purpose: textField(1000, '목적'),
  length: z.enum(['short', 'medium', 'long']).default('short'),
});

const LENGTH_LABEL = { short: '짧게(문자 1통)', medium: '보통', long: '길게' } as const;

export const template: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'template',
  inputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n문자·안내문 템플릿을 씁니다. 사람마다 바뀌는 부분은 {이름}, {날짜}, {시간} 같은 치환자로 둡니다.\n${clinicInfo(ctx)}`,
      user: `목적: ${input.purpose}\n길이: ${LENGTH_LABEL[input.length]}`,
    };
  },
  demo(input, ctx) {
    return `${DEMO_MARK} [${ctx.clinic?.name ?? '치과'}] {이름}님, ${snippet(input.purpose, 20)} 관련 안내드립니다. {날짜} {시간}에 뵙겠습니다. 문의는 대표번호로 연락 주세요.`;
  },
};

// 이 파일이 하는 일: AI 기능 "채용 공고·면접 질문"(backend.md §4 hiring)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사 기본형.
// 입력 {jobType, conditions, preferred?} → 응답 JSON {posting, questions[]}. 차별 표현 규칙 점검은 인사 모듈이 덧붙인다.
import { z } from 'zod';
import { baseSystem, demoJson, jsonOnly, optionalText, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  jobType: textField(50, '직무'),
  conditions: textField(3000, '근무 조건'),
  preferred: optionalText(1000, '우대 사항'),
});
const outputSchema = z.object({ posting: z.string(), questions: z.array(z.string()).min(1) });

export const hiring: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'hiring',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n채용 공고(마크다운)와 면접 질문을 씁니다. 나이·성별·혼인·출신 지역 같은 차별 조건은 넣지 않습니다(채용절차법·남녀고용평등법).\n${jsonOnly('{"posting":"마크다운 공고","questions":["..."]}')}`,
      user: `직무: ${input.jobType}\n근무 조건: ${input.conditions}${input.preferred ? `\n우대 사항: ${input.preferred}` : ''}`,
    };
  },
  demo(input) {
    return demoJson({
      posting: `[데모 응답]\n## ${input.jobType} 채용\n- 근무 조건: ${snippet(input.conditions, 60)}\n- 지원 방법: 이메일 지원`,
      questions: ['[데모 응답] 이전 근무지에서 맡았던 일을 말씀해 주세요.', '바쁜 시간에 일을 어떻게 나누시나요?'],
    });
  },
};

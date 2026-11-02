// 이 파일이 하는 일: AI 기능 "전화 응대 스크립트"(backend.md §4 script)의 입력 검사·프롬프트·데모 응답 기본형.
// 입력 {situation, tone?, extra?}에 서버가 병원 정보(진료 시간·주차 등)를 채워 보낸다. 응답은 그냥 글이다.
import { z } from 'zod';
import { baseSystem, clinicInfo, DEMO_MARK, optionalText, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  situation: textField(1000, '상황'),
  tone: optionalText(50, '말투'),
  extra: optionalText(1000, '덧붙일 내용'),
});

export const script: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'script',
  inputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n치과 데스크 직원이 전화로 그대로 읽을 수 있는 응대 스크립트를 씁니다.\n${clinicInfo(ctx)}`,
      user: `상황: ${input.situation}\n말투: ${input.tone ?? '친절하고 차분하게'}${input.extra ? `\n덧붙일 내용: ${input.extra}` : ''}`,
    };
  },
  demo(input, ctx) {
    const clinic = ctx.clinic?.name ?? '저희 치과';
    return `${DEMO_MARK} "${snippet(input.situation)}" 상황 응대 예시\n직원: 안녕하세요, ${clinic}입니다. 무엇을 도와드릴까요?\n직원: 말씀하신 내용 확인해 보겠습니다. 잠시만 기다려 주세요.\n직원: 확인해 드렸습니다. 더 궁금하신 점 있으시면 편하게 전화 주세요.`;
  },
};

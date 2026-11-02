// 이 파일이 하는 일: AI 기능 "홍보 글"(backend.md §4 promo)의 입력 검사·프롬프트·데모 응답 기본형.
// 입력 {topic, channel, length?} → 마크다운. 화면은 이 결과에 광고 점검(adcheck)을 자동으로 이어 실행한다.
import { z } from 'zod';
import { baseSystem, clinicInfo, DEMO_MARK, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  topic: textField(1000, '주제'),
  channel: textField(50, '올릴 곳'),
  length: z.enum(['short', 'medium', 'long']).default('medium'),
});

export const promo: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'promo',
  inputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n병원 홍보 글을 씁니다. 치료 효과 보장, 최고·유일 같은 과장, 다른 병원 비교, 환자 후기 인용은 쓰지 않습니다(의료법 제56조).\n${clinicInfo(ctx)}`,
      user: `주제: ${input.topic}\n올릴 곳: ${input.channel}\n길이: ${input.length}`,
    };
  },
  demo(input, ctx) {
    return `${DEMO_MARK}\n## ${snippet(input.topic, 30)}\n\n${ctx.clinic?.name ?? '저희 치과'}에서 ${snippet(input.topic, 30)} 소식을 전해 드립니다.\n진료 시간과 예약 방법은 대표번호로 문의해 주세요.`;
  },
};

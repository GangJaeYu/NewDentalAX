// 이 파일이 하는 일: AI 기능 "월간 요약 문장"(backend.md §4 monthly_summary, manager 이상)의 입력 검사·프롬프트·데모 응답 기본형.
// 입력 {month, numbers(집계 숫자)} → 짧은 요약 글. 숫자는 서버가 계산한 값만 쓰고 새 숫자를 지어내지 않게 한다.
import { z } from 'zod';
import { baseSystem, DEMO_MARK, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, '월은 2026-11 형식으로 적어 주세요.'),
  numbers: z.record(z.string().max(50), z.union([z.number(), z.string().max(200)])).default({}),
});

export const monthly_summary: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'monthly_summary',
  inputSchema,
  buildPrompt(input, ctx) {
    return {
      system: `${baseSystem(ctx)}\n운영 숫자를 3~5문장으로 요약합니다. 주어진 숫자만 쓰고 새 숫자를 만들지 않습니다.`,
      user: `월: ${input.month}\n숫자: ${JSON.stringify(input.numbers)}`,
    };
  },
  demo(input) {
    return `${DEMO_MARK} ${input.month} 운영 요약 예시입니다. 지출과 재고 흐름은 지난달과 비슷했습니다. 자세한 숫자는 위 표를 확인해 주세요.`;
  },
};

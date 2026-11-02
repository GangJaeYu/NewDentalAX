// 이 파일이 하는 일: AI 기능 "의료광고 점검 2차"(backend.md §4 adcheck, FR-120)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사.
// 입력 {text, ruleHits?(1차 규칙 점검 결과)} → 응답 JSON {issues[{phrase, reason, suggestion}], overall}. 결과는 참고용이며 법률 자문이 아니다(FR-038).
// 1차 규칙이 놓친 표현(효과 장담, 진료 사실 확인, 환자 유인, 비교·과장 등)을 찾고 바꿀 말을 제안하게 한다. 부르는 곳: POST /api/adcheck(server/modules/marketing).
// 데모 응답은 규칙 점검에서 찾은 표현을 바탕으로 만든다(키 없이도 화면 흐름을 볼 수 있게).
import { z } from 'zod';
import { baseSystem, DEMO_MARK, demoJson, jsonOnly, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  text: textField(8000, '점검할 글'),
  ruleHits: z
    .array(z.looseObject({ phrase: z.string(), reason: z.string().optional(), suggestion: z.string().optional() }))
    .max(200)
    .default([]),
});
const outputSchema = z.object({
  issues: z.array(z.object({ phrase: z.string(), reason: z.string(), suggestion: z.string() })),
  overall: z.string(),
});

/** 같은 표현은 한 번만(앞에서부터) */
function uniqueHits<T extends { phrase: string }>(hits: readonly T[]): T[] {
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.phrase) ? false : (seen.add(h.phrase), true)));
}

export const adcheck: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'adcheck',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    const hits = uniqueHits(input.ruleHits);
    const hitText = hits.length
      ? `\n\n규칙 점검에서 이미 찾은 표현(이유):\n${hits
          .slice(0, 30)
          .map((h) => `- ${h.phrase}${h.reason ? ` (${h.reason})` : ''}`)
          .join('\n')}`
      : '\n\n규칙 점검에서 찾은 표현은 없습니다.';
    return {
      system: [
        baseSystem(ctx),
        '의료법 제56조(의료광고의 금지 등) 기준으로 병원 홍보 글·리뷰 답글을 살펴, 문제가 될 수 있는 표현과 바꿀 말을 제안합니다. 법률 자문이 아닌 참고 의견입니다.',
        '살필 것: 최고·유일·순위 같은 과장, 치료 효과·결과 장담(100%, 완치, 무통, 부작용 없음), 치료 전후 비교, 환자 치료 경험담, 과도한 할인·무료 강조(환자 유인), 다른 병원과 비교·비방, 특정 환자의 진료 사실을 확인해 주는 표현.',
        '규칙 점검에서 이미 찾은 표현도 확인하고, 규칙이 놓친 표현이 있으면 더해 주세요. phrase는 글에 있는 그대로 짧게 적고, suggestion은 바로 바꿔 쓸 수 있는 문장으로 적습니다. 문제가 없으면 issues는 빈 배열입니다.',
        jsonOnly('{"issues":[{"phrase":"...","reason":"...","suggestion":"..."}],"overall":"전체 의견 한두 문장"}'),
      ].join('\n'),
      user: `점검할 글:\n${input.text}${hitText}`,
    };
  },
  demo(input) {
    const hits = uniqueHits(input.ruleHits).slice(0, 5);
    return demoJson({
      issues: hits.map((h) => ({
        phrase: h.phrase,
        reason: h.reason ?? '과장으로 보일 수 있는 표현이에요.',
        suggestion: h.suggestion ?? '사실만 담백하게 적어 주세요.',
      })),
      overall: hits.length
        ? `${DEMO_MARK} 규칙 점검에서 찾은 표현 ${hits.length}곳을 다시 살펴봤어요. 효과를 장담하거나 할인을 앞세우는 말은 빼고, 진료 내용과 예약 방법을 사실대로 안내해 주세요.`
        : `${DEMO_MARK} 규칙에 걸린 표현은 없어요. 효과를 장담하거나 다른 병원과 비교하는 말이 없는지 한 번 더 읽어 봐 주세요.`,
    });
  },
};

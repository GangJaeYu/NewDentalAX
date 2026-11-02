// 이 파일이 하는 일: AI 기능 "리뷰 답글"(backend.md §4 review_reply, FR-043)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사.
// 입력 {review, tones[2~3]} → 응답 JSON {replies:[{tone, text}]}(말투마다 하나). 리뷰 속 전화번호 등은 게이트웨이가 가린 뒤 보낸다(FR-043 AC1).
// 답글에는 리뷰 쓴 분이 환자였다는 사실이나 치료 내용을 확인해 주는 표현을 쓰지 않게 안내하고(FR-043 AC2), 화면이 shared/desk-texts.ts 규칙으로 한 번 더 점검한다.
// 데모 응답은 리뷰 글을 그대로 옮기지 않고, 좋은 리뷰/아쉬운 리뷰와 주제 단어(친절·설명·대기·주차·청결)만 읽어 말투별로 다른 답글을 만든다.
// 바뀌는 낱말 뒤 조사는 받침에 맞춰 고른다(shared/josa.ts: "직원 응대를", "하늘숲치과가 되도록").
import { z } from 'zod';
import { REVIEW_TONES } from '../../../shared/desk-texts.ts';
import { withJosa } from '../../../shared/josa.ts';
import { baseSystem, demoJson, jsonOnly, textField, type AiFeatureModule, type PromptContext } from './types.ts';

const inputSchema = z.object({
  review: textField(3000, '리뷰'),
  tones: z
    .array(z.string().trim().min(1, { error: '말투를 확인해 주세요.' }).max(30, { error: '말투는 30자까지 적을 수 있어요.' }))
    .min(2, { error: '말투를 2개 이상 골라 주세요.' })
    .max(3, { error: '말투는 3개까지 고를 수 있어요.' })
    .default([...REVIEW_TONES]),
});
type ReviewInput = z.output<typeof inputSchema>;
const outputSchema = z.object({ replies: z.array(z.object({ tone: z.string(), text: z.string() })).min(1) });
export type ReviewReplyOutput = z.output<typeof outputSchema>;

/** 아쉬움·불만이 담긴 리뷰인지(데모용 간단 판단) */
function isComplaint(review: string): boolean {
  return /불친절|아프|아팠|비싸|오래\s*기다|기다리|대기|불편|별로|실망|화가|최악|불만|아쉬/.test(review);
}

/** 리뷰에 나온 주제(데모 답글에 한 마디 넣음). 아쉬운 리뷰면 아쉬운 점을, 좋은 리뷰면 칭찬받은 점을 고른다 */
function topicOf(review: string, complaint: boolean): string | null {
  if (complaint) {
    if (/기다|대기|오래/.test(review)) return '기다리신 시간';
    if (/비싸|가격|비용/.test(review)) return '비용 안내';
    if (/불친절/.test(review)) return '직원 응대';
    if (/아프|아팠/.test(review)) return '진료 중 불편';
    if (/주차/.test(review)) return '주차';
    return null;
  }
  if (/친절|상냥/.test(review)) return '직원 응대';
  if (/설명/.test(review)) return '설명';
  if (/주차/.test(review)) return '주차';
  if (/깨끗|청결|위생/.test(review)) return '청결';
  return null;
}

/** 아쉬운 리뷰 안에 칭찬도 있는지 */
function hasPraise(review: string): boolean {
  return /(?<!불)친절|상냥|자세|꼼꼼|깨끗|좋았|만족|감사/.test(review);
}

/** 데모 답글 하나(말투별). 진료 사실을 확인해 주는 말은 쓰지 않는다 */
function demoReply(tone: string, review: string, ctx: PromptContext): string {
  const clinic = ctx.clinic?.name?.trim() || '저희 치과';
  const complaint = isComplaint(review);
  const topic = topicOf(review, complaint);
  const about = topic ? `${topic}에 대해 ` : '';
  const praise = complaint && hasPraise(review) ? '좋게 봐 주신 부분은 감사드리고, ' : '';
  if (complaint) {
    if (/따뜻|다정/.test(tone)) {
      return `[데모 응답] 소중한 의견 남겨 주셔서 진심으로 감사드립니다. ${praise}${about}불편하셨던 마음이 글에서 느껴져 정말 죄송한 마음입니다. 말씀해 주신 부분은 모든 직원이 함께 살피고 고쳐 나가겠습니다. 더 자세히 듣고 싶으니 편하실 때 ${clinic} 대표번호로 연락 주세요.`;
    }
    if (/간결|짧/.test(tone)) {
      return `[데모 응답] ${praise}불편을 드려 죄송합니다. ${about}남겨 주신 의견은 직원들과 공유해 바로 개선하겠습니다. 감사합니다.`;
    }
    return `[데모 응답] 안녕하세요, ${clinic}입니다. ${praise}${about}불편을 드린 점 정중히 사과드립니다. 남겨 주신 의견은 원내에서 꼼꼼히 검토해 더 나은 모습으로 보답하겠습니다. 소중한 의견 감사합니다.`;
  }
  if (/따뜻|다정/.test(tone)) {
    return `[데모 응답] 따뜻한 리뷰 남겨 주셔서 정말 감사합니다! ${topic ? `${withJosa(topic, '을/를')} 좋게 봐 주셔서 ` : ''}모든 직원이 큰 힘을 얻었어요. 앞으로도 편안한 ${withJosa(clinic, '이/가')} 되도록 늘 노력하겠습니다.`;
  }
  if (/간결|짧/.test(tone)) {
    return `[데모 응답] 좋은 리뷰 감사합니다. ${topic ? `${topic}에 만족하셨다니 기쁩니다. ` : ''}늘 같은 마음으로 노력하겠습니다.`;
  }
  return `[데모 응답] 안녕하세요, ${clinic}입니다. 소중한 리뷰 남겨 주셔서 감사드립니다. ${topic ? `${topic}에 대해 좋은 말씀 주셔서 ` : ''}직원 모두 감사한 마음입니다. 앞으로도 정성을 다하겠습니다.`;
}

export const review_reply: AiFeatureModule<ReviewInput> = {
  id: 'review_reply',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    return {
      system: [
        baseSystem(ctx),
        '온라인 리뷰에 병원 이름으로 올릴 답글 초안을 씁니다. 말투마다 하나씩, 서로 다른 문장으로 씁니다.',
        '- 리뷰 쓴 분이 우리 환자였다는 사실, 내원·방문 날짜, 받은 치료 이름(임플란트·교정 등), 진료 기록 내용을 확인해 주는 말을 쓰지 않습니다.',
        '- 치료 효과를 장담하거나 다른 병원과 비교하지 않습니다(의료광고 기준).',
        '- 아쉬운 리뷰에는 변명하지 않고 사과와 개선 약속, 대표번호 문의 안내를 씁니다.',
        '- 이름·연락처는 쓰지 않습니다.',
        jsonOnly('{"replies":[{"tone":"말투","text":"답글"}]}'),
      ].join('\n'),
      user: `리뷰: ${input.review}\n말투(각각 하나씩): ${input.tones.join(', ')}`,
    };
  },
  demo(input, ctx) {
    return demoJson({ replies: input.tones.map((tone) => ({ tone, text: demoReply(tone, input.review, ctx) })) });
  },
};

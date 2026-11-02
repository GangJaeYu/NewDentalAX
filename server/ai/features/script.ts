// 이 파일이 하는 일: AI 기능 "전화 응대 스크립트"(backend.md §4 script, FR-042)의 입력 검사·프롬프트·데모 응답.
// 입력 {situation, tone?, extra?}에 서버가 병원 정보(진료시간·점심시간·휴진·주차·위치·보험 안내)를 채워 보낸다(FR-042 AC1). 응답은 그냥 글이다.
// 데모 응답도 병원 정보를 실제 값으로 넣는다(예: 토요일 9:30~14:00). 병원 정보에 진료시간이 아직 없으면 병원 정보 화면의 기본값을 쓴다.
// 대표번호 뒤 조사는 번호 끝자리 소리에 맞춘다(shared/josa.ts: 0100 → "으로", 4567 → "로").
import { z } from 'zod';
import { clinicFacts, situationKind, type ClinicFacts } from '../../../shared/desk-texts.ts';
import { withJosa } from '../../../shared/josa.ts';
import { baseSystem, DEMO_MARK, optionalText, snippet, textField, type AiFeatureModule, type PromptContext } from './types.ts';

const inputSchema = z.object({
  situation: textField(1000, '상황'),
  tone: optionalText(50, '말투'),
  extra: optionalText(1000, '덧붙일 내용'),
});
type ScriptInput = z.output<typeof inputSchema>;

/** 말투별 첫인사·끝인사 */
function toneWords(tone: string | undefined): { hello: string; bye: string } {
  if (tone && /밝|상냥/.test(tone)) return { hello: '네~ 반갑습니다!', bye: '좋은 하루 보내세요!' };
  if (tone && /간결/.test(tone)) return { hello: '네, 말씀하세요.', bye: '감사합니다.' };
  return { hello: '무엇을 도와드릴까요?', bye: '더 궁금하신 점 있으시면 편하게 전화 주세요. 감사합니다.' };
}

/** 등록 안 된 정보 자리 */
const MISSING = '(병원 정보에 아직 적지 않았어요. 관리자에게 병원 정보 입력을 요청하세요)';

/** 상황별 본문 줄(데모). 병원 정보를 실제 값으로 넣는다 */
function bodyLines(input: ScriptInput, f: ClinicFacts): string[] {
  const kind = situationKind(input.situation);
  const hours = `저희 진료시간은 ${f.hours}입니다.`;
  switch (kind) {
    case 'hours':
      return [hours, f.lunch !== '점심시간 없음' ? `점심시간 ${f.lunch}에는 진료가 잠시 쉬니 참고해 주세요.` : '점심시간 없이 진료합니다.', f.holiday ? `휴진 안내: ${f.holiday}.` : ''];
    case 'reschedule':
      return [
        '예약 바꾸시려는 거죠? 원하시는 날짜와 시간대를 말씀해 주시면 바로 확인해 드리겠습니다.',
        `참고로 ${hours.replace('저희 ', '')}`,
        '바뀐 예약은 다시 한번 날짜와 시간을 말씀드려 확인하겠습니다.',
      ];
    case 'parking':
      return [f.parking ? `주차 안내드립니다. ${f.parking}` : `주차 안내 ${MISSING}`, `참고로 ${hours.replace('저희 ', '')}`];
    case 'location':
      return [f.location ? `오시는 길 안내드립니다. ${f.location}` : `위치·교통 안내 ${MISSING}`, f.parking ? `차로 오시면 ${f.parking}` : '', `참고로 ${hours.replace('저희 ', '')}`];
    case 'insurance':
      return [
        f.insurance ? `보험 관련 일반 안내드립니다. ${f.insurance}` : `보험 일반 안내 ${MISSING}`,
        '정확한 적용 여부와 금액은 진료 상황에 따라 달라서, 내원하시면 자세히 안내드리겠습니다.',
        `참고로 ${hours.replace('저희 ', '')}`,
      ];
    case 'holiday':
      return [f.holiday ? `휴진 안내드립니다. ${f.holiday}입니다.` : `휴진 안내 ${MISSING}`, hours];
    default:
      return ['말씀하신 내용 확인해 보겠습니다. 잠시만 기다려 주세요.', hours];
  }
}

/** 데모 스크립트 글 */
export function demoScript(input: ScriptInput, ctx: PromptContext): string {
  const f = clinicFacts(ctx.clinic);
  const t = toneWords(input.tone);
  const lines = [
    `${DEMO_MARK} "${snippet(input.situation, 20)}" 응대 스크립트${input.tone ? ` · ${input.tone}` : ''}`,
    `직원: 안녕하세요, ${f.name}입니다. ${t.hello}`,
    ...bodyLines(input, f)
      .filter(Boolean)
      .map((l) => `직원: ${l}`),
  ];
  if (input.extra) lines.push(`직원: 덧붙여 안내드리면, ${snippet(input.extra, 80)}`);
  lines.push(`직원: ${f.phone ? `다른 문의는 대표번호 ${withJosa(f.phone, '으로/로')} 연락 주세요. ` : ''}${t.bye}`);
  return lines.join('\n');
}

export const script: AiFeatureModule<ScriptInput> = {
  id: 'script',
  inputSchema,
  buildPrompt(input, ctx) {
    const f = clinicFacts(ctx.clinic);
    return {
      system: [
        baseSystem(ctx),
        '치과 데스크 직원이 전화로 그대로 읽을 수 있는 응대 스크립트를 씁니다.',
        '- 줄마다 "직원:"으로 시작하고, 필요하면 "환자:" 예상 질문 줄을 넣습니다.',
        '- 아래 병원 정보는 그대로 정확히 씁니다. 병원 정보에 없는 내용(가격·치료 효과 등)은 지어내지 않고 "확인 후 안내"라고 씁니다.',
        '- 환자 이름·연락처는 넣지 않습니다.',
        '병원 정보:',
        `- 병원 이름: ${f.name}`,
        `- 대표번호: ${f.phone || '등록 안 됨'}`,
        `- 진료시간: ${f.hours}`,
        `- 점심시간: ${f.lunch}`,
        `- 휴진 안내: ${f.holiday || '등록 안 됨'}`,
        `- 주차: ${f.parking || '등록 안 됨'}`,
        `- 위치·교통: ${f.location || '등록 안 됨'}`,
        `- 보험 일반 안내: ${f.insurance || '등록 안 됨'}`,
      ].join('\n'),
      user: `상황: ${input.situation}\n말투: ${input.tone ?? '친절하고 차분하게'}${input.extra ? `\n덧붙일 내용: ${input.extra}` : ''}`,
    };
  },
  demo: demoScript,
};

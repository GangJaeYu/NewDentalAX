// 이 파일이 하는 일: AI 기능 "홍보 글"(backend.md §4 promo, FR-121)의 입력 검사·프롬프트·데모 응답.
// 입력 {topic, channel(블로그·인스타그램 등), length(short·medium·long)} → 마크다운. 화면(/docs/promo)은 이 결과에 광고 점검(POST /api/adcheck)을 자동으로 이어 실행한다.
// 프롬프트는 의료법 제56조에서 막는 표현(효과 보장, 최고·유일, 비교, 경험담, 할인·무료 강조)을 쓰지 않게 하고, 채널별 모양(블로그는 소제목, 인스타그램은 짧은 문단·해시태그)을 정한다.
// 데모 응답은 주제·채널·분량·병원 이름을 반영한 예시 글이다.
import { z } from 'zod';
import { baseSystem, clinicInfo, DEMO_MARK, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  topic: textField(1000, '주제'),
  channel: textField(50, '올릴 곳'),
  length: z.enum(['short', 'medium', 'long'], { error: '분량은 짧게·보통·길게 중에서 골라 주세요.' }).default('medium'),
});

/** 분량별 글자 수 안내 */
const LENGTH_GUIDE: Record<'short' | 'medium' | 'long', string> = {
  short: '300자 안팎',
  medium: '700자 안팎',
  long: '1,200자 안팎',
};

/** 인스타그램처럼 짧은 글 채널인지 */
function isSns(channel: string): boolean {
  return /인스타|instagram|sns|페이스북|facebook|스레드|threads/i.test(channel);
}

export const promo: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'promo',
  inputSchema,
  buildPrompt(input, ctx) {
    const shape = isSns(input.channel)
      ? '인스타그램용: 첫 줄은 짧은 제목, 2~4줄짜리 짧은 문단, 끝에 해시태그 3~5개.'
      : '블로그용: 마크다운으로 "## 제목", 소제목(###) 2~3개, 목록을 써서 읽기 쉽게.';
    return {
      system: [
        baseSystem(ctx),
        '치과 홍보 글 초안을 씁니다. 환자에게 도움이 되는 건강 정보와 병원 안내 위주로 씁니다.',
        '쓰지 않는 것(의료법 제56조): 치료 효과 보장(100%, 완치, 무통, 부작용 없음), 최고·유일·1위 같은 과장, 다른 병원과 비교, 환자 치료 경험담·후기 인용, 치료 전후 비교, 할인·무료·선착순 강조.',
        '치료 결과는 사람마다 다를 수 있다는 점을 필요하면 적습니다. 환자 개인정보는 쓰지 않습니다.',
        shape,
        clinicInfo(ctx),
      ].join('\n'),
      user: `주제: ${input.topic}\n올릴 곳: ${input.channel}\n분량: ${LENGTH_GUIDE[input.length]}`,
    };
  },
  demo(input, ctx) {
    const name = ctx.clinic?.name ?? '저희 치과';
    const topic = snippet(input.topic, 40);
    const phone = ctx.clinic?.phone ? `(${ctx.clinic.phone})` : '';
    if (isSns(input.channel)) {
      const lines = [
        DEMO_MARK,
        `[${topic}]`,
        '',
        `안녕하세요, ${name}입니다.`,
        `오늘은 ${topic} 이야기를 짧게 전해 드려요.`,
        '하루 세 번, 식사 후 3분 안에 꼼꼼히 닦고 이 사이는 치실로 챙겨 주세요.',
      ];
      if (input.length !== 'short') lines.push('잇몸에서 피가 자주 나거나 시린 느낌이 계속되면 가까운 치과에서 검진을 받아 보세요.');
      if (input.length === 'long') lines.push('정기 검진은 6개월에 한 번이 알맞아요. 개인에 따라 필요한 주기는 다를 수 있어요.');
      lines.push('', `예약 문의는 대표번호${phone}로 해 주세요.`, '', '#치아건강 #칫솔질 #정기검진 #구강관리');
      return lines.join('\n');
    }
    const parts = [DEMO_MARK, `## ${topic}`, '', `안녕하세요, ${name}입니다. 오늘은 ${topic}에 대해 알려 드릴게요.`];
    if (input.length !== 'short') {
      parts.push(
        '',
        '### 이렇게 해 보세요',
        '- 하루 세 번, 식사 후 3분 안에 칫솔질을 해 주세요.',
        '- 치실이나 치간 칫솔로 이 사이도 닦아 주세요.',
        '- 6개월에 한 번은 치과에서 검진을 받아 보세요.',
        '',
        '### 이런 점은 살펴 주세요',
        '- 잇몸에서 피가 자주 나거나 시린 느낌이 계속되면 진료를 받아 보세요.',
        '- 치료 방법과 결과는 사람마다 다를 수 있어요.',
      );
    }
    if (input.length === 'long') {
      parts.push('', '### 자주 묻는 질문', '- 스케일링은 1년에 한 번 건강보험이 적용될 수 있어요. 자세한 기준은 병원에 문의해 주세요.', '- 칫솔은 3개월마다 바꾸는 것이 좋아요.');
    }
    parts.push('', `진료 시간과 예약은 대표번호${phone}로 문의해 주세요.`);
    return parts.join('\n');
  },
};

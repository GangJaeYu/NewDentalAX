// 이 파일이 하는 일: AI 기능 "문자·안내문 템플릿"(backend.md §4 template, FR-044 AC2)의 입력 검사·프롬프트·데모 응답.
// 입력 {purpose, length?} → 병원 정보 치환자({병원이름}·{진료시간}·{대표번호} 등)와 날짜·시간 자리({날짜}·{시간})를 쓴 안내 문구.
// 환자 이름 치환자는 쓰지 않는다(FR-044 AC1). 치환자 목록은 shared/desk-texts.ts의 PLACEHOLDERS 하나만 쓴다(화면 고르기 목록과 같음).
import { z } from 'zod';
import { PLACEHOLDERS, situationKind } from '../../../shared/desk-texts.ts';
import { baseSystem, DEMO_MARK, snippet, textField, type AiFeatureModule } from './types.ts';

const inputSchema = z.object({
  purpose: textField(1000, '목적'),
  length: z.enum(['short', 'medium', 'long'], { error: '길이는 짧게·보통·길게 중에서 골라 주세요.' }).default('short'),
});
type TemplateInput = z.output<typeof inputSchema>;

const LENGTH_LABEL = { short: '짧게(단문 문자 1통, 90바이트 안쪽)', medium: '보통(장문 문자)', long: '길게(안내문)' } as const;

/** 데모 템플릿(목적 단어와 길이에 맞춰 치환자를 넣은 문구) */
export function demoTemplate(input: TemplateInput): string {
  const p = snippet(input.purpose, 20);
  const kind = situationKind(input.purpose);
  if (input.length === 'short') {
    if (kind === 'reschedule') return `${DEMO_MARK} [{병원이름}] {날짜} {시간} 예약 안내입니다. 변경은 {대표번호}`;
    if (kind === 'holiday') return `${DEMO_MARK} [{병원이름}] {휴진안내}. 문의 {대표번호}`;
    return `${DEMO_MARK} [{병원이름}] ${p} 안내드립니다. 문의 {대표번호}`;
  }
  const lines = [`${DEMO_MARK} [{병원이름}] ${p} 안내`, '', '안녕하세요, {병원이름}입니다.'];
  if (kind === 'reschedule') lines.push('{날짜} {시간} 예약 안내드립니다. 시간 변경이 필요하시면 미리 연락 주세요.');
  else if (kind === 'holiday') lines.push('{휴진안내} 진료에 참고해 주세요.');
  else lines.push(`${p} 관련하여 안내드립니다.`);
  lines.push('', '- 진료시간: {진료시간}', '- 점심시간: {점심시간}');
  if (input.length === 'long') lines.push('- 주차: {주차안내}', '- 오시는 길: {위치안내}');
  lines.push('', '문의: {대표번호}');
  return lines.join('\n');
}

export const template: AiFeatureModule<TemplateInput> = {
  id: 'template',
  inputSchema,
  buildPrompt(input, ctx) {
    const list = PLACEHOLDERS.map((ph) => `{${ph.key}}(${ph.label})`).join(', ');
    return {
      system: [
        baseSystem(ctx),
        '치과에서 보내는 문자·안내문 템플릿을 씁니다. 실제로 보내지 않고, 직원이 복사해서 씁니다.',
        `- 병원 정보와 날짜·시간은 다음 치환자로만 둡니다: ${list}`,
        '- 위 목록에 없는 치환자를 만들지 않습니다. 특히 환자 이름·연락처 같은 개인 정보 치환자({이름} 등)는 쓰지 않고 "고객님"이라고 씁니다.',
        '- 단문은 한글 45자(90바이트) 안쪽으로 씁니다. 치료 효과를 장담하는 말은 쓰지 않습니다.',
      ].join('\n'),
      user: `목적: ${input.purpose}\n길이: ${LENGTH_LABEL[input.length]}`,
    };
  },
  demo: demoTemplate,
};

// 이 파일이 하는 일: AI 기능 "월간 요약 문장"(backend.md §4 monthly_summary, manager 이상, FR-111 AC2)의 입력 검사·프롬프트·데모 응답.
// 입력 {month, numbers(집계 숫자)} → 변동 원인 후보와 절약 제안이 담긴 짧은 글. 숫자 칸의 값은 숫자만 받는다(메모 같은 글은 넣을 수 없다).
// 숫자는 서버(server/modules/finance/service.ts aiNumbers)가 계산한 값만 쓰고, AI가 새 숫자를 지어내지 않게 안내한다.
import { z } from 'zod';
import { baseSystem, DEMO_MARK, type AiFeatureModule } from './types.ts';

/** 원 단위 숫자를 쉼표 넣은 글로 */
function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

const inputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, '월은 2026-11 형식으로 적어 주세요.'),
  numbers: z
    .record(z.string().max(60, '숫자 이름이 너무 길어요.'), z.number({ error: '집계 숫자만 보낼 수 있어요.' }).finite())
    .refine((o) => Object.keys(o).length <= 60, '숫자는 60개까지 보낼 수 있어요.')
    .default({}),
});

/** 숫자 칸 하나를 찾는다(없으면 null) */
function pick(numbers: Record<string, number>, key: string): number | null {
  const v = numbers[key];
  return typeof v === 'number' ? v : null;
}

export const monthly_summary: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'monthly_summary',
  inputSchema,
  buildPrompt(input, ctx) {
    const lines = Object.entries(input.numbers).map(([k, v]) => `- ${k}: ${v}`);
    return {
      system: [
        baseSystem(ctx),
        '치과의 한 달 지출 집계 숫자를 보고 원장·실장에게 보고하듯 짧게 정리합니다.',
        '1) 한두 문장 요약 2) 변동 원인 후보 2~3개(지난달·전년 같은 달과 비교) 3) 절약 제안 1~2개 순서로, 모두 5~7문장 안에서 씁니다.',
        '주어진 숫자만 쓰고 새 숫자를 만들지 않습니다. 원인은 단정하지 말고 "~일 수 있어요"처럼 후보로 씁니다.',
      ].join('\n'),
      user: `월: ${input.month}\n집계 숫자:\n${lines.join('\n') || '- (숫자 없음)'}`,
    };
  },
  demo(input) {
    const total = pick(input.numbers, '이번 달 지출 합계(원)');
    const diff = pick(input.numbers, '지난달 대비 증감(%)');
    const material = pick(input.numbers, '이번 달 재료비(원)');
    const parts = [`${DEMO_MARK} ${input.month} 지출 요약 예시입니다.`];
    if (total !== null) parts.push(`이번 달 지출은 모두 ${formatNumber(total)}원입니다.`);
    if (diff !== null) parts.push(diff > 0 ? `지난달보다 ${diff}% 늘었어요. 재료 주문이 몰렸거나 일회성 수리비가 있었을 수 있어요.` : diff < 0 ? `지난달보다 ${Math.abs(diff)}% 줄었어요.` : '지난달과 같아요.');
    if (material !== null) parts.push(`재료비는 ${formatNumber(material)}원이에요. 자주 쓰는 재료는 거래처별 단가를 비교해 묶음 주문하면 아낄 수 있어요.`);
    parts.push('실제 AI를 연결하면 숫자를 바탕으로 변동 원인 후보와 절약 제안을 자세히 써 드려요.');
    return parts.join(' ');
  },
};

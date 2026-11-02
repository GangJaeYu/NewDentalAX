// 이 파일이 하는 일: AI 기능 "회의록 요약"(backend.md §4 minutes, FR-061 AC1)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사.
// 입력 {notes} → 응답 JSON {decisions[], todos[{text, role, due}], summary}. 마감일은 YYYY-MM-DD, 담당은 사람 이름이 아닌 역할(직무)로 받는다.
// 데모 응답은 메모 줄에서 "결정"·"하기로"가 든 줄은 결정 사항으로, "까지"·"담당"·"할 일"이 든 줄은 할 일로 나눠 그럴듯하게 보여 준다.
import { z } from 'zod';
import { baseSystem, demoJson, jsonOnly, snippet, textField, type AiFeatureModule, type PromptContext } from './types.ts';

const inputSchema = z.object({ notes: textField(12000, '회의 메모') });
const outputSchema = z.object({
  decisions: z.array(z.string()),
  todos: z.array(z.object({ text: z.string(), role: z.string().nullable().optional(), due: z.string().nullable().optional() })),
  summary: z.string(),
});
export type MinutesOutput = z.output<typeof outputSchema>;

/** 메모에 나온 직무 이름 → 역할 */
const ROLE_WORDS: Array<[RegExp, string]> = [
  [/데스크|접수|상담/, '데스크'],
  [/위생사|스케일링/, '치과위생사'],
  [/조무사|어시/, '치과조무사'],
  [/실장/, '실장'],
  [/원장/, '원장'],
];

/** "11월 6일", "11/6", "2026-11-06" 같은 날짜를 YYYY-MM-DD로(못 찾으면 null) */
export function findDue(line: string, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(line);
  if (iso) return `${iso[1]}-${iso[2]?.padStart(2, '0')}-${iso[3]?.padStart(2, '0')}`;
  const md = /(\d{1,2})\s*(?:월\s*|\/)(\d{1,2})\s*일?/.exec(line);
  if (md) {
    const m = Number(md[1]);
    const d = Number(md[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const y = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` < today ? year + 1 : year;
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

/** 데모 정리(규칙으로 줄을 나눔) */
export function demoMinutes(notes: string, ctx: PromptContext): MinutesOutput {
  const lines = notes
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  const decisions: string[] = [];
  const todos: MinutesOutput['todos'] = [];
  for (const line of lines) {
    if (/까지|담당|할 일|해야|챙기/.test(line)) {
      const role = ROLE_WORDS.find(([re]) => re.test(line))?.[1] ?? null;
      todos.push({ text: snippet(line.replace(/\s*\(.*?\)\s*$/, ''), 60), role, due: findDue(line, ctx.today) });
    } else if (/결정|하기로|확정|바꾸|정함/.test(line)) {
      decisions.push(snippet(line, 80));
    }
  }
  if (decisions.length === 0) decisions.push(`"${snippet(notes, 20)}" 내용대로 진행하기로 함`);
  if (todos.length === 0) todos.push({ text: '결정 사항을 공지에 올리기', role: '데스크', due: ctx.today });
  return {
    decisions,
    todos,
    summary: `[데모 응답] ${lines.length}개 메모를 정리했어요. 결정 ${decisions.length}건, 할 일 ${todos.length}건입니다.`,
  };
}

export const minutes: AiFeatureModule<z.output<typeof inputSchema>> = {
  id: 'minutes',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    return {
      system: [
        baseSystem(ctx),
        '회의 메모를 결정 사항·할 일·논의 요약으로 정리합니다.',
        '- decisions: 회의에서 정한 것(한 줄씩)',
        '- todos: 해야 할 일. role은 사람 이름이 아니라 담당 직무(데스크·치과위생사·치과조무사·실장·원장 등), 모르면 null. due는 마감일 YYYY-MM-DD, 모르면 null',
        '- summary: 논의 내용 요약(3문장 이내)',
        jsonOnly('{"decisions":["..."],"todos":[{"text":"...","role":"담당 직무","due":"YYYY-MM-DD"}],"summary":"..."}'),
      ].join('\n'),
      user: input.notes,
    };
  },
  demo(input, ctx) {
    return demoJson(demoMinutes(input.notes, ctx));
  },
};

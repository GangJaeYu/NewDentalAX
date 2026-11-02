// 이 파일이 하는 일: AI 기능 "AI 문서 작성"(backend.md §4 doc_writer, FR-060 AC1)의 입력 검사·문서 종류별 프롬프트·데모 응답.
// 입력 {kind, points, length?, tone?} → 마크다운 문서. kind는 종류 키(notice_patient 등) 또는 자유 글(예: "감염관리 지침")이다.
// 공문은 수신·참조·제목·본문·붙임 형식을 따르게 한다. 사용자가 등급(빠름·표준·고급)을 고를 수 있다(요청의 tier로 받음).
import { z } from 'zod';
import { baseSystem, DEMO_MARK, optionalText, snippet, textField, type AiFeatureModule, type PromptContext } from './types.ts';
import { DOC_KIND_LABELS, type DocKind } from '../../../shared/schemas/docs.ts';

const inputSchema = z.object({
  kind: textField(100, '문서 종류'),
  points: textField(8000, '들어갈 내용'),
  length: z.enum(['short', 'medium', 'long']).default('medium'),
  tone: optionalText(50, '말투'),
});
type Input = z.output<typeof inputSchema>;

/** 길이 → 안내 */
const LENGTH_GUIDE: Record<Input['length'], string> = {
  short: '짧게(A4 반 쪽 안팎, 300자 안팎)',
  medium: '보통(A4 한 쪽 안팎, 700자 안팎)',
  long: '자세히(A4 두 쪽 안팎, 1,500자 안팎)',
};

/** 종류별 형식 안내 */
const KIND_GUIDE: Partial<Record<DocKind, string>> = {
  notice_patient:
    '환자에게 나눠 주는 일반 안내문입니다. 특정 환자 이름·연락처·진단은 쓰지 않습니다. 쉬운 말로, 할 일과 하지 말 일을 목록으로 나누고, 이상이 있으면 병원에 연락하라는 안내를 맨 끝에 둡니다.',
  official: [
    '공문 형식을 반드시 지킵니다. 순서와 항목 이름은 다음과 같습니다.',
    '- **수신**: 받는 곳',
    '- **참조**: 함께 볼 곳(없으면 "없음")',
    '- **제목**: 한 줄 제목',
    '## 본문: 번호를 붙인 문단(1. 2. 3.)으로 씁니다. 첫 문단은 인사말입니다.',
    '## 붙임: 붙이는 서류 목록(없으면 "없음"). 마지막 줄 끝에 "끝."을 붙입니다.',
    '맨 아래에 보내는 곳(병원 이름과 대표)을 적습니다.',
  ].join('\n'),
  policy: '원내 내부 규정입니다. 목적·적용 범위·기준(조항 번호)·위반 시 조치·시행일 순서로 씁니다.',
  manual: '직원용 업무 매뉴얼입니다. 준비물·순서(번호 목록)·주의할 점·확인 방법 순서로 씁니다.',
  review: '온라인 리뷰에 다는 병원 답글입니다. 감사 인사 → 내용에 대한 답 → 다음 방문 안내 순서로, 환자 개인정보나 진료 내용은 쓰지 않습니다.',
  other: '원내에서 쓰는 일반 문서입니다. 제목과 소제목으로 내용을 나눕니다.',
};

/** kind(키 또는 글) → [종류 키 또는 null, 화면 이름] */
export function resolveKind(kind: string): [DocKind | null, string] {
  if (kind in DOC_KIND_LABELS) return [kind as DocKind, DOC_KIND_LABELS[kind as DocKind]];
  const byLabel = (Object.entries(DOC_KIND_LABELS) as [DocKind, string][]).find(([, label]) => label === kind);
  return byLabel ? [byLabel[0], byLabel[1]] : [null, kind];
}

/** 병원 이름(없으면 "하늘숲치과" 대신 "우리 병원") */
function clinicName(ctx: PromptContext): string {
  return ctx.clinic?.name || '우리 병원';
}

/** 요점 글을 목록 줄로(데모 응답에 입력 내용을 반영) */
function pointLines(points: string, max = 5): string[] {
  const lines = points
    .split(/[\n,]+/)
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, max)
    .map((s) => snippet(s, 60));
  return lines.length ? lines : [snippet(points, 60)];
}

export const doc_writer: AiFeatureModule<Input> = {
  id: 'doc_writer',
  inputSchema,
  buildPrompt(input, ctx) {
    const [key, label] = resolveKind(input.kind);
    const guide = (key && KIND_GUIDE[key]) || KIND_GUIDE.other;
    return {
      system: [
        baseSystem(ctx),
        '원내 문서를 마크다운으로 씁니다. 맨 위에 제목(#)을 하나 두고, 소제목(##)·목록(-)·굵게(**)만 씁니다. HTML 태그는 쓰지 않습니다.',
        `문서 종류: ${label}`,
        guide,
      ].join('\n'),
      user: `문서 종류: ${label}\n들어갈 내용:\n${input.points}\n분량: ${LENGTH_GUIDE[input.length]}\n말투: ${input.tone ?? '공손하고 쉬운 말'}`,
    };
  },
  demo(input, ctx) {
    const [key, label] = resolveKind(input.kind);
    const points = pointLines(input.points);
    const clinic = clinicName(ctx);
    if (key === 'official') {
      return [
        `${DEMO_MARK}`,
        `# ${snippet(points[0] ?? label, 30)} 안내`,
        '',
        '- **수신**: 관계 기관 담당자',
        '- **참조**: 없음',
        `- **제목**: ${snippet(points[0] ?? label, 30)} 안내`,
        '',
        '## 본문',
        '1. 귀 기관의 무궁한 발전을 기원합니다.',
        ...points.map((p, i) => `${i + 2}. ${p}`),
        '',
        '## 붙임',
        '1. 관련 자료 1부.  끝.',
        '',
        `${clinic} 원장`,
      ].join('\n');
    }
    return [
      `${DEMO_MARK}`,
      `# ${label === input.kind ? snippet(input.kind, 30) : `${snippet(points[0] ?? label, 24)} ${label}`}`,
      '',
      '## 안내 드립니다',
      `${clinic}에서 알려 드리는 내용입니다. 아래 내용을 꼭 확인해 주세요.`,
      '',
      '## 지켜 주세요',
      ...points.map((p) => `- ${p}`),
      '',
      '## 궁금하면 연락 주세요',
      '불편한 점이 있거나 이상이 느껴지면 언제든 병원으로 연락해 주세요.',
    ].join('\n');
  },
};

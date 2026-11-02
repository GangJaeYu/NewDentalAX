// 이 파일이 하는 일: AI 기능 "채용 공고·면접 질문"(backend.md §4 hiring, FR-084)의 입력 검사·프롬프트·데모 응답·응답 JSON 검사.
// 입력 {jobType, conditions, preferred?} → 응답 JSON {posting(마크다운 공고), questions[{type: 직무|태도|상황, text}]}.
// 차별 소지 표현(나이·성별·결혼·출신 등)은 프롬프트에서 빼라고 안내하고, 화면이 규칙 사전(server/modules/marketing/hiring-rules.ts, POST /api/hiring/check)으로 한 번 더 점검한다.
// 데모 응답은 직무에 맞는 직무 질문과 공통 태도·상황 질문을 2개씩 만들고, 입력한 근무 조건·우대 사항을 공고에 그대로 옮긴다(옮긴 글도 화면에서 점검된다).
import { z } from 'zod';
import { QUESTION_TYPES } from '../../../shared/schemas/hiring.ts';
import { baseSystem, demoJson, jsonOnly, optionalText, textField, type AiFeatureModule, type PromptContext } from './types.ts';

const inputSchema = z.object({
  jobType: textField(50, '직무'),
  conditions: textField(3000, '근무 조건'),
  preferred: optionalText(1000, '우대 사항'),
});
type HiringInput = z.output<typeof inputSchema>;

/** 질문 하나: {type, text}가 기본이고, AI가 글만 돌려줘도 받아 준다(화면이 "기타"로 묶음) */
const questionSchema = z.union([z.object({ type: z.string(), text: z.string().min(1) }), z.string().min(1)]);
const outputSchema = z.object({ posting: z.string().min(1), questions: z.array(questionSchema).min(1) });
export type HiringOutput = z.output<typeof outputSchema>;

/** 직무별 데모 직무 질문 */
function jobQuestions(jobType: string): [string, string] {
  if (/위생/.test(jobType)) return ['스케일링 전후로 기구 준비와 소독을 어떤 순서로 하셨는지 말씀해 주세요.', '구강 위생 교육을 할 때 쉽게 설명하려고 쓰는 방법이 있나요?'];
  if (/조무/.test(jobType)) return ['진료 보조를 하면서 감염 관리를 위해 꼭 지킨 일을 말씀해 주세요.', '진료실 재료가 떨어지지 않게 어떻게 챙기셨나요?'];
  if (/데스크|상담|코디/.test(jobType)) return ['예약 변경 전화가 몰릴 때 순서를 어떻게 정하시나요?', '진료비나 보험 기준을 설명할 때 무엇을 먼저 확인하시나요?'];
  if (/실장/.test(jobType)) return ['직원 근무표를 짤 때 무엇을 먼저 고려하시나요?', '재료 발주와 거래처 관리를 맡았던 경험을 말씀해 주세요.'];
  if (/의사/.test(jobType)) return ['진료 계획을 설명할 때 이해를 돕기 위해 쓰는 방법이 있나요?', '함께 일하는 직원과 진료 흐름을 맞출 때 무엇을 중요하게 보시나요?'];
  return [`${jobType} 업무에서 가장 자신 있는 일을 사례와 함께 말씀해 주세요.`, '이전 근무지에서 맡았던 일과 그 일에서 배운 점을 말씀해 주세요.'];
}

/** 데모 공고(마크다운). 차별 조건을 덧붙이지 않고, 입력한 조건·우대 사항만 옮긴다 */
function demoPosting(input: HiringInput, ctx: PromptContext): string {
  const clinic = ctx.clinic?.name?.trim() || '저희 치과';
  const lines = [
    `## ${clinic} ${input.jobType} 채용`,
    '',
    `${clinic}에서 환자를 친절하게 맞이하고 함께 성장할 ${input.jobType} 선생님을 찾습니다.`,
    '',
    '### 하는 일',
    `- ${input.jobType} 업무 전반`,
    '- 진료 흐름에 맞춘 협업과 원내 위생 관리',
    '',
    '### 근무 조건',
    ...input.conditions
      .split(/\n|,\s*/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `- ${l}`),
  ];
  if (input.preferred) {
    lines.push('', '### 우대 사항', ...input.preferred.split(/\n|,\s*/).map((l) => l.trim()).filter(Boolean).map((l) => `- ${l}`));
  }
  lines.push('', '### 지원 방법', '- 이력서를 이메일로 보내 주세요. 서류 확인 뒤 면접 일정을 연락드려요.', '- 궁금한 점은 병원 대표번호로 편하게 물어 주세요.');
  return lines.join('\n');
}

export const hiring: AiFeatureModule<HiringInput> = {
  id: 'hiring',
  inputSchema,
  outputSchema,
  buildPrompt(input, ctx) {
    return {
      system: [
        baseSystem(ctx),
        '치과 채용 공고(마크다운)와 면접 질문을 씁니다.',
        '- 공고에는 하는 일, 근무 조건, 우대 사항, 지원 방법을 소제목으로 나눠 씁니다.',
        '- 나이·성별·결혼·임신·출산·출신 지역·학교·외모·키·체중·종교·가족의 직업·재산 같은 차별 조건은 넣지 않습니다. 입력에 있어도 빼고, 직무에 필요한 조건으로 바꿉니다(채용절차법·남녀고용평등법·연령차별금지법).',
        `- 면접 질문은 ${QUESTION_TYPES.join('·')} 질문을 각각 2개 이상 씁니다. 직무 질문은 업무 지식·경험, 태도 질문은 일하는 자세·협업, 상황 질문은 "이럴 때 어떻게 하시겠어요?" 모양입니다.`,
        '- 면접 질문에서도 결혼·자녀·나이·가족 같은 사생활은 묻지 않습니다.',
        jsonOnly('{"posting":"마크다운 공고","questions":[{"type":"직무","text":"질문"},{"type":"태도","text":"질문"},{"type":"상황","text":"질문"}]}'),
      ].join('\n'),
      user: `직무: ${input.jobType}\n근무 조건: ${input.conditions}${input.preferred ? `\n우대 사항: ${input.preferred}` : ''}`,
    };
  },
  demo(input, ctx) {
    const [j1, j2] = jobQuestions(input.jobType);
    return demoJson({
      posting: demoPosting(input, ctx),
      questions: [
        { type: '직무', text: j1 },
        { type: '직무', text: j2 },
        { type: '태도', text: '바쁜 시간에 동료와 일을 어떻게 나누고 도우시나요?' },
        { type: '태도', text: '실수를 했을 때 어떻게 바로잡고 다시 생기지 않게 하셨나요?' },
        { type: '상황', text: '오래 기다린 환자가 데스크에서 화를 내면 어떻게 하시겠어요?' },
        { type: '상황', text: '퇴근 직전에 급한 진료가 들어오면 어떻게 하시겠어요?' },
      ],
    });
  },
};

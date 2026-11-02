// 이 파일이 하는 일: 신규 직원 온보딩(FR-083, backend.md §3.7 onboarding)의 입력 검사(zod)·API 응답 모양·진행률 계산을 서버와 화면이 함께 쓰게 둔다.
// 흐름: 직무별 체크리스트 템플릿(직접 쓰거나 AI 초안) → 신규 직원에게 배정(멘토 지정, 항목 복사) → 직원·멘토가 항목을 체크 → 진행률 %.
// 진행률 = 끝낸 항목 수 ÷ 전체 항목 수 × 100(반올림). shared 폴더는 다른 폴더를 import하지 않는다(같은 shared 안만 쓴다).
import { z } from 'zod';
import { JOB_TYPES, type JobType } from '../enums.ts';

/** 템플릿 항목 수·길이 한도 */
export const ONBOARDING_MAX_ITEMS = 50;
export const ONBOARDING_ITEM_MAX = 200;

const itemsField = z
  .array(z.string({ error: '항목은 글로 적어 주세요.' }).trim().max(ONBOARDING_ITEM_MAX, `항목 하나는 ${ONBOARDING_ITEM_MAX}자 이하로 줄여 주세요.`), {
    error: '체크리스트 항목을 적어 주세요.',
  })
  .transform((list) => list.filter((s) => s.length > 0))
  .pipe(z.array(z.string()).min(1, '체크리스트 항목을 하나 이상 적어 주세요.').max(ONBOARDING_MAX_ITEMS, `항목은 ${ONBOARDING_MAX_ITEMS}개까지 넣을 수 있어요.`));

const titleField = z.string({ error: '템플릿 이름을 적어 주세요.' }).trim().min(1, '템플릿 이름을 적어 주세요.').max(100, '템플릿 이름은 100자 이하로 줄여 주세요.');
const jobTypeField = z.enum(JOB_TYPES, { error: '직무를 목록에서 골라 주세요.' });

/** POST /api/onboarding/templates 본문 */
export const createTemplateSchema = z.object({
  jobType: jobTypeField,
  title: titleField,
  items: itemsField,
  source: z.enum(['ai', 'manual'], { error: '만든 방법을 확인해 주세요.' }).default('manual'),
});
export type CreateTemplateInput = z.input<typeof createTemplateSchema>;

/** PATCH /api/onboarding/templates/:id 본문 */
export const updateTemplateSchema = z
  .object({
    jobType: jobTypeField.optional(),
    title: titleField.optional(),
    items: itemsField.optional(),
    active: z.boolean({ error: '사용 여부를 확인해 주세요.' }).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: '바꿀 내용이 없어요.' });

const idField = (label: string) =>
  z.coerce.number({ error: `${label}을(를) 골라 주세요.` }).int({ error: `${label}을(를) 다시 골라 주세요.` }).positive({ error: `${label}을(를) 골라 주세요.` });

/** POST /api/onboarding/assignments 본문 */
export const createAssignmentSchema = z
  .object({
    userId: idField('신규 직원'),
    templateId: idField('템플릿'),
    mentorId: idField('담당 멘토'),
    startedOn: z
      .string({ error: '시작일을 골라 주세요.' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, '시작일을 2026-11-02 같은 날짜로 골라 주세요.')
      .optional(),
  })
  .refine((v) => v.userId !== v.mentorId, { message: '신규 직원과 멘토는 다른 사람이어야 해요.', path: ['mentorId'] });
export type CreateAssignmentInput = z.input<typeof createAssignmentSchema>;

/** POST /api/onboarding/assignments/:id/items/:idx 본문 */
export const checkItemSchema = z.object({ done: z.boolean({ error: '체크 여부를 확인해 주세요.' }) });

/** 템플릿 하나 */
export interface OnboardingTemplate {
  id: number;
  jobType: JobType;
  title: string;
  items: string[];
  source: 'ai' | 'manual';
  active: boolean;
  /** 이 템플릿으로 배정한 수 */
  assignedCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 배정의 항목 하나 */
export interface OnboardingItemState {
  index: number;
  text: string;
  doneAt: string | null;
  doneBy: { id: number; name: string } | null;
}

/** 배정 하나(GET /api/onboarding/assignments) */
export interface OnboardingAssignment {
  id: number;
  title: string;
  templateId: number | null;
  user: { id: number; name: string; jobType: JobType };
  mentor: { id: number; name: string };
  startedOn: string;
  items: OnboardingItemState[];
  done: number;
  total: number;
  /** 진행률(0~100, 정수) */
  percent: number;
  /** 보는 사람과의 관계: 본인(self)·멘토(mentor)·관리 화면에서만 봄(viewer) */
  relation: 'self' | 'mentor' | 'viewer';
  /** 보는 사람이 항목을 체크할 수 있는지(본인 또는 멘토) */
  canCheck: boolean;
  createdAt: string;
}

/** 진행률 %(반올림). 항목이 없으면 0 */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.min(done, total) / total) * 100);
}

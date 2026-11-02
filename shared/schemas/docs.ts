// 이 파일이 하는 일: 서식 보관함 문서(documents)의 종류 이름·입력 검사·응답 모양을 서버와 화면이 함께 쓰게 둔다(backend.md §3.6, database.md §6).
// 문서 종류는 DB CHECK와 같은 8가지다. 화면에 보일 이름은 DOC_KIND_LABELS, AI 문서 작성에서 고를 수 있는 종류는 WRITER_KINDS다.
import { z } from 'zod';

/** 문서 종류(DB documents.kind) */
export const DOC_KINDS = ['notice_patient', 'official', 'policy', 'manual', 'review', 'minutes', 'other', 'form'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** 종류 → 화면 이름 */
export const DOC_KIND_LABELS: Readonly<Record<DocKind, string>> = {
  notice_patient: '환자 안내문',
  official: '공문',
  policy: '내부 규정',
  manual: '업무 매뉴얼',
  review: '리뷰 답글',
  minutes: '회의록',
  other: '기타',
  form: '서식 파일',
};

/** AI 문서 작성에서 고르는 종류(FR-060 AC1) */
export const WRITER_KINDS: readonly DocKind[] = ['notice_patient', 'official', 'policy', 'manual', 'review', 'other'];

/** 문서 만든 방법 */
export type DocSource = 'ai' | 'manual' | 'upload';

/** 태그 목록 검사(최대 10개, 각 20자) */
const tagsSchema = z
  .array(z.string().trim().min(1, '빈 태그는 넣을 수 없어요.').max(20, '태그는 20자 이하로 적어 주세요.'))
  .max(10, '태그는 10개까지 넣을 수 있어요.')
  .transform((xs) => [...new Set(xs)]);

/** POST /api/documents(직접 쓴 문서·AI 초안) 입력 */
export const documentCreateSchema = z.object({
  kind: z.enum(DOC_KINDS.filter((k) => k !== 'form') as [DocKind, ...DocKind[]], { error: '문서 종류를 골라 주세요.' }),
  title: z.string({ error: '제목을 적어 주세요.' }).trim().min(1, '제목을 적어 주세요.').max(200, '제목은 200자 이하로 줄여 주세요.'),
  body_md: z.string({ error: '본문을 적어 주세요.' }).trim().min(1, '본문을 적어 주세요.').max(100_000, '본문이 너무 길어요(10만 자 이하).'),
  folder: z.string().trim().max(50, '폴더 이름은 50자 이하로 적어 주세요.').default(''),
  tags: tagsSchema.default([]),
  source: z.enum(['ai', 'manual']).default('manual'),
});
export type DocumentCreateInput = z.output<typeof documentCreateSchema>;

/** PATCH /api/documents/:id 입력(바꿀 칸만) */
export const documentPatchSchema = z
  .object({
    kind: documentCreateSchema.shape.kind.optional(),
    title: documentCreateSchema.shape.title.optional(),
    body_md: documentCreateSchema.shape.body_md.optional(),
    folder: z.string().trim().max(50, '폴더 이름은 50자 이하로 적어 주세요.').optional(),
    tags: tagsSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: '바꿀 내용이 없어요.' });
export type DocumentPatchInput = z.output<typeof documentPatchSchema>;

/** 올린 파일 정보(문서에 딸림) */
export interface DocFileView {
  id: number;
  name: string;
  mime: string;
  size: number;
}

/** 목록 한 줄 */
export interface DocListItem {
  id: number;
  kind: DocKind;
  title: string;
  folder: string;
  tags: string[];
  source: DocSource;
  file: DocFileView | null;
  createdBy: string | null;
  updatedAt: string;
  /** 지금 버전 번호(올린 파일만 있는 서식은 0) */
  version: number;
}

/** 상세 */
export interface DocDetail extends DocListItem {
  bodyMd: string;
  createdAt: string;
  createdById: number | null;
  /** 지금 사용자가 고치거나 지울 수 있는지 */
  canEdit: boolean;
}

/** 버전 한 줄 */
export interface DocVersionView {
  id: number;
  version: number;
  title: string;
  bodyMd: string;
  createdBy: string | null;
  createdAt: string;
}

/** GET /api/documents 응답 */
export interface DocListResponse {
  data: DocListItem[];
  total: number;
  /** 거르기용: 쓰이고 있는 폴더·태그 */
  facets: { folders: string[]; tags: string[] };
}

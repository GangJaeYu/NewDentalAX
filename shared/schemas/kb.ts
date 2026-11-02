// 이 파일이 하는 일: 원내 AI 도우미(자료 올리기·질문·근거·대화 기록)의 입력 검사와 응답 모양을 서버와 화면이 함께 쓰게 둔다(backend.md §3.6, FR-070·071).
// 자료 상태는 DB kb_docs.status와 같은 4가지(처리 중·검토 필요·완료·실패), 공개 범위는 전체 직원(all)·실장님 이상(manager) 두 가지다.
import { z } from 'zod';
import type { PiiFinding } from '../privacy-rules.ts';

/** 자료 상태(DB kb_docs.status) */
export const KB_STATUSES = ['processing', 'needs_review', 'ready', 'failed'] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

/** 상태 → 화면 이름 */
export const KB_STATUS_LABELS: Readonly<Record<KbStatus, string>> = {
  processing: '처리 중',
  needs_review: '검토 필요',
  ready: '완료',
  failed: '실패',
};

/** 공개 범위(DB kb_docs.visibility) */
export const KB_VISIBILITIES = ['all', 'manager'] as const;
export type KbVisibility = (typeof KB_VISIBILITIES)[number];

/** 공개 범위 → 화면 이름 */
export const KB_VISIBILITY_LABELS: Readonly<Record<KbVisibility, string>> = {
  all: '전체 직원',
  manager: '실장님 이상',
};

/** 올릴 수 있는 파일 확장자(server/lib/files.ts PURPOSE_EXTS.kb와 같다. HWP는 글을 꺼낼 수 없어 받지 않는다) */
export const KB_FILE_EXTS = ['.txt', '.md', '.pdf', '.docx'] as const;

/** 질문 최대 글자 수 */
export const QUESTION_MAX = 500;

/** 근거를 찾지 못했을 때의 답(FR-071 AC2) */
export const NOT_FOUND_ANSWER = '원내 문서에서 찾지 못했습니다.';

/** 공개 범위 검사(쉬운 한국어 오류) */
export const visibilitySchema = z.enum(KB_VISIBILITIES, { error: '공개 범위는 전체 직원 또는 실장님 이상 중에서 골라 주세요.' });

/** 서식 보관함 문서를 자료로 고를 때의 본문 */
export const kbFromDocumentSchema = z.object({
  documentId: z.number({ error: '서식 보관함 문서를 골라 주세요.' }).int({ error: '서식 보관함 문서를 골라 주세요.' }).positive({ error: '서식 보관함 문서를 골라 주세요.' }),
  title: z.string().trim().max(200, '제목은 200자 이하로 줄여 주세요.').default(''),
  visibility: visibilitySchema.default('all'),
});
export type KbFromDocumentInput = z.output<typeof kbFromDocumentSchema>;

/** 파일을 올릴 때 함께 보내는 글 칸 */
export const kbUploadFieldsSchema = z.object({
  title: z.string().trim().max(200, '제목은 200자 이하로 줄여 주세요.').default(''),
  visibility: visibilitySchema.default('all'),
});

/** 질문 본문 */
export const askSchema = z.object({
  question: z
    .string({ error: '질문을 적어 주세요.' })
    .trim()
    .min(1, '질문을 적어 주세요.')
    .max(QUESTION_MAX, `질문은 ${QUESTION_MAX}자 이하로 적어 주세요.`),
});
export type AskInput = z.output<typeof askSchema>;

/** 자료 목록 한 줄 */
export interface KbDocItem {
  id: number;
  title: string;
  /** 어디서 왔는지: 파일 이름 또는 "서식 보관함: <문서 제목>" */
  sourceName: string;
  sourceKind: 'file' | 'document' | 'demo';
  visibility: KbVisibility;
  status: KbStatus;
  /** 실패 이유(실패일 때만) */
  error: string | null;
  /** 감지한 개인정보 종류별 건수(검토 필요일 때) */
  findings: PiiFinding[];
  chunkCount: number;
  createdBy: string | null;
  createdAt: string;
}

/** 자료 조각(원문 보기) */
export interface KbChunkView {
  id: number;
  seq: number;
  heading: string;
  text: string;
}

/** 자료 상세(원문 보기·검토) */
export interface KbDocDetail extends KbDocItem {
  /** 완료된 자료의 조각들 */
  chunks: KbChunkView[];
  /** 검토 필요일 때, 개인정보가 들어 있는 줄을 가린 모양으로 몇 줄 보여 준다 */
  samples: string[];
  /** 올린 파일(실장님 이상만 내려받을 수 있다) */
  fileId: number | null;
  documentId: number | null;
}

/** 근거 카드 하나 */
export interface AssistantSource {
  /** 답 속 근거 번호([1]) */
  n: number;
  kbDocId: number;
  title: string;
  chunkId: number;
  /** 제목 > 소제목 경로 */
  heading: string;
  /** 해당 부분 발췌 */
  excerpt: string;
  /** 지금은 지워진 자료(지난 대화 기록에서만 생긴다) */
  deleted?: boolean;
}

/** 대화 한 줄 */
export interface AssistantMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  sources: AssistantSource[];
  found: boolean;
  demo: boolean;
  createdAt: string;
}

/** 질문 응답 */
export interface AskResponse {
  found: boolean;
  answer: string;
  /** 찾지 못했을 때의 안내(어떤 문서를 올리면 되는지) */
  hint: string | null;
  sources: AssistantSource[];
  /** 방금 저장한 질문·답 두 줄 */
  messages: AssistantMessage[];
  /** AI를 불렀을 때만: 데모 여부·개인정보 처리 안내·비용 */
  ai: { demo: boolean; notice: string | null; costKrw: number; requestId: number } | null;
}

// 이 파일이 하는 일: 데스크 모듈(공지·인수인계·오픈/마감 체크리스트, backend.md §3.4)의 API 응답 모양과 선택지를 서버와 화면이 함께 쓰게 둔다.
// 분류 목록은 화면의 고르기 상자에 쓰는 추천값이고, 서버는 20자 이하 글자면 받는다(다른 화면이 보내는 분류도 받기 위함).
// shared 폴더는 다른 폴더를 import하지 않는다(enums.ts만 예외로 같은 폴더).
import type { JobType } from '../enums.ts';

/** 글 종류: 공지(manager 이상 작성) · 인수인계(모두 작성) */
export const POST_KINDS = ['notice', 'handover'] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const POST_KIND_LABELS: Record<PostKind, string> = { notice: '공지', handover: '인수인계' };

/** 종류별 추천 분류 */
export const POST_CATEGORIES: Record<PostKind, readonly string[]> = {
  notice: ['일반', '진료', '감염관리', '교육', '행사'],
  handover: ['예약', '재고', '시설', '업무', '기타'],
};

/** 체크리스트 종류: 오픈(진료 시작 전) · 마감(진료 끝난 뒤) */
export const CHECKLIST_KINDS = ['open', 'close'] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];
export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = { open: '오픈', close: '마감' };

/** 사람 한 명(이름만) */
export interface PersonRef {
  id: number;
  name: string;
}

/** 목록의 글 한 건(GET /api/posts) */
export interface PostListItem {
  id: number;
  kind: PostKind;
  category: string;
  title: string;
  /** 본문 앞부분(최대 120자) */
  preview: string;
  pinned: boolean;
  author: PersonRef;
  createdAt: string;
  updatedAt: string;
  /** 인수인계 처리 완료 시각(처리 전이면 null) */
  resolvedAt: string | null;
  resolvedBy: PersonRef | null;
  /** 읽은 사람 수(사용 중인 계정만) */
  readCount: number;
  /** 사용 중인 전체 계정 수 */
  totalUsers: number;
  /** 내가 읽었는지 */
  readByMe: boolean;
}

/** 글 상세(GET /api/posts/:id). readers·unreadUsers는 작성자와 manager 이상에게만 온다 */
export interface PostDetail extends Omit<PostListItem, 'preview'> {
  body: string;
  /** 내가 고치거나 지울 수 있는지(작성자 또는 manager 이상) */
  canEdit: boolean;
  readers?: Array<PersonRef & { readAt: string }>;
  unreadUsers?: PersonRef[];
}

/** 체크리스트 항목 한 줄과 그 날짜의 체크 상태 */
export interface ChecklistItemState {
  id: number;
  text: string;
  /** 담당 직무(null이면 모두) */
  roleHint: JobType | null;
  sort: number;
  /** 지금도 쓰는 항목인지(지난 날짜에는 지운 항목도 기록이 있으면 보인다) */
  active: boolean;
  checked: boolean;
  checkedBy: PersonRef | null;
  checkedAt: string | null;
}

/** GET /api/checklists/:kind?date= 응답의 data */
export interface ChecklistDay {
  kind: ChecklistKind;
  /** 본 날짜(YYYY-MM-DD, 한국 날짜) */
  date: string;
  /** 서버 기준 오늘 */
  today: string;
  /** 오늘이 아니면 true(조회만 됨) */
  readOnly: boolean;
  done: number;
  total: number;
  items: ChecklistItemState[];
}

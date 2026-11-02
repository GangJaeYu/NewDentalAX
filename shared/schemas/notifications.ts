// 이 파일이 하는 일: 알림센터(FR-090)의 공용 모양을 정한다. 알림 종류 목록(한국어 이름·받는 사람 규칙),
// API 응답 모양(알림 한 건·요약), 알림 링크가 이 서비스 안 주소인지 확인하는 함수를 서버와 화면이 함께 쓴다.
// 받는 사람 규칙은 architecture overview §3.8을 옮긴 것이다: 재고·발주·연차 신청·멸균 불합격·법정·장비는 manager 이상,
// 예산은 admin, 공지는 전원, 연차 결과는 신청자, 교육은 해당 직원과 manager 이상.
import type { Role } from '../roles.ts';

/** 알림 종류 하나의 규칙 */
export interface NotificationTypeDef {
  /** 화면에 보여 줄 한국어 이름(칩 글자) */
  readonly label: string;
  /** 받는 사람을 따로 정하지 않았을 때 보낼 역할(그 역할 이상). null이면 반드시 userIds로 받는 사람을 정해야 한다 */
  readonly defaultRole: Role | null;
  /** 이 역할보다 낮은 사람에게는 절대 보내지 않는다(예: manager 전용 알림은 staff에게 가지 않음) */
  readonly minRole: Role;
}

/** 알림 종류 목록. 새 종류를 쓰는 모듈은 여기 이름을 쓴다(목록에 없는 종류는 받는 사람 제한 없이 그대로 보낸다) */
export const NOTIFICATION_TYPES = {
  leave_requested: { label: '연차 신청', defaultRole: 'manager', minRole: 'manager' },
  leave_result: { label: '연차 결과', defaultRole: null, minRole: 'staff' },
  stock_low: { label: '재고 부족', defaultRole: 'manager', minRole: 'manager' },
  stock_expiry: { label: '유효기간', defaultRole: 'manager', minRole: 'manager' },
  order: { label: '발주', defaultRole: 'manager', minRole: 'manager' },
  sterilizer_fail: { label: '멸균 불합격', defaultRole: 'manager', minRole: 'manager' },
  legal_due: { label: '법정 일정', defaultRole: 'manager', minRole: 'manager' },
  equipment_due: { label: '장비 점검', defaultRole: 'manager', minRole: 'manager' },
  training_due: { label: '교육 예정', defaultRole: 'manager', minRole: 'staff' },
  notice: { label: '새 공지', defaultRole: 'staff', minRole: 'staff' },
  ai_budget: { label: 'AI 예산', defaultRole: 'admin', minRole: 'admin' },
} as const satisfies Record<string, NotificationTypeDef>;

/** 정해 둔 알림 종류 이름 */
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/** 정해 둔 알림 종류인지 */
export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && Object.hasOwn(NOTIFICATION_TYPES, value);
}

/** 알림 종류의 한국어 이름. 목록에 없으면 '알림' */
export function notificationTypeLabel(type: string): string {
  return isNotificationType(type) ? NOTIFICATION_TYPES[type].label : '알림';
}

/**
 * 알림 링크가 이 서비스 안 주소인지 확인한다. '/'로 시작하고 '//'나 '/\'로 시작하지 않아야 한다.
 * 다른 사이트 주소나 javascript: 같은 주소는 false다(누르면 엉뚱한 곳으로 가는 것을 막음).
 */
export function isInternalLink(link: unknown): link is string {
  if (typeof link !== 'string' || link.length > 500 || !/^\/(?![/\\])/.test(link) || /\s/.test(link)) return false;
  // 눈에 안 보이는 제어 문자(줄바꿈 등)가 섞이면 받지 않는다
  for (let i = 0; i < link.length; i += 1) if (link.charCodeAt(i) < 0x20 || link.charCodeAt(i) === 0x7f) return false;
  return true;
}

/** API가 돌려주는 알림 한 건(GET /api/notifications의 data 항목) */
export interface NotificationItem {
  id: number;
  type: string;
  /** 종류의 한국어 이름 */
  typeLabel: string;
  title: string;
  body: string | null;
  /** 누르면 갈 서비스 안 주소(없으면 null) */
  link: string | null;
  /** 만든 시각(ISO-8601 UTC) */
  createdAt: string;
  /** 읽은 시각(읽지 않았으면 null) */
  readAt: string | null;
}

/** GET /api/notifications/summary 응답의 data: 읽지 않은 수와 가장 최근 알림 번호(없으면 0) */
export interface NotificationSummary {
  unread: number;
  latestId: number;
}

/** GET /api/notifications 응답: { data, total } */
export interface NotificationPage {
  data: NotificationItem[];
  total: number;
}

// 이 파일이 하는 일: 알림을 만드는 함수 emitNotification(= notify.emit)을 둔다(overview §3.8 즉시 알림, FR-090).
// 받는 사람은 사용자 id 목록이나 역할(그 역할 이상의 활성 사용자)로 정한다. 둘 다 없으면 알림 종류의 기본 규칙(shared/schemas/notifications.ts)을 쓴다.
// 종류마다 "이 역할보다 낮은 사람에게는 보내지 않는다"(minRole)를 지켜서, 예를 들어 manager 전용 알림은 staff에게 절대 가지 않는다.
// dedupeKey가 같으면 같은 사람에게 두 번 넣지 않는다(UNIQUE(user_id, dedupe_key)). 꺼진(비활성) 계정에는 보내지 않는다.
// phase-02-task-02(AI 예산 80% 알림)가 처음 만들었고, phase-02-task-04가 받는 사람 규칙·링크 검사를 더했다. 기존 호출 방식은 그대로 쓸 수 있다.
import type { Db } from '../../db/index.ts';
import { systemClock, type Clock } from '../../lib/clock.ts';
import { ROLE_RANK, type Role } from '../../../shared/roles.ts';
import { isInternalLink, isNotificationType, NOTIFICATION_TYPES } from '../../../shared/schemas/notifications.ts';

/** 알림 한 건의 내용과 받는 사람 */
export interface NotificationInput {
  /** 받는 사용자 id 목록 */
  userIds?: readonly number[];
  /** 받는 역할: 이 역할 이상인 활성 사용자 모두(예: 'manager' → manager·admin) */
  role?: Role;
  /** 알림 종류(영문 이름, 예: 'ai_budget'). 정해 둔 종류는 shared/schemas/notifications.ts의 NOTIFICATION_TYPES */
  type: string;
  title: string;
  body?: string | null;
  /** 누르면 갈 서비스 안 주소(예: '/admin/ai-usage'). '/'로 시작해야 한다 */
  link?: string | null;
  /** 중복 방지 키(예: 'budget80:2026-11'). 같은 사람에게 같은 키는 한 번만 들어간다 */
  dedupeKey?: string | null;
}

/** 역할 이름 목록 중 기준 역할 이상인 것 */
function rolesAtLeast(role: Role): Role[] {
  return (Object.keys(ROLE_RANK) as Role[]).filter((r) => ROLE_RANK[r] >= ROLE_RANK[role]);
}

/** 역할 기준으로 받는 사람(활성 사용자) id를 찾는다 */
function usersAtLeast(db: Db, role: Role): number[] {
  const roles = rolesAtLeast(role);
  const marks = roles.map(() => '?').join(', ');
  return db.all<{ id: number }>(`SELECT id FROM users WHERE active = 1 AND role IN (${marks}) ORDER BY id`, roles).map((r) => r.id);
}

/** id 목록 중 활성 사용자이고 최소 역할 이상인 사람만 남긴다(없는 id·꺼진 계정·역할이 낮은 사람은 뺀다) */
function filterRecipients(db: Db, ids: readonly number[], minRole: Role): number[] {
  if (ids.length === 0) return [];
  const allowed = new Set(rolesAtLeast(minRole));
  const marks = ids.map(() => '?').join(', ');
  return db
    .all<{ id: number; role: Role }>(`SELECT id, role FROM users WHERE active = 1 AND id IN (${marks}) ORDER BY id`, [...ids])
    .filter((u) => allowed.has(u.role))
    .map((u) => u.id);
}

/**
 * 이 알림을 실제로 받을 사람 id 목록을 정한다(중복 없음, 번호 순).
 * - userIds·role을 주면 그 사람들, 둘 다 없으면 종류의 기본 역할(defaultRole)
 * - 종류의 최소 역할(minRole)보다 낮은 사람은 뺀다
 */
export function resolveRecipients(db: Db, input: Pick<NotificationInput, 'userIds' | 'role' | 'type'>): number[] {
  const def = isNotificationType(input.type) ? NOTIFICATION_TYPES[input.type] : null;
  const minRole: Role = def?.minRole ?? 'staff';
  const ids = new Set<number>(input.userIds ?? []);
  const role = input.role ?? (input.userIds === undefined ? def?.defaultRole : undefined) ?? undefined;
  if (role) for (const id of usersAtLeast(db, role)) ids.add(id);
  return filterRecipients(db, [...ids], minRole);
}

/**
 * 알림을 만든다. 새로 들어간 알림 건수를 돌려준다(중복이라 건너뛴 것은 세지 않는다).
 * 받는 사람이 없으면 0을 돌려준다. 링크가 서비스 안 주소가 아니면 만들지 않고 오류를 던진다(프로그램 실수를 빨리 찾기 위함).
 */
export function emitNotification(db: Db, input: NotificationInput, clock: Clock = systemClock): number {
  if (input.link != null && !isInternalLink(input.link)) {
    throw new Error(`알림 링크 "${input.link}"는 이 서비스 안 주소('/'로 시작)가 아니에요.`);
  }
  const ids = resolveRecipients(db, input);
  if (ids.length === 0) return 0;
  const now = clock.now().toISOString();
  let created = 0;
  db.tx(() => {
    for (const userId of ids) {
      const r = db.run(
        'INSERT OR IGNORE INTO notifications (user_id, type, title, body, link, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, input.type, input.title, input.body ?? null, input.link ?? null, input.dedupeKey ?? null, now],
      );
      created += r.changes;
    }
  });
  return created;
}

/** 다른 모듈이 부르는 이름: notify.emit(db, { type, title, ... }, clock) */
export const notify = { emit: emitNotification } as const;

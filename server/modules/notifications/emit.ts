// 이 파일이 하는 일: 알림을 만드는 최소 함수 emitNotification을 둔다(overview §3.8 즉시 알림, FR-090).
// 받는 사람은 사용자 id 목록이나 역할(그 역할 이상의 활성 사용자)로 정한다. dedupeKey가 같으면 같은 사람에게 두 번 넣지 않는다(UNIQUE(user_id, dedupe_key)).
// phase-02-task-02(AI 예산 80% 알림)가 만들었고, 알림 모듈(phase-02-task-04)이 이 함수를 넓혀 쓴다.
import type { Db } from '../../db/index.ts';
import { systemClock, type Clock } from '../../lib/clock.ts';
import { ROLE_RANK, type Role } from '../../../shared/roles.ts';

/** 알림 한 건의 내용과 받는 사람 */
export interface NotificationInput {
  /** 받는 사용자 id 목록 */
  userIds?: readonly number[];
  /** 받는 역할: 이 역할 이상인 활성 사용자 모두(예: 'manager' → manager·admin) */
  role?: Role;
  /** 알림 종류(영문 이름, 예: 'ai_budget') */
  type: string;
  title: string;
  body?: string | null;
  /** 누르면 갈 화면 주소(예: '/admin/ai-usage') */
  link?: string | null;
  /** 중복 방지 키(예: 'budget80:2026-11'). 같은 사람에게 같은 키는 한 번만 들어간다 */
  dedupeKey?: string | null;
}

/** 역할 기준으로 받는 사람(활성 사용자) id를 찾는다 */
function usersAtLeast(db: Db, role: Role): number[] {
  const roles = (Object.keys(ROLE_RANK) as Role[]).filter((r) => ROLE_RANK[r] >= ROLE_RANK[role]);
  const marks = roles.map(() => '?').join(', ');
  return db.all<{ id: number }>(`SELECT id FROM users WHERE active = 1 AND role IN (${marks}) ORDER BY id`, roles).map((r) => r.id);
}

/**
 * 알림을 만든다. 새로 들어간 알림 건수를 돌려준다(중복이라 건너뛴 것은 세지 않는다).
 * 받는 사람이 없으면 0을 돌려준다.
 */
export function emitNotification(db: Db, input: NotificationInput, clock: Clock = systemClock): number {
  const ids = new Set<number>(input.userIds ?? []);
  if (input.role) for (const id of usersAtLeast(db, input.role)) ids.add(id);
  if (ids.size === 0) return 0;
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

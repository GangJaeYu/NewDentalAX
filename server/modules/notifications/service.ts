// 이 파일이 하는 일: 내 알림을 읽고 읽음 처리하는 기능(backend.md §3.3, FR-090)을 둔다.
// 요약(읽지 않은 수·가장 최근 번호), 목록(최근 것부터, 쪽 나누기·읽지 않은 것만), 한 건 읽음, 모두 읽음.
// 모든 함수는 "로그인한 사람 자신의 알림"만 다룬다. 다른 사람 알림 번호를 주면 없는 것으로 본다(404).
// 읽음 표시는 업무 데이터를 바꾸는 일이 아니라 감사 로그에 남기지 않는다(DECISIONS 후보, 2026-11-02).
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError } from '../../lib/errors.ts';
import { notificationTypeLabel, type NotificationItem, type NotificationPage, type NotificationSummary } from '../../../shared/schemas/notifications.ts';

interface NotificationRow {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

/** DB 줄 → API 응답 모양 */
function toItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    typeLabel: notificationTypeLabel(row.type),
    title: row.title,
    body: row.body,
    link: row.link,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

/** 읽지 않은 알림 수와 가장 최근 알림 번호(없으면 0). 화면의 종 아이콘이 30초마다 부른다 */
export function getSummary(db: Db, userId: number): NotificationSummary {
  const r = db.get<{ unread: number | null; latest: number | null }>(
    'SELECT SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread, MAX(id) AS latest FROM notifications WHERE user_id = ?',
    [userId],
  );
  return { unread: r?.unread ?? 0, latestId: r?.latest ?? 0 };
}

/** 목록 조건 */
export interface ListQuery {
  page: number;
  pageSize: number;
  /** true면 읽지 않은 것만 */
  unreadOnly: boolean;
}

/** 내 알림 목록(최근 것부터). total은 조건에 맞는 전체 건수 */
export function listNotifications(db: Db, userId: number, q: ListQuery): NotificationPage {
  const where = q.unreadOnly ? 'user_id = ? AND read_at IS NULL' : 'user_id = ?';
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE ${where}`, [userId])?.n ?? 0;
  const rows = db.all<NotificationRow>(
    `SELECT id, type, title, body, link, created_at, read_at FROM notifications WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [userId, q.pageSize, (q.page - 1) * q.pageSize],
  );
  return { data: rows.map(toItem), total };
}

/** 알림 한 건을 읽음으로 바꾼다. 이미 읽었으면 그대로 둔다. 내 알림이 아니거나 없으면 404 NOT_FOUND */
export function markRead(db: Db, clock: Clock, userId: number, id: number): void {
  const r = db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', [clock.now().toISOString(), id, userId]);
  if (r.changes > 0) return;
  const mine = db.get<{ id: number }>('SELECT id FROM notifications WHERE id = ? AND user_id = ?', [id, userId]);
  if (!mine) throw new AppError('NOT_FOUND', { message: '찾는 알림이 없어요. 이미 지워졌을 수 있어요.' });
}

/** 내 알림을 모두 읽음으로 바꾼다. 바꾼 건수를 돌려준다 */
export function markAllRead(db: Db, clock: Clock, userId: number): number {
  return db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [clock.now().toISOString(), userId]).changes;
}

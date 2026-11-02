// 이 파일이 하는 일: 알림 목록 한 덩어리(FR-090). 상단바 종 팝오버와 알림 전체 화면(/notifications)이 같이 쓴다.
// 불러오는 중(Skeleton)·오류(ErrorState: 이유 + 다시 시도)·빈 상태(EmptyState)를 공용 컴포넌트로 보여 주고(DESIGN §5-4),
// 알림 줄은 누를 수 있는 버튼이다. 종류와 "읽지 않음"을 글자 칩으로 함께 보여 준다(색만으로 구분하지 않음, DESIGN §5-5).
import type { ReactNode } from 'react';
import type { NotificationItem } from '../../../shared/schemas/notifications.ts';
import { Chip } from '../components/Chip.tsx';
import { EmptyState, ErrorState, Skeleton } from '../components/States.tsx';
import './NotificationBell.css';

const timeFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** 알림 시각을 "11월 2일 오전 9:00"처럼 보여 준다 */
export function formatNotificationTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : timeFormat.format(d);
}

/** NotificationList가 받는 값 */
export interface NotificationListProps {
  items: readonly NotificationItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** 읽지 않은 것만 보는 중이면 빈 상태 문구가 달라진다 */
  unreadOnly?: boolean;
  /** 알림을 눌렀을 때 */
  onOpen(item: NotificationItem): void;
  /** 오류 상태에서 "다시 시도"를 눌렀을 때 */
  onRetry(): void;
  /** 빈 상태에 둘 버튼(예: 대시보드로 가기) */
  emptyAction?: ReactNode;
  /** 팝오버처럼 좁은 곳에서는 본문을 숨기고 줄을 촘촘하게 한다 */
  compact?: boolean;
}

/** 알림 목록(불러오는 중·오류·빈 상태 포함) */
export function NotificationList(props: NotificationListProps) {
  const { items, status, error, unreadOnly = false, onOpen, onRetry, emptyAction, compact = false } = props;

  if (status === 'idle' || (status === 'loading' && items.length === 0)) {
    return <Skeleton rows={compact ? 3 : 5} label="알림을 불러오는 중이에요" />;
  }
  if (status === 'error') {
    return <ErrorState title="알림을 불러오지 못했어요" message={error ?? undefined} onRetry={onRetry} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon="bell"
        title={unreadOnly ? '읽지 않은 알림이 없어요' : '아직 받은 알림이 없어요'}
        description="재고 부족, 연차 신청, 새 공지 같은 소식이 생기면 여기에 모여요."
        action={emptyAction}
      />
    );
  }

  return (
    <ul className={compact ? 'notif-list compact' : 'notif-list'}>
      {items.map((n) => {
        const unread = n.readAt === null;
        return (
          <li key={n.id} className={unread ? 'unread' : undefined}>
            <button type="button" className="notif-row" onClick={() => onOpen(n)}>
              <span className="mark" aria-hidden="true" />
              <span className="t">
                <b>{n.title}</b>
                {n.body && !compact ? <span className="desc">{n.body}</span> : null}
                <span className="meta">
                  <Chip tone="ghost">{n.typeLabel}</Chip>
                  {unread ? <Chip tone="info">읽지 않음</Chip> : null}
                  <time className="num" dateTime={n.createdAt}>
                    {formatNotificationTime(n.createdAt)}
                  </time>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

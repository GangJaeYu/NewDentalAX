// 이 파일이 하는 일: 알림 전체 화면(/notifications, FR-090)의 본문과, 종 아이콘 팝오버에서도 다시 쓰는 알림 목록(NotificationList)을 둔다.
// 알림을 누르면 읽음 처리하고 링크 화면으로 이동한다. "모두 읽음", "전체/읽지 않음" 거르기, "더 보기"가 있다.
// 불러오는 중(뼈대 모양)·빈 상태(안내 + 대시보드로 가기)·오류 상태(이유 + 다시 시도)를 모두 보여 준다(DESIGN §5-4).
// 색은 디자인 토큰을 붙이기 전이라 클래스 이름만 둔다. 앱 셸(phase-01-task-04)이 라우트·스타일을 연결한다.
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import type { NotificationItem } from '../../../../shared/schemas/notifications.ts';
import { useNotifications, type NotificationsStore } from '../../lib/useNotifications.ts';

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
  /** 빈 상태에서 "대시보드로 가기"를 눌렀을 때(없으면 버튼을 숨긴다) */
  onGoHome?: () => void;
  /** 팝오버처럼 좁은 곳에서는 본문을 한 줄로 줄인다 */
  compact?: boolean;
}

/** 알림 목록(불러오는 중·오류·빈 상태 포함). 종 아이콘 팝오버와 알림 화면이 같이 쓴다 */
export function NotificationList(props: NotificationListProps) {
  const { items, status, error, unreadOnly = false, onOpen, onRetry, onGoHome, compact = false } = props;

  if (status === 'idle' || (status === 'loading' && items.length === 0)) {
    return (
      <div className="notif-list notif-list--loading" aria-busy="true">
        <p className="sr-only" role="status">
          알림을 불러오는 중이에요.
        </p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="notif-skeleton" aria-hidden="true" />
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="notif-list notif-list--error" role="alert">
        <p className="notif-state-title">알림을 불러오지 못했어요.</p>
        <p className="notif-state-reason">{error ?? '잠시 후 다시 시도해 주세요.'}</p>
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          다시 시도
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="notif-list notif-list--empty">
        <p className="notif-state-title">{unreadOnly ? '읽지 않은 알림이 없어요.' : '아직 받은 알림이 없어요.'}</p>
        <p className="notif-state-reason">재고 부족, 연차 신청, 새 공지 같은 소식이 생기면 여기에 모여요.</p>
        {onGoHome ? (
          <button type="button" className="btn btn-secondary" onClick={onGoHome}>
            대시보드로 가기
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <ul className={compact ? 'notif-list notif-list--compact' : 'notif-list'}>
      {items.map((n) => {
        const unread = n.readAt === null;
        return (
          <li key={n.id} className={unread ? 'notif-item notif-item--unread' : 'notif-item'}>
            <button type="button" className="notif-item-button" onClick={() => onOpen(n)}>
              <span className="notif-item-head">
                <span className="chip">{n.typeLabel}</span>
                {unread ? <span className="chip chip--accent">읽지 않음</span> : null}
                <time className="notif-item-time" dateTime={n.createdAt}>
                  {formatNotificationTime(n.createdAt)}
                </time>
              </span>
              <span className="notif-item-title">{n.title}</span>
              {n.body && !compact ? <span className="notif-item-body">{n.body}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 알림 전체 화면 본문. store를 넣지 않으면 앱 공용 알림 저장소를 쓴다 */
export default function NotificationsPage({ store }: { store?: NotificationsStore }) {
  const n = useNotifications(store);
  const navigate = useNavigate();
  const s = n.store;

  useEffect(() => {
    void s.loadList();
  }, [s]);

  return (
    <section className="page notifications-page" aria-labelledby="notifications-title">
      <header className="page-head">
        <h1 id="notifications-title">알림</h1>
        <p className="page-sub" aria-live="polite">
          {n.summaryLoaded ? `읽지 않은 알림 ${n.unread}개` : '알림을 확인하는 중이에요.'}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void s.markAllRead()} disabled={n.unread === 0}>
          모두 읽음
        </button>
      </header>

      <div className="toolbar" role="group" aria-label="알림 거르기">
        <button type="button" className="btn btn-ghost" aria-pressed={!n.unreadOnly} onClick={() => void s.loadList({ unreadOnly: false })}>
          전체
        </button>
        <button type="button" className="btn btn-ghost" aria-pressed={n.unreadOnly} onClick={() => void s.loadList({ unreadOnly: true })}>
          읽지 않음
        </button>
      </div>

      {n.actionError ? (
        <p className="notif-action-error" role="alert">
          {n.actionError}
        </p>
      ) : null}

      <NotificationList
        items={n.items}
        status={n.listStatus}
        error={n.listError}
        unreadOnly={n.unreadOnly}
        onOpen={(item) => void s.open(item, (to) => navigate(to))}
        onRetry={() => void s.loadList()}
        onGoHome={() => navigate('/')}
      />

      {n.listStatus === 'ready' && n.items.length < n.total ? (
        <button type="button" className="btn btn-secondary notif-more" onClick={() => void s.loadMore()}>
          더 보기 ({n.items.length}/{n.total})
        </button>
      ) : null}
    </section>
  );
}

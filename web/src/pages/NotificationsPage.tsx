// 이 파일이 하는 일: 알림 전체 화면(/notifications, FR-090). 내 알림을 최근 것부터 보여 주고, 누르면 읽음 처리하고 그 화면으로 이동한다.
// 위에 "모두 읽음"(주 행동), 그 아래 카드에 "전체 / 읽지 않음" 거르기와 목록, "더 보기"가 있다.
// 불러오는 중·빈 상태·오류 상태는 공용 컴포넌트(Skeleton·EmptyState·ErrorState)로 보여 준다(layout/NotificationList.tsx).
// 상단바 종(layout/NotificationBell.tsx)과 같은 알림 저장소를 써서 한쪽에서 읽으면 다른 쪽 숫자도 같이 줄어든다.
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/Button.tsx';
import { PageHeader } from '../components/Card.tsx';
import { Segmented } from '../components/Toolbar.tsx';
import { NotificationList } from '../layout/NotificationList.tsx';
import { useNotifications, type NotificationsStore } from '../lib/useNotifications.ts';

type Filter = 'all' | 'unread';

/** 알림 전체 화면. store를 넣지 않으면 앱 공용 알림 저장소를 쓴다 */
export default function NotificationsPage({ store }: { store?: NotificationsStore }) {
  const n = useNotifications(store);
  const s = n.store;
  const navigate = useNavigate();

  useEffect(() => {
    void s.loadList();
  }, [s]);

  return (
    <>
      <PageHeader
        title="알림"
        summary={n.summaryLoaded ? `읽지 않은 알림 ${n.unread}개` : '알림을 확인하는 중이에요.'}
        actions={
          <Button variant="primary" icon="check" disabled={n.unread === 0} onClick={() => void s.markAllRead()}>
            모두 읽음
          </Button>
        }
      />
      <article className="card notif-card" aria-label="알림 목록">
        <div className="toolbar">
          <Segmented<Filter>
            label="알림 거르기"
            value={n.unreadOnly ? 'unread' : 'all'}
            options={[
              { value: 'all', label: '전체' },
              { value: 'unread', label: '읽지 않음' },
            ]}
            onChange={(v) => void s.loadList({ unreadOnly: v === 'unread' })}
          />
          <span className="grow" />
          <span className="sub num" aria-live="polite">
            {n.listStatus === 'ready' ? `${n.total}건` : ''}
          </span>
        </div>
        {n.actionError ? (
          <p className="form-error notif-action-error" role="alert">
            {n.actionError}
          </p>
        ) : null}
        <div className="body">
          <NotificationList
            items={n.items}
            status={n.listStatus}
            error={n.listError}
            unreadOnly={n.unreadOnly}
            onOpen={(item) => void s.open(item, (to) => navigate(to))}
            onRetry={() => void s.loadList()}
            emptyAction={
              <Button size="sm" to="/">
                대시보드로 가기
              </Button>
            }
          />
          {n.listStatus === 'ready' && n.items.length < n.total ? (
            <Button size="sm" className="notif-more" onClick={() => void s.loadMore()}>
              더 보기 ({n.items.length}/{n.total})
            </Button>
          ) : null}
        </div>
      </article>
    </>
  );
}

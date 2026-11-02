// 이 파일이 하는 일: 알림 목록(NotificationList)과 종 버튼(NotificationBell)이 불러오는 중·오류·빈 상태·알림 줄·배지를 바르게 그리는지
// 서버 렌더링으로 확인한다(DESIGN §5-4·5, FR-090). 클릭·팝오버 흐름은 tests/e2e/notifications.spec.ts(브라우저)가 본다.
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { NotificationItem } from '../../../shared/schemas/notifications.ts';
import { createNotificationsStore, type NotificationsApi } from '../lib/useNotifications.ts';
import { formatNotificationTime, NotificationList } from './NotificationList.tsx';
import { badgeText, NotificationBell } from './NotificationBell.tsx';

const noop = () => {};
const item = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 1,
  type: 'stock_low',
  typeLabel: '재고 부족',
  title: '거즈 재고가 부족해요',
  body: '현재 3개, 적정 10개',
  link: '/inventory/items/1',
  createdAt: '2026-11-02T00:00:00.000Z',
  readAt: null,
  ...over,
});

describe('알림 목록 그리기', () => {
  test('불러오는 중에는 공용 뼈대(Skeleton)를 보여 준다', () => {
    const html = renderToStaticMarkup(<NotificationList items={[]} status="loading" error={null} onOpen={noop} onRetry={noop} />);
    expect(html).toContain('class="skel"');
    expect(html).toContain('aria-label="알림을 불러오는 중이에요"');
    expect(html).toContain('aria-busy="true"');
  });

  test('오류면 공용 오류 상태(이유 + 다시 시도)를 보여 준다', () => {
    const html = renderToStaticMarkup(<NotificationList items={[]} status="error" error="서버에 연결할 수 없어요." onOpen={noop} onRetry={noop} />);
    expect(html).toContain('class="errstate"');
    expect(html).toContain('알림을 불러오지 못했어요');
    expect(html).toContain('서버에 연결할 수 없어요.');
    expect(html).toContain('다시 시도');
  });

  test('비어 있으면 공용 빈 상태와 넣어 준 버튼, 읽지 않음 거르기면 다른 문구', () => {
    const all = renderToStaticMarkup(<NotificationList items={[]} status="ready" error={null} onOpen={noop} onRetry={noop} emptyAction={<button type="button">대시보드로 가기</button>} />);
    expect(all).toContain('class="empty"');
    expect(all).toContain('아직 받은 알림이 없어요');
    expect(all).toContain('대시보드로 가기');
    const unread = renderToStaticMarkup(<NotificationList items={[]} status="ready" error={null} unreadOnly onOpen={noop} onRetry={noop} />);
    expect(unread).toContain('읽지 않은 알림이 없어요');
  });

  test('phase-02-task-04 AC2: 알림 줄은 누를 수 있는 버튼이고, 종류·읽지 않음을 글자 칩으로 보여 준다', () => {
    const html = renderToStaticMarkup(
      <NotificationList items={[item(), item({ id: 2, title: '읽은 알림', readAt: '2026-11-02T01:00:00.000Z' })]} status="ready" error={null} onOpen={noop} onRetry={noop} />,
    );
    expect(html.match(/<button type="button" class="notif-row"/g)).toHaveLength(2);
    expect(html).toContain('<span class="chip ghost">재고 부족</span>');
    expect(html.match(/<span class="chip info">읽지 않음<\/span>/g)).toHaveLength(1);
    expect(html.match(/<li class="unread">/g)).toHaveLength(1);
    expect(html).toContain('현재 3개, 적정 10개');
    expect(html).toContain('dateTime="2026-11-02T00:00:00.000Z"');
    const compact = renderToStaticMarkup(<NotificationList items={[item()]} status="ready" error={null} compact onOpen={noop} onRetry={noop} />);
    expect(compact).not.toContain('현재 3개');
  });

  test('시각은 한국 시간으로 보여 준다', () => {
    expect(formatNotificationTime('2026-11-02T00:00:00.000Z')).toBe('11월 2일 오전 9:00');
    expect(formatNotificationTime('잘못된 값')).toBe('');
  });
});

describe('알림 종 버튼', () => {
  const quiet: NotificationsApi = {
    summary: async () => ({ unread: 0, latestId: 0 }),
    list: async () => ({ data: [], total: 0 }),
    markRead: async () => {},
    markAllRead: async () => {},
  };

  test('phase-02-task-04 AC3: 읽지 않은 수를 배지와 이름(읽지 않은 알림 N)으로 보여 주고, 0이면 배지를 숨긴다', () => {
    const store = createNotificationsStore(quiet);
    const with5 = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationBell store={store} count={5} />
      </MemoryRouter>,
    );
    expect(with5).toContain('aria-label="읽지 않은 알림 5"');
    expect(with5).toContain('data-testid="notification-badge"');
    expect(with5).toContain('aria-expanded="false"');
    const none = renderToStaticMarkup(
      <MemoryRouter>
        <NotificationBell store={store} />
      </MemoryRouter>,
    );
    expect(none).toContain('aria-label="알림"');
    expect(none).not.toContain('notification-badge');
    expect(badgeText(7)).toBe('7');
    expect(badgeText(120)).toBe('99+');
  });
});

// 이 파일이 하는 일: 알림 목록(NotificationList)이 불러오는 중·오류·빈 상태·알림 줄을 바르게 그리는지 서버 렌더링으로 확인한다(DESIGN §5-4·5, FR-090).
// 브라우저 클릭 흐름(E2E)은 앱 셸(phase-01-task-04)에 라우트를 연결한 뒤 추가한다.
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NotificationItem } from '../../../../shared/schemas/notifications.ts';
import { formatNotificationTime, NotificationList } from './NotificationsPage.tsx';

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
  test('불러오는 중에는 뼈대 모양과 안내 문구(aria-busy)를 보여 준다', () => {
    const html = renderToStaticMarkup(<NotificationList items={[]} status="loading" error={null} onOpen={noop} onRetry={noop} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('알림을 불러오는 중이에요.');
    expect(html.match(/notif-skeleton/g)).toHaveLength(3);
  });

  test('오류면 이유와 다시 시도 버튼을 보여 준다', () => {
    const html = renderToStaticMarkup(<NotificationList items={[]} status="error" error="서버에 연결하지 못했어요." onOpen={noop} onRetry={noop} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('알림을 불러오지 못했어요.');
    expect(html).toContain('서버에 연결하지 못했어요.');
    expect(html).toContain('다시 시도');
  });

  test('비어 있으면 안내와 대시보드로 가기 버튼, 읽지 않음 거르기면 다른 문구', () => {
    const all = renderToStaticMarkup(<NotificationList items={[]} status="ready" error={null} onOpen={noop} onRetry={noop} onGoHome={noop} />);
    expect(all).toContain('아직 받은 알림이 없어요.');
    expect(all).toContain('대시보드로 가기');
    const unread = renderToStaticMarkup(<NotificationList items={[]} status="ready" error={null} unreadOnly onOpen={noop} onRetry={noop} />);
    expect(unread).toContain('읽지 않은 알림이 없어요.');
    expect(unread).not.toContain('대시보드로 가기');
  });

  test('phase-02-task-04 AC2: 알림 줄은 누를 수 있는 버튼이고, 종류·읽지 않음을 글자 칩으로 보여 준다', () => {
    const html = renderToStaticMarkup(
      <NotificationList items={[item(), item({ id: 2, title: '읽은 알림', readAt: '2026-11-02T01:00:00.000Z' })]} status="ready" error={null} onOpen={noop} onRetry={noop} />,
    );
    expect(html.match(/<button type="button" class="notif-item-button"/g)).toHaveLength(2);
    expect(html).toContain('재고 부족');
    expect(html.match(/읽지 않음/g)).toHaveLength(1);
    expect(html).toContain('notif-item--unread');
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

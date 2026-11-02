// 이 파일이 하는 일: 상단바 알림 종 자리. 읽지 않은 알림 수(count)를 받아 빨간 배지로 보여 주고, 누르면 알림 전체 화면(/notifications)으로 간다.
// 지금은 숫자를 받는 자리만 있다. 실제 알림 수를 불러와 넣는 일(30초 폴링, TD-016)은 phase-02-task-04가 한다.
import { Link } from 'react-router';
import { Icon } from '../components/Icon.tsx';

/** 알림 종 버튼. count가 0이거나 없으면 배지를 숨긴다 */
export function NotificationBell({ count }: { count?: number }) {
  const n = count && count > 0 ? count : 0;
  const label = n ? `알림 ${n}건` : '알림';
  return (
    <Link className="iconbtn" to="/notifications" aria-label={label} title={label}>
      <Icon name="bell" />
      {n ? (
        <span className="dot num" aria-hidden="true">
          {n > 99 ? '99+' : n}
        </span>
      ) : null}
    </Link>
  );
}

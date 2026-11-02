// 이 파일이 하는 일: 상단바 알림 종(FR-090 AC1·AC3). 읽지 않은 알림 수를 빨간 배지로 보여 주고(30초마다 갱신, lib/useNotifications.ts),
// 누르면 최근 알림 팝오버를 연다: 알림을 누르면 읽음 처리하고 그 화면으로 이동, "모두 읽음", "전체 보기"(/notifications).
// 바깥을 누르거나 Esc를 누르면 닫히고, Esc면 종 버튼으로 포커스가 돌아온다. count를 주면 그 숫자를 배지로 쓴다(테스트·미리보기용).
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from '../components/Icon.tsx';
import { Button } from '../components/Button.tsx';
import { useNotifications, type NotificationsStore } from '../lib/useNotifications.ts';
import { NotificationList } from './NotificationList.tsx';
import './NotificationBell.css';

/** 팝오버에 보여 줄 최근 알림 수 */
const POPOVER_ITEMS = 8;

/** 배지 숫자 글자(99를 넘으면 99+) */
export function badgeText(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/** 알림 종 버튼과 최근 알림 팝오버 */
export function NotificationBell({ count, store }: { count?: number; store?: NotificationsStore }) {
  const n = useNotifications(store);
  const s = n.store;
  const unread = Math.max(0, count ?? n.unread);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const titleId = useId();
  const navigate = useNavigate();
  // 이름에 배지 숫자를 그대로 넣는다(눈에 보이는 글자와 읽히는 이름이 맞아야 함, axe label-content-name-mismatch)
  const label = unread ? `읽지 않은 알림 ${badgeText(unread)}` : '알림';

  // 열 때마다 최근 목록을 새로 받는다
  useEffect(() => {
    if (open) void s.loadList();
  }, [open, s]);

  // 바깥 누르기·Esc로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="notif-bell" ref={boxRef}>
      <button
        ref={btnRef}
        type="button"
        className="iconbtn"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={popId}
        aria-haspopup="dialog"
        data-testid="notification-bell"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" />
        {unread ? (
          <span className="dot num" aria-hidden="true" data-testid="notification-badge">
            {badgeText(unread)}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="notif-pop" id={popId} role="dialog" aria-labelledby={titleId}>
          <div className="notif-pop-head">
            <h2 id={titleId}>알림</h2>
            <span className="sub num">읽지 않음 {unread}개</span>
            <Button size="sm" variant="ghost" icon="check" disabled={n.unread === 0} onClick={() => void s.markAllRead()}>
              모두 읽음
            </Button>
          </div>
          {n.actionError ? (
            <p className="form-error" role="alert">
              {n.actionError}
            </p>
          ) : null}
          <div className="notif-pop-body">
            <NotificationList
              compact
              items={n.items.slice(0, POPOVER_ITEMS)}
              status={n.listStatus}
              error={n.listError}
              unreadOnly={n.unreadOnly}
              onOpen={(item) => {
                setOpen(false);
                void s.open(item, (to) => navigate(to));
              }}
              onRetry={() => void s.loadList()}
            />
          </div>
          <div className="notif-pop-foot">
            <Link to="/notifications" onClick={() => setOpen(false)}>
              알림 전체 보기
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

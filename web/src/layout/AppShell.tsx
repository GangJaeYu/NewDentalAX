// 이 파일이 하는 일: 로그인한 뒤 모든 업무 화면을 감싸는 앱 골격(상단바 + 왼쪽 메뉴 + 본문 + 휴대폰 아래쪽 탭). frontend.md §3.
// 본문 바로 가기 링크(키보드용), 휴대폰 "더보기" 서랍(전체 메뉴)을 둔다. 화면을 옮기면 본문 맨 위로 스크롤한다.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { Me } from '../../../shared/schemas/auth.ts';
import { BOTTOM_TABS, findNavItem } from '../lib/nav.ts';
import { Icon } from '../components/Icon.tsx';
import { Drawer } from '../components/Dialog.tsx';
import { TopBar } from './TopBar.tsx';
import { MoreNav, Sidebar, type NavCounts } from './Sidebar.tsx';

interface AppShellProps {
  user: Me;
  clinicName: string | null;
  demoMode: boolean;
  onLogout: () => void;
  /** 알림 종 배지 숫자(phase-02-task-04가 연결) */
  notificationCount?: number;
  /** 메뉴 건수 배지 */
  navCounts?: NavCounts;
  children: ReactNode;
}

/** 휴대폰 아래쪽 탭 막대 */
function BottomNav({ user }: { user: Me }) {
  const { pathname } = useLocation();
  const [more, setMore] = useState(false);
  const current = findNavItem(pathname)?.path ?? null;
  const inTabs = BOTTOM_TABS.some((t) => t.path === current);
  return (
    <>
      <nav className="bottomnav" aria-label="아래쪽 메뉴">
        {BOTTOM_TABS.map((t) => (
          <Link key={t.path} to={t.path} aria-current={current === t.path ? 'page' : undefined}>
            <Icon name={t.icon} />
            {t.label}
          </Link>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-current={!inTabs && current ? 'page' : undefined}>
          <Icon name="menu" />
          더보기
        </button>
      </nav>
      <Drawer open={more} onClose={() => setMore(false)} title="전체 메뉴">
        <MoreNav role={user.role} onNavigate={() => setMore(false)} />
      </Drawer>
    </>
  );
}

/** 앱 골격 */
export function AppShell({ user, clinicName, demoMode, onLogout, notificationCount, navCounts, children }: AppShellProps) {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        본문 바로 가기
      </a>
      <TopBar user={user} clinicName={clinicName} demoMode={demoMode} notificationCount={notificationCount} onLogout={onLogout} />
      <Sidebar role={user.role} counts={navCounts} />
      <main className="main" id="main" tabIndex={-1}>
        <div className="wrap">{children}</div>
      </main>
      <BottomNav user={user} />
    </div>
  );
}

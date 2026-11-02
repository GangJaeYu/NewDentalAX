// 이 파일이 하는 일: 상단바(56px). 병원 이름, 메뉴 찾기, 데모 모드 배지, 알림 종, 밝기 전환, 사용자 메뉴(비밀번호 바꾸기·밝기 3단계·로그아웃)를 둔다(DESIGN §4).
// 메뉴 찾기는 메뉴 이름으로 화면을 찾아 이동한다('/' 키로 바로 입력). 휴대폰(720px 이하)에서는 찾기·이름 글자를 숨긴다.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ROLE_LABELS } from '../../../shared/roles.ts';
import type { Me } from '../../../shared/schemas/auth.ts';
import { Icon } from '../components/Icon.tsx';
import { IconButton } from '../components/Button.tsx';
import { Segmented } from '../components/Toolbar.tsx';
import { useToast } from '../components/Toast.tsx';
import { HOME_ITEM, searchMenu, visibleGroups } from '../lib/nav.ts';
import { effectiveTheme, setTheme, THEME_LABELS, toggleTheme, useTheme, type ThemePref } from '../lib/theme.ts';
import { initials } from '../lib/format.ts';
import { NotificationBell } from './NotificationBell.tsx';

/** 데모 모드 배지(가상 데이터·예시 AI 응답으로 동작 중일 때) */
export function DemoBadge({ detail = '가상 데이터' }: { detail?: string }) {
  return (
    <span className="pill demo" title={`데모 모드: ${detail}로 동작 중이에요`} data-testid="demo-badge">
      <Icon name="spark" size="sm" />
      데모 모드<span className="long">&nbsp;· {detail}</span>
    </span>
  );
}

/** 메뉴 이름으로 화면 찾기 */
function MenuSearch({ user }: { user: Me }) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const options = [HOME_ITEM, ...visibleGroups(user.role).flatMap((g) => g.items)];

  // '/' 키를 누르면 찾기 칸으로(다른 입력 중일 때는 제외)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const hit = searchMenu(q, user.role)[0];
    if (!hit) {
      toast.error(`"${q}"에 맞는 메뉴가 없어요.`);
      return;
    }
    setQ('');
    inputRef.current?.blur();
    navigate(hit.path);
  };

  return (
    <form className="top-search" role="search" onSubmit={submit}>
      <Icon name="search" />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="메뉴 찾기"
        aria-label="메뉴 찾기"
        list={listId}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.path} value={o.label} />
        ))}
      </datalist>
      <kbd aria-hidden="true">/</kbd>
    </form>
  );
}

/** 사용자 메뉴(이름 누르면 열림) */
function UserMenu({ user, onLogout }: { user: Me; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

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

  const role = ROLE_LABELS[user.role];
  return (
    <div className="me" ref={boxRef}>
      <button ref={btnRef} type="button" className="me-btn" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((v) => !v)}>
        <span className="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="who">
          {user.name} <small>{role}</small>
        </span>
        <span className="sr-only"> 메뉴</span>
      </button>
      {open ? (
        <div className="menu-pop" id={menuId}>
          <div className="menu-head">
            <b>{user.name}</b>
            <small>
              {user.username} · {role}
            </small>
          </div>
          <Link to="/change-password" onClick={() => setOpen(false)}>
            <Icon name="key" size="md" />
            비밀번호 바꾸기
          </Link>
          <div className="menu-head">
            <small>화면 밝기</small>
            <Segmented<ThemePref>
              label="화면 밝기"
              value={theme}
              options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: THEME_LABELS[v] }))}
              onChange={setTheme}
            />
          </div>
          <button type="button" onClick={onLogout}>
            <Icon name="logout" size="md" />
            로그아웃
          </button>
        </div>
      ) : null}
    </div>
  );
}

interface TopBarProps {
  user: Me;
  clinicName: string | null;
  demoMode: boolean;
  notificationCount?: number;
  onLogout: () => void;
}

/** 상단바 */
export function TopBar({ user, clinicName, demoMode, notificationCount, onLogout }: TopBarProps) {
  const theme = useTheme();
  const dark = effectiveTheme(theme) === 'dark';
  return (
    <header className="top">
      <Link className="brand" to="/" title="대시보드로">
        <span className="mark" aria-hidden="true">
          <Icon name="tooth" />
        </span>
        <span className="name">
          {clinicName ?? '우리 병원'} <small>원내 업무</small>
        </span>
      </Link>
      <MenuSearch user={user} />
      <div className="spacer" />
      {demoMode ? <DemoBadge /> : null}
      <NotificationBell count={notificationCount} />
      <IconButton icon={dark ? 'sun' : 'moon'} label={dark ? '밝게 보기' : '어둡게 보기'} onClick={toggleTheme} />
      <UserMenu user={user} onLogout={onLogout} />
    </header>
  );
}

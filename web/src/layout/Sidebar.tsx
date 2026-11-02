// 이 파일이 하는 일: 왼쪽 메뉴(대시보드 + 7개 묶음, 접기·펴기)와 휴대폰 "더보기" 서랍 안 전체 메뉴(MoreNav)를 그린다.
// 권한이 없는 항목·묶음은 lib/nav.ts visibleGroups(shared/roles.ts canSeePage)로 숨긴다. 태블릿(721~1100px)에서는 CSS가 묶음별 아이콘 링크만 남긴다.
// 접은 묶음은 이 브라우저에 기억한다(실패해도 무시). 지금 보는 화면이 든 묶음은 접혀 있어도 펼쳐 보인다.
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { Role } from '../../../shared/roles.ts';
import { findNavItem, HOME_ITEM, isActivePath, visibleGroups, type NavGroup } from '../lib/nav.ts';
import { Icon } from '../components/Icon.tsx';

/** 메뉴 항목 옆 건수 배지(경로 → { n, alert }). 각 모듈이 채운다 */
export type NavCounts = Readonly<Record<string, { n: number | string; alert?: boolean }>>;

const STORE_KEY = 'nav.collapsed';
/** 처음에는 관리 묶음만 접어 둔다(시안 v2) */
const DEFAULT_COLLAPSED = ['admin'];

function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) return new Set(v.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // 저장소를 못 쓰면 기본값
  }
  return new Set(DEFAULT_COLLAPSED);
}

function saveCollapsed(s: Set<string>): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify([...s]));
  } catch {
    // 저장하지 못해도 화면은 동작한다
  }
}

function groupActive(g: NavGroup, pathname: string): boolean {
  return g.items.some((it) => isActivePath(it.path, pathname));
}

/** 왼쪽 메뉴 */
export function Sidebar({ role, counts = {} }: { role: Role; counts?: NavCounts }) {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const groups = visibleGroups(role);
  const current = findNavItem(pathname)?.path ?? null;

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });
  };

  return (
    <nav className="side" aria-label="주 메뉴">
      <div className="side-inner nav-list">
        <Link to={HOME_ITEM.path} aria-current={current === HOME_ITEM.path ? 'page' : undefined}>
          <Icon name="home" />
          <span className="nav-label">{HOME_ITEM.label}</span>
        </Link>
        {groups.map((g) => {
          const active = groupActive(g, pathname);
          const open = !collapsed.has(g.id) || active;
          const listId = `nav-${g.id}`;
          const first = g.items[0];
          return (
            <div key={g.id} className="nav-list" data-group={g.id}>
              <button type="button" className="gh" aria-expanded={open} aria-controls={listId} onClick={() => toggle(g.id)}>
                <Icon name={g.icon} />
                <span className="nav-label">{g.label}</span>
                <Icon name="chev" className="chev" />
              </button>
              {first ? (
                <Link className={['gh-rail', active && 'in-group'].filter(Boolean).join(' ')} to={first.path} aria-label={g.label} title={g.label} aria-current={active ? 'page' : undefined}>
                  <Icon name={g.icon} />
                </Link>
              ) : null}
              <div className="items" id={listId} hidden={!open}>
                {g.items.map((it) => {
                  const c = counts[it.path];
                  return (
                    <Link key={it.path} to={it.path} aria-current={current === it.path ? 'page' : undefined}>
                      <span className="nav-label">{it.label}</span>
                      {it.ai ? <b className="new">AI</b> : null}
                      {c ? <b className={['cnt', 'num', c.alert && 'alert'].filter(Boolean).join(' ')}>{c.n}</b> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

/** 휴대폰 "더보기" 서랍 안 전체 메뉴(항목을 누르면 onNavigate로 서랍을 닫는다) */
export function MoreNav({ role, onNavigate }: { role: Role; onNavigate: () => void }) {
  const groups = visibleGroups(role);
  const { pathname } = useLocation();
  const current = findNavItem(pathname)?.path ?? null;
  return (
    <nav className="more-nav" aria-label="전체 메뉴">
      <Link to="/" aria-current={current === '/' ? 'page' : undefined} onClick={onNavigate}>
        <Icon name="home" />
        대시보드
      </Link>
      {groups.map((g) => (
        <div key={g.id}>
          <p className="group-title">
            <Icon name={g.icon} size="md" />
            {g.label}
          </p>
          {g.items.map((it) => (
            <Link key={it.path} to={it.path} aria-current={current === it.path ? 'page' : undefined} onClick={onNavigate}>
              {it.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

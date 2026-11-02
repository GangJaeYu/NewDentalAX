// 이 파일이 하는 일: 앱 셸의 순수 로직 단위 테스트(phase-01-task-04). 메뉴 권한 숨김(AC3), 연결 끊김 판단(AC6), 경로 표가 frontend.md §3과 같은지,
// 로그인 후 돌아갈 주소(?next) 안전 검사, 메뉴 찾기를 확인한다. 브라우저 없이 Node에서 돈다.
import { describe, expect, it } from 'vitest';
import { canSeePage } from '../../../shared/roles.ts';
import { BOTTOM_TABS, findNavItem, HOME_ITEM, NAV_GROUPS, searchMenu, visibleGroups } from './nav.ts';
import { ConnectionTracker } from './connection.ts';
import { loginPath, safeNext } from './session.tsx';
import { AUTH_PATHS, PRINT_ROUTES, SHELL_ROUTES } from '../routes.tsx';
// 문서·소스 글은 Vite의 ?raw 가져오기로 읽는다(web 타입 설정에는 node:fs가 없음)
import frontendMd from '../../../docs/ARCHITECTURE/frontend.md?raw';
import routesSrc from '../routes.tsx?raw';

/** pages 아래 모든 페이지 파일의 글(경로 → 내용) */
const PAGE_SOURCES = import.meta.glob('../pages/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('메뉴(시안 v2 7묶음)와 권한 숨김', () => {
  it('phase-01-task-04 AC3: staff에게는 관리·운영 지표 묶음과 발주서·CSV 가져오기가 보이지 않는다', () => {
    const groups = visibleGroups('staff');
    const ids = groups.map((g) => g.id);
    expect(ids).toEqual(['desk', 'inventory', 'docs', 'hr', 'facility']);
    const paths = groups.flatMap((g) => g.items.map((i) => i.path));
    expect(paths).not.toContain('/inventory/orders');
    expect(paths.some((p) => p.startsWith('/admin'))).toBe(false);
    expect(paths.some((p) => p.startsWith('/finance'))).toBe(false);
    // 직접 접근 판단도 같은 표를 쓴다
    expect(canSeePage('staff', '/admin/users')).toBe(false);
    expect(canSeePage('staff', '/inventory/orders/3')).toBe(false);
    expect(canSeePage('staff', '/inventory')).toBe(true);
  });

  it('phase-01-task-04 AC3: admin은 7개 묶음 전부, manager는 관리 묶음만 빠진다', () => {
    expect(visibleGroups('admin').map((g) => g.label)).toEqual(['데스크·소통', '재고·구매', '문서·AI', '인사·근무', '시설·법정', '운영 지표', '관리']);
    expect(visibleGroups('manager').map((g) => g.id)).toEqual(['desk', 'inventory', 'docs', 'hr', 'facility', 'finance']);
    expect(visibleGroups('admin').find((g) => g.id === 'admin')?.items).toHaveLength(7);
    expect(visibleGroups(null)).toEqual([]);
  });

  it('phase-01-task-04 범위: 지금 경로에 맞는 메뉴는 가장 길게 맞는 항목이다(품목 상세 → 재고 현황, 입출고 → 입출고 기록)', () => {
    expect(findNavItem('/')?.label).toBe('대시보드');
    expect(findNavItem('/inventory/items/12')?.label).toBe('재고 현황');
    expect(findNavItem('/inventory/moves')?.label).toBe('입출고 기록');
    expect(findNavItem('/desk/board/3')?.label).toBe('공지·인수인계');
    expect(findNavItem('/nothing')).toBeNull();
  });

  it('phase-01-task-04 범위: 메뉴 찾기는 띄어쓰기를 무시하고 권한 없는 메뉴는 빼고 찾는다', () => {
    expect(searchMenu('재고', 'staff')[0]?.path).toBe('/inventory');
    expect(searchMenu('연 차', 'staff').map((i) => i.path)).toContain('/hr/leave');
    expect(searchMenu('사용자', 'staff')).toEqual([]);
    expect(searchMenu('사용자', 'admin')[0]?.path).toBe('/admin/users');
    expect(searchMenu('   ', 'admin')).toEqual([]);
  });

  it('phase-01-task-04 범위: 휴대폰 아래쪽 탭은 홈·재고·AI·근무 4개다(+ 더보기 버튼)', () => {
    expect(BOTTOM_TABS.map((t) => t.label)).toEqual(['홈', '재고', 'AI', '근무']);
  });
});

describe('경로 표(frontend.md §3)', () => {
  /** frontend.md §3 표의 경로 칸에서 경로를 모두 뽑는다 */
  function pathsFromDoc(): string[] {
    const sec = frontendMd.split('## 3.')[1]?.split('## 4.')[0] ?? '';
    const out: string[] = [];
    for (const line of sec.split('\n')) {
      if (!line.startsWith('| `')) continue;
      const cell = line.split('|')[1] ?? '';
      for (const m of cell.matchAll(/`([^`]+)`/g)) out.push((m[1] ?? '').split('?')[0] ?? '');
    }
    return out;
  }

  it('phase-01-task-04 범위: frontend.md §3의 모든 경로가 routes.tsx에 등록돼 있다', () => {
    const registered = new Set(['/', ...AUTH_PATHS, ...SHELL_ROUTES.map((r) => r.path), ...PRINT_ROUTES.map((r) => r.path)]);
    const doc = pathsFromDoc();
    expect(doc.length).toBeGreaterThan(40);
    const missing = doc.filter((p) => !registered.has(p));
    expect(missing).toEqual([]);
  });

  it('phase-01-task-04 범위: 메뉴의 모든 항목은 등록된 경로로 간다', () => {
    const registered = new Set(['/', ...SHELL_ROUTES.map((r) => r.path)]);
    const navPaths = [HOME_ITEM, ...NAV_GROUPS.flatMap((g) => g.items)].map((i) => i.path);
    expect(navPaths.filter((p) => !registered.has(p))).toEqual([]);
  });

  it('phase-01-task-04 범위: 등록된 페이지 파일이 모두 있고 첫 줄에 "이 파일이 하는 일"이 있다', () => {
    const files = [...routesSrc.matchAll(/import\('\.\/(pages\/[^']+)'\)/g)].map((m) => m[1] as string);
    expect(files.length).toBe(SHELL_ROUTES.length + PRINT_ROUTES.length);
    for (const f of files) {
      const text = PAGE_SOURCES[`../${f}`];
      expect(text, f).toBeDefined();
      expect(text?.split('\n')[0], f).toContain('이 파일이 하는 일');
    }
  });
});

describe('로그인 후 돌아갈 주소(?next)', () => {
  it('phase-01-task-04 범위: 같은 사이트 경로만 허용하고 바깥 주소·인증 화면은 대시보드로 바꾼다', () => {
    expect(safeNext('/inventory/items/3?tab=log')).toBe('/inventory/items/3?tab=log');
    expect(safeNext(null)).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example/x')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('/login?next=/x')).toBe('/');
    expect(safeNext('/setup')).toBe('/');
    expect(loginPath('/admin/users')).toBe('/login?next=%2Fadmin%2Fusers');
    expect(loginPath('/')).toBe('/login');
  });
});

describe('연결 끊김 판단(TD-017)', () => {
  it('phase-01-task-04 AC6: 네트워크 실패가 연속 2번이면 끊김, 응답을 한 번 받으면 바로 연결됨으로 돌아간다', () => {
    const t = new ConnectionTracker();
    const seen: boolean[] = [];
    t.subscribe(() => seen.push(t.isOffline()));
    t.reportFailure();
    expect(t.isOffline()).toBe(false);
    t.reportSuccess();
    t.reportFailure();
    expect(t.isOffline()).toBe(false);
    t.reportFailure();
    expect(t.isOffline()).toBe(true);
    t.reportFailure();
    t.reportSuccess();
    expect(t.isOffline()).toBe(false);
    expect(seen).toEqual([true, false]);
  });
});

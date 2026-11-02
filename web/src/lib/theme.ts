// 이 파일이 하는 일: 밝기(테마) 3상태 "시스템 / 라이트 / 다크"를 저장하고 <html data-theme>에 반영한다(NFR-006 AC2, frontend.md §1).
// 저장은 localStorage('theme')에 하고, 저장소를 못 써도 오류 없이 넘어간다. 첫 그리기 전 반영은 web/public/theme-init.js가 한다.
import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_LABELS: Record<ThemePref, string> = { system: '시스템 설정', light: '라이트', dark: '다크' };

const KEY = 'theme';
const listeners = new Set<() => void>();

/** 저장된 값이 올바른 테마 값인지 */
export function isThemePref(v: unknown): v is ThemePref {
  return v === 'system' || v === 'light' || v === 'dark';
}

/** 저장된 테마 설정(없거나 못 읽으면 system) */
export function readTheme(): ThemePref {
  try {
    const v = window.localStorage.getItem(KEY);
    return isThemePref(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

/** 시스템이 다크 모드인지 */
function systemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 지금 실제로 보이는 밝기(light/dark) */
export function effectiveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return systemDark() ? 'dark' : 'light';
  return pref;
}

/** 테마를 정하고 저장한 뒤 화면에 반영한다 */
export function setTheme(pref: ThemePref): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, pref);
  } catch {
    // 저장하지 못해도 이번 화면에는 반영한다
  }
  applyTheme(pref);
  for (const fn of listeners) fn();
}

/** <html data-theme>에 반영한다(system이면 속성을 지워 시스템 설정을 따르게 한다) */
export function applyTheme(pref: ThemePref): void {
  const el = document.documentElement;
  if (pref === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', pref);
}

/** 상단바 밝기 버튼: 지금 보이는 밝기의 반대로 바꾼다 */
export function toggleTheme(): void {
  setTheme(effectiveTheme(readTheme()) === 'dark' ? 'light' : 'dark');
}

/** 화면에서 지금 테마 설정을 읽는다(바뀌면 다시 그린다) */
export function useTheme(): ThemePref {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      mq?.addEventListener('change', cb);
      return () => {
        listeners.delete(cb);
        mq?.removeEventListener('change', cb);
      };
    },
    readTheme,
    () => 'system',
  );
}

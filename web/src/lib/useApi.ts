// 이 파일이 하는 일: 화면이 서버 데이터를 불러와 보여 줄 때 쓰는 훅 useApi(key, fetcher) → { data, error, loading, reload } (frontend.md §5).
// 같은 key는 결과를 함께 쓰고, 저장한 뒤 invalidate(key 앞부분)를 부르면 그 key를 보고 있는 화면이 다시 불러온다.
// 모든 목록·카드는 loading이면 Skeleton, error면 ErrorState(다시 시도 = reload), 비었으면 EmptyState를 보여 준다(NFR-006 AC3).
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/** 한 key의 상태 */
export interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

interface Entry {
  state: ApiState<unknown>;
  fetcher: (() => Promise<unknown>) | null;
  stale: boolean;
  /** 늦게 끝난 옛 요청이 새 결과를 덮지 않게 요청마다 번호를 붙인다 */
  seq: number;
}

const EMPTY: ApiState<unknown> = { data: undefined, error: undefined, loading: true };
const entries = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();

function notify(key: string): void {
  for (const fn of subs.get(key) ?? []) fn();
}

function setState(key: string, patch: Partial<ApiState<unknown>>): void {
  const e = entries.get(key);
  if (!e) return;
  e.state = { ...e.state, ...patch };
  notify(key);
}

/** key의 데이터를 (다시) 불러온다 */
function load(key: string, fetcher: () => Promise<unknown>): void {
  let e = entries.get(key);
  if (!e) {
    e = { state: { ...EMPTY }, fetcher, stale: false, seq: 0 };
    entries.set(key, e);
  }
  e.fetcher = fetcher;
  e.stale = false;
  const seq = ++e.seq;
  setState(key, { loading: true, error: undefined });
  fetcher().then(
    (data) => {
      if (entries.get(key)?.seq === seq) setState(key, { data, error: undefined, loading: false });
    },
    (error: unknown) => {
      if (entries.get(key)?.seq === seq) setState(key, { error: error instanceof Error ? error : new Error(String(error)), loading: false });
    },
  );
}

/**
 * key가 prefix로 시작하는 데이터를 낡은 것으로 표시하고, 지금 보고 있는 화면이 있으면 바로 다시 불러온다.
 * 예: 품목을 저장한 뒤 invalidate('inventory') → 'inventory:list', 'inventory:item:3'이 다시 불러와진다.
 */
export function invalidate(prefix: string): void {
  for (const [key, e] of entries) {
    if (!key.startsWith(prefix)) continue;
    e.stale = true;
    if ((subs.get(key)?.size ?? 0) > 0 && e.fetcher) load(key, e.fetcher);
  }
}

/** 저장된 결과를 모두 지운다(로그아웃할 때) */
export function clearApiCache(): void {
  entries.clear();
}

/**
 * 서버 데이터를 불러온다. key가 바뀌면 새로 불러오고, 같은 key를 쓰는 다른 화면과 결과를 함께 쓴다.
 * fetcher는 매번 새 함수여도 된다(마지막 것을 쓴다). key를 null로 주면 불러오지 않는다.
 */
export function useApi<T>(key: string | null, fetcher: () => Promise<T>): ApiState<T> & { reload: () => void } {
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => {};
      let set = subs.get(key);
      if (!set) {
        set = new Set();
        subs.set(key, set);
      }
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
    [key],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (key ? (entries.get(key)?.state ?? EMPTY) : EMPTY),
    () => EMPTY,
  ) as ApiState<T>;

  useEffect(() => {
    if (!key) return;
    const e = entries.get(key);
    if (!e || e.stale || (e.state.error && !e.state.loading)) load(key, () => fetcherRef.current());
  }, [key]);

  const reload = useCallback(() => {
    if (key) load(key, () => fetcherRef.current());
  }, [key]);

  return { ...state, reload };
}

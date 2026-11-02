// 이 파일이 하는 일: 화면의 알림 상태(읽지 않은 수·목록)를 서버와 맞춘다(FR-090 AC1·AC3, backend.md §3.3).
// - createNotificationsApi: /api/notifications 요약·목록·읽음·모두 읽음을 부르는 작은 클라이언트(CSRF 토큰은 /api/session에서 받아 둔다)
// - createNotificationsStore: 30초마다(창이 보일 때만) 요약을 다시 받고, 창이 다시 활성화되면 바로 갱신한다. 새 알림이 오면 열어 둔 목록도 새로 받는다
// - useNotifications: React 화면(상단바 종 아이콘·/notifications 화면)이 쓰는 훅. 여러 곳에서 써도 폴링은 한 번만 돈다
// 시간·타이머·창 상태는 바꿔 끼울 수 있어 테스트가 30초 폴링을 직접 흉내 낸다(폴링 주기도 intervalMs로 바꿀 수 있음).
import { useEffect, useSyncExternalStore } from 'react';
import { isInternalLink, type NotificationItem, type NotificationPage, type NotificationSummary } from '../../../shared/schemas/notifications.ts';

/** 기본 폴링 주기: 30초(FR-090 AC3 "1분 안에" 보다 짧게) */
export const NOTIFICATION_POLL_MS = 30_000;
/** 종 아이콘 목록·알림 화면이 한 번에 받는 개수 */
export const NOTIFICATION_PAGE_SIZE = 20;

const LOAD_FAILED = '알림을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';

/** 알림 API 오류(화면에 보여 줄 한국어 문구와 서버 오류 코드) */
export class NotificationsApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'NotificationsApiError';
    this.status = status;
    this.code = code;
  }
}

/** 서버 알림 API를 부르는 함수 묶음 */
export interface NotificationsApi {
  summary(): Promise<NotificationSummary>;
  list(q?: { page?: number; pageSize?: number; unreadOnly?: boolean }): Promise<NotificationPage>;
  markRead(id: number): Promise<void>;
  markAllRead(): Promise<void>;
}

/** createNotificationsApi에 넣는 값 */
export interface NotificationsApiOptions {
  /** fetch 함수(기본: 브라우저 fetch) */
  fetchImpl?: typeof fetch;
  /** CSRF 토큰을 주는 함수(기본: GET /api/session의 csrfToken을 받아 기억) */
  csrfToken?: () => string | null | Promise<string | null>;
}

/** 응답이 실패면 서버의 한국어 문구로 오류를 만든다 */
async function toError(res: Response): Promise<NotificationsApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new NotificationsApiError(res.status, body.error?.code ?? 'HTTP', body.error?.message ?? LOAD_FAILED);
  } catch {
    return new NotificationsApiError(res.status, 'HTTP', LOAD_FAILED);
  }
}

/** 서버 알림 API 클라이언트를 만든다. 연결이 끊기면 "불러오지 못했어요" 오류를 던진다 */
export function createNotificationsApi(opts: NotificationsApiOptions = {}): NotificationsApi {
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  let cachedToken: string | null = null;

  /** CSRF 토큰(넣어 준 함수가 없으면 /api/session에서 받아 기억한다) */
  async function token(fresh: boolean): Promise<string | null> {
    if (opts.csrfToken) return opts.csrfToken();
    if (cachedToken && !fresh) return cachedToken;
    const res = await doFetch('/api/session', { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!res.ok) throw await toError(res);
    const body = (await res.json()) as { data?: { csrfToken?: string | null } };
    cachedToken = body.data?.csrfToken ?? null;
    return cachedToken;
  }

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await doFetch(url, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init.headers ?? {}) } });
    } catch {
      throw new NotificationsApiError(0, 'NETWORK', '서버에 연결하지 못했어요. 원내 와이파이에 연결되어 있는지 확인해 주세요.');
    }
  }

  async function getJson<T>(url: string): Promise<T> {
    const res = await call(url);
    if (!res.ok) throw await toError(res);
    return (await res.json()) as T;
  }

  /** 상태를 바꾸는 POST. 본문 없이 보낸다(빈 JSON 본문은 서버가 거부함). CSRF가 낡았으면 토큰을 새로 받아 한 번 더 보낸다 */
  async function post(url: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const t = await token(attempt > 0);
      const res = await call(url, { method: 'POST', headers: t ? { 'x-csrf-token': t } : {} });
      if (res.ok) return;
      const err = await toError(res);
      if (err.code === 'CSRF' && attempt === 0 && !opts.csrfToken) continue;
      throw err;
    }
  }

  return {
    async summary() {
      return (await getJson<{ data: NotificationSummary }>('/api/notifications/summary')).data;
    },
    async list(q = {}) {
      const p = new URLSearchParams({ page: String(q.page ?? 1), pageSize: String(q.pageSize ?? NOTIFICATION_PAGE_SIZE) });
      if (q.unreadOnly) p.set('unread', '1');
      return getJson<NotificationPage>(`/api/notifications?${p.toString()}`);
    },
    markRead: (id) => post(`/api/notifications/${encodeURIComponent(String(id))}/read`),
    markAllRead: () => post('/api/notifications/read-all'),
  };
}

/** 화면이 보는 알림 상태 */
export interface NotificationsState {
  /** 읽지 않은 알림 수(종 아이콘 배지) */
  unread: number;
  /** 가장 최근 알림 번호(새 알림이 왔는지 알아보는 데 씀) */
  latestId: number;
  /** 요약을 한 번이라도 받았는지 */
  summaryLoaded: boolean;
  /** 마지막 요약 받기가 실패했으면 그 이유 */
  summaryError: string | null;
  /** 받아 둔 목록(최근 것부터) */
  items: NotificationItem[];
  /** 조건에 맞는 전체 건수 */
  total: number;
  /** 목록 상태: 아직 안 받음·받는 중·받음·실패 */
  listStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** 목록 받기 실패 이유 */
  listError: string | null;
  /** 읽지 않은 것만 보는 중인지 */
  unreadOnly: boolean;
  /** 읽음 처리 등 동작이 실패했을 때 보여 줄 문구 */
  actionError: string | null;
}

/** 폴링이 쓰는 타이머·창 상태(테스트가 바꿔 끼운다) */
export interface PollEnv {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** 창(탭)이 지금 보이는지 */
  isVisible(): boolean;
  /** 창이 다시 보이거나 활성화되면 부를 함수를 건다. 돌려준 함수로 푼다 */
  onVisible(fn: () => void): () => void;
}

/** 브라우저 기본 PollEnv: setInterval, document.visibilityState, visibilitychange·focus 이벤트 */
export function browserPollEnv(): PollEnv {
  return {
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (h) => window.clearInterval(h as number),
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    onVisible(fn) {
      const onVis = () => {
        if (document.visibilityState !== 'hidden') fn();
      };
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('focus', fn);
      return () => {
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('focus', fn);
      };
    },
  };
}

/** createNotificationsStore에 넣는 값 */
export interface NotificationsStoreOptions {
  /** 폴링 주기(기본 30초). 테스트·E2E는 짧게 줄일 수 있다 */
  intervalMs?: number;
  /** 한 번에 받는 목록 개수 */
  pageSize?: number;
  /** 타이머·창 상태(기본: 브라우저) */
  env?: PollEnv;
}

/** 알림 상태 저장소 */
export interface NotificationsStore {
  getState(): NotificationsState;
  subscribe(listener: () => void): () => void;
  /** 폴링을 켠다(여러 번 부르면 횟수를 세고, 같은 횟수만큼 stop해야 꺼진다) */
  start(): void;
  stop(): void;
  /** 요약을 지금 다시 받는다. 새 알림이 왔고 목록을 받아 둔 상태면 목록도 새로 받는다 */
  refreshSummary(): Promise<void>;
  /** 목록 첫 쪽을 받는다(unreadOnly를 주면 그 조건으로 바꾼다) */
  loadList(opts?: { unreadOnly?: boolean }): Promise<void>;
  /** 다음 쪽을 이어 받는다 */
  loadMore(): Promise<void>;
  /** 한 건 읽음 처리(배지를 바로 줄이고 서버에 알린다) */
  markRead(id: number): Promise<void>;
  /** 모두 읽음 */
  markAllRead(): Promise<void>;
  /** 알림을 눌렀을 때: 읽지 않았으면 읽음 처리하고, 링크가 있으면 그 화면으로 이동한다 */
  open(item: NotificationItem, navigate: (to: string) => void): Promise<void>;
}

const INITIAL: NotificationsState = {
  unread: 0,
  latestId: 0,
  summaryLoaded: false,
  summaryError: null,
  items: [],
  total: 0,
  listStatus: 'idle',
  listError: null,
  unreadOnly: false,
  actionError: null,
};

/** 오류를 화면 문구로 */
function messageOf(e: unknown): string {
  return e instanceof NotificationsApiError ? e.message : LOAD_FAILED;
}

/** 알림 상태 저장소를 만든다(React와 무관해서 테스트에서 바로 쓸 수 있다) */
export function createNotificationsStore(api: NotificationsApi, opts: NotificationsStoreOptions = {}): NotificationsStore {
  const intervalMs = opts.intervalMs ?? NOTIFICATION_POLL_MS;
  const pageSize = opts.pageSize ?? NOTIFICATION_PAGE_SIZE;
  let env = opts.env ?? null;
  let state: NotificationsState = INITIAL;
  const listeners = new Set<() => void>();
  let users = 0;
  let timer: unknown = null;
  let offVisible: (() => void) | null = null;
  let listSeq = 0;
  let page = 1;

  function set(patch: Partial<NotificationsState>): void {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l();
  }

  async function refreshSummary(): Promise<void> {
    try {
      const s = await api.summary();
      const changed = state.summaryLoaded && s.latestId !== state.latestId;
      set({ unread: s.unread, latestId: s.latestId, summaryLoaded: true, summaryError: null });
      if (changed && state.listStatus === 'ready') await loadList();
    } catch (e) {
      set({ summaryError: messageOf(e) });
    }
  }

  async function loadList(o: { unreadOnly?: boolean } = {}): Promise<void> {
    const unreadOnly = o.unreadOnly ?? state.unreadOnly;
    const seq = ++listSeq;
    page = 1;
    set({ listStatus: state.listStatus === 'ready' && unreadOnly === state.unreadOnly ? 'ready' : 'loading', listError: null, unreadOnly });
    try {
      const r = await api.list({ page: 1, pageSize, unreadOnly });
      if (seq !== listSeq) return; // 그사이 더 새로운 요청이 있었다
      set({ items: r.data, total: r.total, listStatus: 'ready' });
    } catch (e) {
      if (seq !== listSeq) return;
      set({ listStatus: 'error', listError: messageOf(e) });
    }
  }

  async function loadMore(): Promise<void> {
    if (state.listStatus !== 'ready' || state.items.length >= state.total) return;
    const seq = listSeq;
    try {
      const r = await api.list({ page: page + 1, pageSize, unreadOnly: state.unreadOnly });
      if (seq !== listSeq) return;
      page += 1;
      const seen = new Set(state.items.map((n) => n.id));
      set({ items: [...state.items, ...r.data.filter((n) => !seen.has(n.id))], total: r.total });
    } catch (e) {
      set({ actionError: messageOf(e) });
    }
  }

  async function markRead(id: number): Promise<void> {
    const target = state.items.find((n) => n.id === id);
    if (target && target.readAt === null) {
      // 화면을 바로 바꾼다(배지 줄이기). 서버 응답이 실패하면 요약을 다시 받아 바로잡는다
      const now = new Date().toISOString();
      set({
        unread: Math.max(0, state.unread - 1),
        items: state.unreadOnly ? state.items.filter((n) => n.id !== id) : state.items.map((n) => (n.id === id ? { ...n, readAt: now } : n)),
        total: state.unreadOnly ? Math.max(0, state.total - 1) : state.total,
      });
    }
    try {
      await api.markRead(id);
      set({ actionError: null });
    } catch (e) {
      set({ actionError: messageOf(e) });
      if (state.listStatus === 'ready') await loadList();
    }
    await refreshSummary();
  }

  async function markAllRead(): Promise<void> {
    try {
      await api.markAllRead();
      const now = new Date().toISOString();
      set({
        unread: 0,
        actionError: null,
        items: state.unreadOnly ? [] : state.items.map((n) => (n.readAt ? n : { ...n, readAt: now })),
        total: state.unreadOnly ? 0 : state.total,
      });
    } catch (e) {
      set({ actionError: messageOf(e) });
    }
    await refreshSummary();
  }

  async function open(item: NotificationItem, navigate: (to: string) => void): Promise<void> {
    if (item.readAt === null) await markRead(item.id);
    if (isInternalLink(item.link)) navigate(item.link);
  }

  function tick(): void {
    if (env?.isVisible() !== false) void refreshSummary();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      users += 1;
      if (users > 1) return;
      env ??= browserPollEnv();
      void refreshSummary();
      timer = env.setInterval(tick, intervalMs);
      offVisible = env.onVisible(() => void refreshSummary());
    },
    stop() {
      if (users === 0) return;
      users -= 1;
      if (users > 0) return;
      if (timer !== null) env?.clearInterval(timer);
      timer = null;
      offVisible?.();
      offVisible = null;
    },
    refreshSummary,
    loadList,
    loadMore,
    markRead,
    markAllRead,
    open,
  };
}

let shared: NotificationsStore | null = null;

/** 앱 전체가 함께 쓰는 알림 저장소(상단바 종 아이콘과 알림 화면이 같은 상태를 본다) */
export function sharedNotificationsStore(): NotificationsStore {
  shared ??= createNotificationsStore(createNotificationsApi());
  return shared;
}

/**
 * React 훅: 알림 상태와 동작을 돌려준다. 화면이 떠 있는 동안 30초 폴링이 돈다.
 * 예: const n = useNotifications(); n.unread → 배지 숫자, n.store.loadList() → 목록 받기
 */
export function useNotifications(store: NotificationsStore = sharedNotificationsStore()): NotificationsState & { store: NotificationsStore } {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return { ...state, store };
}

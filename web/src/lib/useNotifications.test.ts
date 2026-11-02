// 이 파일이 하는 일: 화면 알림 저장소(30초 폴링·창 활성화 시 갱신·읽음 처리·링크 이동)와 API 클라이언트를 확인한다
// (phase-02-task-04 AC2·AC3). 가짜 서버(메모리)·가짜 타이머로 30초 폴링을 직접 돌린다. 브라우저 E2E는 앱 셸 연결 뒤에 추가한다.
import { describe, expect, test } from 'vitest';
import type { NotificationItem } from '../../../shared/schemas/notifications.ts';
import { createNotificationsApi, createNotificationsStore, NOTIFICATION_POLL_MS, type NotificationsApi, type PollEnv } from './useNotifications.ts';

/** 메모리 안의 가짜 알림 서버 */
function fakeServer() {
  const items: NotificationItem[] = [];
  let seq = 0;
  const calls: string[] = [];
  const api: NotificationsApi = {
    async summary() {
      calls.push('summary');
      return { unread: items.filter((n) => n.readAt === null).length, latestId: items.reduce((m, n) => Math.max(m, n.id), 0) };
    },
    async list(q = {}) {
      calls.push(`list:${q.page ?? 1}:${q.unreadOnly ? 'unread' : 'all'}`);
      const all = [...items].reverse().filter((n) => !q.unreadOnly || n.readAt === null);
      const size = q.pageSize ?? 20;
      const page = q.page ?? 1;
      return { data: all.slice((page - 1) * size, page * size), total: all.length };
    },
    async markRead(id) {
      calls.push(`read:${id}`);
      const n = items.find((x) => x.id === id);
      if (n && !n.readAt) n.readAt = '2026-11-02T00:10:00.000Z';
    },
    async markAllRead() {
      calls.push('readAll');
      for (const n of items) n.readAt ??= '2026-11-02T00:10:00.000Z';
    },
  };
  return {
    api,
    calls,
    add(title: string, link: string | null = null) {
      seq += 1;
      items.push({ id: seq, type: 'notice', typeLabel: '새 공지', title, body: null, link, createdAt: '2026-11-02T00:00:00.000Z', readAt: null });
      return seq;
    },
  };
}

/** 가짜 타이머·창 상태. advance(ms)로 시간을 흘려 interval을 울린다 */
function fakeEnv() {
  let now = 0;
  let visible = true;
  const intervals = new Map<number, { fn: () => void; ms: number; next: number }>();
  const visListeners = new Set<() => void>();
  let seq = 0;
  const env: PollEnv = {
    setInterval(fn, ms) {
      seq += 1;
      intervals.set(seq, { fn, ms, next: now + ms });
      return seq;
    },
    clearInterval(h) {
      intervals.delete(h as number);
    },
    isVisible: () => visible,
    onVisible(fn) {
      visListeners.add(fn);
      return () => visListeners.delete(fn);
    },
  };
  return {
    env,
    intervals,
    /** ms만큼 시간을 보내며 울릴 interval을 울린다 */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...intervals.values()].filter((t) => t.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        due.next += due.ms;
        due.fn();
        await flush();
      }
      now = end;
    },
    setVisible(v: boolean) {
      visible = v;
      if (v) for (const l of visListeners) l();
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

describe('알림 저장소(폴링)', () => {
  test('phase-02-task-04 AC3: 새 알림이 생기면 새로고침 없이 다음 폴링(30초) 안에 배지 수가 바뀐다 — 60초 안', async () => {
    const server = fakeServer();
    const t = fakeEnv();
    const store = createNotificationsStore(server.api, { env: t.env });
    store.start();
    await flush();
    expect(store.getState()).toMatchObject({ unread: 0, summaryLoaded: true });
    expect([...t.intervals.values()][0]?.ms).toBe(NOTIFICATION_POLL_MS);
    expect(NOTIFICATION_POLL_MS).toBeLessThanOrEqual(30_000);

    // 0.5초 뒤 새 알림이 생긴다 → 다음 폴링(30초)에서 배지 반영, 60초는 넘지 않는다
    await t.advance(500);
    server.add('새 공지가 올라왔어요');
    let seenAt: number | null = null;
    for (let ms = 500; ms <= 60_000; ms += 500) {
      await t.advance(500);
      if (store.getState().unread === 1) {
        seenAt = ms + 500;
        break;
      }
    }
    expect(seenAt).not.toBeNull();
    expect(seenAt as number).toBeLessThanOrEqual(60_000);
    expect(store.getState().latestId).toBe(1);
    store.stop();
    expect(t.intervals.size).toBe(0);
  });

  test('phase-02-task-04 AC3: 폴링 주기는 설정으로 바꿀 수 있고, 창이 숨겨져 있으면 건너뛰다가 다시 보이면 바로 갱신한다', async () => {
    const server = fakeServer();
    const t = fakeEnv();
    const store = createNotificationsStore(server.api, { env: t.env, intervalMs: 1000 });
    store.start();
    await flush();
    const summaries = () => server.calls.filter((c) => c === 'summary').length;
    expect(summaries()).toBe(1);
    await t.advance(1000);
    expect(summaries()).toBe(2);

    t.setVisible(false);
    server.add('숨겨진 동안 온 알림');
    await t.advance(5000);
    expect(summaries()).toBe(2);
    expect(store.getState().unread).toBe(0);

    t.setVisible(true);
    await flush();
    expect(summaries()).toBe(3);
    expect(store.getState().unread).toBe(1);
    store.stop();
  });

  test('phase-02-task-04 AC3: 여러 화면이 함께 써도 폴링은 하나만 돌고, 새 알림이 오면 열어 둔 목록도 새로 받는다', async () => {
    const server = fakeServer();
    const t = fakeEnv();
    const store = createNotificationsStore(server.api, { env: t.env });
    store.start();
    store.start();
    expect(t.intervals.size).toBe(1);
    await flush();
    await store.loadList();
    expect(store.getState().listStatus).toBe('ready');
    expect(store.getState().items).toEqual([]);

    server.add('재고 부족');
    await t.advance(NOTIFICATION_POLL_MS);
    expect(store.getState().items.map((n) => n.title)).toEqual(['재고 부족']);
    store.stop();
    expect(t.intervals.size).toBe(1);
    store.stop();
    expect(t.intervals.size).toBe(0);
  });

  test('phase-02-task-04 AC2: 알림을 누르면 읽음 처리되어 배지 수가 줄고, 링크 화면으로 이동한다', async () => {
    const server = fakeServer();
    server.add('첫 공지', '/desk/notices/1');
    server.add('둘째 공지', '/desk/notices/2');
    const t = fakeEnv();
    const store = createNotificationsStore(server.api, { env: t.env });
    store.start();
    await flush();
    await store.loadList();
    expect(store.getState().unread).toBe(2);

    const target = store.getState().items[0] as NotificationItem;
    expect(target.title).toBe('둘째 공지');
    const went: string[] = [];
    await store.open(target, (to) => went.push(to));
    expect(went).toEqual(['/desk/notices/2']);
    expect(server.calls).toContain('read:2');
    expect(store.getState().unread).toBe(1);
    expect(store.getState().items.find((n) => n.id === 2)?.readAt).not.toBeNull();

    // 이미 읽은 알림은 다시 읽음 처리하지 않고 이동만 한다
    const readCount = server.calls.filter((c) => c.startsWith('read:')).length;
    await store.open(store.getState().items[0] as NotificationItem, (to) => went.push(to));
    expect(server.calls.filter((c) => c.startsWith('read:')).length).toBe(readCount);
    expect(went).toEqual(['/desk/notices/2', '/desk/notices/2']);

    // 바깥 주소 링크는 이동하지 않는다
    await store.open({ ...target, id: 1, link: 'https://evil.example', readAt: null }, (to) => went.push(to));
    expect(went).toHaveLength(2);

    await store.markAllRead();
    expect(store.getState().unread).toBe(0);
    store.stop();
  });

  test('읽지 않음 거르기·더 보기·목록 오류 상태', async () => {
    const server = fakeServer();
    for (let i = 1; i <= 5; i += 1) server.add(`공지 ${i}`);
    const t = fakeEnv();
    const store = createNotificationsStore(server.api, { env: t.env, pageSize: 2 });
    await store.loadList();
    expect(store.getState().items.map((n) => n.id)).toEqual([5, 4]);
    await store.loadMore();
    expect(store.getState().items.map((n) => n.id)).toEqual([5, 4, 3, 2]);
    await store.markRead(5);
    await store.loadList({ unreadOnly: true });
    expect(store.getState()).toMatchObject({ unreadOnly: true, total: 4 });
    await store.markRead(4);
    expect(store.getState().items.map((n) => n.id)).toEqual([3]);

    const broken = createNotificationsStore({ ...server.api, list: async () => { throw new Error('x'); } }, { env: t.env });
    await broken.loadList();
    expect(broken.getState()).toMatchObject({ listStatus: 'error', listError: '알림을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' });
  });
});

describe('알림 API 클라이언트', () => {
  test('요약·목록 주소, POST에 CSRF 헤더(본문 없음), 오류는 서버의 한국어 문구, 끊기면 연결 안내', async () => {
    const seen: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body });
      if (url === '/api/session') return Response.json({ data: { csrfToken: 'tok1' } });
      if (url === '/api/notifications/summary') return Response.json({ data: { unread: 3, latestId: 9 } });
      if (url.startsWith('/api/notifications?')) return Response.json({ data: [], total: 0 });
      if (url === '/api/notifications/7/read') return new Response(null, { status: 204 });
      return Response.json({ error: { code: 'NOT_FOUND', message: '찾는 알림이 없어요. 이미 지워졌을 수 있어요.' } }, { status: 404 });
    }) as typeof fetch;
    const api = createNotificationsApi({ fetchImpl });
    expect(await api.summary()).toEqual({ unread: 3, latestId: 9 });
    await api.list({ page: 2, pageSize: 10, unreadOnly: true });
    expect(seen.at(-1)?.url).toBe('/api/notifications?page=2&pageSize=10&unread=1');
    await api.markRead(7);
    const post = seen.at(-1);
    expect(post).toMatchObject({ url: '/api/notifications/7/read', method: 'POST', body: undefined });
    expect(post?.headers['x-csrf-token']).toBe('tok1');
    expect(post?.headers['content-type']).toBeUndefined();
    await expect(api.markRead(8)).rejects.toThrow('찾는 알림이 없어요. 이미 지워졌을 수 있어요.');

    const offline = createNotificationsApi({ fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch });
    await expect(offline.summary()).rejects.toThrow('원내 와이파이에 연결되어 있는지 확인해 주세요');
  });

  test('CSRF 토큰이 낡았으면 새로 받아 한 번 더 보낸다', async () => {
    let tokenNo = 0;
    const posts: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/session') {
        tokenNo += 1;
        return Response.json({ data: { csrfToken: `tok${tokenNo}` } });
      }
      const t = (init?.headers as Record<string, string>)['x-csrf-token'] ?? '';
      posts.push(t);
      if (t === 'tok1') return Response.json({ error: { code: 'CSRF', message: '보안 확인에 실패했습니다. 화면을 새로 고쳐 주세요.' } }, { status: 403 });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await createNotificationsApi({ fetchImpl }).markAllRead();
    expect(posts).toEqual(['tok1', 'tok2']);
  });
});

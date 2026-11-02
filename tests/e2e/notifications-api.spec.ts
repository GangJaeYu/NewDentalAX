// 이 파일이 하는 일: 실제로 띄운 테스트 서버(scripts/e2e-server.ts)에 HTTP로 알림 API 흐름을 보내 확인한다(phase-02-task-04 AC1~AC4, FR-090).
// 다른 E2E(auth-api.spec)가 admin을 잠그므로, 이 파일은 테스트 서버의 데이터 폴더(.tmp/e2e/run-*)의 app.db에 직접 별도 계정·세션을 만들고
// 알림은 업무 모듈이 하듯 notify.emit으로 만든다(아직 알림을 만드는 화면·API가 없음). 화면(종 아이콘) E2E는 앱 셸 연결 뒤에 추가한다.
// AC3(60초 안 배지 반영)은 화면 대신 "새 알림 뒤 요약 API가 60초 안에 바뀌는지"를 화면과 같은 30초 간격 폴링으로 확인한다.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { appDbPath, openDb, type Db } from '../../server/db/index.ts';
import { fixedClock, type Clock } from '../../server/lib/clock.ts';
import { createSession } from '../../server/auth/sessions.ts';
import { emitNotification } from '../../server/modules/notifications/emit.ts';
import type { NotificationPage, NotificationSummary } from '../../shared/schemas/notifications.ts';

/** 테스트 서버가 쓰는 데이터 폴더(.tmp/e2e 아래 server.pid가 있는 가장 최근 run-* 폴더) */
function serverDataDir(): string {
  const base = path.join(process.cwd(), '.tmp', 'e2e');
  const runs = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('run-') && fs.existsSync(path.join(base, d.name, 'server.pid')))
    .map((d) => path.join(base, d.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const dir = runs[0];
  if (!dir) throw new Error('테스트 서버의 데이터 폴더를 찾지 못했어요(.tmp/e2e/run-*)');
  return dir;
}

interface Who {
  userId: number;
  headers: Record<string, string>;
  writeHeaders: Record<string, string>;
}

let db: Db;
let clock: Clock;
const suffix = String(Date.now()).slice(-6);

/** 테스트 서버 DB에 계정과 세션을 만든다(로그인 API·잠금과 무관) */
function makeUser(role: 'admin' | 'manager' | 'staff', tag: string): Who {
  const now = clock.now().toISOString();
  const r = db.run(
    "INSERT INTO users (username, name, role, job_type, password_hash, must_change_pw, active, created_at, updated_at) VALUES (?, ?, ?, 'other', 'scrypt$x', 0, 1, ?, ?)",
    [`ntf${tag}${suffix}`, `알림 ${tag}`, role, now, now],
  );
  const s = createSession(db, clock, r.lastInsertRowid, '127.0.0.1');
  const cookie = `sid=${s.token}`;
  return { userId: r.lastInsertRowid, headers: { cookie }, writeHeaders: { cookie, 'x-csrf-token': s.csrfToken } };
}

async function summary(request: APIRequestContext, who: Who): Promise<NotificationSummary> {
  const res = await request.get('/api/notifications/summary', { headers: who.headers });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: NotificationSummary }).data;
}

async function list(request: APIRequestContext, who: Who): Promise<NotificationPage> {
  const res = await request.get('/api/notifications', { headers: who.headers });
  expect(res.status()).toBe(200);
  return (await res.json()) as NotificationPage;
}

test.describe.serial('알림 API 흐름(실제 서버)', () => {
  let manager: Who;
  let staff: Who;

  test.beforeAll(async ({ request }) => {
    const health = await request.get('/api/health');
    const body = (await health.json()) as { ok: boolean; now: string };
    expect(body.ok).toBe(true);
    clock = fixedClock(body.now); // 서버와 같은 고정 시각(TEST_NOW)으로 세션을 만든다
    db = openDb(appDbPath(serverDataDir()));
    manager = makeUser('manager', 'm');
    staff = makeUser('staff', 's');
  });

  test.afterAll(() => {
    db?.close();
  });

  test('phase-02-task-04 AC1·AC4: 같은 dedupe_key로 두 번 만들어도 1건이고, manager 전용 알림은 staff에게 가지 않는다', async ({ request }) => {
    const input = { type: 'stock_low', title: '거즈 재고가 부족해요', link: '/inventory/items/1', dedupeKey: `e2e:item:1:${suffix}` };
    emitNotification(db, input, clock);
    emitNotification(db, input, clock);
    const mine = (await list(request, manager)).data.filter((n) => n.title === input.title);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: 'stock_low', typeLabel: '재고 부족', link: '/inventory/items/1', readAt: null });
    expect(await summary(request, staff)).toEqual({ unread: 0, latestId: 0 });
    expect((await list(request, staff)).total).toBe(0);
  });

  test('phase-02-task-04 AC3: 새 알림이 생기면 새로고침 없이 60초 안에 요약(배지 수)에 반영된다', async ({ request }) => {
    const before = await summary(request, staff);
    const created = Date.now();
    emitNotification(db, { type: 'notice', title: '새 공지가 올라왔어요', link: '/desk/notices/1', dedupeKey: `e2e:notice:1:${suffix}` }, clock);
    // 화면 종 아이콘과 같은 방식: 요약을 다시 불러 바뀌었는지 본다(최대 60초)
    await expect
      .poll(async () => (await summary(request, staff)).unread, { timeout: 60_000, intervals: [500, 1000, 30_000] })
      .toBe(before.unread + 1);
    expect(Date.now() - created).toBeLessThan(60_000);
    expect((await summary(request, staff)).latestId).toBeGreaterThan(before.latestId);
  });

  test('phase-02-task-04 AC2: 알림을 읽음 처리하면 링크가 있고 배지 수가 줄어든다(CSRF 없으면 거부)', async ({ request }) => {
    const before = await summary(request, staff);
    expect(before.unread).toBeGreaterThan(0);
    const item = (await list(request, staff)).data.find((n) => n.readAt === null);
    expect(item?.link).toBe('/desk/notices/1');

    const noCsrf = await request.post(`/api/notifications/${item?.id}/read`, { headers: staff.headers });
    expect(noCsrf.status()).toBe(403);

    const res = await request.post(`/api/notifications/${item?.id}/read`, { headers: staff.writeHeaders });
    expect(res.status()).toBe(204);
    expect((await summary(request, staff)).unread).toBe(before.unread - 1);

    // 다른 사람(staff)은 manager 알림을 읽음 처리할 수 없다
    const mgrItem = (await list(request, manager)).data[0];
    const other = await request.post(`/api/notifications/${mgrItem?.id}/read`, { headers: staff.writeHeaders });
    expect(other.status()).toBe(404);

    const all = await request.post('/api/notifications/read-all', { headers: manager.writeHeaders });
    expect(all.status()).toBe(204);
    expect((await summary(request, manager)).unread).toBe(0);
  });
});

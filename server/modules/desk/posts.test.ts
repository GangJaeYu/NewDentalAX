// 이 파일이 하는 일: 공지·인수인계 API(posts.ts, FR-040)를 실제 라우트와 DB로 확인한다(phase-03-task-04 AC1·AC2·AC3).
// 공지 작성 권한(staff 403, 인수인계는 가능), 읽음 기록과 읽은/안 읽은 사람 목록, 새 공지 알림, 고치기·지우기 권한, 처리 완료, 데모 seed를 본다.
// 요청은 fastify.inject로 보내고, 시간은 manualClock으로 움직인다. 데이터는 작업 사본 안 .tmp/unit/ 임시 폴더만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock, MINUTE_MS } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import type { PostDetail, PostListItem } from '../../../shared/schemas/desk.ts';
import { DEMO_HANDOVERS, DEMO_NOTICES, seedDemo, tables } from './seed.ts';

const START = '2026-11-02T09:00:00+09:00';

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

async function makeApp() {
  tmp = makeTmpDir('dentalax-posts-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return { app, clock };
}

function people(a: FastifyInstance) {
  return { admin: loginAs(a, 'admin'), manager: loginAs(a, 'manager'), staff: loginAs(a, 'staff'), staff2: loginAs(a, 'staff') };
}

async function create(a: FastifyInstance, who: TestLogin, body: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: '/api/posts', headers: who.writeHeaders, payload: body });
}

async function open(a: FastifyInstance, who: TestLogin, id: number): Promise<PostDetail> {
  const res = await a.inject({ method: 'GET', url: `/api/posts/${id}`, headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: PostDetail }>().data;
}

async function list(a: FastifyInstance, who: TestLogin, query = ''): Promise<{ data: PostListItem[]; total: number }> {
  const res = await a.inject({ method: 'GET', url: `/api/posts${query}`, headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: PostListItem[]; total: number }>();
}

describe('공지·인수인계 작성 권한', () => {
  test('phase-03-task-04 AC1: staff가 공지를 쓰면 403 FORBIDDEN이고, 인수인계는 쓸 수 있다', async () => {
    const { app: a } = await makeApp();
    const p = people(a);
    const denied = await create(a, p.staff, { kind: 'notice', category: '일반', title: '직원이 쓴 공지', body: '내용' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('FORBIDDEN');
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM posts WHERE kind = 'notice'")?.n).toBe(0);

    const ok = await create(a, p.staff, { kind: 'handover', category: '재고', title: '거즈 박스 2개 남음', body: '내일 발주 확인 부탁드려요.' });
    expect(ok.statusCode).toBe(201);
    const post = ok.json<{ data: PostDetail }>().data;
    expect(post).toMatchObject({ kind: 'handover', category: '재고', title: '거즈 박스 2개 남음', author: { id: p.staff.userId }, resolvedAt: null, canEdit: true });
    // 각 글에는 분류·작성자·시각이 붙는다(FR-040 AC1)
    expect(post.createdAt).toBe(new Date(START).toISOString());

    // manager는 공지를 쓰고 고정할 수 있다
    const notice = await create(a, p.manager, { kind: 'notice', category: '감염관리', title: '감염관리 교육', body: '목요일 점심', pinned: true });
    expect(notice.statusCode).toBe(201);
    expect(notice.json<{ data: PostDetail }>().data.pinned).toBe(true);
    // 인수인계는 고정할 수 없다
    const pinHandover = await create(a, p.manager, { kind: 'handover', title: '고정 시도', pinned: true });
    expect(pinHandover.statusCode).toBe(400);
    expect(pinHandover.json().error.fields.pinned).toMatch(/공지에만/);
    // staff는 공지 고정도 못 바꾼다
    const nid = notice.json<{ data: PostDetail }>().data.id;
    const pinByStaff = await a.inject({ method: 'PATCH', url: `/api/posts/${nid}`, headers: p.staff.writeHeaders, payload: { pinned: false } });
    expect(pinByStaff.statusCode).toBe(403);
    // 감사 기록이 남는다
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('notice.create', 'handover.create')")?.n).toBe(2);
  });

  test('phase-03-task-04: 분류를 빼고 보내도(회의록 할 일 보내기 등) 기본 분류로 저장된다', async () => {
    const { app: a } = await makeApp();
    const p = people(a);
    const r = await create(a, p.staff, { kind: 'handover', title: '회의록 할 일: 소독제 주문', body: '담당: 정하늘' });
    expect(r.statusCode).toBe(201);
    expect(r.json<{ data: PostDetail }>().data.category).toBe('기타');
    const bad = await create(a, p.staff, { kind: 'memo', title: '' });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().error.fields)).toEqual(expect.arrayContaining(['kind', 'title']));
  });

  test('phase-03-task-04: 다른 사람 글은 작성자 또는 manager 이상만 고치고 지운다', async () => {
    const { app: a } = await makeApp();
    const p = people(a);
    const id = (await create(a, p.staff, { kind: 'handover', title: '원래 제목' })).json<{ data: PostDetail }>().data.id;
    const byOther = await a.inject({ method: 'PATCH', url: `/api/posts/${id}`, headers: p.staff2.writeHeaders, payload: { title: '남이 고침' } });
    expect(byOther.statusCode).toBe(403);
    expect((await open(a, p.staff2, id)).canEdit).toBe(false);
    const byMe = await a.inject({ method: 'PATCH', url: `/api/posts/${id}`, headers: p.staff.writeHeaders, payload: { title: '내가 고침' } });
    expect(byMe.statusCode).toBe(200);
    expect(byMe.json<{ data: PostDetail }>().data.title).toBe('내가 고침');
    const delOther = await a.inject({ method: 'DELETE', url: `/api/posts/${id}`, headers: p.staff2.writeHeaders });
    expect(delOther.statusCode).toBe(403);
    const delManager = await a.inject({ method: 'DELETE', url: `/api/posts/${id}`, headers: p.manager.writeHeaders });
    expect(delManager.statusCode).toBe(204);
    expect((await a.inject({ method: 'GET', url: `/api/posts/${id}`, headers: p.staff.headers })).statusCode).toBe(404);
    expect((await list(a, p.staff)).total).toBe(0);
  });
});

describe('읽음 기록', () => {
  test('phase-03-task-04 AC2: staff가 공지를 열면 manager가 보는 읽음 수가 1 늘고 안 읽은 사람 목록에서 빠진다', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    const id = (await create(a, p.manager, { kind: 'notice', title: '11월 회식 안내', body: '금요일 저녁' })).json<{ data: PostDetail }>().data.id;

    const before = await open(a, p.manager, id);
    expect(before.totalUsers).toBe(4);
    expect(before.readCount).toBe(1); // 작성자는 읽은 것으로 시작
    expect(before.unreadUsers?.map((u) => u.id)).toEqual(expect.arrayContaining([p.staff.userId, p.staff2.userId, p.admin.userId]));
    expect((await list(a, p.staff, '?kind=notice')).data[0]?.readByMe).toBe(false);

    clock.advance(5 * MINUTE_MS);
    const seen = await open(a, p.staff, id);
    expect(seen.readByMe).toBe(true);
    // staff(작성자 아님)에게는 읽은 사람 목록을 주지 않는다
    expect(seen.readers).toBeUndefined();
    expect(seen.unreadUsers).toBeUndefined();

    const after = await open(a, p.manager, id);
    expect(after.readCount).toBe(before.readCount + 1);
    expect(after.unreadUsers?.map((u) => u.id)).not.toContain(p.staff.userId);
    expect(after.unreadUsers?.map((u) => u.id)).toContain(p.staff2.userId);
    expect(after.readers?.find((r) => r.id === p.staff.userId)?.readAt).toBe(clock.now().toISOString());
    // 목록에도 같은 읽음 수가 나온다
    expect((await list(a, p.manager, '?kind=notice')).data[0]?.readCount).toBe(2);
    // 다시 열어도 두 번 세지 않는다
    await open(a, p.staff, id);
    expect((await open(a, p.manager, id)).readCount).toBe(2);
  });

  test('phase-03-task-04 AC2: 사용 중지한 계정은 전체 수와 안 읽은 사람에서 빠진다', async () => {
    const { app: a } = await makeApp();
    const p = people(a);
    const id = (await create(a, p.manager, { kind: 'notice', title: '안내' })).json<{ data: PostDetail }>().data.id;
    a.db.run('UPDATE users SET active = 0 WHERE id = ?', [p.staff2.userId]);
    const d = await open(a, p.manager, id);
    expect(d.totalUsers).toBe(3);
    expect(d.unreadUsers?.map((u) => u.id)).not.toContain(p.staff2.userId);
  });
});

describe('새 공지 알림', () => {
  test('phase-03-task-04 AC3: 새 공지를 올리면 사용 중인 전 직원에게 공지 알림이 생긴다', async () => {
    const { app: a } = await makeApp();
    const p = people(a);
    const off = loginAs(a, 'staff');
    a.db.run('UPDATE users SET active = 0 WHERE id = ?', [off.userId]);
    const r = await create(a, p.manager, { kind: 'notice', title: '감염관리 교육', body: '목요일 13:10' });
    const id = r.json<{ data: PostDetail }>().data.id;
    const rows = a.db.all<{ user_id: number; type: string; title: string; link: string }>("SELECT user_id, type, title, link FROM notifications WHERE type = 'notice' ORDER BY user_id");
    expect(rows.map((n) => n.user_id).sort((x, y) => x - y)).toEqual([p.admin.userId, p.manager.userId, p.staff.userId, p.staff2.userId].sort((x, y) => x - y));
    expect(rows.every((n) => n.title === '새 공지: 감염관리 교육' && n.link === `/desk/board/${id}`)).toBe(true);
    // staff의 알림센터에서도 보인다
    const mine = await a.inject({ method: 'GET', url: '/api/notifications', headers: p.staff.headers });
    expect(mine.json().data[0]).toMatchObject({ type: 'notice', typeLabel: '새 공지', link: `/desk/board/${id}` });
    // 인수인계는 알림을 만들지 않는다
    await create(a, p.staff, { kind: 'handover', title: '전달 사항' });
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications')?.n).toBe(4);
  });
});

describe('인수인계 처리 완료와 목록', () => {
  test('phase-03-task-04: 인수인계를 처리 완료하면 처리 전 목록(unresolved=1)에서 빠지고, 다시 되돌릴 수 있다', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    const h1 = (await create(a, p.staff, { kind: 'handover', title: '첫째' })).json<{ data: PostDetail }>().data.id;
    clock.advance(MINUTE_MS);
    await create(a, p.staff, { kind: 'handover', title: '둘째' });
    await create(a, p.manager, { kind: 'notice', title: '공지' });
    expect((await list(a, p.staff, '?unresolved=1')).total).toBe(2);
    const done = await a.inject({ method: 'POST', url: `/api/posts/${h1}/resolve`, headers: p.staff2.writeHeaders, payload: {} });
    expect(done.statusCode).toBe(200);
    expect(done.json<{ data: PostDetail }>().data).toMatchObject({ resolvedBy: { id: p.staff2.userId }, resolvedAt: clock.now().toISOString() });
    const open1 = await list(a, p.staff, '?unresolved=1');
    expect(open1.data.map((x) => x.title)).toEqual(['둘째']);
    const undo = await a.inject({ method: 'POST', url: `/api/posts/${h1}/resolve`, headers: p.staff.writeHeaders, payload: { resolved: false } });
    expect(undo.json<{ data: PostDetail }>().data.resolvedAt).toBeNull();
    // 공지는 처리 완료 표시를 쓸 수 없다
    const nid = (await list(a, p.staff, '?kind=notice')).data[0]?.id;
    const bad = await a.inject({ method: 'POST', url: `/api/posts/${nid}/resolve`, headers: p.manager.writeHeaders, payload: {} });
    expect(bad.statusCode).toBe(400);
  });

  test('phase-03-task-04: 목록은 고정 공지가 먼저이고, 검색어로 찾을 수 있다', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    await create(a, p.manager, { kind: 'notice', title: '고정된 옛 공지', pinned: true });
    clock.advance(MINUTE_MS);
    await create(a, p.manager, { kind: 'notice', title: '새 공지 100%', body: '주차 안내' });
    const l = await list(a, p.staff, '?kind=notice');
    expect(l.data.map((x) => x.title)).toEqual(['고정된 옛 공지', '새 공지 100%']);
    expect((await list(a, p.staff, '?q=주차')).data.map((x) => x.title)).toEqual(['새 공지 100%']);
    expect((await list(a, p.staff, `?q=${encodeURIComponent('100%')}`)).total).toBe(1);
    expect((await list(a, p.staff, `?q=${encodeURIComponent('_')}`)).total).toBe(0);
    const anon = await a.inject({ method: 'GET', url: '/api/posts' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('데모 데이터', () => {
  test('phase-03-task-04: 데모 seed는 공지 6개·인수인계·체크리스트를 넣고, 두 번 불러도 늘지 않는다', async () => {
    const { app: a, clock } = await makeApp();
    people(a);
    seedDemo(a.db, { clock, scale: 1 });
    seedDemo(a.db, { clock, scale: 1 });
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM posts WHERE kind = 'notice'")?.n).toBe(DEMO_NOTICES.length);
    expect(DEMO_NOTICES.length).toBe(6);
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM posts WHERE kind = 'handover'")?.n).toBe(DEMO_HANDOVERS.length);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM checklist_items')?.n).toBe(14);
    // 오늘 체크 기록은 없다(오늘은 새로 시작)
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM checklist_checks WHERE date = '2026-11-02'")?.n).toBe(0);
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM checklist_checks WHERE date = '2026-11-01'")?.n).toBeGreaterThan(0);
    for (const t of tables) expect(a.db.get('SELECT 1 AS x FROM sqlite_master WHERE name = ?', [t]), t).toBeDefined();
  });
});

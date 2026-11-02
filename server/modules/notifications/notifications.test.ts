// 이 파일이 하는 일: 알림 만들기(notify.emit)·받는 사람 규칙·알림 API(요약·목록·읽음·모두 읽음)를 실제 라우트와 DB로 확인한다
// (phase-02-task-04 AC1·AC2·AC4, FR-090). 요청은 fastify.inject로 보내고, 시간은 manualClock으로 움직인다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock, MINUTE_MS } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { emitNotification, notify, resolveRecipients } from './emit.ts';
import type { NotificationItem, NotificationPage, NotificationSummary } from '../../../shared/schemas/notifications.ts';

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
  tmp = makeTmpDir('dentalax-notif-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return { app, clock };
}

/** 원장(admin)·실장(manager)·직원(staff) 한 명씩 */
function people(a: FastifyInstance) {
  return { admin: loginAs(a, 'admin'), manager: loginAs(a, 'manager'), staff: loginAs(a, 'staff') };
}

async function summary(a: FastifyInstance, who: TestLogin): Promise<NotificationSummary> {
  const res = await a.inject({ method: 'GET', url: '/api/notifications/summary', headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: NotificationSummary }>().data;
}

async function list(a: FastifyInstance, who: TestLogin, query = ''): Promise<NotificationPage> {
  const res = await a.inject({ method: 'GET', url: `/api/notifications${query}`, headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<NotificationPage>();
}

function count(a: FastifyInstance, where = '1 = 1', params: (string | number)[] = []): number {
  return a.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE ${where}`, params)?.n ?? 0;
}

describe('notify.emit 중복 방지', () => {
  test('phase-02-task-04 AC1: 같은 dedupe_key로 두 번 emit해도 알림은 받는 사람마다 1건이다', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    const input = { type: 'stock_low', title: '거즈 재고가 부족해요', link: '/inventory/items/3', dedupeKey: 'item:3:2026-11-02' };
    expect(notify.emit(a.db, input, clock)).toBe(2); // manager·admin
    clock.advance(10 * MINUTE_MS);
    expect(notify.emit(a.db, input, clock)).toBe(0);
    expect(count(a, 'dedupe_key = ?', ['item:3:2026-11-02'])).toBe(2);
    expect(count(a, 'user_id = ?', [p.manager.userId])).toBe(1);
    expect((await list(a, p.manager)).total).toBe(1);
    // 다른 키(다음 날)는 새로 들어간다
    expect(notify.emit(a.db, { ...input, dedupeKey: 'item:3:2026-11-03' }, clock)).toBe(2);
    // 키가 없는 알림은 매번 새로 들어간다
    expect(notify.emit(a.db, { type: 'notice', title: '공지' }, clock)).toBe(3);
    expect(notify.emit(a.db, { type: 'notice', title: '공지' }, clock)).toBe(3);
  });

  test('phase-02-task-04 AC1: 기존 호출 방식(role·userIds 직접 지정)도 그대로 동작한다', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    expect(emitNotification(a.db, { role: 'admin', type: 'ai_budget', title: 'AI 예산 80%', link: '/admin/ai-usage', dedupeKey: 'budget80:2026-11' }, clock)).toBe(1);
    expect(emitNotification(a.db, { role: 'admin', type: 'ai_budget', title: 'AI 예산 80%', link: '/admin/ai-usage', dedupeKey: 'budget80:2026-11' }, clock)).toBe(0);
    expect(emitNotification(a.db, { userIds: [p.staff.userId], type: 'leave_result', title: '연차가 승인됐어요' }, clock)).toBe(1);
    expect(emitNotification(a.db, { userIds: [], type: 'leave_result', title: '받는 사람 없음' }, clock)).toBe(0);
  });

  test('링크는 서비스 안 주소만 받는다', async () => {
    const { app: a, clock } = await makeApp();
    people(a);
    for (const link of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '/\\evil']) {
      expect(() => emitNotification(a.db, { type: 'notice', title: 't', link }, clock), link).toThrow(/서비스 안 주소/);
    }
    expect(count(a)).toBe(0);
  });
});

describe('받는 사람 규칙', () => {
  test('phase-02-task-04 AC4: staff에게는 manager 전용 알림이 가지 않는다(기본 규칙·직접 지정 모두)', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    for (const type of ['stock_low', 'stock_expiry', 'order', 'leave_requested', 'sterilizer_fail', 'legal_due', 'equipment_due']) {
      emitNotification(a.db, { type, title: `${type} 알림`, dedupeKey: `${type}:1` }, clock);
      // 실수로 staff를 직접 넣어도 빠진다
      emitNotification(a.db, { type, title: `${type} 직접`, userIds: [p.staff.userId, p.manager.userId], dedupeKey: `${type}:2` }, clock);
      emitNotification(a.db, { type, title: `${type} 역할`, role: 'staff', dedupeKey: `${type}:3` }, clock);
    }
    expect(count(a, 'user_id = ?', [p.staff.userId])).toBe(0);
    expect(await summary(a, p.staff)).toEqual({ unread: 0, latestId: 0 });
    expect((await summary(a, p.manager)).unread).toBe(21);
    expect((await summary(a, p.admin)).unread).toBe(14); // admin은 직접 지정(:2)에서 빠짐
    // AI 예산은 admin만
    emitNotification(a.db, { type: 'ai_budget', title: '예산', role: 'manager' }, clock);
    expect(count(a, "type = 'ai_budget'")).toBe(1);
    expect(count(a, "type = 'ai_budget' AND user_id = ?", [p.admin.userId])).toBe(1);
  });

  test('phase-02-task-04 AC4: 공지는 전원, 연차 결과는 신청자만, 교육은 해당 직원과 manager 이상, 꺼진 계정은 받지 않는다', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    const other = loginAs(a, 'staff');
    const off = loginAs(a, 'staff');
    a.db.run('UPDATE users SET active = 0 WHERE id = ?', [off.userId]);

    expect(resolveRecipients(a.db, { type: 'notice' })).toEqual([p.admin.userId, p.manager.userId, p.staff.userId, other.userId]);
    expect(resolveRecipients(a.db, { type: 'leave_result' })).toEqual([]);
    expect(resolveRecipients(a.db, { type: 'leave_result', userIds: [p.staff.userId, off.userId, 99999] })).toEqual([p.staff.userId]);
    expect(resolveRecipients(a.db, { type: 'training_due', userIds: [other.userId], role: 'manager' })).toEqual([p.admin.userId, p.manager.userId, other.userId]);
    emitNotification(a.db, { type: 'leave_result', title: '연차 승인', userIds: [p.staff.userId] }, clock);
    expect((await summary(a, p.staff)).unread).toBe(1);
    expect((await summary(a, other)).unread).toBe(0);
  });

  test('phase-02-task-04 AC4: 목록 API는 내 알림만 돌려준다', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    emitNotification(a.db, { type: 'stock_low', title: '재고 부족', dedupeKey: 's1' }, clock);
    emitNotification(a.db, { type: 'notice', title: '새 공지', link: '/desk/notices/1', dedupeKey: 'n1' }, clock);
    const staffList = await list(a, p.staff);
    expect(staffList.total).toBe(1);
    expect(staffList.data.map((n) => n.type)).toEqual(['notice']);
    const mgr = await list(a, p.manager);
    expect(mgr.data.map((n) => n.title)).toEqual(['새 공지', '재고 부족']);
  });
});

describe('알림 API', () => {
  test('phase-02-task-04 AC2: 알림을 읽음 처리하면 링크가 그대로 있고 읽지 않은 수(배지)가 줄어든다', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    emitNotification(a.db, { type: 'notice', title: '첫 공지', link: '/desk/notices/1', dedupeKey: 'n1' }, clock);
    clock.advance(MINUTE_MS);
    emitNotification(a.db, { type: 'notice', title: '둘째 공지', link: '/desk/notices/2', dedupeKey: 'n2' }, clock);

    const before = await summary(a, p.staff);
    expect(before.unread).toBe(2);
    const page = await list(a, p.staff);
    const first = page.data[0] as NotificationItem;
    expect(first).toMatchObject({ title: '둘째 공지', link: '/desk/notices/2', typeLabel: '새 공지', readAt: null, type: 'notice' });
    expect(first.id).toBe(before.latestId);

    const noCsrf = await a.inject({ method: 'POST', url: `/api/notifications/${first.id}/read`, headers: p.staff.headers });
    expect(noCsrf.statusCode).toBe(403);

    clock.advance(MINUTE_MS);
    const read = await a.inject({ method: 'POST', url: `/api/notifications/${first.id}/read`, headers: p.staff.writeHeaders });
    expect(read.statusCode).toBe(204);
    expect(await summary(a, p.staff)).toEqual({ unread: 1, latestId: before.latestId });
    const after = await list(a, p.staff);
    expect(after.data[0]?.readAt).toBe(clock.now().toISOString());
    // 다시 읽어도 그대로(읽은 시각 유지)
    clock.advance(MINUTE_MS);
    expect((await a.inject({ method: 'POST', url: `/api/notifications/${first.id}/read`, headers: p.staff.writeHeaders })).statusCode).toBe(204);
    expect((await list(a, p.staff)).data[0]?.readAt).toBe(after.data[0]?.readAt);
    // 다른 사람(manager)의 배지는 그대로
    expect((await summary(a, p.manager)).unread).toBe(2);
    // 읽지 않은 것만
    const unreadOnly = await list(a, p.staff, '?unread=1');
    expect(unreadOnly.total).toBe(1);
    expect(unreadOnly.data[0]?.title).toBe('첫 공지');
  });

  test('phase-02-task-04 AC2: 다른 사람 알림·없는 번호는 404, 잘못된 번호는 400, 모두 읽음은 내 것만 0으로 만든다', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    emitNotification(a.db, { type: 'notice', title: '공지', dedupeKey: 'n1' }, clock);
    const managerItem = (await list(a, p.manager)).data[0] as NotificationItem;

    const others = await a.inject({ method: 'POST', url: `/api/notifications/${managerItem.id}/read`, headers: p.staff.writeHeaders });
    expect(others.statusCode).toBe(404);
    expect(others.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect((await summary(a, p.manager)).unread).toBe(1);
    expect((await a.inject({ method: 'POST', url: '/api/notifications/99999/read', headers: p.staff.writeHeaders })).statusCode).toBe(404);
    const bad = await a.inject({ method: 'POST', url: '/api/notifications/abc/read', headers: p.staff.writeHeaders });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'VALIDATION' } });

    const all = await a.inject({ method: 'POST', url: '/api/notifications/read-all', headers: p.staff.writeHeaders });
    expect(all.statusCode).toBe(204);
    expect((await summary(a, p.staff)).unread).toBe(0);
    expect((await summary(a, p.manager)).unread).toBe(1);
  });

  test('목록은 쪽을 나누고, 로그인하지 않으면 401, 잘못된 쪽 크기는 400이다', async () => {
    const { app: a, clock } = await makeApp();
    const p = people(a);
    for (let i = 1; i <= 5; i += 1) emitNotification(a.db, { type: 'notice', title: `공지 ${i}`, dedupeKey: `n${i}` }, clock);
    const page2 = await list(a, p.staff, '?page=2&pageSize=2');
    expect(page2.total).toBe(5);
    expect(page2.data.map((n) => n.title)).toEqual(['공지 3', '공지 2']);
    expect((await a.inject({ method: 'GET', url: '/api/notifications/summary' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'GET', url: '/api/notifications' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'GET', url: '/api/notifications?pageSize=500', headers: p.staff.headers })).statusCode).toBe(400);
    const res = await a.inject({ method: 'GET', url: '/api/notifications/summary', headers: p.staff.headers });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// 이 파일이 하는 일: 예약 작업 시계(scheduler)와 기한형 알림 작업(notify-job)을 확인한다(backend.md §6, phase-02-task-04 범위·AC1).
// 시작할 때 한 번·매시 정각에 도는지, 일찍 울린 타이머는 다시 기다리는지, 작업 실패가 다른 작업을 막지 않는지,
// 만료 세션 정리, scanner 등록·중복 방지(dedupe)를 가짜 타이머와 manualClock으로 확인한다.
import fs from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { openDb, type Db } from '../db/index.ts';
import { migrate } from '../db/migrate.ts';
import { HOUR_MS, manualClock, MINUTE_MS } from '../lib/clock.ts';
import { createSession, SESSION_IDLE_MS } from '../auth/sessions.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';
import { defaultJobs, msUntilNextHour, startScheduler, type ScheduledJob, type TimerApi } from './scheduler.ts';
import { listNotifyScanners, notifyScanJob, registerNotifyScanner, runNotifyScan, type NotifyScanner } from './notify-job.ts';

let db: Db | null = null;
let tmp: string | null = null;
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  db?.close();
  db = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

function makeDb(): Db {
  tmp = makeTmpDir('dentalax-jobs-');
  db = openDb(`${tmp}/app.db`);
  migrate(db, { clock: manualClock('2026-11-02T09:00:00+09:00') });
  return db;
}

/** 걸린 타이머를 기록하고, 테스트가 직접 울리게 하는 가짜 타이머 */
function fakeTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let seq = 0;
  const api: TimerApi = {
    setTimeout(fn, ms) {
      seq += 1;
      pending.set(seq, { fn, ms });
      return seq;
    },
    clearTimeout(h) {
      pending.delete(h as number);
    },
  };
  return {
    api,
    pending,
    /** 가장 최근 타이머의 대기 시간 */
    lastMs: () => [...pending.values()].at(-1)?.ms ?? null,
    /** 걸린 타이머를 모두 울린다 */
    fire() {
      const list = [...pending.values()];
      pending.clear();
      for (const t of list) t.fn();
    },
  };
}

/** 대기 중인 Promise 처리를 끝까지 흘려보낸다 */
const flush = () => new Promise((r) => setTimeout(r, 0));

function addUser(d: Db, username: string, role: string): number {
  const now = '2026-11-02T00:00:00.000Z';
  return d.run("INSERT INTO users (username, name, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, 'scrypt$x', ?, ?)", [username, username, role, now, now]).lastInsertRowid;
}

describe('scheduler', () => {
  test('다음 정각까지 남은 시간을 계산한다(정각이면 1시간)', () => {
    expect(msUntilNextHour(new Date('2026-11-02T09:00:00+09:00'))).toBe(HOUR_MS);
    expect(msUntilNextHour(new Date('2026-11-02T09:59:30+09:00'))).toBe(30_000);
    expect(msUntilNextHour(new Date('2026-11-02T09:15:00.500+09:00'))).toBe(45 * MINUTE_MS - 500);
  });

  test('시작할 때 한 번, 그 뒤 매시 정각에 작업을 돌리고, 일찍 울리면 다시 기다린다', async () => {
    const d = makeDb();
    const clock = manualClock('2026-11-02T09:20:00+09:00');
    const timers = fakeTimers();
    const runs: string[] = [];
    const job: ScheduledJob = { name: 'probe', run: ({ clock: c }) => runs.push(c.now().toISOString()) };
    const s = startScheduler({ db: d, clock, jobs: [job], timers: timers.api });
    await flush();
    expect(runs).toEqual(['2026-11-02T00:20:00.000Z']);
    expect(timers.lastMs()).toBe(40 * MINUTE_MS);
    expect(s.nextRunAt()?.toISOString()).toBe('2026-11-02T01:00:00.000Z');

    // 정각보다 2초 일찍 울림 → 돌리지 않고 남은 2초를 다시 기다린다
    clock.set('2026-11-02T09:59:58+09:00');
    timers.fire();
    await flush();
    expect(runs).toHaveLength(1);
    expect(timers.lastMs()).toBe(2000);

    clock.set('2026-11-02T10:00:00.010+09:00');
    timers.fire();
    await flush();
    expect(runs).toEqual(['2026-11-02T00:20:00.000Z', '2026-11-02T01:00:00.010Z']);
    expect(s.nextRunAt()?.toISOString()).toBe('2026-11-02T02:00:00.000Z');

    await s.stop();
    expect(timers.pending.size).toBe(0);
    expect(s.nextRunAt()).toBeNull();
  });

  test('작업 하나가 실패해도 다음 작업은 돌고, 실패는 로그에 남는다', async () => {
    const d = makeDb();
    const logs: string[] = [];
    const timers = fakeTimers();
    let second = 0;
    const s = startScheduler({
      db: d,
      clock: manualClock('2026-11-02T09:00:00+09:00'),
      timers: timers.api,
      log: (m) => logs.push(m),
      jobs: [
        { name: 'broken', run: () => { throw new Error('일부러 실패'); } },
        { name: 'ok', run: () => (second += 1) },
      ],
    });
    await flush();
    const results = await s.runNow();
    expect(results.map((r) => [r.name, r.ok])).toEqual([['broken', false], ['ok', true]]);
    expect(second).toBe(2); // 시작 실행 + runNow
    expect(logs.some((l) => l.includes('broken') && l.includes('일부러 실패'))).toBe(true);
    await s.stop();
  });

  test('기본 작업은 세션 정리와 알림 찾기이고, 매시 만료된 세션을 지운다', async () => {
    expect(defaultJobs().map((j) => j.name)).toEqual(['sessions.purge', 'notify.scan']);
    const d = makeDb();
    const clock = manualClock('2026-11-02T09:00:00+09:00');
    const uid = addUser(d, 'staff01', 'staff');
    createSession(d, clock, uid, '127.0.0.1');
    const timers = fakeTimers();
    const s = startScheduler({ db: d, clock, timers: timers.api });
    await flush();
    expect(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')?.n).toBe(1);
    clock.advance(SESSION_IDLE_MS + HOUR_MS);
    timers.fire();
    await flush();
    expect(d.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')?.n).toBe(0);
    await s.stop();
  });
});

describe('notify-job', () => {
  test('phase-02-task-04 AC1: 매시 같은 scanner가 같은 알림을 찾아도 dedupe_key로 1건만 남는다', async () => {
    const d = makeDb();
    const mgr = addUser(d, 'mgr01', 'manager');
    addUser(d, 'staff01', 'staff');
    const clock = manualClock('2026-11-02T09:00:00+09:00');
    const scanner: NotifyScanner = {
      name: 'test.stock',
      scan: ({ clock: c }) => [{ type: 'stock_low', title: '거즈 부족', link: '/inventory/items/1', dedupeKey: `item:1:${c.now().toISOString().slice(0, 10)}` }],
    };
    cleanups.push(registerNotifyScanner(scanner));
    expect(listNotifyScanners().map((s) => s.name)).toContain('test.stock');

    const timers = fakeTimers();
    const s = startScheduler({ db: d, clock, timers: timers.api, jobs: [notifyScanJob] });
    await flush();
    clock.advance(HOUR_MS);
    timers.fire();
    await flush();
    const rows = d.all<{ user_id: number }>("SELECT user_id FROM notifications WHERE type = 'stock_low'");
    expect(rows).toEqual([{ user_id: mgr }]); // staff에게는 가지 않고, 두 번 돌아도 1건
    await s.stop();
  });

  test('scanner 하나가 실패해도 다른 scanner의 알림은 만들어지고, 등록을 풀면 빠진다', async () => {
    const d = makeDb();
    addUser(d, 'staff01', 'staff');
    const clock = manualClock('2026-11-02T09:00:00+09:00');
    const bad: NotifyScanner = { name: 'test.bad', scan: () => { throw new Error('찾기 실패'); } };
    const good: NotifyScanner = { name: 'test.good', scan: async () => [{ type: 'notice', title: '공지', dedupeKey: 'n1' }] };
    const r = await runNotifyScan(d, clock, [bad, good]);
    expect(r.created).toBe(1);
    expect(r.errors).toEqual([{ name: 'test.bad', message: '찾기 실패' }]);
    expect(r.scanners).toEqual([{ name: 'test.good', found: 1, created: 1 }]);

    const off = registerNotifyScanner(good);
    off();
    expect(listNotifyScanners().map((s) => s.name)).not.toContain('test.good');
  });
});

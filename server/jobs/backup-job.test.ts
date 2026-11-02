// 이 파일이 하는 일: 하루 한 번 자동 백업 작업을 확인한다(phase-02-task-05 AC3, FR-006 AC1).
// 주입 시계로 "어제 백업만 있는 상태"를 만든 뒤 서버 시작(startBackupJob)을 흉내 내 오늘 백업이 바로 생기는지,
// 같은 날 다시 확인해도 겹쳐 만들지 않는지, 정각 타이머가 다음 날 백업을 만드는지, 복원 중에는 건너뛰는지 본다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { DAY_MS, HOUR_MS, manualClock, MINUTE_MS, type ManualClock } from '../lib/clock.ts';
import { kstDate } from '../lib/dates.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';
import { createBackup, listBackups } from '../modules/admin/backup-service.ts';
import { backupEnvOf, backupScheduledJob, msToNextHour, startBackupJob, type JobTimers } from './backup-job.ts';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

/** 직접 울릴 수 있는 가짜 타이머 */
function fakeTimers() {
  const pending: Array<{ fn: () => void; ms: number; id: number }> = [];
  let next = 1;
  const timers: JobTimers = {
    setTimeout(fn, ms) {
      const id = next++;
      pending.push({ fn, ms, id });
      return id;
    },
    clearTimeout(handle) {
      const i = pending.findIndex((p) => p.id === handle);
      if (i >= 0) pending.splice(i, 1);
    },
  };
  /** 가장 먼저 걸린 타이머를 울린다 */
  const fire = () => {
    const t = pending.shift();
    if (!t) throw new Error('걸린 타이머가 없어요');
    t.fn();
    return t.ms;
  };
  return { timers, pending, fire };
}

async function makeApp(startIso: string): Promise<{ app: FastifyInstance; clock: ManualClock }> {
  const dataDir = makeTmpDir('dentalax-backupjob-');
  const clock = manualClock(startIso);
  const app = await buildApp({ dataDir, backupDir: path.join(dataDir, 'backups'), webDist: path.join(dataDir, 'no-web'), clock });
  cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  cleanups.push(() => app.close());
  return { app, clock };
}

describe('자동 백업 작업', () => {
  test('phase-02-task-05 AC3: 주입 시계로 어제 백업만 있는 상태에서 서버를 시작하면 오늘 백업이 즉시 생긴다', async () => {
    const { app, clock } = await makeApp('2026-11-01T12:00:00+09:00');
    // 어제(11/1) 백업을 만들어 두고, 서버가 꺼져 있던 사이 하루가 지난 것처럼 시계를 오늘(11/2 09:00)로 옮긴다
    const yesterday = createBackup(backupEnvOf(app), 'auto');
    expect(yesterday.name).toBe('20261101-120000-auto');
    clock.set('2026-11-02T09:00:00+09:00');

    const t = fakeTimers();
    const job = startBackupJob(app, { timers: t.timers });
    cleanups.push(() => job.stop());

    expect(job.first).not.toBeNull();
    expect(job.first?.reason).toBe('auto');
    expect(job.first?.name).toBe('20261102-090000-auto');
    const list = listBackups(app.backupDir);
    expect(list.map((b) => b.name)).toEqual(['20261102-090000-auto', '20261101-120000-auto']);
    expect(kstDate(new Date(list[0]?.createdAt ?? ''))).toBe('2026-11-02');
    // 다음 확인은 정각(10:00)에 걸린다
    expect(t.pending).toHaveLength(1);
    expect(t.pending[0]?.ms).toBe(HOUR_MS);
  });

  test('phase-02-task-05 AC3: 오늘 백업이 이미 있으면 시작·정각 확인 때 새로 만들지 않는다', async () => {
    const { app, clock } = await makeApp('2026-11-02T08:10:00+09:00');
    createBackup(backupEnvOf(app), 'manual');
    clock.advance(40 * MINUTE_MS);
    const t = fakeTimers();
    const job = startBackupJob(app, { timers: t.timers });
    cleanups.push(() => job.stop());
    expect(job.first).toBeNull();
    clock.advance(10 * MINUTE_MS);
    t.fire();
    expect(listBackups(app.backupDir)).toHaveLength(1);
  });

  test('phase-02-task-05 AC3: 서버가 켜진 채 날짜가 바뀌면 다음 정각 확인 때 그날 백업이 생긴다', async () => {
    const { app, clock } = await makeApp('2026-11-02T23:20:00+09:00');
    const t = fakeTimers();
    const job = startBackupJob(app, { timers: t.timers });
    cleanups.push(() => job.stop());
    expect(job.first?.name).toBe('20261102-232000-auto');
    expect(t.pending[0]?.ms).toBe(40 * MINUTE_MS);
    clock.set('2026-11-03T00:00:00+09:00');
    t.fire();
    expect(listBackups(app.backupDir).map((b) => b.name)).toEqual(['20261103-000000-auto', '20261102-232000-auto']);
    // 같은 날 다음 정각에는 만들지 않는다
    clock.advance(HOUR_MS);
    t.fire();
    expect(listBackups(app.backupDir)).toHaveLength(2);
  });

  test('phase-02-task-05 범위: 복원 중(점검 모드)에는 자동 백업을 건너뛰고, scheduler용 작업도 같은 확인을 한다', async () => {
    const { app, clock } = await makeApp('2026-11-02T09:00:00+09:00');
    app.maintenance.on = true;
    expect(backupScheduledJob(app).run()).toBeNull();
    expect(listBackups(app.backupDir)).toHaveLength(0);
    app.maintenance.on = false;
    expect(backupScheduledJob(app).run()?.reason).toBe('auto');
    clock.advance(DAY_MS);
    expect(backupScheduledJob(app).name).toBe('backup.daily');
  });

  test('phase-02-task-05 범위: 다음 정각까지 남은 시간', () => {
    expect(msToNextHour(new Date('2026-11-02T09:00:00+09:00'))).toBe(HOUR_MS);
    expect(msToNextHour(new Date('2026-11-02T09:59:30+09:00'))).toBe(30_000);
  });
});

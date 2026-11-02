// 이 파일이 하는 일: 하루 한 번 자동 백업 작업(backupJob.ensureDaily, backend.md §6·overview §3.7, FR-006 AC1).
// 서버가 켜질 때 한 번, 그 뒤 매시 정각에 "오늘(KST) 백업이 있는지" 보고 없으면 만든다. 서버가 꺼져 있어 놓친 날은 켜자마자 만든다.
// 복원 중(점검 모드)에는 건너뛴다. 시계·타이머를 바꿔 끼울 수 있어 테스트가 "어제 백업만 있는 상태에서 시작"을 흉내 낸다.
// server/jobs/scheduler.ts(02-04)가 합쳐지면 backupScheduledJob(app)을 그 작업 목록에 더하고, startBackupJob 대신 scheduler가 돌린다.
import type { FastifyInstance } from 'fastify';
import { HOUR_MS, type Clock } from '../lib/clock.ts';
import { ensureDaily, type BackupEnv } from '../modules/admin/backup-service.ts';
import type { BackupItem } from '../../shared/schemas/backup.ts';

/** 바꿔 끼울 수 있는 타이머(기본: Node 타이머) */
export interface JobTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const nodeTimers: JobTimers = {
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    // 이 타이머만 남았다고 프로그램이 꺼지지 않고 버티지 않게 한다
    t.unref?.();
    return t;
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/** 서버 인스턴스에서 백업에 필요한 값(바꿔 끼우는 DB·폴더·시계)을 꺼낸다 */
export function backupEnvOf(app: FastifyInstance): BackupEnv {
  return { db: app.db, dataDir: app.dataDir, backupDir: app.backupDir, clock: app.clock };
}

/**
 * 자동 백업을 한 번 확인한다. 복원 중이면 건너뛰고 null.
 * 오늘 백업을 새로 만들었으면 그 항목, 이미 있으면 null.
 */
export function runBackupCheck(app: FastifyInstance): BackupItem | null {
  if (app.maintenance.on) return null;
  return ensureDaily(backupEnvOf(app));
}

/** scheduler(02-04)의 작업 모양 { name, run }. ctx.db 대신 서버의 바꿔 끼우는 DB(app.db)를 쓴다(복원 뒤에도 맞는 연결) */
export function backupScheduledJob(app: FastifyInstance): { name: string; run: () => BackupItem | null } {
  return { name: 'backup.daily', run: () => runBackupCheck(app) };
}

/** 다음 정각까지 남은 밀리초(이미 정각이면 1시간) */
export function msToNextHour(now: Date): number {
  const t = now.getTime();
  return HOUR_MS - (((t % HOUR_MS) + HOUR_MS) % HOUR_MS);
}

/** 켜진 자동 백업 작업 */
export interface BackupJobHandle {
  /** 켜자마자 한 확인의 결과(만든 백업 또는 null) */
  readonly first: BackupItem | null;
  /** 끈다 */
  stop(): void;
}

/**
 * 자동 백업 작업을 켠다: 지금 바로 한 번 확인하고, 그 뒤 매시 정각마다 확인한다.
 * 실패해도 서버는 계속 돌고, log로 남긴다.
 */
export function startBackupJob(app: FastifyInstance, opts: { clock?: Clock; timers?: JobTimers; log?: (m: string) => void } = {}): BackupJobHandle {
  const clock = opts.clock ?? app.clock;
  const timers = opts.timers ?? nodeTimers;
  const log = opts.log ?? (() => {});
  let handle: unknown = null;
  let stopped = false;

  const check = (): BackupItem | null => {
    try {
      const made = runBackupCheck(app);
      if (made) log(`자동 백업을 만들었어요: ${made.name}`);
      return made;
    } catch (e) {
      log(`자동 백업 실패: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const arm = () => {
    if (stopped) return;
    handle = timers.setTimeout(() => {
      handle = null;
      check();
      arm();
    }, Math.max(1, msToNextHour(clock.now())));
  };

  const first = check();
  arm();
  return {
    first,
    stop() {
      stopped = true;
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
    },
  };
}

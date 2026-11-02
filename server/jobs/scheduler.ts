// 이 파일이 하는 일: 백그라운드 작업 시계(backend.md §6). 서버가 켜질 때 한 번, 그 뒤 매시 정각마다 등록된 작업을 차례로 돌린다.
// 기본 작업: 만료된 세션 지우기(purgeExpiredSessions), 기한형 알림 찾기(notify-job). 백업 작업(backupJob.ensureDaily)은 맡은 태스크가 defaultJobs에 더한다.
// 시각은 주입한 clock으로 계산하고, 타이머(setTimeout)도 바꿔 끼울 수 있어 테스트가 "정각"을 직접 흉내 낸다.
// 작업 하나가 실패해도 다른 작업은 계속 돌고, 실패는 log로 남긴다. 앞 실행이 끝나기 전에는 새 실행을 겹쳐 시작하지 않는다.
// main.ts가 서버를 연 뒤 startScheduler를 부르고, 끌 때 stop()을 기다린 다음 DB를 닫는다.
import type { Db } from '../db/index.ts';
import { HOUR_MS, type Clock } from '../lib/clock.ts';
import { purgeExpiredSessions } from '../auth/sessions.ts';
import { notifyScanJob } from './notify-job.ts';

/** 작업이 받는 값 */
export interface JobContext {
  db: Db;
  clock: Clock;
  /** 서버 로그 한 줄 남기기 */
  log: (message: string) => void;
}

/** scheduler가 돌리는 작업 하나 */
export interface ScheduledJob {
  /** 로그에 쓸 이름(예: 'sessions.purge') */
  name: string;
  run(ctx: JobContext): unknown;
}

/** 작업 한 번의 결과 */
export interface JobRunResult {
  name: string;
  ok: boolean;
  /** 실패 이유(ok=false일 때) */
  error?: string;
  /** 작업이 돌려준 값(예: 지운 세션 수, 알림 찾기 결과) */
  value?: unknown;
}

/** 바꿔 끼울 수 있는 타이머(기본: Node의 setTimeout) */
export interface TimerApi {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const nodeTimers: TimerApi = {
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

/** 매시 세션 정리 작업 */
export const sessionPurgeJob: ScheduledJob = {
  name: 'sessions.purge',
  run: ({ db, clock }) => purgeExpiredSessions(db, clock),
};

/** 기본 작업 목록(순서대로 돈다) */
export function defaultJobs(): ScheduledJob[] {
  return [sessionPurgeJob, notifyScanJob];
}

/** 다음 정각(시 단위)까지 남은 밀리초. 이미 정각이면 1시간 */
export function msUntilNextHour(now: Date): number {
  const t = now.getTime();
  return HOUR_MS - (((t % HOUR_MS) + HOUR_MS) % HOUR_MS);
}

/** startScheduler에 넣는 값 */
export interface SchedulerOptions {
  db: Db;
  clock: Clock;
  /** 돌릴 작업(기본: defaultJobs()) */
  jobs?: readonly ScheduledJob[];
  /** 타이머(기본: Node 타이머) */
  timers?: TimerApi;
  /** 로그(기본: 아무것도 안 함) */
  log?: (message: string) => void;
}

/** 켜진 scheduler */
export interface Scheduler {
  /** 지금 바로 모든 작업을 한 번 돌린다(이미 도는 중이면 그 실행을 기다린다) */
  runNow(): Promise<JobRunResult[]>;
  /** 다음 실행 예정 시각(꺼졌으면 null) */
  nextRunAt(): Date | null;
  /** 끈다. 도는 중인 실행이 있으면 끝날 때까지 기다린다 */
  stop(): Promise<void>;
}

/**
 * scheduler를 켠다. 켜자마자 작업을 한 번 돌리고(기다리지 않음), 그 뒤 매시 정각마다 돌린다.
 * 타이머가 정각보다 조금 일찍 울리면 남은 시간만큼 다시 기다려서, 한 시간에 두 번 도는 일을 막는다.
 */
export function startScheduler(opts: SchedulerOptions): Scheduler {
  const { db, clock } = opts;
  const jobs = [...(opts.jobs ?? defaultJobs())];
  const timers = opts.timers ?? nodeTimers;
  const log = opts.log ?? (() => {});
  let stopped = false;
  let handle: unknown = null;
  let target: number | null = null;
  let current: Promise<JobRunResult[]> | null = null;

  /** 작업을 차례로 한 번 돌린다 */
  async function runCycle(): Promise<JobRunResult[]> {
    const results: JobRunResult[] = [];
    for (const job of jobs) {
      try {
        const value = await job.run({ db, clock, log });
        results.push({ name: job.name, ok: true, value });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        log(`예약 작업 실패 ${job.name}: ${error}`);
        results.push({ name: job.name, ok: false, error });
      }
    }
    return results;
  }

  function runNow(): Promise<JobRunResult[]> {
    if (!current) {
      current = runCycle().finally(() => {
        current = null;
      });
    }
    return current;
  }

  /** 다음 정각에 울릴 타이머를 건다 */
  function arm(): void {
    if (stopped) return;
    const now = clock.now();
    target ??= now.getTime() + msUntilNextHour(now);
    handle = timers.setTimeout(onTimer, Math.max(1, target - now.getTime()));
  }

  function onTimer(): void {
    handle = null;
    if (stopped) return;
    const now = clock.now().getTime();
    if (target !== null && now < target) {
      // 일찍 울렸다: 정각까지 남은 시간만 다시 기다린다
      arm();
      return;
    }
    target = null;
    void runNow().finally(arm);
  }

  void runNow();
  arm();

  return {
    runNow,
    nextRunAt: () => (stopped || target === null ? null : new Date(target)),
    async stop() {
      stopped = true;
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      target = null;
      if (current) await current.catch(() => {});
    },
  };
}

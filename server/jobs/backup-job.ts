// 이 파일이 하는 일: 하루 한 번 자동 백업 작업(backupJob.ensureDaily, backend.md §6·overview §3.7, FR-006 AC1).
// "오늘(KST) 백업이 있는지" 보고 없으면 만든다. 서버가 꺼져 있어 놓친 날은 켜자마자 만든다. 복원 중(점검 모드)에는 건너뛴다.
// 언제 부르나: ① 서버 시작 때 포트를 열기 전에 startupBackupCheck(main.ts) — 그래서 /api/health가 ok면 오늘 백업은 이미 있다.
//            ② 그 뒤 매시 정각은 server/jobs/scheduler.ts가 backupScheduledJob(app)을 다른 예약 작업과 함께 돌린다(타이머는 scheduler 하나).
// DB는 scheduler가 넘기는 ctx.db 대신 서버의 바꿔 끼우는 DB(app.db)를 쓴다(복원 뒤에도 맞는 연결).
import type { FastifyInstance } from 'fastify';
import { ensureDaily, type BackupEnv } from '../modules/admin/backup-service.ts';
import type { BackupItem } from '../../shared/schemas/backup.ts';

/** 서버 인스턴스에서 백업에 필요한 값(바꿔 끼우는 DB·폴더·시계)을 꺼낸다 */
export function backupEnvOf(app: FastifyInstance): BackupEnv {
  return { db: app.db, dataDir: app.dataDir, backupDir: app.backupDir, clock: app.clock };
}

/**
 * 자동 백업을 한 번 확인한다. 복원 중이면 건너뛰고 null.
 * 오늘 백업을 새로 만들었으면 그 항목, 이미 있으면 null. 실패하면 오류를 던진다.
 */
export function runBackupCheck(app: FastifyInstance): BackupItem | null {
  if (app.maintenance.on) return null;
  return ensureDaily(backupEnvOf(app));
}

/**
 * scheduler(server/jobs/scheduler.ts)에 넣는 작업 { name, run }. 실패는 scheduler가 "예약 작업 실패 backup.daily: …"로 남기고,
 * 새 백업을 만들었으면 log로 알린다.
 */
export function backupScheduledJob(app: FastifyInstance, log: (m: string) => void = () => {}): { name: string; run: () => BackupItem | null } {
  return {
    name: 'backup.daily',
    run: () => {
      const made = runBackupCheck(app);
      if (made) log(`자동 백업을 만들었어요: ${made.name}`);
      return made;
    },
  };
}

/**
 * 서버를 켤 때(포트를 열기 전) 한 번 확인한다. 실패해도 서버는 켜지고, 이유를 log로 남긴다(다음 정각에 scheduler가 다시 시도).
 * 새로 만든 백업(또는 null)을 돌려준다.
 */
export function startupBackupCheck(app: FastifyInstance, log: (m: string) => void = () => {}): BackupItem | null {
  try {
    const made = runBackupCheck(app);
    if (made) log(`자동 백업을 만들었어요: ${made.name}`);
    return made;
  } catch (e) {
    log(`자동 백업 실패: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

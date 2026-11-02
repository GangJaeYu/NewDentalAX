// 이 파일이 하는 일: 기한형 알림 작업(notifyJob.scan, backend.md §6·overview §3.8)의 확장 지점을 둔다.
// 각 업무 모듈(재고·시설·인사 등)은 registerNotifyScanner({ name, scan })로 "지금 만들 알림 목록을 찾는 함수"를 등록한다.
// scheduler가 서버 시작 때와 매시 정각에 runNotifyScan을 부르면, 등록된 scanner를 차례로 돌려 나온 알림을 notify.emit으로 만든다.
// 같은 날 같은 알림은 dedupeKey(예: 'item:12:2026-11-02')로 한 번만 들어간다. scanner 하나가 실패해도 나머지는 계속 돈다.
// 등록 위치 예: server/modules/inventory/notify.ts에서 registerNotifyScanner(...)를 부르고, 그 모듈의 routes.ts가 이 파일을 import한다.
import type { Db } from '../db/index.ts';
import type { Clock } from '../lib/clock.ts';
import { emitNotification, type NotificationInput } from '../modules/notifications/emit.ts';
import type { ScheduledJob } from './scheduler.ts';

/** scanner가 받는 값 */
export interface NotifyScanContext {
  db: Db;
  clock: Clock;
}

/** 모듈이 등록하는 알림 찾기 함수 */
export interface NotifyScanner {
  /** 고유 이름(예: 'inventory.stock'). 같은 이름으로 다시 등록하면 바꿔 끼운다 */
  name: string;
  /** 지금 만들어야 할 알림 목록을 돌려준다. dedupeKey를 꼭 넣어 같은 날 중복을 막는다 */
  scan(ctx: NotifyScanContext): readonly NotificationInput[] | Promise<readonly NotificationInput[]>;
}

/** 한 번 돌린 결과 */
export interface NotifyScanResult {
  /** 새로 들어간 알림 수(중복으로 건너뛴 것 제외) */
  created: number;
  /** scanner별: 찾은 알림 수, 새로 들어간 수 */
  scanners: { name: string; found: number; created: number }[];
  /** 실패한 scanner와 이유 */
  errors: { name: string; message: string }[];
}

const registry = new Map<string, NotifyScanner>();

/** scanner를 등록한다. 돌려준 함수를 부르면 등록을 푼다(테스트 정리용) */
export function registerNotifyScanner(scanner: NotifyScanner): () => void {
  registry.set(scanner.name, scanner);
  return () => {
    if (registry.get(scanner.name) === scanner) registry.delete(scanner.name);
  };
}

/** 지금 등록된 scanner 목록(등록한 순서) */
export function listNotifyScanners(): NotifyScanner[] {
  return [...registry.values()];
}

/**
 * 등록된 scanner를 모두 돌려 알림을 만든다. scanner가 던진 오류나 잘못된 알림(링크 오류 등)은 errors에 담고 다음으로 넘어간다.
 * scanners를 넣으면 등록부 대신 그 목록만 돌린다(테스트용).
 */
export async function runNotifyScan(db: Db, clock: Clock, scanners: readonly NotifyScanner[] = listNotifyScanners()): Promise<NotifyScanResult> {
  const result: NotifyScanResult = { created: 0, scanners: [], errors: [] };
  for (const s of scanners) {
    try {
      const found = await s.scan({ db, clock });
      let created = 0;
      for (const input of found) created += emitNotification(db, input, clock);
      result.created += created;
      result.scanners.push({ name: s.name, found: found.length, created });
    } catch (e) {
      result.errors.push({ name: s.name, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

/** scheduler에 넣는 작업: 기한형 알림 찾기 */
export const notifyScanJob: ScheduledJob = {
  name: 'notify.scan',
  async run({ db, clock, log }) {
    const r = await runNotifyScan(db, clock);
    for (const e of r.errors) log(`알림 찾기 실패 scanner=${e.name}: ${e.message}`);
    if (r.created > 0) log(`알림 ${r.created}건을 만들었어요(scanner ${r.scanners.length}개)`);
    return r;
  },
};

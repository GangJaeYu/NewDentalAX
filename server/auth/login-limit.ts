// 이 파일이 하는 일: 로그인 실패를 세어 잠근다(FR-002 AC2, TD-006).
// - 아이디별: 연속 5번 틀리면 15분 동안 잠근다(login_attempts 테이블). 잠긴 동안은 맞는 비밀번호도 423 LOCKED다.
//   첫 실패에서 15분이 지나도록 5번이 안 되면 횟수를 처음부터 다시 센다(가끔 틀린 기록이 몇 달씩 쌓여 잠기지 않게).
// - 기기(IP)별: 15분 안에 30번 넘게 틀리면 그 기기를 15분 막는다(여러 아이디를 돌려 가며 시도하는 것 방지, 메모리에만 둔다).
// 없는 아이디도 똑같이 센다(아이디가 있는지 없는지 응답으로 알 수 없게).
import type { Db } from '../db/index.ts';
import type { Clock } from '../lib/clock.ts';
import { MINUTE_MS } from '../lib/clock.ts';

/** 잠그기까지 허용하는 연속 실패 횟수 */
export const MAX_FAILED = 5;
/** 잠그는 시간(15분) */
export const LOCK_MS = 15 * MINUTE_MS;
/** 한 기기에서 15분 안에 허용하는 실패 횟수 */
export const MAX_FAILED_PER_IP = 30;

interface AttemptRow {
  failed_count: number;
  first_failed_at: string | null;
  locked_until: string | null;
}

/** 잠겨 있으면 남은 초, 아니면 0 */
export function lockedRemainingSec(db: Db, clock: Clock, username: string): number {
  const row = db.get<AttemptRow>('SELECT failed_count, first_failed_at, locked_until FROM login_attempts WHERE username = ?', [username]);
  if (!row?.locked_until) return 0;
  const left = Date.parse(row.locked_until) - clock.now().getTime();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/**
 * 실패를 한 번 기록한다. 이번 실패로 잠기면 { locked: true, retryAfterSec }를 돌려준다.
 * 지난 잠금이 풀렸거나 첫 실패에서 15분이 지났으면 1부터 다시 센다.
 */
export function recordFailure(db: Db, clock: Clock, username: string): { locked: boolean; failedCount: number; retryAfterSec: number } {
  const now = clock.now();
  const nowIso = now.toISOString();
  return db.tx(() => {
    const row = db.get<AttemptRow>('SELECT failed_count, first_failed_at, locked_until FROM login_attempts WHERE username = ?', [username]);
    const lockOver = !!row?.locked_until && Date.parse(row.locked_until) <= now.getTime();
    // first_failed_at: 이번 연속 실패의 첫 시각. 여기서 15분 안에 5번이 차면 잠근다
    const stale = !row?.first_failed_at || now.getTime() - Date.parse(row.first_failed_at) > LOCK_MS;
    const restart = !row || lockOver || stale;
    const count = restart ? 1 : row.failed_count + 1;
    const firstAt = restart ? nowIso : (row.first_failed_at as string);
    const locked = count >= MAX_FAILED;
    const lockedUntil = locked ? new Date(now.getTime() + LOCK_MS).toISOString() : null;
    db.run(
      `INSERT INTO login_attempts (username, failed_count, first_failed_at, locked_until) VALUES (?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET failed_count = excluded.failed_count, first_failed_at = excluded.first_failed_at, locked_until = excluded.locked_until`,
      [username, count, firstAt, lockedUntil],
    );
    return { locked, failedCount: count, retryAfterSec: locked ? Math.ceil(LOCK_MS / 1000) : 0 };
  });
}

/** 로그인에 성공하면 실패 기록을 지운다 */
export function clearFailures(db: Db, username: string): void {
  db.run('DELETE FROM login_attempts WHERE username = ?', [username]);
}

/** 기기(IP)별 실패 기록(메모리). 서버를 다시 켜면 비워진다 */
export class IpFailureCounter {
  private readonly hits = new Map<string, number[]>();
  private readonly clock: Clock;
  constructor(clock: Clock) {
    this.clock = clock;
  }

  /** 15분 창 안의 실패 시각만 남긴다 */
  private recent(ip: string): number[] {
    const since = this.clock.now().getTime() - LOCK_MS;
    const list = (this.hits.get(ip) ?? []).filter((t) => t > since);
    if (list.length) this.hits.set(ip, list);
    else this.hits.delete(ip);
    return list;
  }

  /** 이 기기가 막혀 있으면 남은 초, 아니면 0 */
  blockedSec(ip: string): number {
    const list = this.recent(ip);
    if (list.length < MAX_FAILED_PER_IP) return 0;
    const oldest = list[list.length - MAX_FAILED_PER_IP] ?? 0;
    return Math.max(1, Math.ceil((oldest + LOCK_MS - this.clock.now().getTime()) / 1000));
  }

  /** 실패 한 번을 기록한다 */
  record(ip: string): void {
    const list = this.recent(ip);
    list.push(this.clock.now().getTime());
    this.hits.set(ip, list);
  }
}

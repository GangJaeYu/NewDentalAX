// 이 파일이 하는 일: 서버 연결 상태를 기억한다(TD-017). API 요청이 네트워크 오류로 연속 2번 실패하면 "연결 끊김"으로 바꾸고,
// 한 번이라도 응답을 받으면 "연결됨"으로 되돌린다. 화면이 열린 동안 /api/health를 주기적으로 확인해(연결이 끊기면 더 자주) 띠를 띄우고 숨긴다.
// OfflineBanner가 useOffline()으로 이 상태를 읽는다. 상태 판단(ConnectionTracker)은 브라우저 없이 단위 테스트한다.
import { useSyncExternalStore } from 'react';

/** 연속 몇 번 실패하면 연결 끊김으로 볼지 */
export const OFFLINE_AFTER_FAILURES = 2;

/** 연결 상태 판단기: 실패·성공 보고를 받아 끊김 여부를 정한다 */
export class ConnectionTracker {
  private failures = 0;
  private offline = false;
  private readonly listeners = new Set<() => void>();
  private readonly threshold: number;

  constructor(threshold: number = OFFLINE_AFTER_FAILURES) {
    this.threshold = threshold;
  }

  /** 지금 연결이 끊긴 상태인지 */
  isOffline(): boolean {
    return this.offline;
  }

  /** 연속 실패 횟수 */
  failureCount(): number {
    return this.failures;
  }

  /** 네트워크 오류(서버에 닿지 못함)를 한 번 보고한다 */
  reportFailure(): void {
    this.failures += 1;
    if (!this.offline && this.failures >= this.threshold) this.set(true);
  }

  /** 서버가 응답했음을 보고한다(오류 응답이어도 서버에 닿았으면 연결된 것) */
  reportSuccess(): void {
    this.failures = 0;
    if (this.offline) this.set(false);
  }

  /** 상태가 바뀔 때 부를 함수를 등록한다. 돌려준 함수를 부르면 해제된다 */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(v: boolean): void {
    this.offline = v;
    for (const fn of this.listeners) fn();
  }
}

/** 앱 전체가 함께 쓰는 연결 상태 */
export const connection = new ConnectionTracker();

/** 화면 컴포넌트에서 연결 끊김 여부를 읽는다(바뀌면 다시 그린다) */
export function useOffline(): boolean {
  return useSyncExternalStore(
    (cb) => connection.subscribe(cb),
    () => connection.isOffline(),
    () => false,
  );
}

/** 주기 확인 간격 */
export interface HeartbeatOptions {
  /** 연결된 동안 확인 간격(기본 10초) */
  intervalMs?: number;
  /** 끊긴 동안(또는 방금 실패한 뒤) 확인 간격(기본 2초) */
  retryMs?: number;
}

/**
 * /api/health를 주기적으로 불러 연결 상태를 갱신한다. 창이 다시 보이거나 브라우저가 온라인이 되면 바로 확인한다.
 * 돌려준 함수를 부르면 멈춘다.
 */
export function startHeartbeat(opts: HeartbeatOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? 10000;
  const retryMs = opts.retryMs ?? 2000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    const wait = connection.isOffline() || connection.failureCount() > 0 ? retryMs : intervalMs;
    timer = setTimeout(check, wait);
  };

  const check = async () => {
    try {
      await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' });
      connection.reportSuccess();
    } catch {
      connection.reportFailure();
    }
    schedule();
  };

  const now = () => {
    void check();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') now();
  };

  window.addEventListener('online', now);
  window.addEventListener('focus', now);
  document.addEventListener('visibilitychange', onVisible);
  schedule();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener('online', now);
    window.removeEventListener('focus', now);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

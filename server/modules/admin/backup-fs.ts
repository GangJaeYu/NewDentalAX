// 이 파일이 하는 일: 백업·복원의 파일 작업이 Windows의 "잠깐 잠김"에 걸려 실패하지 않도록 짧게 다시 시도하는 도우미.
// Windows에서는 백신(실시간 검사)·검색 색인·다른 프로그램이 방금 만든 파일을 잠깐 열어 두면, 그 파일을 지우거나 같은 이름으로 다시 만들거나
// 그 파일이 든 폴더 이름을 바꾸는 일이 EPERM·EBUSY·EACCES로 실패한다(2026-11-02 실험: 다른 프로세스가 파일을 읽기로 열어 둔 폴더의 이름 바꾸기 → EPERM).
// 이런 오류만 골라 조금씩 더 기다리며 다시 시도하고, 다른 오류(파일 없음 등)나 시간이 다 되면 그대로 던진다.

/** 잠깐 잠김으로 보고 다시 시도할 오류 코드 */
export const TRANSIENT_FS_CODES: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE']);

/** 다시 시도 설정: 최대 횟수와 첫 대기(ms). 대기는 한 번마다 늘고 maxDelayMs를 넘지 않는다(기본 합계 약 5초) */
export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  maxDelayMs?: number;
}

const DEFAULTS = { attempts: 30, delayMs: 20, maxDelayMs: 250 };

/** 잠깐 잠김 오류인지 */
export function isTransientFsError(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && TRANSIENT_FS_CODES.has(code);
}

/** n번째 다시 시도 전에 기다릴 시간 */
function waitMs(n: number, o: Required<RetryOptions>): number {
  return Math.min(o.maxDelayMs, o.delayMs * (n + 1));
}

/** 동기 함수 안에서 잠깐 멈춘다(동기 백업 경로 전용. 잠김이 있을 때만 불린다) */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 동기 파일 작업을 잠깐 잠김이 풀릴 때까지 다시 시도한다 */
export function retryFsSync<T>(fn: () => T, opts: RetryOptions = {}): T {
  const o = { ...DEFAULTS, ...opts };
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (!isTransientFsError(e) || i >= o.attempts - 1) throw e;
      sleepSync(waitMs(i, o));
    }
  }
}

/** 비동기 파일 작업을 잠깐 잠김이 풀릴 때까지 다시 시도한다(기다리는 동안 다른 요청은 계속 처리된다) */
export async function retryFs<T>(fn: () => Promise<T> | T, opts: RetryOptions = {}): Promise<T> {
  const o = { ...DEFAULTS, ...opts };
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransientFsError(e) || i >= o.attempts - 1) throw e;
      await new Promise((res) => setTimeout(res, waitMs(i, o)));
    }
  }
}

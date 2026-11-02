// 이 파일이 하는 일: 서버 전체가 "지금 시각"을 얻는 시계를 정의한다(TD-020). 실제 시계, 멈춘 시계(E2E·테스트),
// 직접 앞으로 돌릴 수 있는 시계(잠금 15분·세션 8시간 같은 시간 경과 테스트)를 제공한다.
// 모든 코드는 new Date()를 직접 쓰지 말고 주입받은 clock.now()를 쓴다.

/** "지금 시각"을 알려 주는 시계 */
export interface Clock {
  now(): Date;
}

/** 실제 시계 */
export const systemClock: Clock = { now: () => new Date() };

/** 정해진 시각에 멈춘 시계(테스트·E2E 전용) */
export function fixedClock(iso: string): Clock {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) throw new Error(`시각 "${iso}"을(를) 읽을 수 없어요. 예: 2026-11-02T09:00:00+09:00`);
  return { now: () => new Date(t) };
}

/** 테스트에서 시간을 앞으로 돌릴 수 있는 시계 */
export interface ManualClock extends Clock {
  /** 지정한 밀리초만큼 시간을 앞으로 보낸다 */
  advance(ms: number): void;
  /** 시각을 직접 바꾼다 */
  set(iso: string): void;
}

/** 시작 시각에서 출발해 advance()로만 움직이는 시계(테스트 전용) */
export function manualClock(startIso: string): ManualClock {
  let t = fixedClock(startIso).now().getTime();
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
    set(iso: string) {
      t = fixedClock(iso).now().getTime();
    },
  };
}

/** 시간 단위(밀리초) — 시간 경과 계산을 읽기 쉽게 쓰기 위한 상수 */
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

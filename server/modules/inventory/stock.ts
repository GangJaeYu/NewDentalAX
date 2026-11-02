// 이 파일이 하는 일: 재고 상태 계산 규칙(database.md §3.2)을 DB 없이 계산하는 순수 함수로 둔다.
// 수량 상태(부족·곧 부족·정상), 유효기간 로트별 남은 수량(FEFO: 유효기간이 빠른 로트부터 빼기), 표시 상태 우선순위, 단가 변동률을 계산한다.
// 상태는 저장하지 않고 조회할 때마다 이 함수로 계산한다. 단위 테스트(stock.test.ts)가 수용 기준 숫자로 확인한다.
import type { InventorySettings, LotRemain, StockStatus } from '../../../shared/schemas/inventory.ts';
import { dday as ddayOf } from '../../lib/dates.ts';

/** 소수 계산 오차를 없앤다(0.1 + 0.2 → 0.3) */
export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * 수량 상태: 현재고 < 적정 → low, 적정 ≤ 현재고 ≤ 적정×배수(기본 1.2) → soon_low, 그 밖에는 ok.
 * 적정 재고가 0이면 수량 상태를 계산하지 않는다(ok).
 */
export function qtyStatus(stock: number, par: number, soonLowRatio = 1.2): 'low' | 'soon_low' | 'ok' {
  if (!(par > 0)) return 'ok';
  if (stock < par) return 'low';
  if (stock <= roundQty(par * soonLowRatio)) return 'soon_low';
  return 'ok';
}

/** 유효기간 로트 계산에 쓰는 입고(또는 + 조정) 한 건 */
export interface LotIn {
  moveId: number;
  qty: number;
  lot: string | null;
  expiryOn: string | null;
  movedAt: string;
}

/**
 * FEFO: 들어온 로트를 유효기간이 빠른 순서(유효기간 없는 로트는 맨 뒤, 같으면 먼저 들어온 순서)로 늘어놓고,
 * 나간 수량(출고 + 줄인 조정)을 앞 로트부터 빼 나간다. 로트마다 남은 수량을 돌려준다(유효기간 순서).
 */
export function fefoLots(ins: readonly LotIn[], consumed: number, today: string): LotRemain[] {
  const sorted = [...ins].sort((a, b) => {
    if (a.expiryOn !== b.expiryOn) {
      if (a.expiryOn === null) return 1;
      if (b.expiryOn === null) return -1;
      return a.expiryOn < b.expiryOn ? -1 : 1;
    }
    if (a.movedAt !== b.movedAt) return a.movedAt < b.movedAt ? -1 : 1;
    return a.moveId - b.moveId;
  });
  let left = Math.max(0, consumed);
  return sorted.map((l) => {
    const take = Math.min(l.qty, left);
    left = roundQty(left - take);
    return {
      moveId: l.moveId,
      lot: l.lot,
      expiryOn: l.expiryOn,
      qty: l.qty,
      remaining: roundQty(l.qty - take),
      dday: l.expiryOn ? ddayOf(l.expiryOn, today) : null,
    };
  });
}

/** 남은 수량이 있는 가장 빠른 유효기간(없으면 null) */
export function nearestExpiry(lots: readonly LotRemain[]): string | null {
  for (const l of lots) if (l.remaining > 0 && l.expiryOn) return l.expiryOn;
  return null;
}

/** 유효기간 상태: 지났으면 expired, 정해 둔 일수(기본 30일) 안이면 expiring, 아니면 null */
export function expiryStatus(expiryOn: string | null, today: string, warnDays = 30): 'expired' | 'expiring' | null {
  if (!expiryOn) return null;
  const d = ddayOf(expiryOn, today);
  if (d < 0) return 'expired';
  if (d <= warnDays) return 'expiring';
  return null;
}

/** 표시 상태: expired > low > expiring > soon_low > ok 순서로 가장 앞선 것 */
export function displayStatus(qty: 'low' | 'soon_low' | 'ok', expiry: 'expired' | 'expiring' | null): StockStatus {
  if (expiry === 'expired') return 'expired';
  if (qty === 'low') return 'low';
  if (expiry === 'expiring') return 'expiring';
  if (qty === 'soon_low') return 'soon_low';
  return 'ok';
}

/** 직전 단가 대비 변동률(%). 직전 단가가 없거나 0이면 null. 8,400 → 8,900 = 5.95… */
export function priceChangePct(prev: number | null | undefined, next: number | null | undefined): number | null {
  if (prev === null || prev === undefined || next === null || next === undefined || !(prev > 0)) return null;
  return Math.round(((next - prev) / prev) * 10000) / 100;
}

/** 변동률이 정해 둔 비율(기본 5%)보다 크면 인상으로 본다 */
export function isPriceUp(pct: number | null, alertPct = 5): boolean {
  return pct !== null && pct > alertPct;
}

/** 품목 하나의 상태를 한 번에 계산한 결과 */
export interface ItemState {
  stock: number;
  status: StockStatus;
  nearestExpiry: string | null;
  dday: number | null;
  lots: LotRemain[];
}

/**
 * 품목 하나의 상태를 계산한다. trackExpiry가 꺼진 품목은 유효기간 상태를 보지 않는다(로트는 참고용으로 계산).
 * stock: 입출고 합, consumed: 나간 수량(출고 + 줄인 조정), ins: 들어온 로트들
 */
export function itemState(
  input: { stock: number; consumed: number; par: number; trackExpiry: boolean; ins: readonly LotIn[] },
  today: string,
  settings: InventorySettings,
): ItemState {
  const lots = fefoLots(input.ins, input.consumed, today);
  const near = input.trackExpiry ? nearestExpiry(lots) : null;
  const q = qtyStatus(input.stock, input.par, settings.soonLowRatio);
  const e = input.trackExpiry && input.stock > 0 ? expiryStatus(near, today, settings.expiryWarnDays) : null;
  return {
    stock: roundQty(input.stock),
    status: displayStatus(q, e),
    nearestExpiry: input.stock > 0 ? near : null,
    dday: input.stock > 0 && near ? ddayOf(near, today) : null,
    lots,
  };
}

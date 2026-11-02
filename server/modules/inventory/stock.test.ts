// 이 파일이 하는 일: 재고 상태 계산 규칙(stock.ts, database.md §3.2)을 수용 기준 숫자로 확인한다(phase-03-task-01 AC3·AC4·AC5).
// 적정 6에서 현재 5·7·8의 상태, FEFO로 유효기간 2026-11-14 로트가 소진되면 다음 로트로 바뀌는지, 8,400 → 8,900 단가 인상 표시를 본다.
import { describe, expect, test } from 'vitest';
import { displayStatus, expiryStatus, fefoLots, isPriceUp, itemState, nearestExpiry, priceChangePct, qtyStatus, type LotIn } from './stock.ts';
import { DEFAULT_INVENTORY_SETTINGS, formatPriceChange } from '../../../shared/schemas/inventory.ts';

const TODAY = '2026-11-02';
const lot = (moveId: number, qty: number, expiryOn: string | null, movedAt = `2026-10-0${moveId}T01:00:00.000Z`): LotIn => ({ moveId, qty, lot: `L${moveId}`, expiryOn, movedAt });

describe('수량 상태', () => {
  test('phase-03-task-01 AC3: 적정 6, 현재 5 → 부족 / 7 → 곧 부족 / 8 → 정상', () => {
    expect(qtyStatus(5, 6)).toBe('low');
    expect(qtyStatus(7, 6)).toBe('soon_low');
    expect(qtyStatus(8, 6)).toBe('ok');
    // 경계: 적정과 같으면 곧 부족, 적정×1.2(7.2)까지 곧 부족
    expect(qtyStatus(6, 6)).toBe('soon_low');
    expect(qtyStatus(7.2, 6)).toBe('soon_low');
    expect(qtyStatus(7.3, 6)).toBe('ok');
  });

  test('phase-03-task-01 AC3: 적정 재고가 0이면 수량 상태를 계산하지 않는다', () => {
    expect(qtyStatus(0, 0)).toBe('ok');
  });

  test('phase-03-task-01 AC3: 표시 상태 우선순위는 만료 > 부족 > 임박 > 곧 부족 > 정상', () => {
    expect(displayStatus('low', 'expired')).toBe('expired');
    expect(displayStatus('low', 'expiring')).toBe('low');
    expect(displayStatus('soon_low', 'expiring')).toBe('expiring');
    expect(displayStatus('soon_low', null)).toBe('soon_low');
    expect(displayStatus('ok', null)).toBe('ok');
  });
});

describe('유효기간(FEFO)', () => {
  test('phase-03-task-01 AC4: 2026-11-14 로트가 남아 있으면 기준일 2026-11-02에 D-12(임박)', () => {
    const ins = [lot(2, 5, '2026-12-20'), lot(1, 3, '2026-11-14')];
    const lots = fefoLots(ins, 0, TODAY);
    expect(lots.map((l) => l.expiryOn)).toEqual(['2026-11-14', '2026-12-20']);
    expect(nearestExpiry(lots)).toBe('2026-11-14');
    const st = itemState({ stock: 8, consumed: 0, par: 2, trackExpiry: true, ins }, TODAY, DEFAULT_INVENTORY_SETTINGS);
    expect(st).toMatchObject({ nearestExpiry: '2026-11-14', dday: 12, status: 'expiring' });
  });

  test('phase-03-task-01 AC4: 출고로 그 로트가 모두 빠지면(FEFO) 다음 로트 기준으로 바뀐다', () => {
    const ins = [lot(1, 3, '2026-11-14'), lot(2, 5, '2026-12-20')];
    // 2개만 나가면 아직 11-14 로트가 1개 남는다
    expect(itemState({ stock: 6, consumed: 2, par: 2, trackExpiry: true, ins }, TODAY, DEFAULT_INVENTORY_SETTINGS).nearestExpiry).toBe('2026-11-14');
    // 3개가 나가면 11-14 로트가 소진되어 12-20(D-48, 30일 밖 → 정상)이 기준이 된다
    const after = itemState({ stock: 5, consumed: 3, par: 2, trackExpiry: true, ins }, TODAY, DEFAULT_INVENTORY_SETTINGS);
    expect(after).toMatchObject({ nearestExpiry: '2026-12-20', dday: 48, status: 'ok' });
    expect(after.lots.map((l) => l.remaining)).toEqual([0, 5]);
  });

  test('phase-03-task-01 AC4: 유효기간이 없는 로트는 맨 뒤에 빼고, 지난 날짜는 만료다', () => {
    const lots = fefoLots([lot(1, 2, null), lot(2, 2, '2026-10-30')], 1, TODAY);
    expect(lots.map((l) => [l.expiryOn, l.remaining])).toEqual([
      ['2026-10-30', 1],
      [null, 2],
    ]);
    expect(expiryStatus('2026-10-30', TODAY)).toBe('expired');
    expect(expiryStatus('2026-12-02', TODAY)).toBe('expiring');
    expect(expiryStatus('2026-12-03', TODAY)).toBeNull();
  });

  test('phase-03-task-01 AC4: 유효기간 관리를 하지 않는 품목은 유효기간 상태를 보지 않는다', () => {
    const st = itemState({ stock: 3, consumed: 0, par: 1, trackExpiry: false, ins: [lot(1, 3, '2026-10-01')] }, TODAY, DEFAULT_INVENTORY_SETTINGS);
    expect(st).toMatchObject({ status: 'ok', nearestExpiry: null, dday: null });
  });
});

describe('단가 변동', () => {
  test('phase-03-task-01 AC5: 직전 단가 8,400 → 8,900이면 ▲6%로 인상 표시', () => {
    const pct = priceChangePct(8400, 8900);
    expect(pct).toBeCloseTo(5.95, 2);
    expect(isPriceUp(pct, 5)).toBe(true);
    expect(formatPriceChange(pct)).toBe('▲6%');
  });

  test('phase-03-task-01 AC5: 5% 이하 인상·인하·직전 단가 없음은 인상 표시를 하지 않는다', () => {
    expect(isPriceUp(priceChangePct(10000, 10500), 5)).toBe(false);
    expect(isPriceUp(priceChangePct(10000, 9000), 5)).toBe(false);
    expect(formatPriceChange(priceChangePct(10000, 9000))).toBe('▼10%');
    expect(priceChangePct(null, 9000)).toBeNull();
    expect(priceChangePct(0, 9000)).toBeNull();
  });
});

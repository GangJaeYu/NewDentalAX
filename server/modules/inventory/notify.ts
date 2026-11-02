// 이 파일이 하는 일: 재고 알림(FR-052 AC3, overview §3.8)을 만든다. 받는 사람은 실장(manager) 이상이다.
// ① 부족: 출고·조정 직후(service.ts)와 매시 정각 알림 찾기(notifyJob)에서, 같은 품목은 하루 한 번(dedupe 'stock_low:item:<id>:<날짜>').
// ② 유효기간: 매시 정각 알림 찾기에서, 남은 로트의 유효기간이 설정 일수(기본 30일)·7일·당일·지남 단계에 들어설 때 단계마다 한 번.
// 이 파일을 import하면 기한형 알림 찾기(server/jobs/notify-job.ts)에 'inventory.stock' scanner가 등록된다(routes.ts가 import한다).
import type { NotificationInput } from '../notifications/emit.ts';
import { registerNotifyScanner, type NotifyScanContext } from '../../jobs/notify-job.ts';
import { ddayLabel, todayKst } from '../../lib/dates.ts';
import type { ItemRow } from '../../../shared/schemas/inventory.ts';
import { readInventorySettings } from './settings.ts';
import { listItems } from './service.ts';

/** 수량 글자(소수 오차 없이) */
function q(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/** 부족 알림 한 건(같은 날 같은 품목은 dedupe로 한 번만 들어간다) */
export function lowStockNotice(item: Pick<ItemRow, 'id' | 'name' | 'stock' | 'par' | 'unit'>, today: string): NotificationInput {
  return {
    type: 'stock_low',
    role: 'manager',
    title: `${item.name} 재고가 부족해요`,
    body: `현재 ${q(item.stock)}${item.unit} · 적정 ${q(item.par)}${item.unit}`,
    link: `/inventory/items/${item.id}`,
    dedupeKey: `stock_low:item:${item.id}:${today}`,
  };
}

/** 유효기간 단계: 지남 / 당일 / 7일 안 / 설정 일수 안 */
export function expiryStage(dday: number, warnDays: number): 'expired' | 'd0' | 'd7' | 'warn' | null {
  if (dday < 0) return 'expired';
  if (dday === 0) return 'd0';
  if (dday <= 7) return 'd7';
  if (dday <= warnDays) return 'warn';
  return null;
}

/** 유효기간 알림 한 건(로트 날짜·단계마다 한 번) */
export function expiryNotice(item: Pick<ItemRow, 'id' | 'name' | 'nearestExpiry' | 'dday'>, warnDays: number): NotificationInput | null {
  if (!item.nearestExpiry || item.dday === null) return null;
  const stage = expiryStage(item.dday, warnDays);
  if (!stage) return null;
  return {
    type: 'stock_expiry',
    role: 'manager',
    title: stage === 'expired' ? `${item.name} 유효기간이 지났어요` : `${item.name} 유효기간이 ${ddayLabel(item.dday)}예요`,
    body: `가장 빠른 유효기간 ${item.nearestExpiry}`,
    link: `/inventory/items/${item.id}`,
    dedupeKey: `stock_expiry:item:${item.id}:${item.nearestExpiry}:${stage}`,
  };
}

/** 지금 만들어야 할 재고 알림 목록(사용 중 품목만) */
export function scanInventory({ db, clock }: NotifyScanContext): NotificationInput[] {
  const s = readInventorySettings(db);
  const today = todayKst(clock);
  const { data } = listItems(db, clock, { status: 'warning', pageSize: 200, page: 1 });
  let rows = data;
  // 200개가 넘으면 나머지 쪽도 읽는다
  for (let page = 2; rows.length === (page - 1) * 200; page++) {
    const more = listItems(db, clock, { status: 'warning', pageSize: 200, page }).data;
    if (!more.length) break;
    rows = rows.concat(more);
  }
  const out: NotificationInput[] = [];
  for (const r of rows) {
    if (r.status === 'low') out.push(lowStockNotice(r, today));
    if (r.trackExpiry) {
      const n = expiryNotice(r, s.expiryWarnDays);
      if (n) out.push(n);
    }
  }
  return out;
}

/** 기한형 알림 찾기에 등록한다(같은 이름으로 다시 등록하면 바꿔 끼운다) */
export const unregisterInventoryScanner = registerNotifyScanner({ name: 'inventory.stock', scan: scanInventory });

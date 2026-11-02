// 이 파일이 하는 일: 재고 설정(settings 테이블의 'inventory' 키, database.md §5)을 읽는다.
// 유효기간 임박 일수(기본 30일), 단가 인상 표시 비율(기본 5%), "곧 부족" 배수(기본 1.2)다. 값이 없거나 틀리면 기본값을 쓴다.
// 설정을 바꾸는 화면·API(PUT /api/settings/inventory)는 관리자 설정 쪽 태스크가 만든다. 여기서는 읽기만 한다.
import type { Db } from '../../db/index.ts';
import { DEFAULT_INVENTORY_SETTINGS, type InventorySettings } from '../../../shared/schemas/inventory.ts';

/** 숫자이고 범위 안이면 그 값, 아니면 기본값 */
function pick(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

/** 재고 설정을 읽는다(없으면 기본값) */
export function readInventorySettings(db: Db): InventorySettings {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'inventory'");
  let raw: Record<string, unknown> = {};
  try {
    const v: unknown = row ? JSON.parse(row.value) : {};
    if (v && typeof v === 'object' && !Array.isArray(v)) raw = v as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const d = DEFAULT_INVENTORY_SETTINGS;
  return {
    expiryWarnDays: pick(raw.expiryWarnDays, 0, 365, d.expiryWarnDays),
    priceAlertPct: pick(raw.priceAlertPct, 0, 1000, d.priceAlertPct),
    soonLowRatio: pick(raw.soonLowRatio, 1, 10, d.soonLowRatio),
  };
}

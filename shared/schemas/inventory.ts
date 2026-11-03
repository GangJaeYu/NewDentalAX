// 이 파일이 하는 일: 재고(품목·거래처·입출고·단가, FR-050~055)의 API 모양과 입력 검사 규칙을 서버와 화면이 함께 쓰게 둔다.
// 입력 검사는 zod 스키마로 하고, 틀리면 항목별 쉬운 한국어 이유가 나간다. 상태 이름(low·soon_low·expiring·expired·ok)의 한국어 표기도 여기 있다.
// 거래처 연락처는 사업자 정보라 저장하지만 AI 입력에는 넣지 않는다(FR-053 AC1). 환자 정보 항목은 두지 않는다.
// 품목 바코드(FR-130)는 글자로 두고, 앞뒤 공백을 지운 값이 병원 안에서 겹치지 않아야 한다(normalizeBarcode).
// shared 폴더는 다른 폴더를 import하지 않는다(zod만 쓴다).
import { z } from 'zod';

/** 품목 표시 상태(우선순위: expired > low > expiring > soon_low > ok) */
export const STOCK_STATUSES = ['expired', 'low', 'expiring', 'soon_low', 'ok'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/** 상태의 화면 표기 */
export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  expired: '만료',
  low: '부족',
  expiring: '유효기간 임박',
  soon_low: '곧 부족',
  ok: '정상',
};

/** 입출고 종류 */
export const MOVE_TYPES = ['in', 'out', 'adjust'] as const;
export type MoveType = (typeof MOVE_TYPES)[number];
export const MOVE_TYPE_LABELS: Record<MoveType, string> = { in: '입고', out: '출고', adjust: '조정' };

/** 재고 설정(settings.inventory, database.md §5) */
export interface InventorySettings {
  /** 유효기간 임박으로 볼 남은 일수 */
  expiryWarnDays: number;
  /** 단가 인상으로 볼 비율(%) */
  priceAlertPct: number;
  /** "곧 부족"으로 볼 적정 재고 배수 */
  soonLowRatio: number;
}
export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = { expiryWarnDays: 30, priceAlertPct: 5, soonLowRatio: 1.2 };

/** 목록 한 줄(GET /api/items) */
export interface ItemRow {
  id: number;
  name: string;
  category: string;
  unit: string;
  /** 적정 재고(0이면 수량 상태를 계산하지 않음) */
  par: number;
  /** 현재고(입출고 합) */
  stock: number;
  status: StockStatus;
  /** 남은 수량이 있는 가장 빠른 유효기간(관리 품목만, 없으면 null) */
  nearestExpiry: string | null;
  /** 그 유효기간까지 남은 날(오늘 0, 지났으면 음수) */
  dday: number | null;
  trackExpiry: boolean;
  vendorId: number | null;
  vendor: string | null;
  location: string | null;
  memo: string | null;
  /** 바코드 값(EAN-13·Code128·QR 등, 없으면 null) */
  barcode: string | null;
  active: boolean;
  /** 최근 입고 단가(없으면 null) */
  lastPrice: number | null;
  /** 직전 입고 단가 대비 변동률(%)(비교할 단가가 없으면 null) */
  priceChangePct: number | null;
  /** 정해 둔 비율보다 많이 올랐으면 그 변동률(%), 아니면 null */
  priceUpPct: number | null;
  /** 입출고 기록 수 */
  moveCount: number;
}

/** 목록 응답: { data, total, counts } — counts는 상태 필터 전 건수 */
export interface ItemPage {
  data: ItemRow[];
  total: number;
  counts: Record<StockStatus | 'all' | 'warning', number>;
  categories: string[];
}

/** 유효기간 로트 하나의 남은 수량(FEFO 계산 결과) */
export interface LotRemain {
  /** 입고 기록 번호 */
  moveId: number;
  lot: string | null;
  expiryOn: string | null;
  /** 들어온 수량 */
  qty: number;
  /** 남은 수량 */
  remaining: number;
  dday: number | null;
}

/** 입출고 기록 한 줄 */
export interface MoveRow {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  type: MoveType;
  qty: number;
  unitPrice: number | null;
  vendorId: number | null;
  vendor: string | null;
  lot: string | null;
  expiryOn: string | null;
  reason: string | null;
  orderId: number | null;
  movedAt: string;
  userName: string | null;
}

/** 단가 기록 한 줄(GET /api/prices) */
export interface PriceRow {
  moveId: number;
  itemId: number;
  itemName: string;
  unit: string;
  vendorId: number | null;
  vendor: string | null;
  unitPrice: number;
  /** 같은 품목 직전 입고 단가 */
  prevPrice: number | null;
  /** 직전 대비 변동률(%) */
  changePct: number | null;
  /** 정해 둔 비율보다 많이 올랐는지 */
  up: boolean;
  movedAt: string;
}

/** 품목 상세(GET /api/items/:id) */
export interface ItemDetail extends ItemRow {
  lots: LotRemain[];
  recentMoves: MoveRow[];
  /** 오래된 것부터 단가 기록 */
  prices: PriceRow[];
  defaultVendor: { id: number; name: string } | null;
}

/** 거래처 한 줄 */
export interface VendorRow {
  id: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  orderMethod: string | null;
  memo: string | null;
  active: boolean;
  /** 이 거래처를 기본 거래처로 둔 사용 중 품목 수 */
  itemCount: number;
}

/** 품목 저장 결과(같은 이름이 있으면 warnings) */
export interface ItemSaveResult {
  item: ItemRow;
  warnings: string[];
}

/** 품목 삭제 결과: 기록이 있으면 "사용 안 함"으로 바뀐다 */
export interface ItemDeleteResult {
  deleted: boolean;
  deactivated: boolean;
}

/** 입출고 저장 결과 */
export interface MoveResult {
  move: MoveRow;
  item: ItemRow;
}

const text = (max: number, label: string) =>
  z
    .string({ error: `${label}을(를) 글자로 적어 주세요.` })
    .trim()
    .max(max, `${label}은(는) ${max}자 안으로 적어 주세요.`);
const optText = (max: number, label: string) =>
  z
    .union([text(max, label), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));
const dateText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 2026-11-14 형식으로 적어 주세요.')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), '없는 날짜예요. 다시 확인해 주세요.');

/** 바코드 최대 길이 */
export const BARCODE_MAX = 64;

/**
 * 바코드 글자를 비교하기 좋게 다듬는다: 앞뒤 공백·줄바꿈을 지운다. 비면 null.
 * 스캐너가 끝에 붙이는 Enter·Tab 글자도 여기서 사라진다.
 */
export function normalizeBarcode(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.replace(/^[\s\p{Cc}]+|[\s\p{Cc}]+$/gu, '');
  return t ? t : null;
}

/** 바코드 글자가 쓸 수 있는 값인지(제어 문자 없음, 64자 이하). 문제가 있으면 쉬운 이유, 없으면 null */
export function barcodeProblem(v: string): string | null {
  if (v.length > BARCODE_MAX) return `바코드는 ${BARCODE_MAX}자 안이어야 해요(지금 ${v.length}자).`;
  if (/\p{Cc}/u.test(v)) return '바코드에 쓸 수 없는 글자(줄바꿈·탭 등)가 들어 있어요.';
  return null;
}

/** 바코드 입력 칸: 빈 값·null은 "바코드 없음"(null), 값은 다듬어서 검사한다 */
const barcodeField = z
  .union([z.string({ error: '바코드를 글자로 적어 주세요.' }), z.null()])
  .transform((v, ctx): string | null => {
    const t = normalizeBarcode(v);
    if (t === null) return null;
    const p = barcodeProblem(t);
    if (p) {
      ctx.addIssue({ code: 'custom', message: p });
      return z.NEVER;
    }
    return t;
  })
  .optional();

/** 품목 등록 입력 */
export const itemCreateSchema = z
  .object({
    name: text(80, '품목 이름').min(1, '품목 이름을 적어 주세요.'),
    category: text(30, '분류').min(1, '분류를 적어 주세요.'),
    unit: text(10, '단위').min(1, '단위를 적어 주세요(예: 박스, 팩).'),
    par: z.number({ error: '적정 재고를 숫자로 적어 주세요.' }).min(0, '적정 재고는 0 이상으로 적어 주세요.').max(1_000_000, '적정 재고가 너무 커요.'),
    trackExpiry: z.boolean({ error: '유효기간 관리 여부를 골라 주세요.' }).default(false),
    vendorId: z.union([z.number().int().positive(), z.null()]).optional().default(null),
    location: optText(40, '보관 위치'),
    memo: optText(300, '메모'),
    barcode: barcodeField,
  })
  .strict();
export type ItemCreateInput = z.output<typeof itemCreateSchema>;

/** 품목 수정 입력(보낸 항목만 바꾼다). active를 true로 보내면 다시 사용한다 */
export const itemPatchSchema = z
  .object({
    name: text(80, '품목 이름').min(1, '품목 이름을 적어 주세요.').optional(),
    category: text(30, '분류').min(1, '분류를 적어 주세요.').optional(),
    unit: text(10, '단위').min(1, '단위를 적어 주세요(예: 박스, 팩).').optional(),
    par: z.number({ error: '적정 재고를 숫자로 적어 주세요.' }).min(0, '적정 재고는 0 이상으로 적어 주세요.').max(1_000_000, '적정 재고가 너무 커요.').optional(),
    trackExpiry: z.boolean().optional(),
    vendorId: z.union([z.number().int().positive(), z.null()]).optional(),
    location: optText(40, '보관 위치'),
    memo: optText(300, '메모'),
    barcode: barcodeField,
    active: z.boolean().optional(),
  })
  .strict();
export type ItemPatchInput = z.output<typeof itemPatchSchema>;

/** 입출고 입력(POST /api/inventory/moves) */
export const moveSchema = z
  .object({
    itemId: z.number({ error: '품목을 골라 주세요.' }).int().positive('품목을 골라 주세요.'),
    type: z.enum(MOVE_TYPES, { error: '입고·출고·조정 중 하나를 골라 주세요.' }),
    qty: z.number({ error: '수량을 숫자로 적어 주세요.' }).max(1_000_000, '수량이 너무 커요.').min(-1_000_000, '수량이 너무 작아요.'),
    unitPrice: z.union([z.number().min(0, '단가는 0원 이상으로 적어 주세요.').max(100_000_000, '단가가 너무 커요.'), z.null()]).optional(),
    vendorId: z.union([z.number().int().positive(), z.null()]).optional(),
    lot: optText(40, '로트 번호'),
    expiryOn: z.union([dateText, z.null(), z.literal('')]).optional(),
    reason: optText(200, '사유'),
    /** 재고보다 많이 출고하는 것을 확인했으면 true */
    force: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'adjust') {
      if (v.qty === 0) ctx.addIssue({ code: 'custom', path: ['qty'], message: '조정 수량은 0이 아니어야 해요(늘리면 +, 줄이면 −).' });
      if (!v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: '재고 조정은 사유를 꼭 적어 주세요.' });
    } else if (!(v.qty > 0)) {
      ctx.addIssue({ code: 'custom', path: ['qty'], message: '수량은 0보다 크게 적어 주세요.' });
    }
  });
export type MoveInput = z.output<typeof moveSchema>;

/** 거래처 입력 */
export const vendorCreateSchema = z
  .object({
    name: text(60, '상호').min(1, '상호를 적어 주세요.'),
    contactName: optText(30, '담당자 이름'),
    phone: optText(30, '업무용 연락처'),
    email: z
      .union([z.email({ error: '이메일 형식을 확인해 주세요.' }).max(80, '이메일은 80자 안으로 적어 주세요.'), z.literal(''), z.null()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v ? v : null)),
    orderMethod: optText(60, '주문 방법'),
    memo: optText(300, '메모'),
  })
  .strict();
export type VendorCreateInput = z.output<typeof vendorCreateSchema>;

export const vendorPatchSchema = vendorCreateSchema.partial().extend({ active: z.boolean().optional() }).strict();
export type VendorPatchInput = z.output<typeof vendorPatchSchema>;

/** 변동률(%)을 화면 표기로: 5.95 → "▲6%", -3.2 → "▼3%" */
export function formatPriceChange(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '';
  const r = Math.round(Math.abs(pct));
  if (pct > 0) return `▲${r}%`;
  if (pct < 0) return `▼${r}%`;
  return '0%';
}

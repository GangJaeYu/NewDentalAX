// 이 파일이 하는 일: 발주서(FR-054·063)의 API 모양과 입력 검사 규칙을 서버와 화면이 함께 쓰게 둔다.
// 상태는 작성(draft) → 발주함(ordered) → 입고 완료(received), 또는 취소(canceled)다. 권장 수량 계산(올림(적정 × 1.5 − 현재고))도 여기 둔다.
// 입력 검사는 zod 스키마로 하고, 틀리면 항목별 쉬운 한국어 이유가 나간다. 환자 정보 항목은 두지 않는다.
// shared 폴더는 다른 폴더를 import하지 않는다(zod만 쓴다).
import { z } from 'zod';

/** 발주서 상태 */
export const ORDER_STATUSES = ['draft', 'ordered', 'received', 'canceled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** 상태의 한국어 표기 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = { draft: '작성 중', ordered: '발주함', received: '입고 완료', canceled: '취소' };

/** 권장 수량 배수(적정 재고의 1.5배까지 채운다, FR-054 AC1) */
export const ORDER_FILL_RATIO = 1.5;

/**
 * 권장 수량 = 올림(적정 × 1.5 − 현재고). 소수 오차(0.1+0.2 같은 것)는 먼저 정리한 뒤 올린다.
 * 결과가 0 이하이면 0(주문할 필요 없음).
 */
export function suggestedQty(par: number, stock: number): number {
  const need = Math.round((par * ORDER_FILL_RATIO - stock) * 1000) / 1000;
  return need > 0 ? Math.ceil(need) : 0;
}

/** 발주서 목록 한 줄 */
export interface OrderRow {
  id: number;
  poNo: string;
  status: OrderStatus;
  vendorId: number | null;
  vendor: string | null;
  note: string | null;
  lineCount: number;
  /** 합계 수량 */
  totalQty: number;
  /** 합계 금액(단가가 없는 줄은 빼고 더한다) */
  total: number;
  /** 단가가 비어 있는 줄이 있으면 true(합계가 모자랄 수 있음) */
  missingPrice: boolean;
  createdBy: string | null;
  createdAt: string;
  orderedAt: string | null;
  receivedAt: string | null;
  canceledAt: string | null;
}

/** 발주서 품목 줄 */
export interface OrderLine {
  id: number;
  itemId: number;
  itemName: string;
  category: string;
  unit: string;
  qty: number;
  /** 만들 때의 최근 단가(없으면 null) */
  unitPrice: number | null;
  /** 수량 × 단가(단가가 없으면 null) */
  amount: number | null;
  /** 지금 재고·적정 재고(화면 참고용) */
  stock: number;
  par: number;
  trackExpiry: boolean;
  /** 입고 처리 때 실제로 들어온 수량(입고 완료 전에는 0) */
  receivedQty: number;
}

/** 발주서 상세(인쇄 화면도 이것을 쓴다) */
export interface OrderDetail extends OrderRow {
  lines: OrderLine[];
  /** 거래처 정보(사업자 정보) */
  vendorInfo: { name: string; contactName: string | null; phone: string | null; email: string | null; orderMethod: string | null } | null;
  /** 병원 정보(설정의 병원 기본 정보) */
  clinic: { name: string; phone: string | null; location: string | null };
}

/** 발주서 초안 만들기 결과 */
export interface OrderDraftResult {
  /** 새로 만든 초안(거래처마다 1건) */
  orders: OrderRow[];
  /** 이미 작성 중·발주한 발주서에 들어 있어 뺀 품목 수 */
  skipped: number;
}

/** 목록 응답 */
export interface OrderPage {
  data: OrderRow[];
  total: number;
  counts: Record<OrderStatus | 'all', number>;
}

const qtyField = z.number({ error: '수량을 숫자로 적어 주세요.' }).max(1_000_000, '수량이 너무 커요.');
const priceField = z.union([z.number({ error: '단가를 숫자로 적어 주세요.' }).min(0, '단가는 0원 이상으로 적어 주세요.').max(100_000_000, '단가가 너무 커요.'), z.null()]);
const idField = (msg: string) => z.number({ error: msg }).int(msg).positive(msg);
const dateText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 2026-11-14 형식으로 적어 주세요.')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), '없는 날짜예요. 다시 확인해 주세요.');

/** 품목 줄들에 같은 품목이 두 번 들어 있으면 오류 */
function noDuplicateItems(lines: ReadonlyArray<{ itemId: number }>, ctx: z.RefinementCtx): void {
  const seen = new Set<number>();
  lines.forEach((l, i) => {
    if (seen.has(l.itemId)) ctx.addIssue({ code: 'custom', path: ['lines', i, 'itemId'], message: '같은 품목이 두 번 들어 있어요. 한 줄로 합쳐 주세요.' });
    seen.add(l.itemId);
  });
}

/** 발주서 수정 입력(PATCH /api/orders/:id, 작성 중일 때만). lines를 보내면 품목 줄 전체를 바꾼다 */
export const orderPatchSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            itemId: idField('품목을 골라 주세요.'),
            qty: qtyField.refine((n) => n > 0, '수량은 0보다 크게 적어 주세요.'),
            unitPrice: priceField.optional(),
          })
          .strict(),
        { error: '품목 줄을 보내 주세요.' },
      )
      .min(1, '품목을 한 개 이상 넣어 주세요.')
      .max(200, '한 발주서에는 품목을 200개까지 넣을 수 있어요.')
      .optional(),
    vendorId: z.union([idField('거래처를 다시 골라 주세요.'), z.null()]).optional(),
    note: z
      .union([z.string({ error: '메모를 글자로 적어 주세요.' }).trim().max(300, '메모는 300자 안으로 적어 주세요.'), z.null()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v ? v : null)),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.lines) noDuplicateItems(v.lines, ctx);
  });
export type OrderPatchInput = z.output<typeof orderPatchSchema>;

/** 입고 처리 입력(POST /api/orders/:id/receive). 수량 0인 줄은 이번에 들어오지 않은 것으로 보고 기록하지 않는다 */
export const orderReceiveSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            itemId: idField('품목을 골라 주세요.'),
            qty: qtyField.min(0, '수량은 0 이상으로 적어 주세요.'),
            unitPrice: priceField.optional(),
            lot: z
              .union([z.string().trim().max(40, '로트 번호는 40자 안으로 적어 주세요.'), z.null()])
              .optional()
              .transform((v) => (v ? v : null)),
            expiryOn: z
              .union([dateText, z.null(), z.literal('')])
              .optional()
              .transform((v) => (v ? v : null)),
          })
          .strict(),
        { error: '입고할 품목 줄을 보내 주세요.' },
      )
      .min(1, '입고할 품목을 한 개 이상 넣어 주세요.')
      .max(200, '한 번에 200줄까지 입고할 수 있어요.'),
  })
  .strict()
  .superRefine((v, ctx) => {
    noDuplicateItems(v.lines, ctx);
    if (!v.lines.some((l) => l.qty > 0)) ctx.addIssue({ code: 'custom', path: ['lines'], message: '들어온 수량을 한 품목 이상 적어 주세요.' });
  });
export type OrderReceiveInput = z.output<typeof orderReceiveSchema>;

/** 발주 번호를 만든다: 2026년 11월, 3번째 → "PO-2611-003" */
export function formatPoNo(yyyymm: string, seq: number): string {
  return `PO-${yyyymm.slice(2, 4)}${yyyymm.slice(5, 7)}-${String(seq).padStart(3, '0')}`;
}

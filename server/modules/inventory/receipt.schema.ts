// 이 파일이 하는 일: 명세서 사진 입고 저장(POST /api/inventory/receipt-commit, backend.md §3.5) 입력을 zod로 검사한다. 틀리면 칸별 쉬운 한국어 이유가 나간다.
// 입력 {fileId, vendorId|vendorName, date, lines:[{itemId|newItem, qty, unitPrice, lot?, expiryOn?}], alsoExpense?}. 지출 옵션 모양은 발주 입고와 같다(expenseFromOrderSchema).
import { z } from 'zod';
import { expenseFromOrderSchema } from '../../../shared/schemas/finance.ts';

const dateText = z
  .string({ error: '날짜는 2026-11-14 형식으로 적어 주세요.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 2026-11-14 형식으로 적어 주세요.')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), '없는 날짜예요. 다시 확인해 주세요.');

const shortText = (max: number, label: string) =>
  z.string({ error: `${label}을(를) 글자로 적어 주세요.` }).trim().min(1, `${label}을(를) 적어 주세요.`).max(max, `${label}은(는) ${max}자 이하로 줄여 주세요.`);

/** 비워도 되는 글 칸(빈 글·null은 null로) */
const optText = (max: number, label: string) =>
  z
    .union([z.string({ error: `${label}을(를) 글자로 적어 주세요.` }).trim().max(max, `${label}은(는) ${max}자 이하로 줄여 주세요.`), z.null()])
    .optional()
    .transform((v) => (v ? v : null));

/** 새 품목으로 등록할 때 필요한 값(실장 이상만) */
const newItemSchema = z
  .object({
    name: shortText(80, '품목 이름'),
    category: shortText(30, '분류'),
    unit: shortText(10, '단위'),
    par: z.number({ error: '적정 재고를 숫자로 적어 주세요.' }).min(0, '적정 재고는 0 이상으로 적어 주세요.').max(1_000_000, '적정 재고가 너무 커요.').default(0),
  })
  .strict();

/** 입고할 줄 하나: 기존 품목(itemId)이나 새 품목(newItem) 중 하나 */
const lineSchema = z
  .object({
    itemId: z.number().int().positive('품목을 골라 주세요.').optional(),
    newItem: newItemSchema.optional(),
    qty: z.number({ error: '수량을 숫자로 적어 주세요.' }).positive('수량은 0보다 크게 적어 주세요.').max(1_000_000, '수량이 너무 커요.'),
    unitPrice: z.union([z.number({ error: '단가를 숫자로 적어 주세요.' }).min(0, '단가는 0원 이상으로 적어 주세요.').max(100_000_000, '단가가 너무 커요.'), z.null()]).optional(),
    lot: optText(40, '로트 번호'),
    expiryOn: z.union([dateText, z.null(), z.literal('')]).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.itemId && !v.newItem) ctx.addIssue({ code: 'custom', path: ['itemId'], message: '연결할 품목을 골라 주세요.' });
    if (v.itemId && v.newItem) ctx.addIssue({ code: 'custom', path: ['itemId'], message: '기존 품목과 새 품목 중 하나만 골라 주세요.' });
  });

/** 명세서 입고 저장 입력 */
export const receiptCommitSchema = z
  .object({
    fileId: z.number({ error: '올린 사진 번호가 없어요. 사진을 다시 올려 주세요.' }).int().positive('올린 사진 번호가 없어요. 사진을 다시 올려 주세요.'),
    vendorId: z.union([z.number().int().positive(), z.null()]).optional(),
    vendorName: optText(60, '거래처'),
    date: z.union([dateText, z.null()]).optional(),
    lines: z.array(lineSchema).min(1, '입고할 품목을 한 줄 이상 남겨 주세요.').max(50, '한 번에 50줄까지 저장할 수 있어요.'),
    alsoExpense: expenseFromOrderSchema.optional(),
  })
  .strict();
export type ReceiptCommitInput = z.output<typeof receiptCommitSchema>;

// 이 파일이 하는 일: 지출 기록·지출 분류·월간 요약(FR-110·111, backend.md §3.9)의 API 모양과 입력 검사 규칙을 서버와 화면이 함께 쓰게 둔다.
// 금액은 원 단위 정수, 결제 수단은 종류만(카드·계좌이체·현금·기타) 고른다. 매출·환자 관련 입력란은 없다(FR-110 AC3).
// 발주 입고 때 "지출로도 기록"하는 입력(expenseFromOrderSchema)도 여기 두고 발주서 입력(orders.ts)이 가져다 쓴다(FR-110 AC2, FR-054 AC3 연결).
// 입력 검사는 zod로 하고, 틀리면 항목별 쉬운 한국어 이유가 나간다. shared 폴더는 다른 폴더를 import하지 않는다(zod만 쓴다).
import { z } from 'zod';

/** 결제 수단 종류 */
export const PAY_METHODS = ['card', 'transfer', 'cash', 'other'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

/** 결제 수단의 한국어 표기 */
export const PAY_METHOD_LABELS: Record<PayMethod, string> = { card: '카드', transfer: '계좌이체', cash: '현금', other: '기타' };

/** 재료비 분류 표시(code). 발주 입고 지출의 기본 분류이자 재료비 추이 그래프 대상이다 */
export const MATERIAL_CODE = 'material';

/** 지출 한 건(목록·상세) */
export interface ExpenseRow {
  id: number;
  /** 지출 날짜(YYYY-MM-DD) */
  date: string;
  categoryId: number;
  category: string;
  vendorId: number | null;
  /** 거래처 이름(등록 거래처가 아니어도 적을 수 있다) */
  vendorName: string | null;
  /** 금액(원) */
  amount: number;
  payMethod: PayMethod;
  memo: string | null;
  /** 영수증 첨부(없으면 null). 내려받기는 GET /api/files/:id */
  file: { id: number; name: string; size: number } | null;
  /** 입고 묶음 참조('order:<id>'). 발주 입고에서 함께 만든 지출이면 값이 있다 */
  stockMoveRef: string | null;
  createdBy: string | null;
  createdAt: string;
}

/** 지출 목록 응답(GET /api/expenses) */
export interface ExpensePage {
  data: ExpenseRow[];
  total: number;
  /** 조건에 맞는 지출 금액 합계(원) */
  sum: number;
  /** 조회한 달(전체면 null) */
  month?: string | null;
}

/** 지출 분류 한 줄 */
export interface ExpenseCategory {
  id: number;
  name: string;
  /** 기능이 기대는 분류 표시('material' 등, 없으면 null) */
  code: string | null;
  sort: number;
  active: boolean;
  /** 이 분류를 쓴 지출 수(지운 것 제외) */
  used: number;
}

/** 전월·전년 동월 비교 */
export interface MonthCompare {
  month: string;
  total: number;
  /** 이번 달 − 비교 달(원) */
  diff: number;
  /** 증감 비율(비교 달이 0원이면 null) */
  diffRatio: number | null;
}

/** 월간 요약(GET /api/finance/monthly) */
export interface MonthlySummary {
  month: string;
  /** 이번 달 지출 합계(원) */
  total: number;
  /** 지출 건수 */
  count: number;
  /** 분류별 합계(큰 것부터). ratio는 합계 대비 비중(0~1) */
  byCategory: Array<{ categoryId: number; name: string; amount: number; count: number; ratio: number }>;
  prevMonth: MonthCompare;
  prevYear: MonthCompare;
  /** 거래처별 상위 5곳(거래처를 적은 지출만) */
  topVendors: Array<{ name: string; amount: number; count: number }>;
  /** 최근 12개월 재료비(오래된 달 → 이번 달) */
  materialTrend12: Array<{ month: string; amount: number }>;
}

/** 대시보드 "이번 달 지출" 카드 값 */
export interface MonthExpenseCard {
  month: string;
  total: number;
  count: number;
  /** 분류별 상위 3개 */
  top: Array<{ name: string; amount: number }>;
}

/** AI 월간 요약 결과(POST /api/finance/monthly/summary) */
export interface MonthlyAiResult {
  month: string;
  text: string;
  demo: boolean;
  costKrw: number;
  privacyNotice: string | null;
  /** AI에 보낸 집계 숫자(화면에 "이 숫자만 보냈어요"로 보여 준다) */
  sent: Record<string, number>;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' 입력 칸 */
export const monthField = z.string({ error: '월을 2026-11 형식으로 적어 주세요.' }).regex(MONTH_RE, '월을 2026-11 형식으로 적어 주세요.');

const dateField = z
  .string({ error: '날짜를 골라 주세요.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 2026-11-14 형식으로 적어 주세요.')
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), '없는 날짜예요. 다시 확인해 주세요.');

const idField = (msg: string) => z.number({ error: msg }).int(msg).positive(msg);

const amountField = z
  .number({ error: '금액을 숫자로 적어 주세요.' })
  .int('금액은 원 단위 정수로 적어 주세요.')
  .min(1, '금액은 1원 이상으로 적어 주세요.')
  .max(10_000_000_000, '금액이 너무 커요. 다시 확인해 주세요.');

/** 비워도 되는 글 칸(빈 글은 null로) */
const optionalText = (max: number, label: string) =>
  z
    .union([z.string({ error: `${label}을(를) 글자로 적어 주세요.` }).trim().max(max, `${label}은(는) ${max}자 안으로 적어 주세요.`), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

const payMethodField = z.enum(PAY_METHODS, { error: '결제 수단을 카드·계좌이체·현금·기타 중에서 골라 주세요.' });

/** 지출 기록 입력(POST /api/expenses). 거래처는 이름으로 받고, 등록 거래처와 이름이 같으면 서버가 연결한다 */
export const expenseCreateSchema = z
  .object({
    date: dateField,
    categoryId: idField('분류를 골라 주세요.'),
    vendorName: optionalText(60, '거래처'),
    amount: amountField,
    payMethod: payMethodField,
    memo: optionalText(300, '메모'),
  })
  .strict();
export type ExpenseCreateInput = z.output<typeof expenseCreateSchema>;

/** 지출 고치기 입력(PATCH /api/expenses/:id). 보낸 칸만 바꾼다 */
export const expensePatchSchema = z
  .object({
    date: dateField.optional(),
    categoryId: idField('분류를 골라 주세요.').optional(),
    vendorName: optionalText(60, '거래처'),
    amount: amountField.optional(),
    payMethod: payMethodField.optional(),
    memo: optionalText(300, '메모'),
  })
  .strict();
export type ExpensePatchInput = z.output<typeof expensePatchSchema>;

/** 지출 분류 전체 바꾸기(PUT /api/expense-categories). 순서대로 sort가 매겨진다. id가 없으면 새 분류 */
export const categoriesPutSchema = z
  .object({
    categories: z
      .array(
        z
          .object({
            id: idField('분류 번호가 올바르지 않아요.').optional(),
            name: z.string({ error: '분류 이름을 적어 주세요.' }).trim().min(1, '분류 이름을 적어 주세요.').max(20, '분류 이름은 20자 안으로 적어 주세요.'),
            active: z.boolean({ error: '사용 여부를 골라 주세요.' }).default(true),
          })
          .strict(),
        { error: '분류 목록을 보내 주세요.' },
      )
      .min(1, '분류를 한 개 이상 남겨 주세요.')
      .max(30, '분류는 30개까지 만들 수 있어요.'),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.categories.forEach((c, i) => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['categories', i, 'name'], message: '같은 이름의 분류가 두 번 있어요.' });
      seen.add(key);
    });
  });
export type CategoriesPutInput = z.output<typeof categoriesPutSchema>;

/** 발주 입고 때 "지출로도 기록" 입력. 금액은 입고 합계, 거래처는 발주서 거래처로 서버가 채운다. 분류를 비우면 재료비 */
export const expenseFromOrderSchema = z
  .object({
    categoryId: idField('분류를 골라 주세요.').optional(),
    payMethod: payMethodField.default('transfer'),
    date: dateField.optional(),
    memo: optionalText(300, '메모'),
  })
  .strict();
export type ExpenseFromOrderInput = z.output<typeof expenseFromOrderSchema>;

/** 'YYYY-MM' 달을 n달 옮긴다(예: 2026-01, -1 → 2025-12) */
export function shiftYearMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(yy).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`;
}

/** 증감 비율(비교 값이 0이면 null). 소수 넷째 자리까지 */
export function changeRatio(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 10000) / 10000;
}

// 이 파일이 하는 일: 지출 기록·월간 요약 화면(/finance/expenses, /finance/monthly)이 함께 쓰는 API 호출과 작은 계산을 둔다.
// 서버 API: GET/POST/PATCH/DELETE /api/expenses, POST/DELETE /api/expenses/:id/file(영수증), GET/PUT /api/expense-categories,
// GET /api/finance/monthly, POST /api/finance/monthly/summary(backend.md §3.9). 증감 문구·금액 입력 읽기 같은 계산은 순수 함수라 단위 테스트한다.
import { CSRF_HEADER } from '../../../../shared/schemas/auth.ts';
import type { ExpenseCategory, ExpensePage, ExpenseRow, MonthCompare, MonthlyAiResult, MonthlySummary } from '../../../../shared/schemas/finance.ts';
import { api, toApiError } from '../../lib/api.ts';
import { invalidate } from '../../lib/useApi.ts';

/** useApi 캐시 이름 앞부분(지출을 바꾸면 이 이름으로 시작하는 캐시를 모두 새로 받는다) */
export const FINANCE_KEY = 'finance';

/** 지출을 바꾼 뒤 목록·요약을 새로 받게 한다 */
export function refreshFinance(): void {
  invalidate(FINANCE_KEY);
}

/** 영수증으로 받을 수 있는 형식과 크기(서버 server/lib/files.ts의 expense 쓰임새와 같다) */
export const RECEIPT_ACCEPT = ['.pdf', '.jpg', '.jpeg', '.png'];
export const RECEIPT_MAX_BYTES = 20 * 1024 * 1024;

/** 지출 목록(달을 비우면 서버의 이번 달) */
export function fetchExpenses(month: string | null, categoryId: number | null): Promise<ExpensePage> {
  const qs = new URLSearchParams({ pageSize: '500' });
  if (month) qs.set('month', month);
  if (categoryId) qs.set('categoryId', String(categoryId));
  return api.page<ExpenseRow, { sum: number; month?: string | null }>(`/api/expenses?${qs.toString()}`).then((r) => ({ data: r.data, total: r.total, sum: r.sum ?? 0, month: r.month ?? null }));
}

/** 지출 분류 목록 */
export function fetchCategories(): Promise<ExpenseCategory[]> {
  return api.get<ExpenseCategory[]>('/api/expense-categories');
}

/** 월간 요약(달을 비우면 서버의 이번 달) */
export function fetchMonthly(month: string | null): Promise<MonthlySummary> {
  return api.get<MonthlySummary>(month ? `/api/finance/monthly?month=${month}` : '/api/finance/monthly');
}

/** AI 월간 요약(서버가 집계 숫자만 보낸다) */
export function runMonthlySummary(month: string): Promise<MonthlyAiResult> {
  return api.post<MonthlyAiResult>('/api/finance/monthly/summary', { month });
}

/** CSV 내려받기 주소 */
export function csvUrl(month: string, categoryId: number | null): string {
  const qs = new URLSearchParams({ format: 'csv', month });
  if (categoryId) qs.set('categoryId', String(categoryId));
  return `/api/expenses?${qs.toString()}`;
}

/** 영수증 올리기(multipart). 서버의 415·413 오류도 한국어 문구 그대로 ApiError로 던진다 */
export async function uploadReceipt(csrfToken: string | null, expenseId: number, file: File): Promise<ExpenseRow> {
  const fd = new FormData();
  fd.set('file', file, file.name);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api/expenses/${expenseId}/file`, { method: 'POST', credentials: 'same-origin', headers, body: fd });
  } catch {
    throw toApiError(0, { error: { code: 'NETWORK', message: '서버에 연결할 수 없어요. 원내 와이파이에 연결되어 있는지 확인해 주세요.' } });
  }
  const body = (await res.json().catch(() => null)) as { data?: ExpenseRow } | null;
  if (!res.ok || !body?.data) throw toApiError(res.status, body);
  return body.data;
}

/**
 * 금액 입력 글을 원 단위 정수로 읽는다(쉼표·"원"·띄어쓰기 허용). 숫자가 아니거나 1원보다 작거나 소수면 null.
 * 예: "120,000원" → 120000, "12.5" → null
 */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[,\s원]/g, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** 증감 문구: "지난달보다 12% 늘었어요" / "줄었어요" / "같아요" / 비교 달 0원이면 "비교할 지출이 없어요" */
export function compareText(c: MonthCompare, label: string): { text: string; tone: 'up' | 'down' | 'same' | 'none' } {
  if (c.diffRatio === null) return { text: `${label} 지출 기록이 없어 비교할 수 없어요`, tone: 'none' };
  if (c.diff === 0) return { text: `${label}과 같아요`, tone: 'same' };
  const pct = Math.round(Math.abs(c.diffRatio) * 1000) / 10;
  return c.diff > 0 ? { text: `${label}보다 ${pct}% 늘었어요`, tone: 'up' } : { text: `${label}보다 ${pct}% 줄었어요`, tone: 'down' };
}

/** 'YYYY-MM' → "11월"(그래프 축 글자) */
export function shortMonth(month: string): string {
  return `${Number(month.slice(5, 7))}월`;
}

/** 파일 크기 글자(KB·MB) */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

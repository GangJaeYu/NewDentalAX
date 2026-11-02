// 이 파일이 하는 일: 지출 기록·지출 분류·월간 요약(FR-110·111, backend.md §3.9, database.md §9)을 DB와 함께 처리한다.
// ① 지출 목록(달·분류 조건, 합계)·기록·고치기·지우기(deleted_at만 채움)·영수증 첨부·CSV ② 분류 바꾸기(쓴 분류는 지우지 않고 "사용 안 함")
// ③ 발주 입고 때 "지출로도 기록"(recordOrderExpense, 발주서 service가 같은 트랜잭션 안에서 부른다) ④ 월간 요약 숫자와 대시보드 "이번 달 지출" 카드 값
// ⑤ AI 월간 요약: 서버가 계산한 집계 숫자만 게이트웨이로 보낸다(개별 지출의 메모·영수증은 보내지 않는다, FR-111 AC2).
// 상태를 바꾸는 함수는 모두 감사 로그를 남긴다. 감사 기록에는 메모 원문을 넣지 않는다.
import fs from 'node:fs';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError, validationError } from '../../lib/errors.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { monthRange, thisMonthKst, todayKst } from '../../lib/dates.ts';
import { toCsv } from '../../lib/csv.ts';
import { getFile, saveUpload, storedFilePath, type SaveEnv } from '../../lib/files.ts';
import { runAi, type AiCallContext } from '../../ai/gateway.ts';
import {
  changeRatio,
  MATERIAL_CODE,
  PAY_METHOD_LABELS,
  shiftYearMonth,
  type CategoriesPutInput,
  type ExpenseCategory,
  type ExpenseCreateInput,
  type ExpenseFromOrderInput,
  type ExpensePage,
  type ExpensePatchInput,
  type ExpenseRow,
  type MonthExpenseCard,
  type MonthlyAiResult,
  type MonthlySummary,
  type PayMethod,
} from '../../../shared/schemas/finance.ts';

/** expenses 한 줄(+ 분류·만든 사람·첨부 이름) */
interface ExpenseDb {
  id: number;
  date: string;
  category_id: number;
  category_name: string;
  vendor_id: number | null;
  vendor_name: string | null;
  amount: number;
  pay_method: PayMethod;
  memo: string | null;
  file_id: number | null;
  file_name: string | null;
  file_size: number | null;
  stock_move_ref: string | null;
  created_by_name: string | null;
  created_at: string;
}

const EXPENSE_SELECT = `SELECT e.id, e.date, e.category_id, c.name AS category_name, e.vendor_id, e.vendor_name, e.amount, e.pay_method, e.memo,
  e.file_id, f.original_name AS file_name, f.size AS file_size, e.stock_move_ref, u.name AS created_by_name, e.created_at
  FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN files f ON f.id = e.file_id LEFT JOIN users u ON u.id = e.created_by`;

/** DB 줄 → 화면용 한 줄 */
function toExpense(r: ExpenseDb): ExpenseRow {
  return {
    id: r.id,
    date: r.date,
    categoryId: r.category_id,
    category: r.category_name,
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    amount: r.amount,
    payMethod: r.pay_method,
    memo: r.memo,
    file: r.file_id ? { id: r.file_id, name: r.file_name ?? '영수증', size: r.file_size ?? 0 } : null,
    stockMoveRef: r.stock_move_ref,
    createdBy: r.created_by_name,
    createdAt: r.created_at,
  };
}

// ---- 분류 ----

/** 지출 분류 목록(정한 순서대로, 쓴 지출 수 포함) */
export function listCategories(db: Db): ExpenseCategory[] {
  return db
    .all<{ id: number; name: string; code: string | null; sort: number; active: number; used: number }>(
      `SELECT c.id, c.name, c.code, c.sort, c.active, (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id AND e.deleted_at IS NULL) AS used
       FROM expense_categories c ORDER BY c.sort, c.id`,
    )
    .map((c) => ({ id: c.id, name: c.name, code: c.code, sort: c.sort, active: c.active === 1, used: c.used }));
}

/** 재료비 분류 번호(code 'material'). 없으면 null */
export function materialCategoryId(db: Db): number | null {
  return db.get<{ id: number }>('SELECT id FROM expense_categories WHERE code = ?', [MATERIAL_CODE])?.id ?? null;
}

/**
 * 분류 목록을 보낸 내용으로 바꾼다(순서 = 보낸 순서). id가 없으면 새로 만들고, 이름·사용 여부를 고친다.
 * 목록에서 빠진 분류는 지출에 쓴 적이 없으면 지우고, 쓴 적이 있으면 409(지우지 말고 "사용 안 함"으로). 재료비 분류는 지울 수 없다.
 */
export function putCategories(ctx: AuditContext, input: CategoriesPutInput): ExpenseCategory[] {
  const { db } = ctx;
  const before = listCategories(db);
  const byId = new Map(before.map((c) => [c.id, c]));
  input.categories.forEach((c, i) => {
    if (c.id !== undefined && !byId.has(c.id)) throw validationError({ [`categories.${i}.id`]: '없는 분류예요. 화면을 새로 고쳐 주세요.' });
  });
  const keep = new Set(input.categories.map((c) => c.id).filter((id): id is number => id !== undefined));
  const removed = before.filter((c) => !keep.has(c.id));
  for (const c of removed) {
    if (c.code === MATERIAL_CODE) throw new AppError('CONFLICT', { message: `"${c.name}" 분류는 발주 입고 지출에 쓰여서 지울 수 없어요. 이름만 바꿀 수 있어요.` });
    // 지운 지출이 가리키는 분류도 지우지 않는다(되살릴 때를 위해)
    const any = db.get('SELECT 1 AS x FROM expenses WHERE category_id = ? LIMIT 1', [c.id]);
    if (any) throw new AppError('CONFLICT', { message: `"${c.name}" 분류는 이미 쓴 지출이 있어서 지울 수 없어요. "사용 안 함"으로 바꿔 주세요.` });
  }
  db.tx(() => {
    for (const c of removed) db.run('DELETE FROM expense_categories WHERE id = ?', [c.id]);
    // 이름 바꾸기 중 UNIQUE 충돌(이름 맞바꾸기)을 피하려고 먼저 임시 이름으로 옮긴다
    for (const c of input.categories) if (c.id !== undefined) db.run('UPDATE expense_categories SET name = ? WHERE id = ?', [`__tmp_${c.id}`, c.id]);
    input.categories.forEach((c, i) => {
      if (c.id !== undefined) db.run('UPDATE expense_categories SET name = ?, active = ?, sort = ? WHERE id = ?', [c.name, c.active ? 1 : 0, i + 1, c.id]);
      else db.run('INSERT INTO expense_categories (name, code, sort, active) VALUES (?, NULL, ?, ?)', [c.name, i + 1, c.active ? 1 : 0]);
    });
    audit(ctx, 'expense_category.update', 'expense_categories', null, {
      total: input.categories.length,
      added: input.categories.filter((c) => c.id === undefined).length,
      removed: removed.length,
    });
  });
  return listCategories(db);
}

/** 분류가 있는지(없으면 400) */
function assertCategory(db: Db, id: number, field = 'categoryId'): void {
  if (!db.get('SELECT id FROM expense_categories WHERE id = ?', [id])) throw validationError({ [field]: '없는 분류예요. 분류를 다시 골라 주세요.' });
}

/** 거래처 이름 → 등록 거래처 번호와 저장할 이름(등록 거래처와 이름이 같으면 연결한다) */
function resolveVendor(db: Db, name: string | null | undefined): { id: number | null; name: string | null } {
  if (!name) return { id: null, name: null };
  const v = db.get<{ id: number; name: string }>('SELECT id, name FROM vendors WHERE name = ? COLLATE NOCASE', [name]);
  return v ? { id: v.id, name: v.name } : { id: null, name };
}

// ---- 지출 ----

/** 목록 조건 */
export interface ExpenseListQuery {
  /** 'YYYY-MM'(없으면 전체) */
  month?: string;
  categoryId?: number;
  page?: number;
  pageSize?: number;
}

/** 조건 → WHERE 절 */
function expenseWhere(q: ExpenseListQuery): { where: string; params: Array<string | number> } {
  const parts = ['e.deleted_at IS NULL'];
  const params: Array<string | number> = [];
  if (q.month) {
    const r = monthRange(q.month);
    parts.push('e.date BETWEEN ? AND ?');
    params.push(r.start, r.end);
  }
  if (q.categoryId) {
    parts.push('e.category_id = ?');
    params.push(q.categoryId);
  }
  return { where: `WHERE ${parts.join(' AND ')}`, params };
}

/** 지출 목록(최근 날짜부터)과 조건에 맞는 금액 합계 */
export function listExpenses(db: Db, q: ExpenseListQuery = {}): ExpensePage {
  const { where, params } = expenseWhere(q);
  const agg = db.get<{ n: number; sum: number | null }>(`SELECT COUNT(*) AS n, SUM(e.amount) AS sum FROM expenses e ${where}`, params);
  const pageSize = Math.min(500, Math.max(1, q.pageSize ?? 100));
  const page = Math.max(1, q.page ?? 1);
  const rows = db.all<ExpenseDb>(`${EXPENSE_SELECT} ${where} ORDER BY e.date DESC, e.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  return { data: rows.map(toExpense), total: agg?.n ?? 0, sum: agg?.sum ?? 0 };
}

/** 지출 한 건(지운 것은 404) */
export function getExpense(db: Db, id: number): ExpenseRow {
  const r = db.get<ExpenseDb>(`${EXPENSE_SELECT} WHERE e.id = ? AND e.deleted_at IS NULL`, [id]);
  if (!r) throw new AppError('NOT_FOUND', { message: '찾는 지출 기록이 없어요. 목록을 새로 고쳐 주세요.' });
  return toExpense(r);
}

/** 지출을 기록한다 */
export function createExpense(ctx: AuditContext, input: ExpenseCreateInput): ExpenseRow {
  const { db, clock } = ctx;
  assertCategory(db, input.categoryId);
  const vendor = resolveVendor(db, input.vendorName);
  const now = clock.now().toISOString();
  const id = db.tx(() => {
    const r = db.run(
      'INSERT INTO expenses (date, category_id, vendor_id, vendor_name, amount, pay_method, memo, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [input.date, input.categoryId, vendor.id, vendor.name, input.amount, input.payMethod, input.memo ?? null, ctx.user?.id ?? null, now, now],
    );
    audit(ctx, 'expense.create', 'expense', r.lastInsertRowid, { date: input.date, categoryId: input.categoryId, amount: input.amount, payMethod: input.payMethod });
    return r.lastInsertRowid;
  });
  return getExpense(db, id);
}

/** 지출을 고친다(보낸 칸만) */
export function updateExpense(ctx: AuditContext, id: number, input: ExpensePatchInput): ExpenseRow {
  const { db, clock } = ctx;
  const before = getExpense(db, id);
  if (input.categoryId !== undefined) assertCategory(db, input.categoryId);
  const sets: string[] = [];
  const params: Array<string | number | null> = [];
  const changed: string[] = [];
  const put = (col: string, key: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    params.push(v);
    changed.push(key);
  };
  if (input.date !== undefined) put('date', 'date', input.date);
  if (input.categoryId !== undefined) put('category_id', 'categoryId', input.categoryId);
  if (input.amount !== undefined) put('amount', 'amount', input.amount);
  if (input.payMethod !== undefined) put('pay_method', 'payMethod', input.payMethod);
  if (input.memo !== undefined) put('memo', 'memo', input.memo);
  if (input.vendorName !== undefined) {
    const v = resolveVendor(db, input.vendorName);
    put('vendor_name', 'vendorName', v.name);
    sets.push('vendor_id = ?');
    params.push(v.id);
  }
  if (!sets.length) return before;
  db.tx(() => {
    db.run(`UPDATE expenses SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, clock.now().toISOString(), id]);
    audit(ctx, 'expense.update', 'expense', id, { changed, amount: input.amount });
  });
  return getExpense(db, id);
}

/** 지출을 지운다(deleted_at만 채운다) */
export function deleteExpense(ctx: AuditContext, id: number): void {
  const { db, clock } = ctx;
  const before = getExpense(db, id);
  const now = clock.now().toISOString();
  db.tx(() => {
    db.run('UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
    audit(ctx, 'expense.delete', 'expense', id, { date: before.date, amount: before.amount });
  });
}

/** 예전 첨부 파일을 지운다(DB 줄과 저장 파일). 실패해도 지출 저장은 그대로 둔다 */
function dropFile(env: SaveEnv, fileId: number | null): void {
  if (!fileId) return;
  const row = getFile(env.db, fileId);
  if (!row) return;
  env.db.run('DELETE FROM files WHERE id = ?', [fileId]);
  const abs = storedFilePath(env.dataDir, row);
  try {
    if (abs) fs.rmSync(abs, { force: true });
  } catch {
    // 파일이 잠겨 있으면 남겨 둔다(다음 초기화 때 정리됨)
  }
}

/** 영수증을 붙인다(이미 있으면 바꾼다). 형식·크기 검사는 saveUpload가 한다(PDF·JPG·PNG, 20MB/사진 8MB) */
export function attachReceipt(env: SaveEnv, ctx: AuditContext, id: number, file: { name: string; data: Buffer }): ExpenseRow {
  const before = getExpense(env.db, id);
  const saved = saveUpload(env, { name: file.name, data: file.data, purpose: 'expense', userId: ctx.user?.id ?? null });
  env.db.tx(() => {
    env.db.run('UPDATE expenses SET file_id = ?, updated_at = ? WHERE id = ?', [saved.id, env.clock.now().toISOString(), id]);
    dropFile(env, before.file?.id ?? null);
    audit(ctx, 'expense.attach', 'expense', id, { fileId: saved.id, size: saved.size });
  });
  return getExpense(env.db, id);
}

/** 영수증 첨부를 뗀다 */
export function removeReceipt(env: SaveEnv, ctx: AuditContext, id: number): ExpenseRow {
  const before = getExpense(env.db, id);
  if (!before.file) return before;
  env.db.tx(() => {
    env.db.run('UPDATE expenses SET file_id = NULL, updated_at = ? WHERE id = ?', [env.clock.now().toISOString(), id]);
    dropFile(env, before.file?.id ?? null);
    audit(ctx, 'expense.detach', 'expense', id, null);
  });
  return getExpense(env.db, id);
}

/** 지출 CSV(엑셀 호환, UTF-8 BOM). 달·분류 조건은 목록과 같다 */
export function expensesCsv(db: Db, q: Omit<ExpenseListQuery, 'page' | 'pageSize'>): { csv: string; rows: number } {
  const { where, params } = expenseWhere(q);
  const rows = db.all<ExpenseDb>(`${EXPENSE_SELECT} ${where} ORDER BY e.date, e.id LIMIT 50000`, params);
  const table: unknown[][] = [['날짜', '분류', '거래처', '금액(원)', '결제 수단', '메모', '영수증']];
  for (const r of rows) table.push([r.date, r.category_name, r.vendor_name ?? '', r.amount, PAY_METHOD_LABELS[r.pay_method], r.memo ?? '', r.file_id ? '있음' : '']);
  return { csv: toCsv(table), rows: rows.length };
}

// ---- 발주 입고 → 지출 ----

/** 발주 입고 지출에 넣을 값(발주서 service가 채운다) */
export interface OrderExpenseInput {
  orderId: number;
  poNo: string;
  vendorId: number | null;
  /** 입고 합계 금액(원, 반올림한 정수) */
  amount: number;
  option: ExpenseFromOrderInput;
}

/** 입고 지출을 기록하기 전에 확인한다(트랜잭션 밖에서 먼저 불러 오류를 일찍 낸다). 쓸 분류 번호를 돌려준다 */
export function checkOrderExpense(db: Db, amount: number, option: ExpenseFromOrderInput): number {
  if (!(amount > 0)) {
    throw validationError({ alsoExpense: '단가가 적힌 품목이 없어 지출 금액을 계산할 수 없어요. 단가를 적거나 "지출로도 기록"을 꺼 주세요.' });
  }
  const categoryId = option.categoryId ?? materialCategoryId(db);
  if (!categoryId) throw validationError({ 'alsoExpense.categoryId': '재료비 분류가 없어요. 분류를 직접 골라 주세요.' });
  assertCategory(db, categoryId, 'alsoExpense.categoryId');
  return categoryId;
}

/**
 * 발주 입고를 지출 1건으로 기록한다(합계 금액·발주서 거래처·기본 재료비 분류, stock_move_ref = 'order:<id>').
 * 발주서 service의 입고 트랜잭션 안에서 불린다. 같은 발주서로 이미 기록한 지출이 있으면 409.
 */
export function recordOrderExpense(ctx: AuditContext, input: OrderExpenseInput): ExpenseRow {
  const { db, clock } = ctx;
  const categoryId = checkOrderExpense(db, input.amount, input.option);
  const ref = `order:${input.orderId}`;
  if (db.get('SELECT 1 AS x FROM expenses WHERE stock_move_ref = ? AND deleted_at IS NULL', [ref])) {
    throw new AppError('CONFLICT', { message: '이 발주서 입고는 이미 지출로 기록했어요.' });
  }
  const vendor = input.vendorId ? db.get<{ id: number; name: string }>('SELECT id, name FROM vendors WHERE id = ?', [input.vendorId]) : undefined;
  const now = clock.now().toISOString();
  const memo = input.option.memo ?? `발주서 ${input.poNo} 입고`;
  const r = db.run(
    'INSERT INTO expenses (date, category_id, vendor_id, vendor_name, amount, pay_method, memo, stock_move_ref, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [input.option.date ?? todayKst(clock), categoryId, vendor?.id ?? null, vendor?.name ?? null, input.amount, input.option.payMethod, memo, ref, ctx.user?.id ?? null, now, now],
  );
  audit(ctx, 'expense.create', 'expense', r.lastInsertRowid, { from: ref, categoryId, amount: input.amount, payMethod: input.option.payMethod });
  return getExpense(db, r.lastInsertRowid);
}

// ---- 월간 요약 ----

/** 그 달 지출 합계(원) */
function monthTotal(db: Db, month: string): number {
  const r = monthRange(month);
  return db.get<{ s: number | null }>('SELECT SUM(amount) AS s FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ?', [r.start, r.end])?.s ?? 0;
}

/** 비교 한 줄 */
function compare(db: Db, total: number, month: string): MonthlySummary['prevMonth'] {
  const before = monthTotal(db, month);
  return { month, total: before, diff: total - before, diffRatio: changeRatio(total, before) };
}

/** 월간 요약(FR-111 AC1): 합계·건수·분류별 비중·전월/전년 동월 대비·거래처 상위 5곳·최근 12개월 재료비 */
export function monthlySummary(db: Db, month: string): MonthlySummary {
  const r = monthRange(month);
  const agg = db.get<{ n: number; s: number | null }>('SELECT COUNT(*) AS n, SUM(amount) AS s FROM expenses WHERE deleted_at IS NULL AND date BETWEEN ? AND ?', [r.start, r.end]);
  const total = agg?.s ?? 0;
  const byCategory = db
    .all<{ id: number; name: string; amount: number; n: number }>(
      `SELECT c.id, c.name, SUM(e.amount) AS amount, COUNT(*) AS n FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.deleted_at IS NULL AND e.date BETWEEN ? AND ? GROUP BY c.id ORDER BY amount DESC, c.sort`,
      [r.start, r.end],
    )
    .map((c) => ({ categoryId: c.id, name: c.name, amount: c.amount, count: c.n, ratio: total ? Math.round((c.amount / total) * 10000) / 10000 : 0 }));
  const topVendors = db
    .all<{ name: string; amount: number; n: number }>(
      `SELECT COALESCE(v.name, e.vendor_name) AS name, SUM(e.amount) AS amount, COUNT(*) AS n FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id
       WHERE e.deleted_at IS NULL AND e.date BETWEEN ? AND ? AND COALESCE(v.name, e.vendor_name) IS NOT NULL
       GROUP BY COALESCE(v.name, e.vendor_name) COLLATE NOCASE ORDER BY amount DESC, name LIMIT 5`,
      [r.start, r.end],
    )
    .map((v) => ({ name: v.name, amount: v.amount, count: v.n }));
  const first = shiftYearMonth(month, -11);
  const trendRows = new Map(
    db
      .all<{ ym: string; amount: number }>(
        `SELECT substr(e.date, 1, 7) AS ym, SUM(e.amount) AS amount FROM expenses e JOIN expense_categories c ON c.id = e.category_id
         WHERE e.deleted_at IS NULL AND c.code = ? AND e.date BETWEEN ? AND ? GROUP BY ym`,
        [MATERIAL_CODE, monthRange(first).start, r.end],
      )
      .map((t) => [t.ym, t.amount]),
  );
  const materialTrend12 = Array.from({ length: 12 }, (_, i) => {
    const m = shiftYearMonth(first, i);
    return { month: m, amount: trendRows.get(m) ?? 0 };
  });
  return {
    month,
    total,
    count: agg?.n ?? 0,
    byCategory,
    prevMonth: compare(db, total, shiftYearMonth(month, -1)),
    prevYear: compare(db, total, shiftYearMonth(month, -12)),
    topVendors,
    materialTrend12,
  };
}

/** 대시보드 "이번 달 지출" 카드 값(phase-03-task-10이 대시보드에 연결한다). 이번 달은 서버 시계의 한국 날짜 기준 */
export function monthExpenseCard(db: Db, clock: Clock): MonthExpenseCard {
  const s = monthlySummary(db, thisMonthKst(clock));
  return { month: s.month, total: s.total, count: s.count, top: s.byCategory.slice(0, 3).map((c) => ({ name: c.name, amount: c.amount })) };
}

// ---- AI 월간 요약 ----

/** 이름을 숫자 칸 이름에 넣을 수 있게 줄인다(20자) */
function short(name: string): string {
  const t = name.replace(/\s+/g, ' ').trim();
  return t.length > 20 ? `${t.slice(0, 20)}…` : t;
}

/**
 * AI에 보낼 집계 숫자만 만든다. 합계·건수·전월/전년 대비·분류별 합계(상위 10)·거래처별 합계(상위 5)·재료비 추이 요약이다.
 * 개별 지출의 메모·날짜·영수증은 넣지 않는다(FR-111 AC2). 칸 이름은 분류·거래처 이름만 쓴다.
 */
export function aiNumbers(s: MonthlySummary): Record<string, number> {
  const out: Record<string, number> = {
    '이번 달 지출 합계(원)': s.total,
    '지출 건수': s.count,
    '지난달 지출 합계(원)': s.prevMonth.total,
    '전년 같은 달 지출 합계(원)': s.prevYear.total,
  };
  if (s.prevMonth.diffRatio !== null) out['지난달 대비 증감(%)'] = Math.round(s.prevMonth.diffRatio * 1000) / 10;
  if (s.prevYear.diffRatio !== null) out['전년 같은 달 대비 증감(%)'] = Math.round(s.prevYear.diffRatio * 1000) / 10;
  for (const c of s.byCategory.slice(0, 10)) out[`분류 ${short(c.name)} 합계(원)`] = c.amount;
  s.topVendors.forEach((v, i) => {
    out[`거래처 ${i + 1}위 ${short(v.name)} 합계(원)`] = v.amount;
  });
  const trend = s.materialTrend12.map((t) => t.amount);
  const past = trend.slice(0, -1).filter((n) => n > 0);
  out['이번 달 재료비(원)'] = trend.at(-1) ?? 0;
  if (past.length) out['지난 11개월 재료비 평균(원)'] = Math.round(past.reduce((a, b) => a + b, 0) / past.length);
  return out;
}

/** AI 월간 요약(FR-111 AC2): 서버가 그 달 숫자를 계산해 게이트웨이로 보낸다. 지출이 없는 달이면 400 */
export async function runMonthlyAi(ai: AiCallContext, month: string): Promise<MonthlyAiResult> {
  const s = monthlySummary(ai.db, month);
  if (s.count === 0) throw new AppError('VALIDATION', { message: '이 달에는 지출 기록이 없어서 요약할 숫자가 없어요.', fields: { month: '지출 기록이 있는 달을 골라 주세요.' } });
  const numbers = aiNumbers(s);
  const r = await runAi(ai, { feature: 'monthly_summary', input: { month, numbers } });
  return { month, text: r.text, demo: r.demo, costKrw: r.usage.costKrw, privacyNotice: r.privacy.notice, sent: numbers };
}

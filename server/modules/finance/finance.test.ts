// 이 파일이 하는 일: 지출 기록·월간 요약 API(backend.md §3.9, FR-110·111)를 실제 라우트와 DB로 확인한다(phase-04-task-04 AC1~AC4).
// AC1 직원은 지출·분류·월간 요약·첨부·AI 요약 API가 모두 403, AC2 발주 입고 "지출로도 기록" → 합계 금액·거래처·재료비 분류 1건(되돌림·중복 막기 포함),
// AC3 월간 요약 숫자 = 그 달 지출 합계 SQL, 빈 달은 0건, AC4 AI 요약 요청(가짜 LLM 서버가 받은 본문)에 메모 글이 없고 집계 숫자만 있다.
// 그 밖에 기록·고치기·지우기·영수증 첨부·CSV(UTF-8 BOM)·분류 바꾸기·대시보드 카드 값·데모 데이터를 본다. 시계는 2026-11-02 09:00(KST)에 멈춰 있다.
import { afterEach, describe, expect, test } from 'vitest';
import { makeAiEnv, putAiSettings, runAi, type AiTestEnv } from '../../../tests/helpers/ai-app.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { UTF8_BOM } from '../../lib/csv.ts';
import { seedDemoAll } from '../../db/seed/registry.ts';
import { aiNumbers, monthExpenseCard, monthlySummary } from './service.ts';
import type { ExpenseCategory, ExpensePage, ExpenseRow, MonthlyAiResult, MonthlySummary } from '../../../shared/schemas/finance.ts';
import type { OrderDetail, OrderDraftResult } from '../../../shared/schemas/orders.ts';

const FAKE_KEY = 'sk-ant-unit-ONLYFAKE-finance-3Kq8';
const SECRET_MEMO = '원장님 개인 메모 비밀글 7731';

let env: (AiTestEnv & { manager: TestLogin }) | null = null;

afterEach(async () => {
  if (env) await env.close();
  env = null;
});

async function setup() {
  const e = await makeAiEnv();
  env = { ...e, manager: loginAs(e.app, 'manager') };
  return env;
}
type Env = Awaited<ReturnType<typeof setup>>;

interface ErrBody {
  error?: { code: string; message: string; fields?: Record<string, string> };
}

async function call<T>(e: Env, who: TestLogin, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  const res = await e.app.inject({ method, url, headers: method === 'GET' ? who.headers : who.writeHeaders, ...(payload === undefined ? {} : { payload: payload as object }) });
  const text = res.body;
  return { status: res.statusCode, body: (text && res.headers['content-type']?.toString().includes('json') ? JSON.parse(text) : {}) as T & ErrBody, raw: text, headers: res.headers };
}

function categories(e: Env): ExpenseCategory[] {
  return e.app.db.all<{ id: number; name: string; code: string | null; sort: number; active: number }>('SELECT * FROM expense_categories ORDER BY sort').map((c) => ({ ...c, active: c.active === 1, used: 0 }));
}
const catId = (e: Env, name: string) => categories(e).find((c) => c.name === name)?.id ?? 0;

async function addExpense(e: Env, body: Record<string, unknown>): Promise<ExpenseRow> {
  const r = await call<{ data: ExpenseRow }>(e, e.manager, 'POST', '/api/expenses', { payMethod: 'card', ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data;
}

/** multipart 본문(파일 하나) */
function multipart(name: string, data: Buffer, type: string) {
  const boundary = '----dentalaxFinanceBoundary8Zx';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`);
  return { payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]), type: `multipart/form-data; boundary=${boundary}` };
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe('지출 권한', () => {
  test('phase-04-task-04 AC1: 직원(staff)은 지출·분류·월간 요약·영수증·AI 요약 API가 모두 403이고, 실장은 쓸 수 있다', async () => {
    const e = await setup();
    const mine = await addExpense(e, { date: '2026-11-01', categoryId: catId(e, '기타'), amount: 1000 });
    const denied: Array<[Parameters<typeof call>[2], string, unknown?]> = [
      ['GET', '/api/expenses'],
      ['GET', '/api/expenses?format=csv'],
      ['POST', '/api/expenses', { date: '2026-11-01', categoryId: 1, amount: 1000, payMethod: 'card' }],
      ['GET', `/api/expenses/${mine.id}`],
      ['PATCH', `/api/expenses/${mine.id}`, { amount: 2000 }],
      ['DELETE', `/api/expenses/${mine.id}`],
      ['POST', `/api/expenses/${mine.id}/file`, {}],
      ['DELETE', `/api/expenses/${mine.id}/file`],
      ['GET', '/api/expense-categories'],
      ['PUT', '/api/expense-categories', { categories: [{ name: '기타' }] }],
      ['GET', '/api/finance/monthly?month=2026-11'],
      ['POST', '/api/finance/monthly/summary', { month: '2026-11' }],
    ];
    for (const [method, url, body] of denied) {
      const r = await call(e, e.staff, method, url, body);
      expect(r.status, `${method} ${url}`).toBe(403);
      expect(r.body.error?.code).toBe('FORBIDDEN');
    }
    // 직원은 AI 게이트웨이로 직접 불러도 월간 요약 기능을 쓸 수 없다
    expect((await runAi(e, e.staff, { feature: 'monthly_summary', input: { month: '2026-11', numbers: { 합계: 1 } } })).statusCode).toBe(403);
    // 실장은 된다. 지출은 그대로 남아 있다
    expect((await call(e, e.manager, 'GET', '/api/expenses')).status).toBe(200);
    expect((await call(e, e.manager, 'GET', '/api/finance/monthly?month=2026-11')).status).toBe(200);
    expect((await call(e, e.admin, 'GET', '/api/expense-categories')).status).toBe(200);
    expect(e.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM expenses WHERE deleted_at IS NULL')?.n).toBe(1);
  });
});

describe('지출 기록·분류·첨부·CSV', () => {
  test('지출을 기록·고치기·지우면 목록·합계·감사 기록이 바뀌고, 등록 거래처 이름은 거래처에 연결된다', async () => {
    const e = await setup();
    const v = await call<{ data: { id: number } }>(e, e.manager, 'POST', '/api/vendors', { name: '미소치재' });
    const a = await addExpense(e, { date: '2026-11-01', categoryId: catId(e, '재료비'), vendorName: '미소치재', amount: 120000, memo: '레진 보충' });
    expect(a).toMatchObject({ category: '재료비', vendorId: v.body.data.id, vendorName: '미소치재', amount: 120000, payMethod: 'card', memo: '레진 보충', file: null });
    await addExpense(e, { date: '2026-10-31', categoryId: catId(e, '임대료'), vendorName: '하늘빌딩', amount: 3000000, payMethod: 'transfer' });

    const nov = await call<ExpensePage>(e, e.manager, 'GET', '/api/expenses?month=2026-11');
    expect(nov.body.data.map((x) => x.id)).toEqual([a.id]);
    expect(nov.body.sum).toBe(120000);
    const all = await call<ExpensePage>(e, e.manager, 'GET', '/api/expenses?month=all');
    expect(all.body.total).toBe(2);
    expect(all.body.sum).toBe(3120000);
    expect((await call<ExpensePage>(e, e.manager, 'GET', `/api/expenses?month=all&categoryId=${catId(e, '임대료')}`)).body.data[0]?.vendorId).toBeNull();
    // 달을 비우면 서버의 이번 달(2026-11)
    expect((await call<ExpensePage>(e, e.manager, 'GET', '/api/expenses')).body).toMatchObject({ month: '2026-11', total: 1, sum: 120000 });

    const p = await call<{ data: ExpenseRow }>(e, e.manager, 'PATCH', `/api/expenses/${a.id}`, { amount: 130000, memo: '', vendorName: '없는거래처' });
    expect(p.status).toBe(200);
    expect(p.body.data).toMatchObject({ amount: 130000, memo: null, vendorId: null, vendorName: '없는거래처' });

    // 잘못된 입력은 칸별 쉬운 문구
    const bad = await call(e, e.manager, 'POST', '/api/expenses', { date: '2026-02-30', categoryId: 999, amount: -5, payMethod: 'coupon' });
    expect(bad.status).toBe(400);
    expect(bad.body.error?.fields).toMatchObject({ date: '없는 날짜예요. 다시 확인해 주세요.', amount: '금액은 1원 이상으로 적어 주세요.' });
    expect((await call(e, e.manager, 'POST', '/api/expenses', { date: '2026-11-01', categoryId: 999, amount: 5, payMethod: 'card' })).body.error?.fields?.categoryId).toBe('없는 분류예요. 분류를 다시 골라 주세요.');
    // 매출·환자 입력란은 받지 않는다(FR-110 AC3)
    expect((await call(e, e.manager, 'POST', '/api/expenses', { date: '2026-11-01', categoryId: 1, amount: 5, payMethod: 'card', revenue: 100 })).status).toBe(400);

    expect((await call(e, e.manager, 'DELETE', `/api/expenses/${a.id}`)).status).toBe(204);
    expect((await call(e, e.manager, 'GET', `/api/expenses/${a.id}`)).status).toBe(404);
    expect((await call<ExpensePage>(e, e.manager, 'GET', '/api/expenses?month=2026-11')).body.total).toBe(0);
    const acts = e.app.db.all<{ action: string; detail: string }>("SELECT action, detail FROM audit_log WHERE action LIKE 'expense.%' ORDER BY id").map((r) => r.action);
    expect(acts).toEqual(['expense.create', 'expense.create', 'expense.update', 'expense.delete']);
    expect(JSON.stringify(e.app.db.all('SELECT detail FROM audit_log'))).not.toContain('레진 보충');
  });

  test('영수증(PNG)을 붙이고 내려받고 떼며, 실행 파일은 거절한다', async () => {
    const e = await setup();
    const a = await addExpense(e, { date: '2026-11-01', categoryId: catId(e, '기타'), amount: 5000 });
    const up = (name: string, data: Buffer, type: string) => {
      const m = multipart(name, data, type);
      return e.app.inject({ method: 'POST', url: `/api/expenses/${a.id}/file`, headers: { ...e.manager.writeHeaders, 'content-type': m.type }, payload: m.payload });
    };
    const ok = await up('영수증.png', PNG, 'image/png');
    expect(ok.statusCode, ok.body).toBe(200);
    const file = ok.json<{ data: ExpenseRow }>().data.file;
    expect(file).toMatchObject({ name: '영수증.png', size: PNG.length });
    const dl = await e.app.inject({ method: 'GET', url: `/api/files/${file?.id}`, headers: e.manager.headers });
    expect(dl.statusCode).toBe(200);
    expect((await e.app.inject({ method: 'GET', url: `/api/files/${file?.id}`, headers: e.staff.headers })).statusCode).toBe(403);
    expect((await up('virus.exe', Buffer.from('MZ....'), 'application/octet-stream')).statusCode).toBe(415);
    const off = await call<{ data: ExpenseRow }>(e, e.manager, 'DELETE', `/api/expenses/${a.id}/file`);
    expect(off.body.data.file).toBeNull();
    expect(e.app.db.get('SELECT id FROM files WHERE id = ?', [file?.id ?? 0])).toBeUndefined();
  });

  test('CSV는 UTF-8 BOM·한글 머리글이고, 그 달 지출만 담는다', async () => {
    const e = await setup();
    await addExpense(e, { date: '2026-11-01', categoryId: catId(e, '재료비'), vendorName: '한빛덴탈', amount: 48600, memo: '글러브, 팁' });
    await addExpense(e, { date: '2026-10-01', categoryId: catId(e, '임대료'), amount: 3300000 });
    const r = await call(e, e.manager, 'GET', '/api/expenses?format=csv&month=2026-11');
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('text/csv');
    expect(r.raw.startsWith(UTF8_BOM)).toBe(true);
    const lines = r.raw.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('날짜,분류,거래처,금액(원),결제 수단,메모,영수증');
    expect(lines.slice(1)).toEqual(['2026-11-01,재료비,한빛덴탈,48600,카드,"글러브, 팁",']);
  });

  test('분류를 더하고 이름·순서·사용 여부를 바꾸며, 쓴 분류와 재료비 분류는 지울 수 없다', async () => {
    const e = await setup();
    const before = categories(e);
    expect(before.map((c) => c.name)).toEqual(['재료비', '장비', '임대료', '공과금', '인건비 외', '마케팅', '기타']);
    await addExpense(e, { date: '2026-11-01', categoryId: catId(e, '마케팅'), amount: 10000 });
    const keep = before.filter((c) => c.name !== '장비').map((c) => ({ id: c.id, name: c.name === '재료비' ? '재료·소모품' : c.name, active: c.name !== '공과금' }));
    const r = await call<{ data: ExpenseCategory[] }>(e, e.manager, 'PUT', '/api/expense-categories', { categories: [{ name: '교육비' }, ...keep] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.map((c) => `${c.name}:${c.active ? 'on' : 'off'}`)).toEqual(['교육비:on', '재료·소모품:on', '임대료:on', '공과금:off', '인건비 외:on', '마케팅:on', '기타:on']);
    expect(r.body.data.find((c) => c.name === '재료·소모품')?.code).toBe('material');
    expect(r.body.data.find((c) => c.name === '마케팅')?.used).toBe(1);
    // 쓴 분류(마케팅)를 빼면 409
    const used = await call(e, e.manager, 'PUT', '/api/expense-categories', { categories: r.body.data.filter((c) => c.name !== '마케팅').map((c) => ({ id: c.id, name: c.name })) });
    expect(used.status).toBe(409);
    expect(used.body.error?.message).toContain('"사용 안 함"으로 바꿔 주세요');
    const mat = await call(e, e.manager, 'PUT', '/api/expense-categories', { categories: r.body.data.filter((c) => c.code !== 'material').map((c) => ({ id: c.id, name: c.name })) });
    expect(mat.status).toBe(409);
    const dup = await call(e, e.manager, 'PUT', '/api/expense-categories', { categories: [{ name: '기타' }, { name: '기타' }] });
    expect(dup.status).toBe(400);
  });
});

describe('발주 입고 → 지출', () => {
  /** 거래처 1곳·부족 품목 2개 → 발주함 상태 발주서 */
  async function orderedPo(e: Env): Promise<{ id: number; glove: number; tip: number; vendorId: number }> {
    const v = (await call<{ data: { id: number } }>(e, e.manager, 'POST', '/api/vendors', { name: '한빛덴탈' })).body.data.id;
    const item = async (name: string, par: number, stock: number, price: number) => {
      const r = await call<{ data: { item: { id: number } } }>(e, e.manager, 'POST', '/api/items', { name, category: '소모품', unit: '박스', par, vendorId: v });
      await call(e, e.manager, 'POST', '/api/inventory/moves', { itemId: r.body.data.item.id, type: 'in', qty: stock, unitPrice: price });
      return r.body.data.item.id;
    };
    const glove = await item('니트릴 글러브 M', 6, 2, 8400); // 권장 7
    const tip = await item('석션 팁', 4, 1, 4200); // 권장 5
    const d = await call<{ data: OrderDraftResult }>(e, e.manager, 'POST', '/api/orders/draft', {});
    const id = d.body.data.orders[0]?.id ?? 0;
    expect((await call(e, e.manager, 'POST', `/api/orders/${id}/order`, {})).status).toBe(200);
    return { id, glove, tip, vendorId: v };
  }

  test('phase-04-task-04 AC2: "지출로도 기록"을 고르면 지출 목록에 입고 합계 금액·거래처·재료비 분류로 1건이 생긴다', async () => {
    const e = await setup();
    const po = await orderedPo(e);
    const r = await call<{ data: OrderDetail & { expense: ExpenseRow | null } }>(e, e.manager, 'POST', `/api/orders/${po.id}/receive`, {
      lines: [
        { itemId: po.glove, qty: 7, unitPrice: 8900 },
        { itemId: po.tip, qty: 3 },
      ],
      alsoExpense: { payMethod: 'card' },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('received');
    const total = 7 * 8900 + 3 * 4200; // 74,900원
    expect(r.body.data.expense).toMatchObject({ amount: total, category: '재료비', vendorId: po.vendorId, vendorName: '한빛덴탈', payMethod: 'card', date: '2026-11-02', stockMoveRef: `order:${po.id}` });
    const list = await call<ExpensePage>(e, e.manager, 'GET', '/api/expenses?month=2026-11');
    expect(list.body.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({ amount: total, category: '재료비', vendorName: '한빛덴탈' });
    expect(list.body.data[0]?.memo).toContain(r.body.data.poNo);
  });

  test('phase-04-task-04 AC2: 고르지 않으면 지출이 생기지 않고, 단가가 없거나 입고가 실패하면 지출도 함께 되돌린다', async () => {
    const e = await setup();
    const po = await orderedPo(e);
    const count = () => e.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM expenses')?.n;
    // 단가 0원 → 금액을 계산할 수 없어 400, 입고도 안 됨
    const zero = await call(e, e.manager, 'POST', `/api/orders/${po.id}/receive`, { lines: [{ itemId: po.glove, qty: 7, unitPrice: 0 }], alsoExpense: {} });
    expect(zero.status).toBe(400);
    expect(zero.body.error?.fields?.alsoExpense).toContain('지출 금액을 계산할 수 없어요');
    // 사용 안 함 품목이 섞이면 입고·지출 모두 되돌림
    expect((await call(e, e.manager, 'DELETE', `/api/items/${po.tip}`)).status).toBe(200);
    const fail = await call(e, e.manager, 'POST', `/api/orders/${po.id}/receive`, { lines: [{ itemId: po.glove, qty: 7 }, { itemId: po.tip, qty: 5 }], alsoExpense: {} });
    expect(fail.status).toBe(409);
    expect(count()).toBe(0);
    expect(e.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_moves WHERE order_id = ?', [po.id])?.n).toBe(0);
    // 고르지 않으면 입고만
    const plain = await call<{ data: { expense: unknown } }>(e, e.manager, 'POST', `/api/orders/${po.id}/receive`, { lines: [{ itemId: po.glove, qty: 7 }] });
    expect(plain.status).toBe(200);
    expect(plain.body.data.expense).toBeNull();
    expect(count()).toBe(0);
  });
});

describe('월간 요약', () => {
  test('phase-04-task-04 AC3: 월간 요약 합계·건수·분류별 합계가 그 달 지출 합계 SQL과 같고, 지운 지출은 빠진다', async () => {
    const e = await setup();
    await e.app.inject({ method: 'POST', url: '/api/vendors', headers: e.manager.writeHeaders, payload: { name: '미소치재' } });
    const rows: Array<[string, string, number, string | null]> = [
      ['2026-10-01', '임대료', 3300000, '하늘빌딩'],
      ['2026-10-05', '재료비', 612000, '미소치재'],
      ['2026-10-17', '재료비', 354000, '바른메디칼'],
      ['2026-10-20', '공과금', 412000, null],
      ['2026-10-31', '마케팅', 220000, '동네소식'],
      ['2026-09-07', '재료비', 590000, '미소치재'],
      ['2026-09-01', '임대료', 3300000, '하늘빌딩'],
      ['2025-10-03', '재료비', 400000, '미소치재'],
      ['2026-11-01', '기타', 9900, null],
    ];
    for (const [date, cat, amount, vendorName] of rows) await addExpense(e, { date, categoryId: catId(e, cat), amount, vendorName });
    const gone = await addExpense(e, { date: '2026-10-15', categoryId: catId(e, '장비'), amount: 999999 });
    await call(e, e.manager, 'DELETE', `/api/expenses/${gone.id}`);

    const r = await call<{ data: MonthlySummary }>(e, e.manager, 'GET', '/api/finance/monthly?month=2026-10');
    expect(r.status).toBe(200);
    const s = r.body.data;
    const sql = e.app.db.get<{ s: number; n: number }>("SELECT SUM(amount) AS s, COUNT(*) AS n FROM expenses WHERE deleted_at IS NULL AND date >= '2026-10-01' AND date <= '2026-10-31'");
    expect(s.total).toBe(sql?.s);
    expect(s.total).toBe(4898000);
    expect(s.count).toBe(sql?.n);
    const byCatSql = e.app.db.all<{ name: string; s: number }>(
      "SELECT c.name, SUM(e.amount) AS s FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.deleted_at IS NULL AND e.date LIKE '2026-10-%' GROUP BY c.name ORDER BY s DESC",
    );
    expect(s.byCategory.map((c) => [c.name, c.amount])).toEqual(byCatSql.map((c) => [c.name, c.s]));
    expect(s.byCategory.reduce((a, c) => a + c.ratio, 0)).toBeCloseTo(1, 3);
    expect(s.prevMonth).toEqual({ month: '2026-09', total: 3890000, diff: 4898000 - 3890000, diffRatio: Math.round(((4898000 - 3890000) / 3890000) * 10000) / 10000 });
    expect(s.prevYear).toMatchObject({ month: '2025-10', total: 400000 });
    expect(s.topVendors.map((v) => [v.name, v.amount])).toEqual([
      ['하늘빌딩', 3300000],
      ['미소치재', 612000],
      ['바른메디칼', 354000],
      ['동네소식', 220000],
    ]);
    expect(s.materialTrend12).toHaveLength(12);
    expect(s.materialTrend12[0]).toEqual({ month: '2025-11', amount: 0 });
    expect(s.materialTrend12.slice(-2)).toEqual([
      { month: '2026-09', amount: 590000 },
      { month: '2026-10', amount: 966000 },
    ]);
    // 서비스 함수도 같은 값(대시보드가 쓴다)
    expect(monthlySummary(e.app.db, '2026-10').total).toBe(4898000);
  });

  test('phase-04-task-04 AC3: 지출이 없는 달은 합계 0·0건·분류 없음(화면이 빈 상태 안내를 보인다), 달을 비우면 이번 달', async () => {
    const e = await setup();
    await addExpense(e, { date: '2026-11-01', categoryId: catId(e, '기타'), amount: 9900 });
    const empty = (await call<{ data: MonthlySummary }>(e, e.manager, 'GET', '/api/finance/monthly?month=2026-03')).body.data;
    expect(empty).toMatchObject({ month: '2026-03', total: 0, count: 0, byCategory: [], topVendors: [] });
    expect(empty.prevMonth.diffRatio).toBeNull();
    const now = (await call<{ data: MonthlySummary }>(e, e.manager, 'GET', '/api/finance/monthly')).body.data;
    expect(now).toMatchObject({ month: '2026-11', total: 9900, count: 1 });
    expect((await call(e, e.manager, 'GET', '/api/finance/monthly?month=2026-13')).status).toBe(400);
    // 빈 달은 AI 요약도 하지 않는다
    const ai = await call(e, e.manager, 'POST', '/api/finance/monthly/summary', { month: '2026-03' });
    expect(ai.status).toBe(400);
    expect(ai.body.error?.message).toBe('이 달에는 지출 기록이 없어서 요약할 숫자가 없어요.');
  });

  test('대시보드 "이번 달 지출" 카드 값: 이번 달 합계·건수·분류 상위 3개', async () => {
    const e = await setup();
    for (const [cat, amount] of [['재료비', 50000], ['임대료', 3000000], ['기타', 1000], ['마케팅', 20000]] as const) await addExpense(e, { date: '2026-11-01', categoryId: catId(e, cat), amount });
    await addExpense(e, { date: '2026-10-31', categoryId: catId(e, '기타'), amount: 777 });
    expect(monthExpenseCard(e.app.db, e.clock)).toEqual({
      month: '2026-11',
      total: 3071000,
      count: 4,
      top: [
        { name: '임대료', amount: 3000000 },
        { name: '재료비', amount: 50000 },
        { name: '마케팅', amount: 20000 },
      ],
    });
  });
});

describe('AI 월간 요약', () => {
  test('phase-04-task-04 AC4: AI 요약 요청 본문(가짜 서버가 받은 것)에 개별 메모 글이 없고 집계 숫자만 있다', async () => {
    const e = await setup();
    await putAiSettings(e, { provider: 'anthropic', keys: { anthropic: FAKE_KEY } });
    e.fake.setReply('이번 달은 재료비가 늘었어요. 묶음 주문을 권해요.', { input: 400, output: 60 });
    await addExpense(e, { date: '2026-10-05', categoryId: catId(e, '재료비'), vendorName: '미소치재', amount: 612000, memo: SECRET_MEMO });
    await addExpense(e, { date: '2026-10-09', categoryId: catId(e, '공과금'), amount: 412000, memo: '010-1234-5678 기사님께 연락' });
    await addExpense(e, { date: '2026-09-05', categoryId: catId(e, '재료비'), amount: 500000, memo: '9월 메모' });

    const r = await call<{ data: MonthlyAiResult }>(e, e.manager, 'POST', '/api/finance/monthly/summary', { month: '2026-10' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ month: '2026-10', demo: false, text: '이번 달은 재료비가 늘었어요. 묶음 주문을 권해요.' });
    expect(e.fake.requests).toHaveLength(1);
    const sent = e.fake.requests[0]?.rawBody ?? '';
    for (const memo of [SECRET_MEMO, '7731', '기사님', '010-1234-5678', '9월 메모', '2026-10-05', '2026-10-09']) expect(sent, memo).not.toContain(memo);
    // 집계 숫자는 들어 있다
    expect(sent).toContain('이번 달 지출 합계(원): 1024000');
    expect(sent).toContain('지난달 지출 합계(원): 500000');
    expect(sent).toContain('분류 재료비 합계(원): 612000');
    expect(sent).toContain('거래처 1위 미소치재 합계(원): 612000');
    // 화면에 보여 줄 "보낸 숫자"는 모두 숫자다
    expect(Object.values(r.body.data.sent).every((v) => typeof v === 'number')).toBe(true);
    expect(r.body.data.sent).toEqual(aiNumbers(monthlySummary(e.app.db, '2026-10')));
    expect(e.app.db.get<{ feature: string; status: string }>('SELECT feature, status FROM ai_usage ORDER BY id DESC LIMIT 1')).toEqual({ feature: 'monthly_summary', status: 'ok' });
  });

  test('phase-04-task-04 AC4: AI 기능 입력의 숫자 칸에는 글(메모)을 넣을 수 없고, 키가 없으면 데모 응답이다', async () => {
    const e = await setup();
    const withText = await runAi(e, e.admin, { feature: 'monthly_summary', input: { month: '2026-10', numbers: { 메모: SECRET_MEMO } } });
    expect(withText.statusCode).toBe(400);
    await addExpense(e, { date: '2026-10-05', categoryId: catId(e, '재료비'), amount: 612000, memo: SECRET_MEMO });
    const demo = await call<{ data: MonthlyAiResult }>(e, e.manager, 'POST', '/api/finance/monthly/summary', { month: '2026-10' });
    expect(demo.status).toBe(200);
    expect(demo.body.data.demo).toBe(true);
    expect(demo.body.data.text).toContain('[데모 응답]');
    expect(demo.body.data.text).toContain('612,000원');
    expect(demo.body.data.text).not.toContain(SECRET_MEMO);
    expect(e.fake.requests).toHaveLength(0);
    // 관리자가 기능을 끄면 403 AI_DISABLED
    await putAiSettings(e, { features: { monthly_summary: { enabled: false } } });
    const off = await call(e, e.manager, 'POST', '/api/finance/monthly/summary', { month: '2026-10' });
    expect(off.status).toBe(403);
    expect(off.body.error?.code).toBe('AI_DISABLED');
  });
});

describe('데모 데이터', () => {
  test('하늘숲치과 데모: 지난 3개월과 이번 달 기준일까지의 지출, 입고 완료 발주서가 재료비 지출로 이어진다', async () => {
    const e = await setup();
    await seedDemoAll(e.app.db, { clock: e.clock, scale: 1 });
    const months = e.app.db.all<{ ym: string; n: number }>('SELECT substr(date, 1, 7) AS ym, COUNT(*) AS n FROM expenses GROUP BY ym ORDER BY ym');
    expect(months.map((m) => m.ym)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    // 기준일(2026-11-02) 뒤의 지출은 없다
    expect(e.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM expenses WHERE date > '2026-11-02'")?.n).toBe(0);
    expect(e.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM expenses WHERE date LIKE '2026-11-%'")?.n).toBeGreaterThan(0);
    const linked = e.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM expenses WHERE stock_move_ref LIKE 'order:%'")?.n ?? 0;
    expect(linked).toBeGreaterThanOrEqual(1);
    const oct = monthlySummary(e.app.db, '2026-10');
    expect(oct.count).toBeGreaterThanOrEqual(9);
    expect(oct.materialTrend12.at(-1)?.amount).toBeGreaterThan(oct.materialTrend12.at(-2)?.amount ?? 0);
    expect(JSON.stringify(e.app.db.all('SELECT memo FROM expenses'))).not.toMatch(/환자|010-\d{4}/);
  });
});

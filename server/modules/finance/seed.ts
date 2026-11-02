// 이 파일이 하는 일: finance 모듈(지출)의 데모 데이터(database.md §11, 하늘숲치과). 지난 3개월과 이번 달(서버 시계의 한국 날짜 기준)의 지출을 넣는다.
// 매달 임대료·공과금·재료비(데모 거래처)·마케팅·기타가 들어가고, 재료비는 달마다 조금씩 오른다. 이번 달은 기준일까지의 지출만 넣는다.
// 재고 데모가 만든 "입고 완료" 발주서가 있으면 그 입고 합계를 재료비 지출 1건(stock_move_ref = order:<id>)으로 이어 둔다.
// 분류(expense_categories)는 070 마이그레이션이 넣고 초기화 때도 남으므로, 여기서는 지출만 넣고 초기화 대상도 expenses뿐이다. 환자 정보는 없다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { formatDate, parseDate, thisMonthKst, todayKst } from '../../lib/dates.ts';
import { shiftYearMonth, type PayMethod } from '../../../shared/schemas/finance.ts';

/** 이 모듈이 소유한 업무 테이블(초기화 때 비울 대상). 분류는 남긴다 */
export const tables: readonly string[] = ['expenses'];

/** 데모 지출 한 줄(달 안의 날짜, 분류 이름, 거래처, 금액, 결제 수단, 메모) */
interface DemoExpense {
  day: number;
  category: string;
  vendor: string | null;
  amount: number;
  pay: PayMethod;
  memo: string;
}

/** 한 달 치 데모 지출. n은 몇 달 전인지(0 = 이번 달), 재료비는 달마다 3%쯤 오른다 */
function monthPlan(n: number): DemoExpense[] {
  const up = (base: number) => Math.round((base * (1 + (3 - n) * 0.03)) / 100) * 100;
  return [
    { day: 1, category: '임대료', vendor: '하늘빌딩 관리사무소', amount: 3_300_000, pay: 'transfer', memo: '월 임대료' },
    { day: 3, category: '재료비', vendor: '한빛덴탈', amount: up(486_000), pay: 'card', memo: '글러브·석션 팁 정기 주문' },
    { day: 7, category: '재료비', vendor: '미소치재', amount: up(612_000), pay: 'transfer', memo: '레진·본딩제 보충' },
    { day: 10, category: '공과금', vendor: null, amount: 412_000 + (n % 2) * 38_000, pay: 'transfer', memo: '전기·수도 요금' },
    { day: 12, category: '마케팅', vendor: '동네소식 광고', amount: 220_000, pay: 'card', memo: '지역 소식지 광고' },
    { day: 15, category: '재료비', vendor: '바른메디칼', amount: up(354_000), pay: 'card', memo: '인상재·임시 재료' },
    { day: 18, category: '기타', vendor: '오피스나라', amount: 96_000 + n * 4_000, pay: 'card', memo: '사무용품·복사 용지' },
    { day: 21, category: '장비', vendor: null, amount: n === 1 ? 680_000 : 0, pay: 'card', memo: '석션 모터 수리' },
    { day: 24, category: '재료비', vendor: '청정위생', amount: up(278_000), pay: 'card', memo: '소독제·멸균 파우치' },
    { day: 26, category: '인건비 외', vendor: null, amount: 150_000, pay: 'cash', memo: '직원 간식·회식비' },
  ].filter((e) => e.amount > 0) as DemoExpense[];
}

/** 데모 지출을 넣는다(분류·거래처가 없으면 그 줄은 건너뛰거나 거래처 이름만 남긴다) */
export function seedDemo(db: Db, ctx: SeedContext): void {
  const today = todayKst(ctx.clock);
  const thisMonth = thisMonthKst(ctx.clock);
  const nowIso = ctx.clock.now().toISOString();
  const manager = db.get<{ id: number }>("SELECT id FROM users WHERE active = 1 AND role IN ('manager', 'admin') ORDER BY role DESC, id LIMIT 1")?.id ?? null;
  const categoryId = (name: string) => db.get<{ id: number }>('SELECT id FROM expense_categories WHERE name = ?', [name])?.id ?? null;
  const vendorId = (name: string | null) => (name ? (db.get<{ id: number }>('SELECT id FROM vendors WHERE name = ?', [name])?.id ?? null) : null);
  const scale = Math.max(1, Math.floor(ctx.scale || 1));
  const insert = (date: string, e: DemoExpense, ref: string | null = null) => {
    const cat = categoryId(e.category);
    if (!cat) return;
    db.run(
      'INSERT INTO expenses (date, category_id, vendor_id, vendor_name, amount, pay_method, memo, stock_move_ref, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [date, cat, vendorId(e.vendor), e.vendor, e.amount, e.pay, e.memo, ref, manager, nowIso, nowIso],
    );
  };

  db.tx(() => {
    for (let n = 3; n >= 0; n--) {
      const month = shiftYearMonth(thisMonth, -n);
      const [y, m] = parseDate(`${month}-01`);
      for (let k = 0; k < scale; k++) {
        for (const e of monthPlan(n)) {
          const date = formatDate(y, m, Math.min(e.day + k, 28));
          if (date > today) continue; // 이번 달은 기준일까지만
          insert(date, e);
        }
      }
    }
    // 재고 데모의 "입고 완료" 발주서를 재료비 지출로 잇는다
    const orders = db.all<{ id: number; po_no: string; vendor_id: number | null; received_at: string; total: number | null }>(
      `SELECT o.id, o.po_no, o.vendor_id, o.received_at, (SELECT SUM(l.qty * l.unit_price) FROM po_lines l WHERE l.po_id = o.id AND l.unit_price IS NOT NULL) AS total
       FROM purchase_orders o WHERE o.status = 'received' AND o.received_at IS NOT NULL`,
    );
    for (const o of orders) {
      const amount = Math.round(o.total ?? 0);
      const vendor = o.vendor_id ? (db.get<{ name: string }>('SELECT name FROM vendors WHERE id = ?', [o.vendor_id])?.name ?? null) : null;
      const date = todayKst({ now: () => new Date(o.received_at) });
      if (amount > 0 && !db.get('SELECT 1 AS x FROM expenses WHERE stock_move_ref = ?', [`order:${o.id}`])) {
        insert(date, { day: 0, category: '재료비', vendor, amount, pay: 'transfer', memo: `발주서 ${o.po_no} 입고` }, `order:${o.id}`);
      }
    }
  });
}

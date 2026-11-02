// 이 파일이 하는 일: 발주서 화면(목록·상세·인쇄)이 함께 쓰는 순수 계산과 서버 호출을 둔다.
// 편집 중인 줄의 합계 계산, 고친 줄 → PATCH 본문, 입고 입력 → receive 본문, 상태 칩 색, 쪽마다 넣을 인쇄 머리말(@page) 규칙이다.
// 계산 함수는 화면 없이 단위 테스트한다(ordersLib.test.ts).
import type { Tone } from '../../components/Chip.tsx';
import { api } from '../../lib/api.ts';
import type { OrderDetail, OrderDraftResult, OrderStatus } from '../../../../shared/schemas/orders.ts';

/** 발주서 화면 데이터 key 앞부분(재고 화면과 같이 다시 불러오게 'inventory'로 시작) */
export const ORDER_KEY = 'inventory:orders';

/** 상태별 칩 색 */
export const ORDER_TONE: Record<OrderStatus, Tone> = { draft: 'warn', ordered: 'info', received: 'ok', canceled: 'ghost' };

/** 화면에서 고치는 품목 줄(수량·단가는 입력 글자 그대로) */
export interface EditLine {
  itemId: number;
  itemName: string;
  unit: string;
  qty: string;
  unitPrice: number | null;
}

/** 입력 글자 → 숫자(비었거나 숫자가 아니면 null). 쉼표는 빼고 읽는다 */
export function parseNum(v: string): number | null {
  const t = v.replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 편집 줄들의 합계(수량이 숫자가 아니거나 단가가 없는 줄은 금액에서 뺀다) */
export function editTotals(lines: readonly EditLine[]): { qty: number; amount: number; missingPrice: boolean } {
  let qty = 0;
  let amount = 0;
  let missingPrice = false;
  for (const l of lines) {
    const q = parseNum(l.qty) ?? 0;
    qty += q;
    if (l.unitPrice === null) missingPrice = true;
    else amount += q * l.unitPrice;
  }
  return { qty: Math.round(qty * 100) / 100, amount: Math.round(amount), missingPrice };
}

/** 줄 수량 오류 문구(없으면 null) */
export function qtyError(v: string): string | null {
  const n = parseNum(v);
  if (n === null) return '수량을 숫자로 적어 주세요.';
  if (!(n > 0)) return '수량은 0보다 크게 적어 주세요.';
  return null;
}

/** 발주서 상세 → 편집 줄 */
export function toEditLines(d: Pick<OrderDetail, 'lines'>): EditLine[] {
  return d.lines.map((l) => ({ itemId: l.itemId, itemName: l.itemName, unit: l.unit, qty: String(l.qty), unitPrice: l.unitPrice }));
}

/** 편집 줄 → PATCH 본문의 lines(단가는 보내지 않아 서버가 원래 단가·최근 단가를 쓰게 한다) */
export function patchLines(lines: readonly EditLine[]): Array<{ itemId: number; qty: number }> {
  return lines.map((l) => ({ itemId: l.itemId, qty: parseNum(l.qty) ?? 0 }));
}

/** 입고 입력 한 줄 */
export interface ReceiveLine {
  itemId: number;
  qty: string;
  unitPrice: string;
  lot: string;
  expiryOn: string;
}

/** 입고 입력 → POST receive 본문의 lines. 단가를 비우면 보내지 않아 발주서 단가를 쓴다 */
export function receiveBody(lines: readonly ReceiveLine[]): Array<{ itemId: number; qty: number; unitPrice?: number; lot?: string; expiryOn?: string }> {
  return lines.map((l) => {
    const price = parseNum(l.unitPrice);
    return {
      itemId: l.itemId,
      qty: parseNum(l.qty) ?? 0,
      ...(price === null ? {} : { unitPrice: price }),
      ...(l.lot.trim() ? { lot: l.lot.trim() } : {}),
      ...(l.expiryOn ? { expiryOn: l.expiryOn } : {}),
    };
  });
}

/** CSS content 글자로 안전하게(따옴표·역슬래시·꺾쇠는 이스케이프, 제어 문자는 띄어쓰기, 최대 80자) */
export function cssText(s: string): string {
  const clean = [...s]
    .map((c) => (c.charCodeAt(0) <= 31 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('')
    .slice(0, 80);
  return `"${clean.replace(/[\\"<>]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
}

/** 쪽마다 들어갈 인쇄 머리말(왼쪽 병원명, 오른쪽 발주 번호). 쪽 번호는 styles/print.css가 넣는다 */
export function orderPrintHeaderCss(clinic: string, poNo: string): string {
  return `@page { @top-left { content: ${cssText(clinic)}; font-size: 9pt; color: #586968; } @top-right { content: ${cssText(`발주서 ${poNo}`)}; font-size: 9pt; color: #586968; } }`;
}

/** 발주서 상세를 불러온다 */
export function fetchOrder(id: number): Promise<OrderDetail> {
  return api.get<OrderDetail>(`/api/orders/${id}`);
}

/** "발주서 만들기" 결과를 쉬운 문구로 */
export function draftMessage(r: OrderDraftResult): string {
  if (r.orders.length > 0) {
    const tail = r.skipped > 0 ? ` 이미 발주서에 담긴 품목 ${r.skipped}개는 뺐어요.` : '';
    return `거래처별 발주서 ${r.orders.length}건을 만들었어요. 수량을 확인한 뒤 발주해 주세요.${tail}`;
  }
  if (r.skipped > 0) return `부족한 품목 ${r.skipped}개가 모두 이미 작성 중이거나 발주한 발주서에 들어 있어요.`;
  return '지금은 부족하거나 곧 부족한 품목이 없어요.';
}

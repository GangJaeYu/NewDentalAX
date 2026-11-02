// 이 파일이 하는 일: "명세서 사진으로 입고" 화면(ReceiptPage.tsx, FR-122)의 순수 로직. 서버 응답 모양, 보내기 버튼을 켤지,
// AI가 읽은 줄 → 화면 입력 줄(가장 비슷한 품목을 미리 고름), 입력 줄 → 저장 요청 본문(칸별 오류 포함), 합계·개인정보 안내 문구를 만든다.
// 화면 부품 없이 계산만 하므로 단위 테스트(receiptLib.test.ts)로 확인한다.
import type { ExpenseRow } from '../../../../shared/schemas/finance.ts';
import type { ItemRow } from '../../../../shared/schemas/inventory.ts';
import type { PiiType } from '../../../../shared/privacy-rules.ts';
import type { AiResultView } from '../../lib/ai.ts';

/** 입력 글 → 숫자(쉼표 허용, 비었거나 숫자가 아니면 null) */
export function toNum(v: string): number | null {
  const t = v.trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 브라우저가 보내기 전에 줄이는 긴 변(px). 서버도 같은 기준으로 다시 검사한다 */
export const RECEIPT_MAX_SIDE = 1600;
/** 줄인 뒤 보낼 수 있는 최대 용량(서버 사진 상한 8MB) */
export const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
/** 고를 수 있는 원본 사진 최대 용량(줄이기 전, 20MB) */
export const RECEIPT_PICK_MAX_BYTES = 20 * 1024 * 1024;
/** 고를 수 있는 사진 형식 */
export const RECEIPT_ACCEPT = ['.jpg', '.jpeg', '.png', '.webp'] as const;
/** 이 점수 이상인 첫 후보는 미리 골라 둔다 */
export const AUTO_PICK_SCORE = 0.4;

/** GET /api/inventory/receipt-status */
export interface ReceiptStatus {
  state: 'ready' | 'disabled' | 'no_image_model' | 'budget';
  demo: boolean;
  message: string | null;
}

/** 품목 후보 */
export interface ItemCandidate {
  itemId: number;
  name: string;
  unit: string;
  category: string;
  score: number;
}

/** POST /api/ai/receipt 응답 */
export interface ReceiptReadResult {
  fileId: number;
  image: { width: number; height: number; bytes: number; format: string };
  draft: {
    vendorName: string | null;
    date: string | null;
    lines: Array<{ name: string; qty?: number | null; unitPrice?: number | null; amount?: number | null }>;
    total?: number | null;
  };
  candidates: ItemCandidate[][];
  vendorCandidates: Array<{ vendorId: number; name: string; score: number }>;
  ai: Omit<AiResultView, 'extra'>;
}

/** POST /api/inventory/receipt-commit 응답 */
export interface ReceiptCommitResult {
  fileId: number;
  moves: number;
  items: ItemRow[];
  createdItems: number;
  expense: ExpenseRow | null;
}

/** 줄의 품목 고르기 값: 품목 번호(글자), 'new'(새 품목), 'skip'(입고 안 함), ''(아직 안 고름) */
export type LineChoice = string;

/** 화면 입력 줄 하나(입력 칸은 모두 글자로 둔다) */
export interface LineState {
  /** AI가 읽은 품목 이름 */
  readName: string;
  choice: LineChoice;
  qty: string;
  unitPrice: string;
  lot: string;
  expiryOn: string;
  newName: string;
  newCategory: string;
  newUnit: string;
}

/** 보내기 버튼을 켤 수 있는지(FR-122 AC1: 확인 체크 전에는 꺼짐) */
export function canSend(s: { hasFile: boolean; confirmed: boolean; ready: boolean; busy: boolean }): boolean {
  return s.hasFile && s.confirmed && s.ready && !s.busy;
}

/** 숫자를 입력 칸 글자로(없으면 빈칸) */
function numText(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(n) : '';
}

/** AI가 읽은 줄 → 화면 입력 줄. 첫 후보가 충분히 비슷하면 미리 골라 둔다. 단가가 없고 금액·수량이 있으면 금액 ÷ 수량 */
export function initialLines(r: Pick<ReceiptReadResult, 'draft' | 'candidates'>): LineState[] {
  return r.draft.lines.map((l, i) => {
    const top = r.candidates[i]?.[0];
    const unitPrice = l.unitPrice ?? (l.amount && l.qty ? Math.round(l.amount / l.qty) : null);
    return {
      readName: l.name,
      choice: top && top.score >= AUTO_PICK_SCORE ? String(top.itemId) : '',
      qty: numText(l.qty),
      unitPrice: numText(unitPrice),
      lot: '',
      expiryOn: '',
      newName: l.name.slice(0, 80),
      newCategory: '소모품',
      newUnit: '개',
    };
  });
}

/** 한 줄 금액(수량 × 단가, 원). 계산할 수 없으면 null */
export function lineAmount(l: Pick<LineState, 'qty' | 'unitPrice'>): number | null {
  const q = toNum(l.qty);
  const p = toNum(l.unitPrice);
  return q !== null && p !== null ? Math.round(q * p) : null;
}

/** 입고할 줄(입고 안 함 제외)의 합계(원) */
export function linesTotal(lines: readonly LineState[]): number {
  return lines.filter((l) => l.choice !== 'skip').reduce((s, l) => s + (lineAmount(l) ?? 0), 0);
}

/** 저장 요청 본문 만들기 결과 */
export interface CommitBuild {
  body: Record<string, unknown> | null;
  /** 칸별 오류(키 예: 'lines.0.qty') */
  errors: Record<string, string>;
  /** 화면 위쪽에 보여 줄 오류 한 줄 */
  formError: string | null;
}

/**
 * 입력 줄 → POST /api/inventory/receipt-commit 본문. 고르지 않은 줄·수량·단가 오류는 칸별로 알려 준다.
 * vendor: 고른 거래처 번호(없으면 null) 또는 읽은 거래처 이름. alsoExpense는 실장 이상이 켰을 때만 넣는다.
 */
export function buildCommitBody(input: {
  fileId: number;
  vendorId: number | null;
  vendorName: string | null;
  date: string;
  lines: readonly LineState[];
  alsoExpense: { payMethod: string } | null;
}): CommitBuild {
  const errors: Record<string, string> = {};
  const out: Array<Record<string, unknown>> = [];
  input.lines.forEach((l, i) => {
    if (l.choice === 'skip') return;
    if (!l.choice) errors[`lines.${i}.itemId`] = '연결할 품목을 고르거나 "입고하지 않음"을 골라 주세요.';
    const qty = toNum(l.qty);
    if (qty === null || !(qty > 0)) errors[`lines.${i}.qty`] = '수량을 0보다 큰 숫자로 적어 주세요.';
    const price = l.unitPrice.trim() ? toNum(l.unitPrice) : null;
    if (l.unitPrice.trim() && (price === null || price < 0)) errors[`lines.${i}.unitPrice`] = '단가는 0원 이상 숫자로 적어 주세요.';
    const line: Record<string, unknown> = { qty, unitPrice: price };
    if (l.choice === 'new') {
      if (!l.newName.trim()) errors[`lines.${i}.newItem.name`] = '새 품목 이름을 적어 주세요.';
      if (!l.newCategory.trim()) errors[`lines.${i}.newItem.category`] = '분류를 적어 주세요.';
      if (!l.newUnit.trim()) errors[`lines.${i}.newItem.unit`] = '단위를 적어 주세요.';
      line.newItem = { name: l.newName.trim(), category: l.newCategory.trim(), unit: l.newUnit.trim(), par: 0 };
    } else if (l.choice) {
      line.itemId = Number(l.choice);
    }
    if (l.lot.trim()) line.lot = l.lot.trim();
    if (l.expiryOn) line.expiryOn = l.expiryOn;
    out.push(line);
  });
  if (Object.keys(errors).length) return { body: null, errors, formError: '빨간 글씨로 표시한 칸을 고쳐 주세요.' };
  if (!out.length) return { body: null, errors, formError: '입고할 품목이 없어요. 한 줄 이상 품목을 골라 주세요.' };
  if (input.alsoExpense && !(linesTotal(input.lines) > 0)) {
    return { body: null, errors: { alsoExpense: '단가를 적어야 지출 금액을 계산할 수 있어요.' }, formError: '지출로 기록하려면 단가를 적어 주세요.' };
  }
  const body: Record<string, unknown> = { fileId: input.fileId, lines: out };
  if (input.vendorId) body.vendorId = input.vendorId;
  else if (input.vendorName?.trim()) body.vendorName = input.vendorName.trim().slice(0, 60);
  if (input.date) body.date = input.date;
  if (input.alsoExpense) body.alsoExpense = { payMethod: input.alsoExpense.payMethod };
  return { body, errors, formError: null };
}

/** 개인정보 종류 이름 */
const PII_LABEL: Record<PiiType, string> = { rrn: '주민등록번호', phone: '전화번호', email: '이메일', card: '카드번호', account: '계좌번호', passport: '여권번호' };

/** AI가 읽은 글에서 개인정보를 가렸을 때 보여 줄 안내(FR-122 AC3). 가린 것이 없으면 null */
export function maskedNotice(findings: ReadonlyArray<{ type: PiiType; count: number }>): string | null {
  if (!findings.length) return null;
  const what = findings.map((f) => `${PII_LABEL[f.type]} ${f.count}건`).join(', ');
  return `읽은 글에 ${what}이 있어 가린 채 보여 드려요. 다음부터는 사진의 해당 부분을 가리고 올려 주세요.`;
}

/** 서버가 AI로 보낸 사진 크기 글(예: "1600×1200px · 320KB") */
export function imageInfoText(img: { width: number; height: number; bytes: number }): string {
  const kb = img.bytes < 1024 * 1024 ? `${Math.max(1, Math.round(img.bytes / 1024))}KB` : `${(img.bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${img.width}×${img.height}px · ${kb}`;
}

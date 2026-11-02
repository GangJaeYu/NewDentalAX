// 이 파일이 하는 일: 명세서·영수증 사진 → 입고·지출 입력(FR-122, overview §3.4)의 서버 쪽 일을 한다.
// ① receiptStatus: 이 사람이 지금 사진 읽기를 쓸 수 있는지(기능 꺼짐·사진 미지원 모델·예산 초과)를 화면에 미리 알려 준다.
// ② readReceipt: 확인 체크 → 형식·용량(8MB)·픽셀 크기(긴 변 1600px) 검사 → AI 게이트웨이(receipt)로 읽기 → 사진을 files(purpose=receipt)로 저장 →
//    읽은 줄마다 기존 품목 후보(글자 2개씩 묶은 2-gram 유사도 상위 3개)와 거래처 후보를 붙여 돌려준다. 읽은 글의 개인정보는 게이트웨이가 가린다.
// ③ commitReceipt: 사용자가 고친 표를 받아 줄마다 입고(recordMove type 'in')를 남기고, 실장 이상이 고르면 지출 1건(재료비, 사진 첨부)도 한 트랜잭션으로 남긴다.
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError, validationError } from '../../lib/errors.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { todayKst } from '../../lib/dates.ts';
import { checkUpload, getFile, saveUpload } from '../../lib/files.ts';
import { runAi, type AiCallContext, type AiResult } from '../../ai/gateway.ts';
import { budgetStatus } from '../../ai/budget.ts';
import { activeModel } from '../../ai/pricing.ts';
import { effectiveProvider, featureSettings, readAiSettings } from '../../ai/settings.ts';
import { can, type Role } from '../../../shared/roles.ts';
import type { ExpenseRow } from '../../../shared/schemas/finance.ts';
import type { ItemRow } from '../../../shared/schemas/inventory.ts';
import { checkOrderExpense, createExpense, getExpense } from '../finance/service.ts';
import { createItem, itemRow, recordMove } from './service.ts';
import { readImageSize } from './receipt-image.ts';
import type { ReceiptCommitInput } from './receipt.schema.ts';

/** 서버가 받는 사진의 긴 변 상한(px). 화면이 보내기 전에 이 크기로 줄인다(FR-122 AC4) */
export const RECEIPT_MAX_SIDE = 1600;
/** 명세서 사진으로 받는 확장자(AI가 읽을 수 있는 사진만. PDF는 받지 않는다) */
export const RECEIPT_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

// ---- ① 사용 가능 여부 ----

/** 화면에 미리 보여 줄 사진 읽기 상태 */
export interface ReceiptStatus {
  /** ready=쓸 수 있음, disabled=관리자가 끔(또는 이 역할 제외), no_image_model=사진을 못 읽는 모델, budget=이번 달 예산 다 씀 */
  state: 'ready' | 'disabled' | 'no_image_model' | 'budget';
  demo: boolean;
  message: string | null;
}

/** 지금 이 역할이 사진 읽기를 쓸 수 있는지 알려 준다(실제 호출 때도 게이트웨이가 같은 검사를 다시 한다) */
export function receiptStatus(db: Db, clock: Clock, dataDir: string, role: Role): ReceiptStatus {
  const s = readAiSettings(db);
  const f = featureSettings(s, 'receipt');
  const provider = effectiveProvider(dataDir, s);
  const demo = provider === 'demo';
  if (!can(role, 'ai.receipt') || !f.enabled || !f.roles.includes(role)) {
    return { state: 'disabled', demo, message: '관리자가 이 AI 기능을 꺼 두었습니다.' };
  }
  if (provider !== 'demo') {
    const m = activeModel(db, provider, f.tier);
    if (!m || !m.supportsImages) return { state: 'no_image_model', demo, message: '사진을 읽을 수 있는 AI 모델이 설정되지 않았습니다.' };
  }
  if (budgetStatus(db, clock, s).exceeded) {
    return { state: 'budget', demo, message: '이번 달 AI 예산을 모두 사용했습니다. 관리자에게 한도 조정을 요청하세요.' };
  }
  return { state: 'ready', demo, message: null };
}

// ---- 이름 비슷한 정도(2-gram) ----

/** 비교용으로 이름을 다듬는다: 소문자, ×→x, 띄어쓰기·괄호·기호 제거 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[\s()[\]{}<>.,·/\\_\-+*'"`~!@#$%^&:;?|]/g, '');
}

/** 글자 2개씩 묶음(한 글자짜리 이름은 그 글자 하나) */
function bigrams(s: string): string[] {
  if (s.length < 2) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/**
 * 두 이름이 얼마나 비슷한지 0~1로 계산한다(2-gram Dice 계수 = 2 × 겹친 묶음 수 ÷ 두 묶음 수 합).
 * 예: "니트릴 글러브 M (100매)"와 "니트릴 글러브 M" → 0.75, 전혀 다른 이름 → 0
 */
export function nameSimilarity(a: string, b: string): number {
  const x = bigrams(normalizeName(a));
  const y = bigrams(normalizeName(b));
  if (!x.length || !y.length) return 0;
  const pool = new Map<string, number>();
  for (const g of y) pool.set(g, (pool.get(g) ?? 0) + 1);
  let common = 0;
  for (const g of x) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      common += 1;
      pool.set(g, n - 1);
    }
  }
  return Math.round(((2 * common) / (x.length + y.length)) * 1000) / 1000;
}

/** 품목 후보 한 개 */
export interface ItemCandidate {
  itemId: number;
  name: string;
  unit: string;
  category: string;
  /** 0~1 비슷한 정도 */
  score: number;
}

/** 거래처 후보 한 개 */
export interface VendorCandidate {
  vendorId: number;
  name: string;
  score: number;
}

/** 후보로 보여 줄 최소 비슷한 정도 */
export const MIN_CANDIDATE_SCORE = 0.2;

/** 이름이 비슷한 순서로 상위 limit개(최소 기준 이상만) */
export function rankByName<T extends { name: string }>(name: string, rows: readonly T[], limit = 3): Array<T & { score: number }> {
  return rows
    .map((r) => ({ ...r, score: nameSimilarity(name, r.name) }))
    .filter((r) => r.score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'))
    .slice(0, limit);
}

/** 사용 중인 품목에서 이름이 비슷한 후보 상위 3개 */
export function itemCandidates(db: Db, name: string): ItemCandidate[] {
  const rows = db.all<{ id: number; name: string; unit: string; category: string }>('SELECT id, name, unit, category FROM items WHERE active = 1');
  return rankByName(name, rows).map((r) => ({ itemId: r.id, name: r.name, unit: r.unit, category: r.category, score: r.score }));
}

/** 사용 중인 거래처에서 이름이 비슷한 후보 상위 3개(이름이 없으면 빈 목록) */
export function vendorCandidates(db: Db, name: string | null): VendorCandidate[] {
  if (!name?.trim()) return [];
  const rows = db.all<{ id: number; name: string }>('SELECT id, name FROM vendors WHERE active = 1');
  return rankByName(name, rows).map((r) => ({ vendorId: r.id, name: r.name, score: r.score }));
}

// ---- ② 사진 읽기 ----

/** AI가 읽은 명세서(게이트웨이가 검사한 JSON, 개인정보는 가려진 상태) */
export interface ReceiptDraft {
  vendorName: string | null;
  date: string | null;
  lines: Array<{ name: string; qty?: number | null; unitPrice?: number | null; amount?: number | null }>;
  total?: number | null;
}

/** POST /api/ai/receipt 응답 */
export interface ReceiptReadResult {
  fileId: number;
  /** 서버가 받은 사진 정보(긴 변 1600px 이하인지 확인용) */
  image: { width: number; height: number; bytes: number; format: string };
  draft: ReceiptDraft;
  /** draft.lines와 같은 순서의 품목 후보(줄마다 최대 3개) */
  candidates: ItemCandidate[][];
  vendorCandidates: VendorCandidate[];
  ai: Omit<AiResult, 'extra'>;
}

/** 올린 사진 파일 */
export interface ReceiptUpload {
  name: string;
  data: Buffer;
  /** 경고를 읽고 확인 체크를 했는지(multipart 글 칸 confirmed=true) */
  confirmed: boolean;
}

/**
 * 사진을 검사하고 AI로 읽는다. 문제가 있으면 AppError를 던진다.
 * - 확인 체크가 없으면 400 VALIDATION, 사진이 아니면 415 FILE_TYPE, 8MB를 넘거나 긴 변이 1600px를 넘으면 413 FILE_TOO_LARGE
 * - 기능 꺼짐·사진 미지원 모델(403 AI_DISABLED), 예산 초과(402) 등은 게이트웨이가 던진다
 * AI가 성공한 뒤에만 사진을 저장한다(실패하면 남는 파일이 없다).
 */
export async function readReceipt(ai: AiCallContext, file: ReceiptUpload): Promise<ReceiptReadResult> {
  if (!file.confirmed) {
    throw validationError({ confirmed: '사진에 환자 정보·카드번호가 보이지 않는지 확인하고 체크해 주세요.' });
  }
  const lower = file.name.toLowerCase();
  if (!RECEIPT_IMAGE_EXTS.some((e) => lower.endsWith(e))) {
    throw new AppError('FILE_TYPE', { message: '명세서는 사진(JPG·PNG·WEBP)으로 올려 주세요.' });
  }
  const checked = checkUpload(file.name, file.data, 'receipt');
  const size = readImageSize(file.data);
  if (!size) throw new AppError('FILE_TYPE', { message: '사진 크기를 읽지 못했어요. 다른 사진으로 다시 올려 주세요.' });
  if (Math.max(size.width, size.height) > RECEIPT_MAX_SIDE) {
    throw new AppError('FILE_TOO_LARGE', {
      message: `사진이 너무 커요(${size.width}×${size.height}px). 긴 변 ${RECEIPT_MAX_SIDE}px 이하로 줄여서 올려 주세요. 이 화면에서 고르면 자동으로 줄여요.`,
    });
  }
  const mime = checked.mime as 'image/jpeg' | 'image/png' | 'image/webp';
  const result = await runAi(ai, { feature: 'receipt', input: { images: [{ mime, data: file.data.toString('base64') }] } });
  const { extra, ...meta } = result;
  const draft = extra as ReceiptDraft;
  const saved = saveUpload({ db: ai.db, clock: ai.clock, dataDir: ai.dataDir }, { name: file.name, data: file.data, purpose: 'receipt', userId: ai.user.id });
  return {
    fileId: saved.id,
    image: { width: size.width, height: size.height, bytes: file.data.length, format: size.format },
    draft,
    candidates: draft.lines.map((l) => itemCandidates(ai.db, l.name)),
    vendorCandidates: vendorCandidates(ai.db, draft.vendorName),
    ai: meta,
  };
}

// ---- ③ 입고(+지출) 저장 ----

/** POST /api/inventory/receipt-commit 응답 */
export interface ReceiptCommitResult {
  fileId: number;
  /** 기록한 입고 줄 수 */
  moves: number;
  /** 입고한 품목의 지금 상태 */
  items: ItemRow[];
  /** 새로 등록한 품목 수 */
  createdItems: number;
  expense: ExpenseRow | null;
}

/** 수량 × 단가 합계(원, 반올림) */
export function linesTotal(lines: ReadonlyArray<{ qty: number; unitPrice?: number | null }>): number {
  return Math.round(lines.reduce((sum, l) => sum + l.qty * (l.unitPrice ?? 0), 0));
}

/**
 * 확인·수정한 명세서를 입고로 저장한다(FR-122 AC2). 모두 한 트랜잭션이라 중간에 실패하면 아무것도 남지 않는다.
 * - 새 품목 등록(newItem)은 품목 관리 권한(실장 이상)만, 지출 동시 기록(alsoExpense)은 receipt.expense 권한(실장 이상)만 허용한다(없으면 403)
 * - 같은 사진으로 두 번 저장하면 409
 * - 지출은 수량 × 단가 합계로 1건, 기본 분류는 재료비, 사진을 영수증으로 붙이고 stock_move_ref = 'receipt:<fileId>'
 */
export function commitReceipt(ctx: AuditContext, role: Role, input: ReceiptCommitInput): ReceiptCommitResult {
  const { db, clock } = ctx;
  if (input.lines.some((l) => l.newItem) && !can(role, 'items.manage')) {
    throw new AppError('FORBIDDEN', { message: '새 품목 등록은 실장 이상만 할 수 있어요. 기존 품목을 골라 주세요.' });
  }
  if (input.alsoExpense && !can(role, 'receipt.expense')) {
    throw new AppError('FORBIDDEN', { message: '지출 동시 기록은 실장 이상만 할 수 있어요. "지출로도 기록"을 끄고 저장해 주세요.' });
  }
  const file = getFile(db, input.fileId);
  if (!file || file.purpose !== 'receipt') {
    throw new AppError('NOT_FOUND', { message: '올린 명세서 사진을 찾을 수 없어요. 사진을 다시 올려 주세요.' });
  }
  if (db.get("SELECT 1 AS x FROM audit_log WHERE action = 'receipt.commit' AND target_type = 'file' AND target_id = ?", [String(file.id)])) {
    throw new AppError('CONFLICT', { message: '이 명세서 사진은 이미 입고로 저장했어요. 재고 현황에서 확인해 주세요.' });
  }
  // 거래처: 번호를 고르면 그것, 이름만 있으면 같은 이름의 거래처, 없으면 거래처 없이 기록한다
  let vendor: { id: number; name: string } | null = null;
  if (input.vendorId) {
    vendor = db.get<{ id: number; name: string }>('SELECT id, name FROM vendors WHERE id = ?', [input.vendorId]) ?? null;
    if (!vendor) throw validationError({ vendorId: '고른 거래처가 없어요. 다시 골라 주세요.' });
  } else if (input.vendorName) {
    vendor = db.get<{ id: number; name: string }>('SELECT id, name FROM vendors WHERE name = ? COLLATE NOCASE AND active = 1', [input.vendorName]) ?? null;
  }
  const vendorName = vendor?.name ?? input.vendorName ?? null;
  const amount = linesTotal(input.lines);
  const categoryId = input.alsoExpense ? checkOrderExpense(db, amount, input.alsoExpense) : null;

  const out = db.tx(() => {
    const itemIds: number[] = [];
    let createdItems = 0;
    for (const l of input.lines) {
      let itemId = l.itemId ?? null;
      if (!itemId && l.newItem) {
        const made = createItem(ctx, { ...l.newItem, trackExpiry: Boolean(l.expiryOn), vendorId: vendor?.id ?? null, location: null, memo: null });
        itemId = made.item.id;
        createdItems += 1;
      }
      if (!itemId) throw validationError({ lines: '품목을 고르지 않은 줄이 있어요.' });
      recordMove(ctx, {
        itemId,
        type: 'in',
        qty: l.qty,
        unitPrice: l.unitPrice ?? null,
        vendorId: vendor?.id ?? null,
        lot: l.lot ?? null,
        expiryOn: l.expiryOn || null,
        reason: `명세서 사진 입고${input.date ? `(${input.date})` : ''}`,
      });
      itemIds.push(itemId);
    }
    let expense: ExpenseRow | null = null;
    if (input.alsoExpense && categoryId) {
      const made = createExpense(ctx, {
        date: input.alsoExpense.date ?? input.date ?? todayKst(clock),
        categoryId,
        vendorName,
        amount,
        payMethod: input.alsoExpense.payMethod,
        memo: input.alsoExpense.memo ?? `명세서 사진 입고 ${input.lines.length}품목`,
      });
      db.run('UPDATE expenses SET file_id = ?, stock_move_ref = ? WHERE id = ?', [file.id, `receipt:${file.id}`, made.id]);
      expense = getExpense(db, made.id);
    }
    audit(ctx, 'receipt.commit', 'file', file.id, { moves: input.lines.length, createdItems, vendorId: vendor?.id ?? null, expenseId: expense?.id ?? null, amount });
    return { itemIds, createdItems, expense };
  });
  const unique = [...new Set(out.itemIds)];
  return { fileId: file.id, moves: input.lines.length, items: unique.map((id) => itemRow(db, clock, id)), createdItems: out.createdItems, expense: out.expense };
}

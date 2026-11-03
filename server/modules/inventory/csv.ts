// 이 파일이 하는 일: 재고 CSV 내보내기와 품목 CSV 가져오기(FR-056, TD-016)를 DB와 함께 처리한다.
// 내보내기: 품목·거래처·입출고 기록을 엑셀에서 한글이 깨지지 않는 CSV(UTF-8 BOM, CRLF)로 만든다. 수식으로 보이는 글자는 앞에 '를 붙인다(server/lib/csv.ts).
// 가져오기: 올린 파일(UTF-8·CP949 자동 판별)을 줄마다 검사해 신규·변경·변경 없음·오류로 나눈 미리보기를 만들고,
// 확정하면 그 사이 바뀐 것까지 반영하도록 다시 검사한 뒤 한 번에 저장한다. 오류 줄이 있으면 "오류 줄 건너뛰기"를 골라야만 저장한다.
// 품목은 품목명(대소문자·앞뒤 공백 무시)으로 기존 품목과 맞춘다. 빈 칸은 "그대로 둠"이다. 환자 정보는 다루지 않는다.
// 바코드 열(FR-130, phase-06-task-01)도 함께 읽고 쓴다. 다른 품목이 쓰는 바코드이거나 파일 안에서 두 번 나오면 그 줄은 오류다.
import { randomBytes } from 'node:crypto';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError } from '../../lib/errors.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { kstParts } from '../../lib/dates.ts';
import { decodeCsvBytes, parseCsvRows, toCsv } from '../../lib/csv.ts';
import { barcodeProblem, MOVE_TYPE_LABELS, normalizeBarcode, STOCK_STATUS_LABELS } from '../../../shared/schemas/inventory.ts';
import {
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  type ImportAction,
  type ImportChange,
  type ImportCommitResult,
  type ImportField,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRowData,
} from '../../../shared/schemas/inventory-csv.ts';
import { listItems, listMoves, listVendors, type MoveListQuery } from './service.ts';

/** 가져오기 파일 최대 크기(2MB) */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
/** 가져오기 최대 줄 수(열 이름 줄 제외) */
export const IMPORT_MAX_ROWS = 5000;
/** 내보내기 최대 줄 수 */
export const EXPORT_MAX_ROWS = 50_000;
/** 미리보기 표가 유효한 시간(30분) */
export const PREVIEW_TTL_MS = 30 * 60 * 1000;

// ───────────── 내보내기 ─────────────

/** ISO 시각 → 한국 시각 "2026-11-02 09:00" */
function kstMinute(iso: string): string {
  const p = kstParts(new Date(iso));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
}

/** 오늘 한국 날짜(파일 이름용) */
export function kstStamp(clock: Clock): string {
  return kstMinute(clock.now().toISOString()).slice(0, 10);
}

/** 품목 CSV 열 이름(앞 9칸은 가져오기 양식과 같다) */
const ITEM_EXPORT_HEADER = [...IMPORT_FIELDS.map((f) => IMPORT_FIELD_LABELS[f]), '현재고', '상태', '가장 빠른 유효기간', '최근 입고 단가', '사용 여부'];

/** 품목 전체(사용 안 함 포함)를 CSV로 */
export function itemsCsv(db: Db, clock: Clock): { csv: string; rows: number } {
  const page = listItems(db, clock, { active: 'all', sort: 'name', page: 1, pageSize: 200 });
  // listItems는 한 쪽 최대 200개라 쪽을 넘기며 모은다
  const all = [...page.data];
  for (let p = 2; all.length < page.total && all.length < EXPORT_MAX_ROWS; p++) all.push(...listItems(db, clock, { active: 'all', sort: 'name', page: p, pageSize: 200 }).data);
  const lines: unknown[][] = [ITEM_EXPORT_HEADER];
  for (const i of all) {
    lines.push([
      i.name,
      i.category,
      i.unit,
      i.par,
      i.trackExpiry ? '예' : '아니오',
      i.vendor ?? '',
      i.location ?? '',
      i.memo ?? '',
      i.barcode ?? '',
      i.stock,
      STOCK_STATUS_LABELS[i.status],
      i.nearestExpiry ?? '',
      i.lastPrice ?? '',
      i.active ? '사용' : '사용 안 함',
    ]);
  }
  return { csv: toCsv(lines), rows: all.length };
}

/** 거래처 전체(사용 안 함 포함)를 CSV로. 연락처는 사업자 정보다 */
export function vendorsCsv(db: Db): { csv: string; rows: number } {
  const vendors = listVendors(db, { active: 'all' });
  const lines: unknown[][] = [['상호', '담당자', '업무용 연락처', '이메일', '주문 방법', '메모', '기본 거래처로 둔 품목 수', '사용 여부']];
  for (const v of vendors) lines.push([v.name, v.contactName ?? '', v.phone ?? '', v.email ?? '', v.orderMethod ?? '', v.memo ?? '', v.itemCount, v.active ? '사용' : '사용 안 함']);
  return { csv: toCsv(lines), rows: vendors.length };
}

/** 입출고 기록(조건이 있으면 그 조건, 최근 것부터)을 CSV로. 수량은 출고면 음수로 적는다 */
export function movesCsv(db: Db, q: Omit<MoveListQuery, 'page' | 'pageSize'> = {}): { csv: string; rows: number } {
  const all = [];
  for (let p = 1; all.length < EXPORT_MAX_ROWS; p++) {
    const chunk = listMoves(db, { ...q, page: p, pageSize: 200 });
    all.push(...chunk.data);
    if (chunk.data.length < 200 || all.length >= chunk.total) break;
  }
  const lines: unknown[][] = [['일시', '구분', '품목명', '단위', '수량', '단가', '거래처', '로트', '유효기간', '사유·메모', '기록한 사람']];
  for (const m of all) {
    lines.push([
      kstMinute(m.movedAt),
      MOVE_TYPE_LABELS[m.type],
      m.itemName,
      m.unit,
      m.type === 'out' ? -m.qty : m.qty,
      m.unitPrice ?? '',
      m.vendor ?? '',
      m.lot ?? '',
      m.expiryOn ?? '',
      m.reason ?? '',
      m.userName ?? '',
    ]);
  }
  return { csv: toCsv(lines), rows: all.length };
}

/** 가져오기 양식: 열 이름 + 예시 한 줄 */
export function templateCsv(): string {
  return toCsv([
    IMPORT_FIELDS.map((f) => IMPORT_FIELD_LABELS[f]),
    ['일회용 마스크(50매)', '소모품', '박스', 10, '아니오', '', '소모품 선반 2칸', '예시 줄이에요. 지우고 써 주세요.', ''],
  ]);
}

// ───────────── 가져오기: 열 맞추기 ─────────────

/** 열 이름 → 칸(띄어쓰기·*·괄호 설명은 무시한다) */
const HEADER_ALIASES: Record<string, ImportField> = {
  품목명: 'name',
  품목이름: 'name',
  품목: 'name',
  이름: 'name',
  name: 'name',
  분류: 'category',
  category: 'category',
  단위: 'unit',
  unit: 'unit',
  적정재고: 'par',
  par: 'par',
  유효기간관리: 'trackExpiry',
  trackexpiry: 'trackExpiry',
  기본거래처: 'vendor',
  거래처: 'vendor',
  vendor: 'vendor',
  보관위치: 'location',
  위치: 'location',
  location: 'location',
  메모: 'memo',
  memo: 'memo',
  바코드: 'barcode',
  바코드값: 'barcode',
  barcode: 'barcode',
  qr: 'barcode',
  qr코드: 'barcode',
};

/** 열 이름을 비교하기 쉽게: "적정 재고*(개)" → "적정재고" */
function normalizeHeader(h: string): string {
  return h
    .replace(/\(.*?\)/g, '')
    .replace(/[\s*_]/g, '')
    .toLowerCase();
}

/** 첫 줄에서 칸 위치를 찾는다. 품목명 열이 없으면 400 */
function mapHeader(cells: string[]): { index: Partial<Record<ImportField, number>>; ignored: string[] } {
  const index: Partial<Record<ImportField, number>> = {};
  const ignored: string[] = [];
  cells.forEach((c, i) => {
    const f = HEADER_ALIASES[normalizeHeader(c)];
    if (f && index[f] === undefined) index[f] = i;
    else if (c) ignored.push(c);
  });
  if (index.name === undefined) {
    throw new AppError('VALIDATION', {
      message: '첫 줄에 "품목명" 열이 있어야 해요. 양식을 내려받아 그 열 이름 그대로 써 주세요.',
      fields: { file: '첫 줄에 "품목명" 열이 없어요.' },
    });
  }
  return { index, ignored };
}

// ───────────── 가져오기: 줄 검사 ─────────────

/** 기존 품목(이름으로 찾기용) */
interface ExistingItem {
  id: number;
  name: string;
  category: string;
  unit: string;
  par_level: number;
  track_expiry: number;
  default_vendor_id: number | null;
  vendor_name: string | null;
  location: string | null;
  memo: string | null;
  barcode: string | null;
  active: number;
}

/** 이름 비교 키(대소문자·앞뒤 공백 무시) */
const keyOf = (s: string) => s.trim().toLowerCase();

/** 내보낼 때 붙인 수식 방지 작은따옴표를 뗀다: "'=SUM" → "=SUM", "'-3" → "-3" */
function unguard(s: string): string {
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

/** "예/아니오" 칸을 읽는다(빈 칸은 null, 알 수 없는 값은 undefined) */
function readYesNo(s: string): boolean | null | undefined {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (['예', '네', 'y', 'yes', 'o', '1', 'true', '관리', '함'].includes(t)) return true;
  if (['아니오', '아니요', 'n', 'no', 'x', '0', 'false', '안 함', '안함', '관리 안 함'].includes(t)) return false;
  return undefined;
}

/** 칸 값을 숫자로(쉼표 허용). 숫자가 아니면 NaN */
function readNumber(s: string): number {
  const t = unguard(s).replace(/,/g, '').trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return Number.NaN;
  return Number(t);
}

/** 글자 칸 최대 길이 */
const MAX_LEN: Partial<Record<ImportField, number>> = { name: 80, category: 30, unit: 10, vendor: 60, location: 40, memo: 300 };

/** 검사한 줄(확정할 때 저장에 쓰는 값 포함) */
interface PlannedRow extends ImportPreviewRow {
  vendorId: number | null | undefined;
}

/** 표시용 값 */
function show(v: string | number | boolean | null): string {
  if (v === null || v === '') return '(비어 있음)';
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  return String(v);
}

/**
 * 파일 글을 줄마다 검사해 처리 계획을 만든다.
 * - 품목명이 기존 품목과 같으면 변경(바뀌는 칸이 없으면 변경 없음), 아니면 신규
 * - 신규는 분류·단위·적정 재고가 꼭 있어야 한다. 적정 재고는 0 이상의 숫자, 유효기간 관리는 예/아니오, 거래처는 등록된 상호여야 한다
 * - 같은 품목명이 파일 안에 두 번 나오면 뒤 줄을 오류로 둔다
 */
export function planImport(db: Db, text: string): { rows: PlannedRow[]; ignored: string[] } {
  const parsed = parseCsvRows(text);
  const head = parsed[0];
  if (!head) throw new AppError('VALIDATION', { message: '빈 파일이에요. 양식에 품목을 적어 올려 주세요.', fields: { file: '빈 파일이에요.' } });
  const { index, ignored } = mapHeader(head.cells);
  const body = parsed.slice(1);
  if (body.length === 0) throw new AppError('VALIDATION', { message: '열 이름 줄만 있고 품목 줄이 없어요. 둘째 줄부터 품목을 적어 주세요.', fields: { file: '품목 줄이 없어요.' } });
  if (body.length > IMPORT_MAX_ROWS) {
    throw new AppError('VALIDATION', { message: `한 번에 ${IMPORT_MAX_ROWS.toLocaleString('ko-KR')}줄까지 가져올 수 있어요. 파일을 나눠 올려 주세요.`, fields: { file: '줄이 너무 많아요.' } });
  }

  const existing = new Map<string, ExistingItem>();
  /** 바코드 → 그 바코드를 쓰는 기존 품목 */
  const barcodeOwner = new Map<string, ExistingItem>();
  /** 파일 안에서 바코드가 처음 나온 줄 */
  const seenBarcode = new Map<string, number>();
  for (const it of db.all<ExistingItem>(
    'SELECT i.id, i.name, i.category, i.unit, i.par_level, i.track_expiry, i.default_vendor_id, v.name AS vendor_name, i.location, i.memo, i.barcode, i.active FROM items i LEFT JOIN vendors v ON v.id = i.default_vendor_id ORDER BY i.active DESC, i.id',
  )) {
    if (!existing.has(keyOf(it.name))) existing.set(keyOf(it.name), it);
    if (it.barcode) barcodeOwner.set(it.barcode, it);
  }
  const vendors = new Map<string, { id: number; name: string }>();
  for (const v of db.all<{ id: number; name: string }>('SELECT id, name FROM vendors ORDER BY active DESC, id')) if (!vendors.has(keyOf(v.name))) vendors.set(keyOf(v.name), v);

  const seen = new Map<string, number>();
  const rows: PlannedRow[] = [];
  for (const { line, cells } of body) {
    const raw = (f: ImportField): string => {
      const i = index[f];
      return i === undefined ? '' : unguard(cells[i] ?? '');
    };
    const errors: string[] = [];
    const notes: string[] = [];
    const data: ImportRowData = { name: null, category: null, unit: null, par: null, trackExpiry: null, vendor: null, location: null, memo: null, barcode: null };

    for (const f of ['name', 'category', 'unit', 'vendor', 'location', 'memo'] as const) {
      const v = raw(f);
      data[f] = v || null;
      const max = MAX_LEN[f];
      if (max && v.length > max) errors.push(`${IMPORT_FIELD_LABELS[f]}은(는) ${max}자 안으로 적어 주세요(지금 ${v.length}자).`);
    }
    const parRaw = raw('par');
    if (parRaw) {
      const n = readNumber(parRaw);
      if (Number.isNaN(n)) errors.push(`적정 재고는 숫자로 적어 주세요(지금 값: "${parRaw}").`);
      else if (n < 0) errors.push('적정 재고는 0 이상으로 적어 주세요.');
      else if (n > 1_000_000) errors.push('적정 재고가 너무 커요.');
      else data.par = n;
    }
    const teRaw = raw('trackExpiry');
    const te = readYesNo(teRaw);
    if (te === undefined) errors.push(`유효기간 관리는 "예" 또는 "아니오"로 적어 주세요(지금 값: "${teRaw}").`);
    else data.trackExpiry = te;

    let vendorId: number | null | undefined;
    if (data.vendor) {
      const v = vendors.get(keyOf(data.vendor));
      if (!v) errors.push(`"${data.vendor}" 거래처가 없어요. 거래처를 먼저 등록하거나 칸을 비워 주세요.`);
      else {
        vendorId = v.id;
        data.vendor = v.name;
      }
    }

    const name = data.name;
    const ex = name ? existing.get(keyOf(name)) : undefined;
    if (!name) errors.push('품목명이 비어 있어요.');
    else {
      const first = seen.get(keyOf(name));
      if (first !== undefined) errors.push(`같은 품목명이 파일 안에 또 있어요(${first}번 줄). 한 줄만 남겨 주세요.`);
      else seen.set(keyOf(name), line);
    }
    if (!ex) {
      if (!data.category && index.category !== undefined) errors.push('새 품목은 분류를 꼭 적어 주세요.');
      if (!data.unit && index.unit !== undefined) errors.push('새 품목은 단위를 꼭 적어 주세요(예: 박스, 팩).');
      if (index.category === undefined) errors.push('새 품목은 분류가 필요한데 "분류" 열이 없어요.');
      if (index.unit === undefined) errors.push('새 품목은 단위가 필요한데 "단위" 열이 없어요.');
      if (data.par === null && !errors.some((e) => e.startsWith('적정 재고'))) errors.push('새 품목은 적정 재고를 꼭 적어 주세요(모르면 0).');
    }

    // 바코드: 앞뒤 공백을 지우고, 쓸 수 없는 글자·다른 품목과 겹침·파일 안 중복을 오류로 둔다
    const code = normalizeBarcode(raw('barcode'));
    if (code) {
      const problem = barcodeProblem(code);
      const owner = barcodeOwner.get(code);
      const firstLine = seenBarcode.get(code);
      if (problem) errors.push(problem);
      else if (owner && owner.id !== ex?.id) errors.push(`바코드 "${code}"는 이미 "${owner.name}" 품목이 쓰고 있어요. 바코드를 다시 확인해 주세요.`);
      else if (firstLine !== undefined) errors.push(`같은 바코드가 파일 안에 또 있어요(${firstLine}번 줄). 품목마다 다른 바코드를 적어 주세요.`);
      else {
        seenBarcode.set(code, line);
        data.barcode = code;
      }
    }

    const changes: ImportChange[] = [];
    if (ex) {
      const cmp = (field: ImportField, from: string | number | boolean | null, to: string | number | boolean | null) => {
        if (to === null) return; // 빈 칸은 그대로 둔다
        if (from === to) return;
        changes.push({ field, label: IMPORT_FIELD_LABELS[field], from: show(from), to: show(to) });
      };
      if (name && name !== ex.name) cmp('name', ex.name, name);
      cmp('category', ex.category, data.category);
      cmp('unit', ex.unit, data.unit);
      cmp('par', ex.par_level, data.par);
      cmp('trackExpiry', ex.track_expiry === 1, data.trackExpiry);
      if (vendorId !== undefined && vendorId !== ex.default_vendor_id) changes.push({ field: 'vendor', label: IMPORT_FIELD_LABELS.vendor, from: show(ex.vendor_name), to: show(data.vendor) });
      cmp('location', ex.location, data.location);
      cmp('memo', ex.memo, data.memo);
      cmp('barcode', ex.barcode, data.barcode);
      if (ex.active !== 1) notes.push('"사용 안 함" 품목이에요. 내용만 바뀌고 사용 안 함 상태는 그대로예요.');
    }

    const action: ImportAction = errors.length ? 'error' : !ex ? 'new' : changes.length ? 'update' : 'unchanged';
    rows.push({ line, action, data, changes: action === 'error' ? [] : changes, errors, notes, itemId: ex?.id ?? null, vendorId });
  }
  return { rows, ignored };
}

/** 미리보기 표(메모리에 30분 보관, 올린 사람만 확정할 수 있다) */
interface PreviewEntry {
  userId: number | null;
  createdAt: number;
  fileName: string;
  text: string;
}
const previews = new Map<string, PreviewEntry>();

/** 오래된 미리보기 표를 지운다 */
function sweep(now: number): void {
  for (const [k, v] of previews) if (now - v.createdAt > PREVIEW_TTL_MS) previews.delete(k);
}

/** 줄 수를 처리 방법별로 센다 */
function countActions(rows: ImportPreviewRow[]): Record<ImportAction, number> {
  const t: Record<ImportAction, number> = { new: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of rows) t[r.action] += 1;
  return t;
}

/** 확정 때 쓰지 않는 값을 뺀 미리보기 줄 */
function publicRow(r: PlannedRow): ImportPreviewRow {
  const { vendorId: _v, ...rest } = r;
  return rest;
}

/**
 * 올린 CSV 파일의 미리보기를 만든다(아직 저장하지 않는다).
 * 크기·확장자를 검사하고 인코딩(UTF-8·CP949)을 판별한 뒤 줄마다 검사한다. 확정용 token을 돌려준다.
 */
export function previewImport(ctx: AuditContext, file: { name: string; data: Uint8Array }): ImportPreview {
  if (!/\.(csv|txt)$/i.test(file.name)) throw new AppError('FILE_TYPE', { message: 'CSV 파일만 올릴 수 있어요. 엑셀에서 "다른 이름으로 저장 → CSV"로 저장해 주세요.' });
  if (file.data.length > IMPORT_MAX_BYTES) throw new AppError('FILE_TOO_LARGE', { message: 'CSV 파일이 너무 커요(최대 2MB). 파일을 나눠 올려 주세요.' });
  if (file.data.length === 0) throw new AppError('VALIDATION', { message: '빈 파일이에요. 양식에 품목을 적어 올려 주세요.', fields: { file: '빈 파일이에요.' } });
  const { text, encoding } = decodeCsvBytes(file.data);
  const { rows, ignored } = planImport(ctx.db, text);
  const now = ctx.clock.now().getTime();
  sweep(now);
  const token = randomBytes(18).toString('base64url');
  previews.set(token, { userId: ctx.user?.id ?? null, createdAt: now, fileName: file.name, text });
  return { token, fileName: file.name, encoding, totals: countActions(rows), rows: rows.map(publicRow), ignoredColumns: ignored };
}

/**
 * 미리보기를 확정한다. 그 사이 다른 사람이 품목을 바꿨을 수 있어 파일을 다시 검사한 뒤 저장한다.
 * 오류 줄이 있는데 skipErrors가 아니면 409(아무것도 저장하지 않음). 신규·변경을 한 트랜잭션으로 저장하고 감사 기록 1건을 남긴다.
 */
export function commitImport(ctx: AuditContext, token: string, skipErrors: boolean): ImportCommitResult {
  const { db, clock } = ctx;
  const now = clock.now().getTime();
  sweep(now);
  const entry = previews.get(token);
  if (!entry || entry.userId !== (ctx.user?.id ?? null)) {
    throw new AppError('NOT_FOUND', { message: '미리보기가 만료됐어요(30분). 파일을 다시 올려 주세요.' });
  }
  const { rows } = planImport(db, entry.text);
  const errorLines = rows.filter((r) => r.action === 'error').map((r) => r.line);
  if (errorLines.length && !skipErrors) {
    throw new AppError('CONFLICT', {
      message: `오류 줄이 ${errorLines.length}개 있어요. 파일을 고쳐 다시 올리거나 "오류 줄 건너뛰고 확정"을 눌러 주세요.`,
      extra: { errorLines },
    });
  }
  const iso = clock.now().toISOString();
  const result = db.tx(() => {
    let created = 0;
    let updated = 0;
    for (const r of rows) {
      if (r.action === 'new') {
        db.run(
          'INSERT INTO items (name, category, unit, par_level, track_expiry, default_vendor_id, location, memo, barcode, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
          [r.data.name, r.data.category, r.data.unit, r.data.par ?? 0, r.data.trackExpiry ? 1 : 0, r.vendorId ?? null, r.data.location, r.data.memo, r.data.barcode, iso, iso],
        );
        created += 1;
      } else if (r.action === 'update' && r.itemId) {
        const sets: string[] = [];
        const params: (string | number | null)[] = [];
        const col: Record<ImportField, string> = { name: 'name', category: 'category', unit: 'unit', par: 'par_level', trackExpiry: 'track_expiry', vendor: 'default_vendor_id', location: 'location', memo: 'memo', barcode: 'barcode' };
        for (const c of r.changes) {
          sets.push(`${col[c.field]} = ?`);
          if (c.field === 'vendor') params.push(r.vendorId ?? null);
          else if (c.field === 'trackExpiry') params.push(r.data.trackExpiry ? 1 : 0);
          else params.push(r.data[c.field] as string | number | null);
        }
        db.run(`UPDATE items SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, iso, r.itemId]);
        updated += 1;
      }
    }
    const skipped = rows.length - created - updated;
    audit(ctx, 'items.import', 'item', null, { fileName: entry.fileName, created, updated, skipped, errorLines: errorLines.slice(0, 50) });
    return { created, updated, skipped, errorLines };
  });
  previews.delete(token);
  return result;
}

/** 테스트용: 보관 중인 미리보기 표를 모두 지운다 */
export function clearPreviewsForTest(): void {
  previews.clear();
}

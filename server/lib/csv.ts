// 이 파일이 하는 일: CSV 내보내기·가져오기에 함께 쓰는 공용 함수(TD-016, FR-056·FR-005 AC2)를 둔다.
// 내보내기: 맨 앞 UTF-8 BOM(엑셀이 한글을 UTF-8로 읽게), 줄 끝 CRLF, 따옴표 이스케이프는 직접 한다.
// 수식 주입 방지: 글자 칸이 = + - @(또는 탭·줄바꿈)로 시작하면 앞에 작은따옴표(')를 붙여 엑셀이 수식으로 실행하지 않게 한다.
// 가져오기: 받은 바이트를 UTF-8로 먼저 풀어 보고, 깨진 글자가 나오면 CP949(EUC-KR)로 다시 푼다. 표 나누기는 papaparse가 한다.
import Papa from 'papaparse';

/** UTF-8 BOM(엑셀이 한글 CSV를 UTF-8로 읽게 하는 표시) */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/** 엑셀이 수식으로 읽을 수 있는 첫 글자 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * CSV 칸 하나를 만든다. 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다.
 * 글자 값이 =, +, -, @로 시작하면 앞에 '를 붙인다. 숫자 값(-3 같은 음수)은 수식이 아니므로 그대로 둔다.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value);
  if (typeof value !== 'number' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 표(첫 줄은 열 이름)를 CSV 글로 만든다(맨 앞 UTF-8 BOM, 줄 끝 CRLF) */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return UTF8_BOM + rows.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** 내려받기 응답 헤더(파일 이름은 영문 기본값 + 한글 이름) */
export function csvDownloadHeaders(asciiName: string, koreanName: string): Record<string, string> {
  return {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(koreanName)}`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
}

/** 해독 결과: 글과 판별한 인코딩 */
export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'cp949';
}

/** 깨진 글자(�) 수 */
function brokenCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch === '�') n += 1;
  return n;
}

/**
 * CSV 파일 바이트를 글로 푼다. UTF-8 BOM이 있으면 UTF-8로 본다.
 * UTF-8로 풀었을 때 깨진 글자가 있으면 CP949(EUC-KR, 엑셀 "CSV(쉼표로 분리)" 기본 저장)로 다시 풀고, 깨진 글자가 더 적은 쪽을 고른다.
 */
export function decodeCsvBytes(bytes: Uint8Array): DecodedText {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const utf8 = new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes);
  if (hasBom) return { text: utf8, encoding: 'utf-8' };
  const bad = brokenCount(utf8);
  if (bad === 0) return { text: utf8, encoding: 'utf-8' };
  const cp949 = new TextDecoder('euc-kr').decode(bytes);
  return brokenCount(cp949) < bad ? { text: cp949, encoding: 'cp949' } : { text: utf8, encoding: 'utf-8' };
}

/** CSV 글을 줄(칸 배열) 목록으로 나눈다. 앞뒤 공백은 지우고, 칸이 모두 빈 줄은 뺀다(원래 줄 번호는 line에 남김) */
export function parseCsvRows(text: string): Array<{ line: number; cells: string[] }> {
  const body = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  const parsed = Papa.parse<string[]>(body, { skipEmptyLines: false });
  const out: Array<{ line: number; cells: string[] }> = [];
  parsed.data.forEach((cells, i) => {
    const trimmed = cells.map((c) => (c ?? '').trim());
    if (trimmed.every((c) => c === '')) return;
    out.push({ line: i + 1, cells: trimmed });
  });
  return out;
}

/** 내보낼 때 붙인 수식 방지 작은따옴표를 가져올 때 다시 뗀다("'=SUM" → "=SUM"은 하지 않고, "'-3" 같은 숫자만 되돌린다) */
export function unguardNumber(s: string): string {
  return /^'[+-]?\d/.test(s) ? s.slice(1) : s;
}

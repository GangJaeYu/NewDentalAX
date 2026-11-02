// 이 파일이 하는 일: 글 속 개인정보(주민·외국인등록번호, 휴대·일반 전화번호, 이메일, 카드번호, 계좌번호, 여권번호)를
// 찾아서 가리거나(redact) 막는(block) 규칙을 둔다. 서버 필터(server/privacy/filter.ts)와 화면 입력 중 경고
// (web/src/lib/privacy.ts)가 이 파일 하나를 함께 쓴다. 최종 판정은 서버가 한다(TD-010, FR-032).
// 순수 함수만 있다. shared 폴더는 다른 폴더를 import하지 않는다.

/** 감지하는 개인정보 종류. backend.md §1 PiiType과 같다. 외국인등록번호는 형식이 같아 rrn으로 센다 */
export const PII_TYPES = ['rrn', 'phone', 'email', 'card', 'account', 'passport'] as const;
export type PiiType = (typeof PII_TYPES)[number];

/** 화면·안내 문구에 쓰는 한국어 이름 */
export const PII_LABELS: Record<PiiType, string> = {
  rrn: '주민등록번호',
  phone: '전화번호',
  email: '이메일',
  card: '카드번호',
  account: '계좌번호',
  passport: '여권번호',
};

/** 가린 자리에 넣는 표시. 예: "[전화번호]" */
export function piiMask(type: PiiType): string {
  return `[${PII_LABELS[type]}]`;
}

/** 처리 방식: block=보내지 않음, redact=가리고 보냄 */
export const PII_ACTIONS = ['block', 'redact'] as const;
export type PiiAction = (typeof PII_ACTIONS)[number];
export type PrivacyPolicy = Record<PiiType, PiiAction>;

/** 기본 정책: 주민등록번호·카드번호는 차단, 나머지는 가리기(FR-032 AC2) */
export const DEFAULT_PRIVACY_POLICY: Readonly<PrivacyPolicy> = Object.freeze({
  rrn: 'block',
  card: 'block',
  phone: 'redact',
  email: 'redact',
  account: 'redact',
  passport: 'redact',
});

/** settings.privacy 값(database.md §5). allowlist는 가리지 않을 번호·주소(병원 대표번호 등) */
export interface PrivacySettings {
  allowlist: string[];
  policy: PrivacyPolicy;
}

export const DEFAULT_PRIVACY_SETTINGS: Readonly<PrivacySettings> = Object.freeze({
  allowlist: [],
  policy: { ...DEFAULT_PRIVACY_POLICY },
});

/** 글 속에서 찾은 개인정보 한 곳(start·end는 원문 기준 위치, end는 포함하지 않음) */
export interface PiiMatch {
  type: PiiType;
  start: number;
  end: number;
  text: string;
}

export interface PiiFinding {
  type: PiiType;
  count: number;
}

/** 검사 결과. TD-010의 {redactedText, findings, blocked}에 차단 종류와 가림 여부를 더했다 */
export interface PrivacyResult {
  /** 감지한 곳을 모두 "[전화번호]" 같은 표시로 바꾼 글(차단 대상도 가린다) */
  redactedText: string;
  /** 종류별 건수. PII_TYPES 순서이고, 0건인 종류는 빠진다. 허용 목록에 있는 것은 세지 않는다 */
  findings: PiiFinding[];
  /** 정책상 차단할 종류가 하나라도 있으면 true */
  blocked: boolean;
  /** 차단 사유가 된 종류(PII_TYPES 순서) */
  blockedTypes: PiiType[];
  /** 한 곳이라도 가렸으면 true */
  redacted: boolean;
}

// ───────────────────────── 글자 정리 ─────────────────────────

/** 전각 숫자·영문, 여러 가지 줄표를 반각으로 바꾼다. 글자 수는 그대로라 위치가 원문과 같다 */
const CHAR_MAP: Record<string, string> = {
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '−': '-', '－': '-',
  '．': '.', '（': '(', '）': ')', '＋': '+', '＠': '@', '　': ' ', ' ': ' ',
};

export function normalizeForScan(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xff10 && c <= 0xff19) out += String.fromCharCode(c - 0xff10 + 48); // ０-９
    else if (c >= 0xff21 && c <= 0xff3a) out += String.fromCharCode(c - 0xff21 + 65); // Ａ-Ｚ
    else if (c >= 0xff41 && c <= 0xff5a) out += String.fromCharCode(c - 0xff41 + 97); // ａ-ｚ
    else {
      const ch = text[i] as string;
      out += CHAR_MAP[ch] ?? ch;
    }
  }
  return out;
}

// ───────────────────────── 검사 도우미 ─────────────────────────

/** Luhn 검사(카드번호 끝자리 검증). 숫자만 넣는다 */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** 주민·외국인등록번호 앞 6자리(YYMMDD)가 실제 날짜인지. 7번째 자리로 1900년대·2000년대를 정한다 */
export function isValidRrnDate(front6: string, genderDigit: string): boolean {
  if (!/^\d{6}$/.test(front6) || !/^[1-8]$/.test(genderDigit)) return false;
  const yy = Number(front6.slice(0, 2));
  const mm = Number(front6.slice(2, 4));
  const dd = Number(front6.slice(4, 6));
  const century = '1256'.includes(genderDigit) ? 1900 : 2000;
  const year = century + yy;
  if (mm < 1 || mm > 12 || dd < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1] as number;
  return dd <= dim;
}

/** 위치 앞(before 글자)·뒤(after 글자)에 문맥 단어가 있는지 */
function hasContext(text: string, start: number, end: number, re: RegExp, before: number, after = 0): boolean {
  if (re.test(text.slice(Math.max(0, start - before), start))) return true;
  return after > 0 && re.test(text.slice(end, end + after));
}

const RRN_CONTEXT = /주민|외국인|등록번호|생년월일/;
const CARD_CONTEXT = /카드|card/i;
const ACCOUNT_CONTEXT = /계좌|입금|송금|이체|은행|뱅크|농협|국민|신한|우리|하나|기업|우체국|새마을|신협|수협|씨티|토스|예금주|account/i;
const STRONG_ACCOUNT_CONTEXT = /계좌/;
const BUSINESS_CONTEXT = /사업자|법인/;
const PASSPORT_CONTEXT = /여권|passport/i;
/** 로트·일련번호처럼 물품 코드를 말하는 문맥(여권번호 오탐 줄이기) */
const CODE_CONTEXT = /lot|로트|제조번호|일련번호|시리얼|serial|s\/n|(?<![a-z])sn(?![a-z])|모델|model|품번|품목|코드|code|ref|cat\.?|규격|제품|batch|배치|주문|발주|번호표/i;

// 앞뒤가 다른 숫자·영문에 붙어 있으면(긴 코드의 일부) 감지하지 않는다.
// "PO-2611-003"처럼 영문·숫자 뒤에 줄표가 오는 경우도 코드로 본다.
const NB = '(?<![0-9A-Za-z])(?<![0-9A-Za-z][-_])';
const NA = '(?![0-9A-Za-z])(?![-_][0-9A-Za-z])';
/** 전화번호 구분 기호: 줄표·점(앞뒤 공백 1개까지) 또는 공백 1개 */
const SEP = '(?:[ \\t]?[-.][ \\t]?|[ \\t])';
/** 일반 전화 지역번호(02, 031~064), 인터넷전화 070, 안심번호 0502~0508 */
const AREA = '(?:2|[3-6][1-5]|70|50[2-8])';

const RE = {
  rrn: new RegExp(`${NB}(\\d{6})([ \\t]?-[ \\t]?|[ \\t]|)([1-8])(\\d{6}|\\*{6})(?![*])${NA}`, 'g'),
  mobile: new RegExp(`${NB}(?:\\+82${SEP}?0?|0)1[016789]${SEP}?\\d{3,4}${SEP}?\\d{4}${NA}`, 'g'),
  landline: new RegExp(
    `(?:${NB}\\+82${SEP}?\\(?0?${AREA}\\)?${SEP}?|\\(0${AREA}\\)[ \\t]?|${NB}0${AREA}(?:\\)[ \\t]?|${SEP}))\\d{3,4}${SEP}\\d{4}${NA}`,
    'g',
  ),
  email: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
  cardGrouped: new RegExp(`${NB}(?:\\d{4}([ -])\\d{4}\\1\\d{4}\\1\\d{1,4}(?:\\1\\d{1,3})?|\\d{4}([ -])\\d{6}\\2\\d{4,5})${NA}`, 'g'),
  cardPlain: new RegExp(`${NB}\\d{13,19}${NA}`, 'g'),
  accountHyphen: new RegExp(`${NB}\\d{2,6}(?:-\\d{2,7}){1,3}${NA}`, 'g'),
  accountPlain: new RegExp(`${NB}\\d{10,14}${NA}`, 'g'),
  passport: new RegExp(`${NB}([A-Za-z])(\\d{8}|\\d{3}[A-Za-z]\\d{4})${NA}`, 'g'),
};

/** 겹칠 때 먼저 고르는 순서(같은 길이일 때) */
const PRIORITY: Record<PiiType, number> = { rrn: 0, card: 1, phone: 2, account: 3, passport: 4, email: 5 };

function digitsOf(s: string): string {
  return s.replace(/\D/g, '');
}

/** 정규식 하나를 돌려 후보를 모은다. accept가 false를 주면 버린다 */
function collect(
  out: PiiMatch[],
  text: string,
  re: RegExp,
  type: PiiType,
  accept: (m: RegExpExecArray, start: number, end: number) => boolean = () => true,
): void {
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (accept(m, start, end)) out.push({ type, start, end, text: m[0] });
    if (m[0].length === 0) re.lastIndex++;
  }
}

/** 모든 규칙으로 후보를 찾는다(겹침 정리 전). 위치는 원문 기준 */
function findCandidates(text: string): PiiMatch[] {
  const t = normalizeForScan(text);
  const out: PiiMatch[] = [];

  // 주민·외국인등록번호: 앞 6자리 날짜 유효 + 7번째 자리 1~8. 구분 기호 없는 13자리는 바코드와 헷갈려 문맥이 있을 때만
  collect(out, t, RE.rrn, 'rrn', (m, s, e) => {
    const [, front, sep, g, back] = m as unknown as [string, string, string, string, string];
    if (!isValidRrnDate(front, g)) return false;
    if (sep === '') return !back.startsWith('*') && hasContext(t, s, e, RRN_CONTEXT, 20);
    return true;
  });

  // 휴대전화(구분 기호 없어도 감지)와 일반 전화(구분 기호 필수)
  collect(out, t, RE.mobile, 'phone');
  collect(out, t, RE.landline, 'phone');

  collect(out, t, RE.email, 'email', (m) => {
    const last = m[0].slice(m[0].lastIndexOf('.') + 1);
    return /^[A-Za-z]{2,}$/.test(last);
  });

  // 카드번호: 4자리씩 끊은 형식은 Luhn만, 붙여 쓴 형식은 15자리 이상이거나 "카드" 문맥이 있을 때
  collect(out, t, RE.cardGrouped, 'card', (m) => {
    const d = digitsOf(m[0]);
    return d.length >= 13 && d.length <= 19 && luhnValid(d);
  });
  collect(out, t, RE.cardPlain, 'card', (m, s, e) => {
    const d = m[0];
    return luhnValid(d) && (d.length >= 15 || hasContext(t, s, e, CARD_CONTEXT, 20));
  });

  // 계좌번호: 줄표가 있는 10~14자리 + 계좌 문맥. 사업자등록번호 형식(3-2-5)과 "사업자" 문맥은 제외
  collect(out, t, RE.accountHyphen, 'account', (m, s, e) => {
    const d = digitsOf(m[0]);
    if (d.length < 10 || d.length > 14) return false;
    if (/^\d{3}-\d{2}-\d{5}$/.test(m[0])) return false;
    if (hasContext(t, s, e, BUSINESS_CONTEXT, 12)) return false;
    return hasContext(t, s, e, ACCOUNT_CONTEXT, 20, 15);
  });
  collect(out, t, RE.accountPlain, 'account', (_m, s, e) => {
    if (hasContext(t, s, e, BUSINESS_CONTEXT, 12)) return false;
    return hasContext(t, s, e, STRONG_ACCOUNT_CONTEXT, 12);
  });

  // 여권번호: 영문 1자 + 숫자 8자리(구형) 또는 숫자3+영문1+숫자4(신형).
  // "여권" 문맥이 있으면 감지. 없으면 대문자 M·S·R·O·D·G로 시작하고 로트·모델 같은 코드 문맥이 없을 때만 감지
  collect(out, t, RE.passport, 'passport', (m, s, e) => {
    if (hasContext(t, s, e, PASSPORT_CONTEXT, 20, 10)) return true;
    const first = m[1] as string;
    if (!/^[MSRODG]$/.test(first)) return false;
    if (/[a-z]/.test(m[2] as string)) return false;
    return !hasContext(t, s, e, CODE_CONTEXT, 15);
  });

  // 원문 글자로 되돌림(위치는 같다)
  for (const c of out) c.text = text.slice(c.start, c.end);
  return out;
}

// ───────────────────────── 허용 목록 ─────────────────────────

/** 허용 목록 비교용 정리: 이메일은 소문자, 번호는 숫자만(+82는 0으로). 비교할 수 없으면 '' */
export function normalizeAllowEntry(value: string): string {
  const v = normalizeForScan(String(value)).trim();
  if (!v) return '';
  if (v.includes('@')) return v.toLowerCase();
  let d = v.replace(/[^0-9+]/g, '');
  if (d.startsWith('+82')) d = `0${d.slice(3).replace(/^0/, '')}`;
  d = d.replace(/\D/g, '');
  return d.length >= 4 ? d : '';
}

function allowSet(allowlist: readonly string[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const a of allowlist ?? []) {
    const n = normalizeAllowEntry(a);
    if (n) set.add(n);
  }
  return set;
}

// ───────────────────────── 공개 함수 ─────────────────────────

/**
 * 글에서 개인정보를 찾아 위치 순서로 돌려준다. 같은 곳에 여러 규칙이 걸리면 더 긴 것, 같으면 우선순위가 높은 것을 고른다.
 * 허용 목록(병원 대표번호 등)과 같은 값은 빼고 돌려준다.
 */
export function detectPii(text: string, options: { allowlist?: readonly string[] } = {}): PiiMatch[] {
  if (!text) return [];
  const cands = findCandidates(text).sort(
    (a, b) => b.end - b.start - (a.end - a.start) || PRIORITY[a.type] - PRIORITY[b.type] || a.start - b.start,
  );
  const chosen: PiiMatch[] = [];
  for (const c of cands) {
    if (chosen.some((k) => c.start < k.end && k.start < c.end)) continue;
    chosen.push(c);
  }
  const allow = allowSet(options.allowlist);
  return chosen
    .filter((c) => allow.size === 0 || !allow.has(normalizeAllowEntry(c.text)))
    .sort((a, b) => a.start - b.start);
}

/** 찾은 목록을 종류별 건수로 센다(PII_TYPES 순서, 0건 제외) */
export function countFindings(matches: readonly { type: PiiType }[]): PiiFinding[] {
  return PII_TYPES.map((type) => ({ type, count: matches.filter((m) => m.type === type).length })).filter((f) => f.count > 0);
}

/** 정책 값을 기본값과 합친다(빠진 종류는 기본 정책) */
export function resolvePolicy(policy?: Partial<PrivacyPolicy>): PrivacyPolicy {
  return { ...DEFAULT_PRIVACY_POLICY, ...(policy ?? {}) };
}

/**
 * 글 하나를 검사한다: 감지한 곳을 "[전화번호]" 같은 표시로 바꾸고, 종류별 건수와 차단 여부를 돌려준다.
 * 예: "홍길동 010-1234-5678 연락" → redactedText "홍길동 [전화번호] 연락", findings [{phone,1}], blocked false
 */
export function scanPrivacy(
  text: string,
  settings: { allowlist?: readonly string[]; policy?: Partial<PrivacyPolicy> } = {},
): PrivacyResult {
  const policy = resolvePolicy(settings.policy);
  const matches = detectPii(text, { allowlist: settings.allowlist });
  let redactedText = '';
  let pos = 0;
  for (const m of matches) {
    redactedText += text.slice(pos, m.start) + piiMask(m.type);
    pos = m.end;
  }
  redactedText += text.slice(pos);
  const findings = countFindings(matches);
  const blockedTypes = findings.filter((f) => policy[f.type] === 'block').map((f) => f.type);
  return { redactedText, findings, blocked: blockedTypes.length > 0, blockedTypes, redacted: matches.length > 0 };
}

/** 종류 이름을 쉼표로 잇는다. 예: "주민등록번호, 카드번호" */
export function joinPiiLabels(types: readonly PiiType[]): string {
  return types.map((t) => PII_LABELS[t]).join(', ');
}

/** 차단 안내 문구(backend.md §5 AI_PII_BLOCKED). 예: "주민등록번호로 보이는 내용이 있어 AI로 보내지 않았습니다. …" */
export function blockedMessage(types: readonly PiiType[]): string {
  return `${joinPiiLabels(types)}로 보이는 내용이 있어 AI로 보내지 않았습니다. 해당 부분을 지우고 다시 시도해 주세요.`;
}

/** 가리고 보낸 뒤 안내 문구(FR-032 AC2). 예: "전화번호 1건을 가리고 보냈습니다". 감지가 없으면 null */
export function redactedMessage(findings: readonly PiiFinding[]): string | null {
  if (findings.length === 0) return null;
  return `${findings.map((f) => `${PII_LABELS[f.type]} ${f.count}건`).join(', ')}을 가리고 보냈습니다`;
}

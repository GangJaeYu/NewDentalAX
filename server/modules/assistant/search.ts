// 이 파일이 하는 일: 원내 AI 도우미의 한글 문서 검색 엔진(TD-011, FR-071, OQ-008 실험 결과 반영).
// 문서를 제목·소제목 경로가 붙은 조각으로 나누고, 한글을 2글자씩 끊은 "2-gram" 문자열로 바꿔 FTS5(unicode61)에 넣은 뒤,
// 질문도 같은 방식으로 바꿔 BM25 점수로 찾는다. 최고 조각이 질문 낱말을 너무 적게 담고 있으면 "찾지 못함"으로 판정한다.
// DB는 server/db/index.ts 래퍼로만 다룬다. 실제 테이블(kb_docs·kb_chunks·kb_fts)의 마이그레이션은 phase-03 문서 태스크가 만든다.
import type { Db, SqlValue } from '../../db/index.ts';

// ───────────────────────── 검색 설정값 ─────────────────────────

/** 검색 품질을 좌우하는 설정값. 기본값은 OQ-008 실험(scripts/kb-eval.ts)으로 정했다 */
export interface SearchParams {
  /** 조각 하나의 최대 글자 수 */
  chunkSize: number;
  /** 긴 절을 여러 조각으로 나눌 때 앞 조각 끝에서 다음 조각으로 겹쳐 넣는 글자 수 */
  overlap: number;
  /** 조각 나누는 방식: 'section'은 소제목마다 끊고, 'size'는 소제목을 무시하고 글자 수로만 끊는다 */
  splitBy: 'section' | 'size';
  /** BM25에서 제목·소제목 경로 열의 가중치(본문은 1) */
  headingWeight: number;
  /** 색인할 때 띄어쓰기를 건너는 2-gram도 넣을지("연차 신청" → "차신"). 띄어쓰기 없는 질문을 찾게 해 준다 */
  crossSpace: boolean;
  /** BM25에서 띄어쓰기를 건너는 2-gram 열의 가중치(우연히 겹치기 쉬워 본문보다 낮게 둔다) */
  crossWeight: number;
  /** 질문에서 조사·질문 어미("은", "해요", "어떻게" 등)를 덜어 낼지 */
  queryCleanup: boolean;
  /** 같은 뜻의 원내 낱말(유통기한 → 유효기간 등)로 질문을 넓힐지 */
  expand: boolean;
  /** 돌려줄 조각 수(BM25 상위 N개) */
  limit: number;
  /** "근거 있음" 판정 기준: 가장 잘 맞는 조각이 질문 2-gram 중 이 비율 이상을 담고 있어야 한다 */
  minMatchRatio: number;
}

/** 기본 설정(OQ-008 실험의 최종값). 바꾸면 `npm run kb-eval`로 적중률을 다시 확인한다 */
export const DEFAULT_SEARCH_PARAMS: Readonly<SearchParams> = Object.freeze({
  chunkSize: 600,
  overlap: 100,
  splitBy: 'section',
  headingWeight: 2,
  crossSpace: true,
  crossWeight: 0.5,
  queryCleanup: true,
  expand: true,
  limit: 6,
  minMatchRatio: 0.4,
});

// ───────────────────────── 2-gram 변환 ─────────────────────────

/** 낱말 하나: 글자들과, 바로 앞 낱말과 띄어쓰기로만 떨어져 있는지 */
interface Word {
  text: string;
  hangul: boolean;
  /** 앞 낱말과의 사이가 공백뿐이면 true(문장부호·숫자로 끊기면 false) */
  joinedToPrev: boolean;
}

/** 한글 덩어리 / 영문 / 숫자 / 그 밖의 글자 덩어리. 문장부호·기호·공백은 낱말 경계다 */
const WORD_RE = /\p{Script=Hangul}+|[a-z]+|[0-9]+|[^\s\p{P}\p{S}\p{Script=Hangul}a-z0-9]+/gu;
const HANGUL_RE = /^\p{Script=Hangul}+$/u;

/** 글자 모양을 통일한다(전각 → 반각, 영문 소문자) */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/** 글을 낱말 목록으로 나눈다 */
function splitWords(text: string): Word[] {
  const s = normalizeText(text);
  const words: Word[] = [];
  let prevEnd = -1;
  let prevHangul = false;
  for (const m of s.matchAll(WORD_RE)) {
    const start = m.index;
    const hangul = HANGUL_RE.test(m[0]);
    const gap = prevEnd < 0 ? '' : s.slice(prevEnd, start);
    const joinedToPrev = prevEnd >= 0 && hangul && prevHangul && gap.length > 0 && /^\s+$/.test(gap);
    words.push({ text: m[0], hangul, joinedToPrev });
    prevEnd = start + m[0].length;
    prevHangul = hangul;
  }
  return words;
}

/** 한글 낱말 하나를 2-gram으로 바꾼다. 한 글자 낱말은 그 글자 하나를 그대로 쓴다 */
function wordGrams(word: string): string[] {
  const ch = Array.from(word);
  if (ch.length <= 1) return ch;
  const out: string[] = [];
  for (let i = 0; i + 1 < ch.length; i++) out.push(ch[i]! + ch[i + 1]!);
  return out;
}

/** 낱말 끝에 붙는 조사·어미(긴 것부터 확인한다) */
const SUFFIXES = [
  '해야돼요', '해야되나요', '해야하나요', '했을때', '하려면', '하나요', '되나요', '인가요', '이에요', '에서는', '으로는',
  '에게는', '한테는', '까지는', '부터는', '해야', '해요', '하면', '하는', '하고', '할때', '돼요', '되면', '예요', '에요',
  '에서', '으로', '에게', '한테', '까지', '부터', '처럼', '보다', '이랑', '마다', '할', '은', '는', '이', '가', '을', '를',
  '에', '로', '와', '과', '도', '만', '의', '랑', '요',
];
/** 두 글자 낱말에서도 떼어도 되는 조사(명사 끝 글자와 거의 겹치지 않는 것만) */
const SHORT_SAFE_SUFFIXES = new Set(['은', '는', '을', '를']);

/** 색인할 때 두 글자 낱말 끝에서 떼어 본 한 글자 조사("물과" → "물"도 색인) */
const ONE_SYLLABLE_PARTICLES = new Set(['은', '는', '이', '가', '을', '를', '에', '로', '와', '과', '도', '만', '의']);

/** 질문에서 뜻이 거의 없는 낱말(질문 말투·의문사) */
const QUERY_STOPWORDS = new Set([
  '몇', '좀', '왜', '뭐', '꼭', '더', '잘', '수', '것', '때', '등', '및', '어떻게', '어떡해', '어떻게요', '어떤', '무슨', '무엇',
  '뭘', '뭐예요', '언제', '어디', '누구', '누가', '얼마', '얼마나', '해요', '하나요', '돼요', '되나요', '있나요', '있어요',
  '있을까요', '없나요', '해야', '해야돼요', '해야하나요', '알려줘', '알려', '주세요', '줘', '줘요', '정도', '혹시', '그냥',
  '하면', '되요', '돼', '해', '가요', '나요', '거', '건가요', '인가요', '이에요', '예요', '게', '걸', '면',
]);

/** 낱말 끝의 조사·어미를 떼어 낸다(최대 3번, 남는 글자가 1~2글자 이상일 때만) */
export function stripSuffix(word: string): string {
  let w = word;
  for (let round = 0; round < 3; round++) {
    const len = Array.from(w).length;
    let changed = false;
    for (const suf of SUFFIXES) {
      if (!w.endsWith(suf)) continue;
      const rest = Array.from(w).slice(0, len - Array.from(suf).length).join('');
      const restLen = Array.from(rest).length;
      const ok = restLen >= 2 || (restLen === 1 && len === 2 && SHORT_SAFE_SUFFIXES.has(suf));
      if (!ok) continue;
      w = rest;
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return w;
}

/**
 * 색인할 글(조각 본문·소제목)을 2-gram 목록으로 바꾼다. 같은 2-gram이 여러 번 나오면 그대로 반복한다(BM25가 횟수를 센다).
 * - 한글 낱말은 2글자씩 겹쳐 끊는다. 한 글자 낱말은 그 글자를 그대로 넣는다.
 * - 두 글자 낱말이 한 글자 조사로 끝나면("물과") 앞 글자("물")도 넣어, 한 글자 질문 낱말과 맞게 한다.
 * - 영문·숫자는 덩어리째 넣는다.
 */
export function toIndexGrams(text: string): string[] {
  const out: string[] = [];
  for (const w of splitWords(text)) {
    if (!w.hangul) {
      out.push(w.text);
      continue;
    }
    out.push(...wordGrams(w.text));
    const ch = Array.from(w.text);
    if (ch.length === 2 && ONE_SYLLABLE_PARTICLES.has(ch[1]!)) out.push(ch[0]!);
  }
  return out;
}

/**
 * 띄어 쓴 두 한글 낱말 사이를 잇는 2-gram(앞 낱말 끝 글자 + 뒤 낱말 첫 글자, "연차 신청" → "차신")을 만든다.
 * 띄어쓰기 없이 친 질문("연차신청")과 맞추려고 따로 색인한다. 우연히 겹치기 쉬워서("다시 세척" → "시세")
 * 점수 가중치를 낮게 두고, 맞는 비율을 셀 때는 질문 낱말 안의 이웃 2-gram이 본문에서 함께 맞을 때만 인정한다.
 */
export function toCrossGrams(text: string): string[] {
  const out: string[] = [];
  let prev: Word | undefined;
  for (const w of splitWords(text)) {
    if (prev && w.joinedToPrev) out.push(Array.from(prev.text).at(-1)! + Array.from(w.text)[0]!);
    prev = w;
  }
  return out;
}

/** 같은 뜻으로 쓰는 원내 낱말. 질문 낱말에 왼쪽이 들어 있으면 오른쪽 낱말도 함께 찾는다 */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  오토클레이브: ['고압증기멸균기', '멸균기'],
  소독기: ['멸균기'],
  유통기한: ['유효기간'],
  유통기간: ['유효기간'],
  휴가: ['연차'],
  월차: ['연차'],
  아파: ['병가'],
  아프: ['병가'],
  아플: ['병가'],
  병원비: ['진료비'],
  치료비: ['진료비'],
  노쇼: ['미내원'],
  바늘: ['주사바늘', '찔림'],
  찔렸: ['찔림'],
  찔리: ['찔림'],
  쓰레기: ['폐기물'],
  유니트: ['수관'],
  체어: ['유니트'],
  주문: ['발주'],
  재고조사: ['재고실사'],
  마취약: ['마취제'],
  냉장고: ['냉장'],
  손소독: ['손소독제'],
});

/** 질문 낱말 하나와, 그 낱말을 대신해 맞춰 볼 같은 뜻 낱말들의 2-gram */
export interface QueryTerm {
  /** 질문에서 꺼낸 낱말(조사를 뗀 뒤) */
  word: string;
  /** 이 낱말의 2-gram */
  grams: string[];
  /** 같은 뜻 낱말들의 2-gram 묶음(expand일 때만) */
  alternatives: string[][];
}

/** 질문을 검색용 낱말 목록으로 바꾼다 */
export function toQueryTerms(question: string, params: Pick<SearchParams, 'queryCleanup' | 'expand'> = DEFAULT_SEARCH_PARAMS): QueryTerm[] {
  const terms: QueryTerm[] = [];
  const seen = new Set<string>();
  for (const w of splitWords(question)) {
    let word = w.text;
    if (w.hangul && params.queryCleanup) {
      if (QUERY_STOPWORDS.has(word)) continue;
      word = stripSuffix(word);
      if (QUERY_STOPWORDS.has(word)) continue;
    }
    if (seen.has(word)) continue;
    seen.add(word);
    const grams = w.hangul ? wordGrams(word) : [word];
    const alternatives: string[][] = [];
    if (params.expand && w.hangul) {
      for (const [key, alts] of Object.entries(SYNONYMS)) {
        if (word.includes(key)) for (const a of alts) alternatives.push(wordGrams(a));
      }
    }
    terms.push({ word, grams, alternatives });
  }
  return terms;
}

/** 질문을 2-gram 목록(중복 없음)으로 바꾼다. 같은 뜻 낱말의 2-gram도 포함한다 */
export function toQueryGrams(question: string, params: Pick<SearchParams, 'queryCleanup' | 'expand'> = DEFAULT_SEARCH_PARAMS): string[] {
  const set = new Set<string>();
  for (const t of toQueryTerms(question, params)) {
    for (const g of t.grams) set.add(g);
    for (const alt of t.alternatives) for (const g of alt) set.add(g);
  }
  return [...set];
}

/** 2-gram 목록을 FTS5 MATCH 식으로 만든다(낱말마다 따옴표로 감싸 OR로 잇는다). 비어 있으면 null */
export function toMatchExpression(grams: readonly string[]): string | null {
  const safe = grams.filter((g) => g.length > 0).map((g) => `"${g.replaceAll('"', '""')}"`);
  return safe.length ? safe.join(' OR ') : null;
}

/**
 * 조각이 질문을 얼마나 담고 있는지(0~1). 질문 2-gram 중 조각(소제목+본문)에 있는 비율이다.
 * - 같은 뜻 낱말이 조각 본문에 통째로 들어 있으면 원래 낱말의 2-gram을 모두 맞은 것으로 센다.
 * - 띄어쓰기를 건너는 2-gram(crossGrams)에만 있는 것은, 같은 질문 낱말 안 바로 옆 2-gram이 본문에서 맞을 때만 센다
 *   ("연차신청"의 "차신"은 "연차"·"신청"이 맞으니 인정, 낱말 하나뿐인 "시세"는 "다시 세척"에 우연히 걸려도 불인정).
 */
export function matchRatio(terms: readonly QueryTerm[], chunkGrams: ReadonlySet<string>, crossGrams: ReadonlySet<string> = new Set()): number {
  let total = 0;
  let hit = 0;
  for (const t of terms) {
    total += t.grams.length;
    const viaAlt = t.alternatives.some((alt) => alt.length > 0 && alt.every((g) => chunkGrams.has(g)));
    if (viaAlt) {
      hit += t.grams.length;
      continue;
    }
    const inMain = t.grams.map((g) => chunkGrams.has(g));
    t.grams.forEach((g, i) => {
      if (inMain[i]) hit++;
      else if (crossGrams.has(g) && (inMain[i - 1] === true || inMain[i + 1] === true)) hit++;
    });
  }
  return total === 0 ? 0 : hit / total;
}

// ───────────────────────── 조각 나누기 ─────────────────────────

/** 문서 조각 하나 */
export interface DocChunk {
  /** 문서 안 순서(0부터) */
  seq: number;
  /** 제목 > 소제목 > 소소제목 경로 */
  heading: string;
  /** 조각 본문 */
  text: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** 마크다운의 첫 번째 # 제목을 꺼낸다(없으면 null) */
export function titleOf(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const m = HEADING_RE.exec(line.trim());
    if (m && m[1] === '#') return m[2]!.trim();
  }
  return null;
}

/** 긴 줄 하나를 문장 단위로, 그래도 길면 글자 수로 자른다 */
function splitLongLine(line: string, size: number): string[] {
  if (line.length <= size) return [line];
  const out: string[] = [];
  for (const sentence of line.split(/(?<=[.!?。])\s+/)) {
    if (sentence.length <= size) out.push(sentence);
    else for (let i = 0; i < sentence.length; i += size) out.push(sentence.slice(i, i + size));
  }
  return out;
}

/** 앞 조각 끝에서 겹칠 부분을 꺼낸다(낱말 중간에서 시작하지 않게 첫 공백 뒤부터) */
function tailOf(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return overlap > 0 ? text : '';
  const tail = text.slice(text.length - overlap);
  const sp = tail.search(/\s/);
  return (sp >= 0 ? tail.slice(sp + 1) : tail).trim();
}

/** 조각으로 묶을 줄 하나와 그 줄이 속한 소제목 경로 */
interface Line {
  text: string;
  path: string[];
}

/**
 * 줄 목록을 chunkSize 안으로 묶는다. 넘치면 새 조각을 시작하고 앞 조각 끝 overlap 글자를 앞에 붙인다.
 * 조각의 경로는 그 조각에 새로 들어간 첫 줄의 경로다.
 */
function packLines(lines: readonly Line[], chunkSize: number, overlap: number): Line[] {
  const units = lines.flatMap((l) => splitLongLine(l.text, chunkSize).map((t) => ({ text: t, path: l.path })));
  const out: Line[] = [];
  let cur: Line | null = null;
  for (const u of units) {
    if (!cur) {
      cur = { ...u };
      continue;
    }
    if (cur.text.length + 1 + u.text.length <= chunkSize) {
      cur.text += `
${u.text}`;
      continue;
    }
    out.push(cur);
    const tail = tailOf(cur.text, overlap);
    cur = { text: tail && tail.length + 1 + u.text.length <= chunkSize ? `${tail}
${u.text}` : u.text, path: u.path };
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 마크다운(또는 일반 글) 문서를 조각으로 나눈다.
 * - 'section': 소제목마다 끊고, 절이 chunkSize보다 길면 줄·문장 단위로 다시 나누며 overlap만큼 겹친다.
 * - 'size': 소제목 줄도 본문처럼 이어 붙여 글자 수로만 나눈다(실험 비교용). 조각의 heading은 조각이 시작하는 절의 경로다.
 * 첫 # 제목이 title과 같으면 경로에 두 번 넣지 않는다.
 */
export function chunkDocument(title: string, body: string, params: Pick<SearchParams, 'chunkSize' | 'overlap' | 'splitBy'> = DEFAULT_SEARCH_PARAMS): DocChunk[] {
  const chunkSize = Math.max(50, Math.floor(params.chunkSize));
  const overlap = Math.max(0, Math.min(Math.floor(params.overlap), Math.floor(chunkSize / 2)));
  interface Section { path: string[]; lines: string[] }
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let cur: Section = { path: [], lines: [] };
  sections.push(cur);
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const m = HEADING_RE.exec(line);
    if (m) {
      const level = m[1]!.length;
      const text = m[2]!.trim();
      while (stack.length && stack.at(-1)!.level >= level) stack.pop();
      if (!(level === 1 && text === title)) stack.push({ level, text });
      cur = { path: stack.map((s) => s.text), lines: params.splitBy === 'size' ? [text] : [] };
      sections.push(cur);
      continue;
    }
    if (line) cur.lines.push(line);
  }
  const headingOf = (path: string[]) => [title, ...path].join(' > ');
  const groups = params.splitBy === 'size'
    ? [sections.flatMap((s) => s.lines.map((text) => ({ text, path: s.path })))]
    : sections.map((s) => s.lines.map((text) => ({ text, path: s.path })));
  const chunks: DocChunk[] = [];
  for (const g of groups) {
    if (!g.length) continue;
    for (const p of packLines(g, chunkSize, overlap)) chunks.push({ seq: chunks.length, heading: headingOf(p.path), text: p.text });
  }
  return chunks;
}

// ───────────────────────── 색인(FTS5) ─────────────────────────

/**
 * 검색 색인 테이블 정의. 실제 마이그레이션(040~049 범위)도 이 정의를 그대로 쓴다.
 * 열: heading(제목·소제목 경로의 2-gram), grams(본문 2-gram), cross(소제목·본문의 띄어쓰기를 건너는 2-gram). rowid = kb_chunks.id
 */
export const KB_FTS_DDL = "CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(heading, grams, cross, tokenize='unicode61')";

/**
 * 마이그레이션 없이 검색만 시험할 때 쓰는 최소 테이블(kb_chunks의 검색에 필요한 열 + kb_fts)을 만든다.
 * 평가 스크립트와 단위 테스트 전용이다. 서비스는 마이그레이션이 만든 테이블을 쓴다.
 */
export function createStandaloneSearchTables(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS kb_chunks (
    id INTEGER PRIMARY KEY,
    kb_doc_id INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    heading TEXT NOT NULL,
    text TEXT NOT NULL
  )`);
  db.exec(KB_FTS_DDL);
}

/** 조각 하나를 색인에 넣는다(rowid = kb_chunks.id). crossSpace가 false면 cross 열은 비운다 */
export function indexChunk(db: Db, chunkId: number, heading: string, text: string, crossSpace: boolean = DEFAULT_SEARCH_PARAMS.crossSpace): void {
  db.run('INSERT INTO kb_fts(rowid, heading, grams, cross) VALUES (?, ?, ?, ?)', [
    chunkId, toIndexGrams(heading).join(' '), toIndexGrams(text).join(' '), crossSpace ? [...toCrossGrams(heading), ...toCrossGrams(text)].join(' ') : '',
  ]);
}

/**
 * 문서 하나를 조각으로 나눠 kb_chunks와 kb_fts에 넣는다. 한 트랜잭션이다. 넣은 조각 수를 돌려준다.
 * 같은 문서를 다시 넣으려면 먼저 removeDocumentIndex를 부른다.
 */
export function indexDocument(db: Db, kbDocId: number, title: string, body: string, params: Readonly<SearchParams> = DEFAULT_SEARCH_PARAMS): number {
  const chunks = chunkDocument(title, body, params);
  return db.tx(() => {
    for (const c of chunks) {
      const r = db.run('INSERT INTO kb_chunks(kb_doc_id, seq, heading, text) VALUES (?, ?, ?, ?)', [kbDocId, c.seq, c.heading, c.text]);
      indexChunk(db, r.lastInsertRowid, c.heading, c.text, params.crossSpace);
    }
    return chunks.length;
  });
}

/** 문서 하나의 조각과 색인을 지운다(문서 삭제·다시 색인할 때) */
export function removeDocumentIndex(db: Db, kbDocId: number): void {
  db.tx(() => {
    db.run('DELETE FROM kb_fts WHERE rowid IN (SELECT id FROM kb_chunks WHERE kb_doc_id = ?)', [kbDocId]);
    db.run('DELETE FROM kb_chunks WHERE kb_doc_id = ?', [kbDocId]);
  });
}

// ───────────────────────── 검색 ─────────────────────────

/** 검색 결과 조각 하나 */
export interface SearchHit {
  chunkId: number;
  kbDocId: number;
  seq: number;
  heading: string;
  text: string;
  /** BM25 점수(클수록 잘 맞음) */
  score: number;
  /** 질문 2-gram 중 이 조각에 있는 비율(0~1) */
  matchRatio: number;
}

/** 검색 결과 */
export interface SearchResult {
  /** 근거로 쓸 만한 조각이 있는지. false면 AI를 부르지 않고 "찾지 못했습니다"로 답한다(FR-071 AC2) */
  found: boolean;
  /** 못 찾은 까닭: 질문에 찾을 낱말이 없음 / 맞는 조각이 없음 / 맞는 정도가 기준보다 낮음 */
  reason?: 'empty_query' | 'no_match' | 'low_match';
  /** BM25 점수 순서의 조각(found=false여도 참고용으로 담는다) */
  hits: SearchHit[];
  /** 가장 잘 맞는 조각의 matchRatio */
  bestMatchRatio: number;
  /** 실제로 찾은 2-gram */
  queryGrams: string[];
}

/** 추가 검색 조건. sql은 kb_chunks를 `c`라는 이름으로 쓴다(예: 공개 범위·삭제 여부를 거르는 조건) */
export interface SearchFilter {
  sql: string;
  params: readonly SqlValue[];
}

interface HitRow {
  chunkId: number;
  kbDocId: number;
  seq: number;
  heading: string;
  text: string;
  hg: string;
  tg: string;
  cg: string;
  rank: number;
}

/**
 * 질문으로 조각을 찾는다. BM25 상위 limit개를 뽑고, 가장 잘 맞는 조각의 matchRatio가 minMatchRatio보다 낮으면 found=false다.
 * filter로 공개 범위 같은 조건을 SQL 안에서 거른다(예: `{ sql: 'c.kb_doc_id IN (SELECT id FROM kb_docs WHERE visibility = ?)', params: ['all'] }`).
 */
export function searchKb(db: Db, question: string, params: Readonly<SearchParams> = DEFAULT_SEARCH_PARAMS, filter?: SearchFilter): SearchResult {
  const terms = toQueryTerms(question, params);
  const queryGrams = toQueryGrams(question, params);
  const match = toMatchExpression(queryGrams);
  if (!match) return { found: false, reason: 'empty_query', hits: [], bestMatchRatio: 0, queryGrams };
  const where = filter ? ` AND (${filter.sql})` : '';
  const rows = db.all<HitRow>(
    `SELECT c.id AS chunkId, c.kb_doc_id AS kbDocId, c.seq AS seq, c.heading AS heading, c.text AS text,
            kb_fts.heading AS hg, kb_fts.grams AS tg, kb_fts.cross AS cg,
            bm25(kb_fts, ?, 1.0, ?) AS rank
       FROM kb_fts JOIN kb_chunks c ON c.id = kb_fts.rowid
      WHERE kb_fts MATCH ?${where}
      ORDER BY rank, c.id
      LIMIT ?`,
    [params.headingWeight, params.crossWeight, match, ...(filter?.params ?? []), Math.max(1, Math.floor(params.limit))],
  );
  const hits: SearchHit[] = rows.map((r) => {
    const main = new Set(`${r.hg} ${r.tg}`.split(' '));
    const cross = new Set(r.cg ? r.cg.split(' ') : []);
    return {
      chunkId: Number(r.chunkId), kbDocId: Number(r.kbDocId), seq: Number(r.seq), heading: r.heading, text: r.text,
      score: -Number(r.rank), matchRatio: matchRatio(terms, main, cross),
    };
  });
  if (!hits.length) return { found: false, reason: 'no_match', hits, bestMatchRatio: 0, queryGrams };
  const bestMatchRatio = Math.max(...hits.map((h) => h.matchRatio));
  if (bestMatchRatio < params.minMatchRatio) return { found: false, reason: 'low_match', hits, bestMatchRatio, queryGrams };
  return { found: true, hits, bestMatchRatio, queryGrams };
}

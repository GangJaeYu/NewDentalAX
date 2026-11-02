// 이 파일이 하는 일: `npm run kb-eval` — 원내 도우미 검색 품질 실험(OQ-008, phase-01-task-06).
// 데모 매뉴얼 5종(tests/fixtures/kb)을 메모리 DB에 색인하고, 질문 20개마다 상위 3개 조각과 정답 문서 포함 여부, 전체 적중률을 출력한다.
// 관계없는 질문은 "찾지 못함" 판정이 맞는지도 함께 보여 준다. 적중률이 80% 미만이거나 관계없는 질문을 "찾음"으로 판정하면 종료 코드 1이다.
// 사용법: node scripts/kb-eval.ts [--chunk 600] [--overlap 100] [--split section|size] [--heading-weight 2] [--no-cross] [--no-cleanup]
//         [--no-expand] [--min-ratio 0.3] [--sweep(설정 조합 비교표)] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db/index.ts';
import {
  createStandaloneSearchTables, DEFAULT_SEARCH_PARAMS, indexDocument, searchKb, titleOf, type SearchParams,
} from '../server/modules/assistant/search.ts';

/** 평가 자료 폴더 */
export const KB_FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'kb');
/** 통과 기준 적중률(TD-011 실험 기준) */
export const PASS_HIT_RATE = 0.8;
/** 정답 문서가 이 순위 안에 들면 적중으로 본다 */
export const TOP_K = 3;

/** eval-set.json 모양 */
export interface EvalSet {
  docs: { id: string; file: string; visibility: string }[];
  /** section: 정답 소제목(조각 경로의 마지막 부분). 보조 지표 "정답 절 1위"에 쓴다 */
  questions: { id: string; q: string; answer: string; section?: string }[];
  unrelated: string[];
}

/** 평가할 문서 하나(파일에서 읽은 것) */
export interface EvalDoc {
  id: string;
  title: string;
  body: string;
}

/** 질문 하나의 결과 */
export interface QuestionResult {
  id: string;
  q: string;
  answer: string;
  section?: string;
  /** 상위 3개 조각: 문서 id, 소제목 경로, 점수, 맞는 비율 */
  top: { doc: string; heading: string; score: number; matchRatio: number }[];
  hit: boolean;
  /** 1위 조각이 정답 소제목인지(보조 지표, section이 없으면 null) */
  sectionAt1: boolean | null;
  /** 정답 문서가 처음 나온 순위(1부터, 상위 limit 안에 없으면 null) */
  rank: number | null;
  found: boolean;
  bestMatchRatio: number;
}

/** 관계없는 질문 하나의 결과 */
export interface UnrelatedResult {
  q: string;
  found: boolean;
  reason?: string;
  bestMatchRatio: number;
  topDoc: string | null;
}

/** 평가 결과 전체 */
export interface EvalReport {
  params: SearchParams;
  chunkCount: number;
  questions: QuestionResult[];
  hits: number;
  hitRate: number;
  /** 1위 조각이 정답 소제목인 질문 수(보조 지표) */
  sectionAt1: number;
  unrelated: UnrelatedResult[];
  /** 관련 질문인데 "찾지 못함"으로 잘못 판정한 수 */
  falseNotFound: number;
  /** 관계없는 질문인데 "찾음"으로 잘못 판정한 수 */
  falseFound: number;
  pass: boolean;
}

/** 평가 자료(질문 세트와 매뉴얼 본문)를 읽는다 */
export function loadEvalSet(dir: string = KB_FIXTURE_DIR): { set: EvalSet; docs: EvalDoc[] } {
  const set = JSON.parse(fs.readFileSync(path.join(dir, 'eval-set.json'), 'utf8')) as EvalSet;
  const docs = set.docs.map((d) => {
    const body = fs.readFileSync(path.join(dir, d.file), 'utf8');
    return { id: d.id, title: titleOf(body) ?? d.file, body };
  });
  return { set, docs };
}

/** 설정값 하나로 평가를 돌린다. 메모리 DB만 쓰고 파일은 만들지 않는다 */
export function runKbEval(params: SearchParams = { ...DEFAULT_SEARCH_PARAMS }, loaded = loadEvalSet()): EvalReport {
  const { set, docs } = loaded;
  const db = openDb(':memory:');
  try {
    createStandaloneSearchTables(db);
    const idOf = new Map<number, string>();
    let chunkCount = 0;
    docs.forEach((d, i) => {
      idOf.set(i + 1, d.id);
      chunkCount += indexDocument(db, i + 1, d.title, d.body, params);
    });
    const questions: QuestionResult[] = set.questions.map((qq) => {
      const r = searchKb(db, qq.q, params);
      const docsInOrder = r.hits.map((h) => idOf.get(h.kbDocId) ?? '?');
      const idx = docsInOrder.indexOf(qq.answer);
      const top = r.hits.slice(0, TOP_K).map((h) => ({
        doc: idOf.get(h.kbDocId) ?? '?', heading: h.heading, score: h.score, matchRatio: h.matchRatio,
      }));
      return {
        id: qq.id, q: qq.q, answer: qq.answer, section: qq.section, top, hit: top.some((t) => t.doc === qq.answer),
        sectionAt1: qq.section ? top[0]?.doc === qq.answer && top[0].heading.endsWith(qq.section) : null,
        rank: idx >= 0 ? idx + 1 : null, found: r.found, bestMatchRatio: r.bestMatchRatio,
      };
    });
    const unrelated: UnrelatedResult[] = set.unrelated.map((q) => {
      const r = searchKb(db, q, params);
      const first = r.hits[0];
      return { q, found: r.found, reason: r.reason, bestMatchRatio: r.bestMatchRatio, topDoc: first ? (idOf.get(first.kbDocId) ?? '?') : null };
    });
    const hits = questions.filter((q) => q.hit).length;
    const hitRate = questions.length ? hits / questions.length : 0;
    const sectionAt1 = questions.filter((q) => q.sectionAt1 === true).length;
    const falseFound = unrelated.filter((u) => u.found).length;
    const falseNotFound = questions.filter((q) => !q.found).length;
    return {
      params, chunkCount, questions, hits, hitRate, sectionAt1, unrelated, falseNotFound, falseFound,
      pass: questions.length > 0 && hitRate >= PASS_HIT_RATE && falseFound === 0,
    };
  } finally {
    db.close();
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fix = (x: number, n = 2) => x.toFixed(n);

/** 설정값을 한 줄로 */
export function describeParams(p: SearchParams): string {
  return `chunk=${p.chunkSize} overlap=${p.overlap} split=${p.splitBy} headingWeight=${p.headingWeight} crossSpace=${p.crossSpace} crossWeight=${p.crossWeight} `
    + `queryCleanup=${p.queryCleanup} expand=${p.expand} limit=${p.limit} minMatchRatio=${p.minMatchRatio}`;
}

/** 평가 결과를 사람이 읽는 글로 */
export function formatReport(r: EvalReport): string {
  const lines: string[] = [];
  lines.push('원내 도우미 검색 품질 평가 (OQ-008)');
  lines.push(`설정: ${describeParams(r.params)}`);
  lines.push(`색인한 조각: ${r.chunkCount}개`);
  lines.push('');
  for (const q of r.questions) {
    lines.push(`${q.id} [${q.hit ? '적중' : '실패'}] "${q.q}" → 정답 ${q.answer}${q.rank ? ` (${q.rank}위)` : ' (상위에 없음)'}`
      + ` · 판정 ${q.found ? '찾음' : '찾지 못함'} · 최고 비율 ${fix(q.bestMatchRatio)}`
      + (q.section ? ` · 정답 절 "${q.section}" ${q.sectionAt1 ? '1위' : '1위 아님'}` : ''));
    q.top.forEach((t, i) => {
      lines.push(`    ${i + 1}. ${t.doc === q.answer ? '●' : '○'} ${t.doc} | ${t.heading} | 점수 ${fix(t.score, 3)} | 비율 ${fix(t.matchRatio)}`);
    });
    for (let i = q.top.length; i < TOP_K; i++) lines.push(`    ${i + 1}. (결과 없음)`);
  }
  lines.push('');
  lines.push(`적중률: ${r.hits}/${r.questions.length} = ${pct(r.hitRate)} (기준 ${pct(PASS_HIT_RATE)} 이상, 상위 ${TOP_K}개 안에 정답 문서)`);
  lines.push(`(보조 지표) 1위 조각이 정답 소제목: ${r.sectionAt1}/${r.questions.length} = ${pct(r.questions.length ? r.sectionAt1 / r.questions.length : 0)}`);
  lines.push(`관련 질문을 "찾지 못함"으로 판정: ${r.falseNotFound}건`);
  lines.push('');
  lines.push(`관계없는 질문 (정답: 찾지 못함, 기준 비율 ${r.params.minMatchRatio})`);
  for (const u of r.unrelated) {
    lines.push(`    [${u.found ? '잘못 찾음' : '찾지 못함'}] "${u.q}" · 까닭 ${u.reason ?? '-'} · 최고 비율 ${fix(u.bestMatchRatio)} · 1위 문서 ${u.topDoc ?? '-'}`);
  }
  lines.push(`관계없는 질문을 "찾음"으로 판정: ${r.falseFound}건`);
  lines.push('');
  lines.push(`결과: ${r.pass ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

/** --sweep: 실험한 설정 조합. 앞 줄부터 한 가지씩 바꿔 가며 비교한다 */
export function sweepVariants(): { name: string; params: SearchParams }[] {
  const base: SearchParams = { ...DEFAULT_SEARCH_PARAMS };
  const v = (name: string, over: Partial<SearchParams>) => ({ name, params: { ...base, ...over } });
  return [
    v('기본 2-gram만(정리·확장·띄어쓰기 건너기 없음, 제목 가중 1)', { crossSpace: false, queryCleanup: false, expand: false, headingWeight: 1 }),
    v('+ 띄어쓰기 건너는 2-gram', { queryCleanup: false, expand: false, headingWeight: 1 }),
    v('+ 질문 조사·어미 정리', { expand: false, headingWeight: 1 }),
    v('+ 같은 뜻 낱말 확장', { headingWeight: 1 }),
    v('+ 제목 가중 2 (최종)', {}),
    v('제목 가중 4', { headingWeight: 4 }),
    v('제목 가중 0.5', { headingWeight: 0.5 }),
    v('조각 300자', { chunkSize: 300, overlap: 50 }),
    v('조각 1000자', { chunkSize: 1000, overlap: 150 }),
    v('글자 수로만 600자', { splitBy: 'size' }),
    v('글자 수로만 300자', { splitBy: 'size', chunkSize: 300, overlap: 50 }),
    v('글자 수로만 1000자', { splitBy: 'size', chunkSize: 1000, overlap: 150 }),
    v('확장 없이(최종에서 확장만 끔)', { expand: false }),
  ];
}

/** --sweep 결과 표 */
export function formatSweep(rows: { name: string; report: EvalReport }[]): string {
  const lines = ['| 설정 | 조각 수 | 적중(문서 상위 3) | 적중률 | 정답 절 1위 | 관련→찾지 못함 | 무관→찾음 | 관련 최저 비율 | 무관 최고 비율 |', '|---|---|---|---|---|---|---|---|---|'];
  for (const { name, report: r } of rows) {
    const relMin = Math.min(...r.questions.map((q) => q.bestMatchRatio));
    const unrMax = Math.max(0, ...r.unrelated.map((u) => u.bestMatchRatio));
    lines.push(`| ${name} | ${r.chunkCount} | ${r.hits}/${r.questions.length} | ${pct(r.hitRate)} | ${r.sectionAt1}/${r.questions.length} | ${r.falseNotFound} | ${r.falseFound} | ${fix(relMin)} | ${fix(unrMax)} |`);
  }
  return lines.join('\n');
}

/** 명령줄 인자를 설정값으로 바꾼다 */
export function parseArgs(argv: readonly string[]): { params: SearchParams; sweep: boolean; json: boolean } {
  const params: SearchParams = { ...DEFAULT_SEARCH_PARAMS };
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (name: string, cur: number) => {
    const s = val(name);
    if (s === undefined) return cur;
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`${name} 값 "${s}"이(가) 숫자가 아니에요.`);
    return n;
  };
  params.chunkSize = num('--chunk', params.chunkSize);
  params.overlap = num('--overlap', params.overlap);
  params.headingWeight = num('--heading-weight', params.headingWeight);
  params.minMatchRatio = num('--min-ratio', params.minMatchRatio);
  params.limit = num('--limit', params.limit);
  const split = val('--split');
  if (split !== undefined) {
    if (split !== 'section' && split !== 'size') throw new Error(`--split은 section 또는 size만 쓸 수 있어요(받은 값: ${split}).`);
    params.splitBy = split;
  }
  if (argv.includes('--no-cross')) params.crossSpace = false;
  if (argv.includes('--no-cleanup')) params.queryCleanup = false;
  if (argv.includes('--no-expand')) params.expand = false;
  return { params, sweep: argv.includes('--sweep'), json: argv.includes('--json') };
}

if (import.meta.main) {
  const { params, sweep, json } = parseArgs(process.argv.slice(2));
  const loaded = loadEvalSet();
  if (sweep) {
    const rows = sweepVariants().map((v) => ({ name: v.name, report: runKbEval(v.params, loaded) }));
    console.log(json ? JSON.stringify(rows, null, 2) : formatSweep(rows));
  } else {
    const report = runKbEval(params, loaded);
    console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
    process.exitCode = report.pass ? 0 : 1;
  }
}

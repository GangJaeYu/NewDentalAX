// 이 파일이 하는 일: 원내 도우미 한글 검색 엔진(search.ts)과 품질 평가(scripts/kb-eval.ts)를 확인한다(phase-01-task-06).
// 2-gram 변환, 조각 나누기, FTS5 색인·BM25 검색, 2글자·띄어쓰기 없는 질문, 관계없는 질문의 "찾지 못함" 판정,
// `npm run kb-eval` 출력과 적중률 80% 기준, 데모 매뉴얼 5종의 분량·구조를 본다. 메모리 DB만 쓴다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, type Db } from '../../db/index.ts';
import {
  chunkDocument, createStandaloneSearchTables, DEFAULT_SEARCH_PARAMS, indexDocument, matchRatio, removeDocumentIndex,
  searchKb, stripSuffix, titleOf, toCrossGrams, toIndexGrams, toMatchExpression, toQueryGrams, toQueryTerms,
} from './search.ts';
import { KB_FIXTURE_DIR, loadEvalSet, PASS_HIT_RATE, runKbEval, sweepVariants } from '../../../scripts/kb-eval.ts';

const ROOT = path.resolve(KB_FIXTURE_DIR, '..', '..', '..');

/** 데모 매뉴얼 5종을 색인한 메모리 DB. 문서 id → kbDocId(1부터) */
function demoDb(): { db: Db; docId: Record<string, number> } {
  const db = openDb(':memory:');
  createStandaloneSearchTables(db);
  const docId: Record<string, number> = {};
  loadEvalSet().docs.forEach((d, i) => {
    docId[d.id] = i + 1;
    indexDocument(db, i + 1, d.title, d.body);
  });
  return { db, docId };
}

describe('2-gram 변환', () => {
  test('한글 낱말은 2글자씩, 한 글자 낱말은 그대로, 영문은 소문자 덩어리, 숫자는 따로', () => {
    expect(toIndexGrams('재고 관리')).toEqual(['재고', '관리']);
    expect(toIndexGrams('고압증기멸균기')).toEqual(['고압', '압증', '증기', '기멸', '멸균', '균기']);
    expect(toIndexGrams('약 보관')).toEqual(['약', '보관']);
    expect(toIndexGrams('B&D 테스트 134도')).toEqual(['b', 'd', '테스', '스트', '134', '도']);
    expect(toIndexGrams('ＡＢＣ')).toEqual(['abc']); // 전각 → 반각
  });

  test('조사를 떼면 한 글자가 되는 낱말은 그 글자도 색인한다("물과" → "물")', () => {
    expect(toIndexGrams('흐르는 물과 비누')).toContain('물');
    expect(toIndexGrams('치과')).toEqual(['치과', '치']);
  });

  test('띄어쓰기를 건너는 2-gram은 공백으로만 떨어진 한글 낱말 사이에서만 만든다', () => {
    expect(toCrossGrams('연차 신청 방법')).toEqual(['차신', '청방']);
    expect(toCrossGrams('연차, 신청')).toEqual([]); // 문장부호로 끊김
    expect(toCrossGrams('7일 전까지')).toEqual(['일전']);
    expect(toCrossGrams('B&D 테스트')).toEqual([]);
  });

  test('조사·어미 떼기: 두 글자 이상 남을 때만, 두 글자 낱말은 은·는·을·를만', () => {
    expect(stripSuffix('멸균기를')).toBe('멸균기');
    expect(stripSuffix('보관은')).toBe('보관');
    expect(stripSuffix('처리하나요')).toBe('처리');
    expect(stripSuffix('연차신청은며칠전까지해야돼요')).toBe('연차신청은며칠전');
    expect(stripSuffix('물은')).toBe('물');
    expect(stripSuffix('치과')).toBe('치과'); // "과"를 떼면 뜻이 사라짐
    expect(stripSuffix('재고')).toBe('재고');
  });

  test('질문 정리: 질문 말투·의문사를 빼고, 같은 뜻 낱말을 함께 찾는다', () => {
    const terms = toQueryTerms('유통기한 지난 재료는 어떻게 처리하나요?');
    expect(terms.map((t) => t.word)).toEqual(['유통기한', '지난', '재료', '처리']);
    expect(terms[0]!.alternatives).toEqual([['유효', '효기', '기간']]);
    expect(toQueryGrams('유통기한')).toEqual(expect.arrayContaining(['유통', '기한', '유효', '기간']));
    expect(toQueryTerms('어떻게 해요?')).toEqual([]);
    // 끄면 그대로 2-gram만
    expect(toQueryGrams('재료는 어떻게', { queryCleanup: false, expand: false })).toEqual(['재료', '료는', '어떻', '떻게']);
  });

  test('MATCH 식: 낱말마다 따옴표로 감싸 OR로 잇고, 따옴표는 두 번 써서 FTS 문법을 깨지 않는다', () => {
    expect(toMatchExpression(['재고', '관리'])).toBe('"재고" OR "관리"');
    expect(toMatchExpression(['a"b'])).toBe('"a""b"');
    expect(toMatchExpression([])).toBeNull();
  });

  test('맞는 비율: 건너는 2-gram은 같은 낱말 안 이웃 2-gram이 본문에서 맞을 때만 센다', () => {
    const noSpace = toQueryTerms('연차신청', { queryCleanup: true, expand: false }); // 연차 차신 신청
    expect(matchRatio(noSpace, new Set(['연차', '신청']), new Set(['차신']))).toBe(1);
    const lone = toQueryTerms('시세', { queryCleanup: true, expand: false });
    expect(matchRatio(lone, new Set(['다시', '세척']), new Set(['시세']))).toBe(0);
    expect(matchRatio([], new Set(['재고']))).toBe(0);
  });
});

describe('조각 나누기', () => {
  const body = [
    '# 하늘숲치과 재고 관리 규정',
    '머리말 한 줄.',
    '## 1. 목적',
    '재고를 관리한다.',
    '## 2. 보관',
    '### 2.1 냉장',
    '냉장 보관 품목은 2~8도로 보관한다.',
    '## 3. 긴 절',
    ...Array.from({ length: 12 }, (_, i) => `- ${i + 1}번째 규칙: 재료실 선반에 품목 이름표를 붙이고 수량을 매일 확인한다.`),
  ].join('\n');

  test('소제목마다 끊고, 제목 > 소제목 > 소소제목 경로를 붙인다(첫 # 제목은 두 번 넣지 않음)', () => {
    const title = titleOf(body)!;
    expect(title).toBe('하늘숲치과 재고 관리 규정');
    const chunks = chunkDocument(title, body, { chunkSize: 600, overlap: 100, splitBy: 'section' });
    expect(chunks[0]).toEqual({ seq: 0, heading: '하늘숲치과 재고 관리 규정', text: '머리말 한 줄.' });
    expect(chunks[1]!.heading).toBe('하늘숲치과 재고 관리 규정 > 1. 목적');
    expect(chunks[2]!.heading).toBe('하늘숲치과 재고 관리 규정 > 2. 보관 > 2.1 냉장');
    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i));
  });

  test('긴 절은 chunkSize 안으로 나누고, 다음 조각 앞에 앞 조각 끝부분을 겹쳐 넣는다', () => {
    const chunks = chunkDocument('규정', body, { chunkSize: 200, overlap: 60, splitBy: 'section' }).filter((c) => c.heading.endsWith('3. 긴 절'));
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(200);
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1]!.text.split('\n').at(-1)!;
      expect(chunks[i]!.text).toContain(prevTail.slice(-20)); // 겹침
    }
    // 모든 규칙 줄이 어딘가에 들어 있다
    for (let i = 1; i <= 12; i++) expect(chunks.some((c) => c.text.includes(`${i}번째 규칙`))).toBe(true);
  });

  test("'size' 방식은 소제목을 넘어 글자 수로만 묶는다(실험 비교용)", () => {
    const chunks = chunkDocument('규정', body, { chunkSize: 600, overlap: 100, splitBy: 'size' });
    expect(chunks.length).toBeLessThan(chunkDocument('규정', body, { chunkSize: 600, overlap: 100, splitBy: 'section' }).length);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(600);
  });
});

describe('색인과 검색', () => {
  let db: Db;
  let docId: Record<string, number>;
  beforeEach(() => {
    ({ db, docId } = demoDb());
  });
  afterEach(() => db.close());

  test('phase-01-task-06 AC3: 2글자 질의 "재고"는 재고 관리 규정을, "연차"는 연차·근무 규정을 1위로 찾는다', () => {
    const stock = searchKb(db, '재고');
    expect(stock.found).toBe(true);
    expect(stock.hits[0]!.kbDocId).toBe(docId.inventory);
    expect(stock.hits.slice(0, 3).every((h) => h.kbDocId === docId.inventory)).toBe(true);
    const leave = searchKb(db, '연차');
    expect(leave.found).toBe(true);
    expect(leave.hits[0]!.kbDocId).toBe(docId.leave);
    expect(leave.hits.slice(0, 3).every((h) => h.kbDocId === docId.leave)).toBe(true);
    // 다른 2글자 질의도
    expect(searchKb(db, '멸균').hits[0]!.kbDocId).toBe(docId.sterilization);
    expect(searchKb(db, '수납').hits[0]!.kbDocId).toBe(docId.desk);
  });

  test('phase-01-task-06 AC3: 띄어쓰기 없는 질의도 정답 문서·정답 절을 1위로 찾는다', () => {
    const cases: [string, string, string][] = [
      ['연차신청은며칠전까지해야돼요', 'leave', '4. 연차 신청과 승인'],
      ['재고실사는언제하나요', 'inventory', '8. 정기 재고 실사'],
      ['멸균파우치겉면에뭐적어야돼요', 'sterilization', '3. 포장'],
      ['주사바늘찔렸을때', 'infection', '7. 주사바늘 찔림 사고 대응'],
      ['예약확인문자', 'desk', '3. 예약 관리'],
    ];
    for (const [q, doc, section] of cases) {
      const r = searchKb(db, q);
      expect(r.found, q).toBe(true);
      expect(r.hits[0]!.kbDocId, q).toBe(docId[doc]);
      expect(r.hits[0]!.heading.endsWith(section), `${q} → ${r.hits[0]!.heading}`).toBe(true);
    }
  });

  test('phase-01-task-06 AC3: 띄어 쓴 질의와 띄어쓰기 없는 질의가 같은 1위 조각을 찾는다', () => {
    const spaced = searchKb(db, '연차 신청 방법');
    const joined = searchKb(db, '연차신청방법');
    expect(joined.hits[0]!.chunkId).toBe(spaced.hits[0]!.chunkId);
  });

  test('phase-01-task-06 AC4: 관련 없는 질문 "주식 시세"는 임계값 판정이 "찾지 못함"이 된다', () => {
    const r = searchKb(db, '주식 시세');
    expect(r.found).toBe(false);
    expect(['no_match', 'low_match']).toContain(r.reason);
    expect(r.bestMatchRatio).toBeLessThan(DEFAULT_SEARCH_PARAMS.minMatchRatio);
  });

  test('phase-01-task-06 AC4: 평가 세트의 관계없는 질문 12개가 모두 "찾지 못함", 관련 질문 20개는 모두 "찾음"', () => {
    const { set } = loadEvalSet();
    expect(set.unrelated.length).toBeGreaterThanOrEqual(8);
    for (const q of set.unrelated) expect(searchKb(db, q).found, q).toBe(false);
    for (const q of set.questions) expect(searchKb(db, q.q).found, q.q).toBe(true);
  });

  test('찾을 낱말이 없는 질문은 FTS를 부르지 않고 empty_query로 끝난다', () => {
    expect(searchKb(db, '   ?!  ')).toMatchObject({ found: false, reason: 'empty_query', hits: [] });
    expect(searchKb(db, '어떻게 해요?')).toMatchObject({ found: false, reason: 'empty_query' });
  });

  test('FTS 문법 글자(따옴표·별표·AND/OR/NOT·괄호)가 섞인 질문도 오류 없이 검색한다', () => {
    for (const q of ['"재고" AND (연차', 'NOT 멸균*', 'kb_fts:재고', "'; DROP TABLE kb_chunks; --"]) {
      expect(() => searchKb(db, q), q).not.toThrow();
    }
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM kb_chunks')!.n).toBeGreaterThan(0);
  });

  test('결과는 BM25 점수 순서이고, 최대 limit개, 점수는 클수록 잘 맞는다', () => {
    const r = searchKb(db, '멸균 기구 보관');
    expect(r.hits.length).toBeLessThanOrEqual(DEFAULT_SEARCH_PARAMS.limit);
    expect(r.hits.length).toBeGreaterThan(1);
    for (let i = 1; i < r.hits.length; i++) expect(r.hits[i - 1]!.score).toBeGreaterThanOrEqual(r.hits[i]!.score);
    expect(searchKb(db, '멸균', { ...DEFAULT_SEARCH_PARAMS, limit: 2 }).hits).toHaveLength(2);
  });

  test('filter 조건(공개 범위 등)은 SQL 안에서 거른다', () => {
    const only = searchKb(db, '연차', DEFAULT_SEARCH_PARAMS, { sql: 'c.kb_doc_id = ?', params: [docId.desk!] });
    expect(only.hits.every((h) => h.kbDocId === docId.desk)).toBe(true);
    const none = searchKb(db, '연차', DEFAULT_SEARCH_PARAMS, { sql: 'c.kb_doc_id IN (SELECT ?) AND 0', params: [1] });
    expect(none).toMatchObject({ found: false, reason: 'no_match' });
  });

  test('문서 색인을 지우면 그 문서 조각은 더 이상 나오지 않는다', () => {
    removeDocumentIndex(db, docId.inventory!);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM kb_chunks WHERE kb_doc_id = ?', [docId.inventory!])!.n).toBe(0);
    expect(searchKb(db, '재고실사').hits.some((h) => h.kbDocId === docId.inventory)).toBe(false);
  });
});

describe('품질 평가(npm run kb-eval)', () => {
  test('phase-01-task-06 AC1: npm run kb-eval이 질문 20개마다 상위 3개 결과와 정답 포함 여부, 전체 적중률을 출력한다', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['kb-eval']).toBe('node --disable-warning=ExperimentalWarning scripts/kb-eval.ts');
    // npm 스크립트와 같은 명령을 그대로 실행한다
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/kb-eval.ts'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.split(/\r?\n/);
    const qLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^Q\d{2} \[(적중|실패)\] ".+" → 정답 \w+/.test(l));
    expect(qLines).toHaveLength(20);
    for (const { i } of qLines) {
      // 질문 줄 바로 아래에 1~3위 결과 줄
      // (맞는 조각이 3개보다 적으면 남는 순위는 "(결과 없음)"으로 적는다. 1위는 반드시 있다)
      for (let k = 1; k <= 3; k++) {
        expect(lines[i + k]).toMatch(new RegExp(`^ {4}${k}\\. ([●○] \\w+ \\| .+ \\| 점수 [\\d.]+ \\| 비율 [\\d.]+|\\(결과 없음\\))$`));
      }
      expect(lines[i + 1]).toMatch(/^ {4}1\. [●○] /);
    }
    expect(r.stdout).toMatch(/적중률: \d+\/20 = [\d.]+% \(기준 80\.0% 이상, 상위 3개 안에 정답 문서\)/);
    expect(r.stdout).toContain('결과: PASS');
  });

  test('phase-01-task-06 AC2: 최종 설정의 적중률이 80% 이상이고 관계없는 질문을 "찾음"으로 판정하지 않는다', () => {
    const report = runKbEval();
    expect(report.questions).toHaveLength(20);
    expect(report.hitRate).toBeGreaterThanOrEqual(PASS_HIT_RATE);
    expect(report.falseFound).toBe(0);
    expect(report.falseNotFound).toBe(0);
    expect(report.pass).toBe(true);
    // 최종값(보고·TRD 반영 대상)
    expect(DEFAULT_SEARCH_PARAMS).toMatchObject({ chunkSize: 600, overlap: 100, splitBy: 'section', headingWeight: 2, limit: 6, minMatchRatio: 0.4 });
  });

  test('phase-01-task-06 AC2: --sweep 비교에 청크 크기·제목 가중·질의 확장을 바꾼 설정이 들어 있고 모두 돌아간다', () => {
    const variants = sweepVariants();
    const base = DEFAULT_SEARCH_PARAMS;
    expect(variants.some((v) => v.params.chunkSize !== base.chunkSize)).toBe(true);
    expect(variants.some((v) => v.params.headingWeight !== base.headingWeight)).toBe(true);
    expect(variants.some((v) => v.params.expand !== base.expand)).toBe(true);
    const loaded = loadEvalSet();
    for (const v of variants) expect(runKbEval(v.params, loaded).questions).toHaveLength(20);
  });
});

describe('데모 매뉴얼 5종(tests/fixtures/kb)', () => {
  test('감염관리·멸균·재고·연차·데스크 매뉴얼이 각 1,500~3,000자이고 제목·소제목 구조를 가진다', () => {
    const { set, docs } = loadEvalSet();
    expect(docs.map((d) => d.id)).toEqual(['infection', 'sterilization', 'inventory', 'leave', 'desk']);
    for (const d of docs) {
      expect(d.body.length, d.id).toBeGreaterThanOrEqual(1500);
      expect(d.body.length, d.id).toBeLessThanOrEqual(3000);
      expect(d.title, d.id).toMatch(/^하늘숲치과 /);
      expect(d.body.match(/^## /gm)!.length, d.id).toBeGreaterThanOrEqual(5);
    }
    expect(new Set(set.questions.map((q) => q.answer))).toEqual(new Set(docs.map((d) => d.id)));
  });

  test('매뉴얼과 질문에 환자 개인정보(주민등록번호·전화번호·이메일) 형태가 없다', () => {
    const files = fs.readdirSync(KB_FIXTURE_DIR).map((f) => fs.readFileSync(path.join(KB_FIXTURE_DIR, f), 'utf8'));
    for (const text of files) {
      expect(text).not.toMatch(/\d{6}-?[1-4]\d{6}/);
      expect(text).not.toMatch(/01[016789]-?\d{3,4}-?\d{4}/);
      expect(text).not.toMatch(/[\w.]+@[\w.]+\.\w+/);
    }
  });
});

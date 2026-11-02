// 이 파일이 하는 일: 의료광고 문구 점검·홍보 글(phase-04-task-06 AC1~AC4)의 서버 쪽을 확인한다.
// 규칙 엔진(순수 함수), 기본 규칙 사전, POST /api/adcheck(1차 규칙 + 2차 AI, 고지, AI 꺼짐), GET/PUT /api/ad-rules(admin 추가 → 다음 점검부터 적용),
// 홍보 글(promo) 데모·프롬프트와 자동 점검 연결을 실제 라우트·DB로 본다. AI는 데모 공급자나 가짜 LLM 서버(tests/fake-llm)만 쓰고 실제 키는 쓰지 않는다.
import { afterEach, describe, expect, test } from 'vitest';
import { makeAiEnv, putAiSettings, runAi, type AiTestEnv } from '../../../tests/helpers/ai-app.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { AD_RULE_SEEDS, ensureAdRules } from '../../db/seed/ad-rules.ts';
import { AD_RULE_CATEGORIES, ADCHECK_NOTICE, type AdcheckResponse, type AdRule } from '../../../shared/schemas/adcheck.ts';
import { adcheck } from '../../ai/features/adcheck.ts';
import { promo } from '../../ai/features/promo.ts';
import type { PromptContext } from '../../ai/features/types.ts';
import { checkPattern, compileRule, findRuleHits, type RuleForCheck } from './rules.ts';

const AC1_TEXT = '국내 최고 임플란트, 100% 성공, 지금 50% 할인';
const FAKE_KEY = 'sk-ant-unit-ONLYFAKE-adcheck-7Pz2';
const ctx: PromptContext = { clinic: { name: '하늘숲치과', phone: '02-555-0100' }, user: { name: '김직원', role: 'staff', jobType: 'desk' }, today: '2026-11-02' };

let env: AiTestEnv | null = null;
afterEach(async () => {
  if (env) await env.close();
  env = null;
});

async function setup(): Promise<AiTestEnv> {
  env = await makeAiEnv();
  return env;
}

/** 기본 규칙을 점검용 모양으로(id는 순서) */
function seedRules(): RuleForCheck[] {
  return AD_RULE_SEEDS.map((s, i) => ({ id: i + 1, pattern: s.pattern, matchType: s.matchType, category: s.category, severity: s.severity, reason: s.reason, suggestion: s.suggestion }));
}

async function check(e: AiTestEnv, who: TestLogin, payload: Record<string, unknown>) {
  return e.app.inject({ method: 'POST', url: '/api/adcheck', headers: who.writeHeaders, payload });
}

async function getRules(e: AiTestEnv, who: TestLogin): Promise<AdRule[]> {
  const res = await e.app.inject({ method: 'GET', url: '/api/ad-rules', headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: AdRule[] }>().data;
}

async function putRules(e: AiTestEnv, who: TestLogin, rules: unknown[]) {
  return e.app.inject({ method: 'PUT', url: '/api/ad-rules', headers: who.writeHeaders, payload: { rules } });
}

/** GET 결과를 PUT 본문 모양으로 */
function asInput(r: AdRule) {
  return { id: r.id, pattern: r.pattern, matchType: r.matchType, category: r.category, severity: r.severity, reason: r.reason, suggestion: r.suggestion, active: r.active };
}

describe('규칙 엔진과 기본 사전', () => {
  test('phase-04-task-06 AC1: "국내 최고 임플란트, 100% 성공, 지금 50% 할인" → 규칙 3건 이상, 각 표현에 위치·이유·대체 표현이 있다', () => {
    const hits = findRuleHits(AC1_TEXT, seedRules());
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.map((h) => h.phrase)).toEqual(expect.arrayContaining(['국내 최고', '100%', '50% 할인']));
    for (const h of hits) {
      expect(AC1_TEXT.slice(h.start, h.end)).toBe(h.phrase);
      expect(h.reason.length).toBeGreaterThan(10);
      expect(h.suggestion.length).toBeGreaterThan(5);
    }
    // 글 앞쪽부터 늘어놓는다
    expect([...hits].sort((a, b) => a.start - b.start)).toEqual(hits);
    expect(hits.find((h) => h.phrase === '국내 최고')?.category).toBe('superlative');
    expect(hits.find((h) => h.phrase === '100%')?.category).toBe('guarantee');
    expect(hits.find((h) => h.phrase === '50% 할인')?.category).toBe('discount');
  });

  test('phase-04-task-06 AC1: 기본 사전은 최고·유일·100%·전후 비교·경험담·할인·무료·비교 광고를 모두 잡고, 기본 규칙은 모두 쓸 수 있는 모양이다', () => {
    for (const s of AD_RULE_SEEDS) expect(checkPattern(s.pattern, s.matchType), s.key).toBeNull();
    const cats = new Set(AD_RULE_SEEDS.map((s) => s.category));
    for (const c of AD_RULE_CATEGORIES.filter((c) => c !== 'other')) expect(cats.has(c), c).toBe(true);
    const rules = seedRules();
    const cases: Array<[string, string]> = [
      ['지역 유일의 장비', 'superlative'],
      ['교정 전후 사진을 보여 드려요', 'before_after'],
      ['비포 애프터 공개', 'before_after'],
      ['실제 환자 후기를 모았어요', 'testimonial'],
      ['무통 임플란트, 부작용 없는 시술', 'guarantee'],
      ['반값 미백 특가', 'discount'],
      ['무료 스케일링 이벤트', 'free'],
      ['다른 치과보다 저렴해요', 'comparison'],
      ['임플란트 전문병원', 'other'],
    ];
    for (const [sentence, cat] of cases) {
      const hits = findRuleHits(sentence, rules);
      expect(hits.some((h) => h.category === cat), `${sentence} → ${cat}`).toBe(true);
    }
    // 위험하지 않은 안내 글은 걸리지 않는다(리뷰 답글의 "후기", 수술 전후 주의사항, 무료 주차)
    expect(findRuleHits('소중한 후기 감사합니다. 수술 전후 주의사항을 꼭 지켜 주세요. 무료 주차가 가능해요.', rules)).toEqual([]);
  });

  test('phase-04-task-06 AC1: 낱말 규칙은 특수 기호를 글자 그대로 찾고, 다른 표현 안에 든 표현은 한 번만 표시한다', () => {
    const rules: RuleForCheck[] = [
      { id: 1, pattern: '1+1', matchType: 'word', category: 'discount', severity: 'high', reason: '묶음 할인 강조', suggestion: '빼 주세요' },
      { id: 2, pattern: '최고', matchType: 'word', category: 'superlative', severity: 'medium', reason: '과장', suggestion: '바꿔 주세요' },
      { id: 3, pattern: '국내 최고', matchType: 'word', category: 'superlative', severity: 'high', reason: '과장', suggestion: '바꿔 주세요' },
    ];
    const hits = findRuleHits('미백 1+1, 국내 최고, 11은 아님', rules);
    expect(hits.map((h) => [h.phrase, h.ruleId])).toEqual([
      ['1+1', 1],
      ['국내 최고', 3],
    ]);
    expect(compileRule({ pattern: '(', matchType: 'regex' })).toBeNull();
  });

  test('phase-04-task-06 AC3: 잘못된 정규식·느려질 수 있는 정규식·빈 글자와 맞는 정규식은 쓸 수 없다', () => {
    expect(checkPattern('(최고', 'regex')).toMatch(/정규식 모양이 틀렸어요/);
    expect(checkPattern('(a+)+', 'regex')).toMatch(/느려질 수 있어/);
    expect(checkPattern('a*', 'regex')).toMatch(/아무 글자 없이도/);
    expect(checkPattern('(a', 'word')).toBeNull();
    expect(checkPattern('기적(의|같은)\\s*치료', 'regex')).toBeNull();
  });
});

describe('POST /api/adcheck', () => {
  test('phase-04-task-06 AC1: 직원이 점검하면 규칙 3건 이상 + AI 2차 점검(데모) 결과가 함께 온다. 글 원문은 저장하지 않는다', async () => {
    const e = await setup();
    const res = await check(e, e.staff, { text: `  ${AC1_TEXT}  `, useAi: true });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: AdcheckResponse }>().data;
    expect(data.text).toBe(AC1_TEXT);
    expect(data.ruleHits.length).toBeGreaterThanOrEqual(3);
    for (const h of data.ruleHits) {
      expect(data.text.slice(h.start, h.end)).toBe(h.phrase);
      expect(['high', 'medium']).toContain(h.severity);
      expect(h.reason).toBeTruthy();
      expect(h.suggestion).toBeTruthy();
    }
    expect(data.ai?.demo).toBe(true);
    expect(data.ai?.report?.issues.map((i) => i.phrase)).toEqual(expect.arrayContaining(['국내 최고', '100%', '50% 할인']));
    expect(data.ai?.report?.overall).toContain('[데모 응답]');
    expect(data.aiError).toBeUndefined();
    const usage = e.app.db.get<{ feature: string; demo: number; status: string }>('SELECT feature, demo, status FROM ai_usage ORDER BY id DESC LIMIT 1');
    expect(usage).toEqual({ feature: 'adcheck', demo: 1, status: 'ok' });
    const dump = JSON.stringify(e.app.db.all('SELECT * FROM ai_usage')) + JSON.stringify(e.app.db.all('SELECT * FROM audit_log'));
    expect(dump).not.toContain('임플란트');
  });

  test('phase-04-task-06 AC1: AI 공급자가 켜져 있으면 규칙 결과를 함께 보내고, AI가 더 찾은 표현을 2차 결과로 돌려준다', async () => {
    const e = await setup();
    await putAiSettings(e, { provider: 'anthropic', keys: { anthropic: FAKE_KEY } });
    e.fake.setReply(
      JSON.stringify({ issues: [{ phrase: '평생 책임', reason: '결과를 장담하는 말이에요.', suggestion: '꾸준히 관리해 드려요.' }], overall: '장담하는 표현을 줄여 주세요.' }),
      { input: 500, output: 80 },
    );
    const res = await check(e, e.staff, { text: '국내 최고 의료진이 평생 책임집니다', useAi: true });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: AdcheckResponse }>().data;
    expect(data.ruleHits.map((h) => h.phrase)).toContain('국내 최고');
    expect(data.ai).toMatchObject({ demo: false, report: { issues: [{ phrase: '평생 책임' }], overall: '장담하는 표현을 줄여 주세요.' } });
    const sent = JSON.stringify(e.fake.requests[0]?.body);
    expect(sent).toContain('규칙 점검에서 이미 찾은 표현');
    expect(sent).toContain('국내 최고');
  });

  test('phase-04-task-06 AC2: 결과에는 늘 "법률 자문이 아니며, 사전심의 대상 여부는 관련 기관 확인" 고지가 붙는다(AI를 안 쓰거나 꺼져 있어도)', async () => {
    const e = await setup();
    const noAi = (await check(e, e.staff, { text: AC1_TEXT, useAi: false })).json<{ data: AdcheckResponse }>().data;
    expect(noAi.notice).toBe(ADCHECK_NOTICE);
    expect(noAi.notice).toContain('법률 자문이 아니며');
    expect(noAi.notice).toContain('사전심의 대상 여부는 관련 기관에 확인');
    expect(noAi.ai).toBeUndefined();
    expect(noAi.ruleHits.length).toBeGreaterThanOrEqual(3);

    // AI 기능을 끄면: 규칙 결과·고지는 그대로, AI는 "꺼 두었습니다" 안내만(FR-043 AC2)
    await putAiSettings(e, { features: { adcheck: { enabled: false } } });
    const off = await check(e, e.staff, { text: AC1_TEXT, useAi: true });
    expect(off.statusCode).toBe(200);
    const offData = off.json<{ data: AdcheckResponse }>().data;
    expect(offData.ruleHits.length).toBeGreaterThanOrEqual(3);
    expect(offData.ai).toBeUndefined();
    expect(offData.aiError).toEqual({ code: 'AI_DISABLED', message: '관리자가 이 AI 기능을 꺼 두었습니다.' });
    expect(offData.notice).toBe(ADCHECK_NOTICE);
  });

  test('phase-04-task-06 AC1: 빈 글·너무 긴 글은 400과 항목별 이유, 로그인하지 않으면 401', async () => {
    const e = await setup();
    const empty = await check(e, e.staff, { text: '   ' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json<{ error: { fields: Record<string, string> } }>().error.fields.text).toBe('점검할 글을(를) 적어 주세요.');
    const long = await check(e, e.staff, { text: '가'.repeat(8001) });
    expect(long.statusCode).toBe(400);
    const anon = await e.app.inject({ method: 'POST', url: '/api/adcheck', payload: { text: AC1_TEXT } });
    expect(anon.statusCode).toBe(401);
  });
});

describe('GET/PUT /api/ad-rules', () => {
  test('phase-04-task-06 AC3: admin이 규칙을 추가하면 다음 점검부터 적용되고, 감사 로그에 남는다', async () => {
    const e = await setup();
    const before = await getRules(e, e.staff);
    expect(before).toHaveLength(AD_RULE_SEEDS.length);
    const text = '기적의 치료로 새 치아를 드려요';
    const first = (await check(e, e.staff, { text, useAi: false })).json<{ data: AdcheckResponse }>().data;
    expect(first.ruleHits).toEqual([]);

    const res = await putRules(e, e.admin, [
      ...before.map(asInput),
      { pattern: '기적의 치료', matchType: 'word', category: 'guarantee', severity: 'high', reason: '치료 효과를 부풀리는 말이에요.', suggestion: '치료 방법을 사실대로 적어 주세요.', active: true },
    ]);
    expect(res.statusCode).toBe(200);
    const after = res.json<{ data: AdRule[] }>().data;
    expect(after).toHaveLength(AD_RULE_SEEDS.length + 1);
    const added = after[after.length - 1];
    expect(added).toMatchObject({ ruleKey: null, pattern: '기적의 치료', active: true });

    const next = (await check(e, e.staff, { text, useAi: false })).json<{ data: AdcheckResponse }>().data;
    expect(next.ruleHits).toHaveLength(1);
    expect(next.ruleHits[0]).toMatchObject({ phrase: '기적의 치료', start: 0, end: 6, ruleId: added?.id, reason: '치료 효과를 부풀리는 말이에요.', suggestion: '치료 방법을 사실대로 적어 주세요.' });

    const log = e.app.db.get<{ action: string; detail: string }>("SELECT action, detail FROM audit_log WHERE action = 'adrules.update'");
    expect(JSON.parse(log?.detail ?? '{}')).toMatchObject({ added: 1, updated: 0, removed: 0 });
  });

  test('phase-04-task-06 AC3: 기본 규칙을 고치거나 끄면 다음 점검에 반영되고, 추가한 규칙은 지울 수 있다', async () => {
    const e = await setup();
    const rules = await getRules(e, e.admin);
    const best = rules.find((r) => r.ruleKey === 'superlative-best');
    expect(best).toBeTruthy();
    // '최고' 규칙 끄기
    const off = await putRules(e, e.admin, rules.map((r) => (r.id === best?.id ? { ...asInput(r), active: false } : asInput(r))));
    expect(off.statusCode).toBe(200);
    const hits = (await check(e, e.staff, { text: AC1_TEXT, useAi: false })).json<{ data: AdcheckResponse }>().data.ruleHits;
    expect(hits.map((h) => h.phrase)).not.toContain('국내 최고');
    expect(hits.map((h) => h.phrase)).toEqual(expect.arrayContaining(['100%', '50% 할인']));

    // 추가 → 지우기
    const cur = off.json<{ data: AdRule[] }>().data;
    const withNew = await putRules(e, e.admin, [...cur.map(asInput), { pattern: '파격', reason: '과장', suggestion: '빼 주세요' }]);
    const list = withNew.json<{ data: AdRule[] }>().data;
    expect(list[list.length - 1]).toMatchObject({ matchType: 'word', category: 'other', severity: 'medium', active: true });
    const removed = await putRules(e, e.admin, list.slice(0, -1).map(asInput));
    expect(removed.statusCode).toBe(200);
    expect(removed.json<{ data: AdRule[] }>().data).toHaveLength(AD_RULE_SEEDS.length);
  });

  test('phase-04-task-06 AC3: staff·manager는 바꿀 수 없고(403), 기본 규칙 지우기·잘못된 정규식은 400과 이유', async () => {
    const e = await setup();
    const manager = loginAs(e.app, 'manager');
    const rules = await getRules(e, e.staff);
    expect((await putRules(e, e.staff, rules.map(asInput))).statusCode).toBe(403);
    expect((await putRules(e, manager, rules.map(asInput))).statusCode).toBe(403);

    const drop = await putRules(e, e.admin, rules.slice(1).map(asInput));
    expect(drop.statusCode).toBe(400);
    expect(drop.json<{ error: { fields: Record<string, string> } }>().error.fields.rules).toMatch(/기본 규칙은 지울 수 없어요/);

    const bad = await putRules(e, e.admin, [...rules.map(asInput), { pattern: '(최고', matchType: 'regex', reason: '과장', suggestion: '빼 주세요' }]);
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: { fields: Record<string, string> } }>().error.fields[`rules.${rules.length}.pattern`]).toMatch(/정규식 모양이 틀렸어요/);

    const unknown = await putRules(e, e.admin, [...rules.map(asInput), { id: 9999, pattern: '없음', reason: '이유', suggestion: '바꿀 말' }]);
    expect(unknown.statusCode).toBe(400);
    // 아무것도 바뀌지 않았다
    expect(await getRules(e, e.staff)).toEqual(rules);
  });

  test('phase-04-task-06 AC3: 기본 규칙 채우기는 빠진 것만 넣고, admin이 고친 내용은 지킨다', async () => {
    const e = await setup();
    const db = e.app.db;
    expect(ensureAdRules(db, e.clock)).toBe(0);
    db.run("UPDATE ad_rules SET reason = '고친 이유', active = 0 WHERE rule_key = 'superlative-only'");
    db.run("DELETE FROM ad_rules WHERE rule_key = 'free'");
    expect(ensureAdRules(db, e.clock)).toBe(1);
    expect(db.get("SELECT reason, active FROM ad_rules WHERE rule_key = 'superlative-only'")).toEqual({ reason: '고친 이유', active: 0 });
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ad_rules')?.n).toBe(AD_RULE_SEEDS.length);
  });
});

describe('홍보 글 → 자동 점검', () => {
  test('phase-04-task-06 AC4: 홍보 글 데모는 주제·채널·분량·병원 이름을 반영하고, 프롬프트는 금지 표현을 피하라고 안내한다', () => {
    const blog = promo.demo(promo.inputSchema.parse({ topic: '스케일링 주기 안내', channel: '블로그', length: 'long' }), ctx);
    expect(blog.startsWith('[데모 응답]')).toBe(true);
    expect(blog).toContain('## 스케일링 주기 안내');
    expect(blog).toContain('하늘숲치과');
    expect(blog).toContain('자주 묻는 질문');
    const insta = promo.demo(promo.inputSchema.parse({ topic: '칫솔질 방법', channel: '인스타그램', length: 'short' }), ctx);
    expect(insta).toContain('#치아건강');
    expect(insta.length).toBeLessThan(blog.length);
    // 데모 글 자체는 규칙에 걸리지 않는다
    expect(findRuleHits(blog, seedRules())).toEqual([]);
    expect(findRuleHits(insta, seedRules())).toEqual([]);
    const p = promo.buildPrompt(promo.inputSchema.parse({ topic: '칫솔질 방법', channel: '인스타그램' }), ctx);
    expect(p.system).toContain('의료법 제56조');
    expect(p.system).toContain('해시태그');
    expect(p.user).toContain('700자');
    const a = adcheck.buildPrompt(adcheck.inputSchema.parse({ text: AC1_TEXT, ruleHits: [{ phrase: '100%', reason: '장담' }] }), ctx);
    expect(a.user).toContain('- 100% (장담)');
    expect(a.system).toContain('진료 사실');
  });

  test('phase-04-task-06 AC4: 홍보 글을 만든 결과를 그대로 점검하면 위험 표현이 하이라이트 위치와 함께 온다(화면의 자동 점검 흐름)', async () => {
    const e = await setup();
    const gen = await runAi(e, e.staff, { feature: 'promo', input: { topic: '국내 최고 임플란트 50% 할인 이벤트', channel: '블로그', length: 'short' } });
    expect(gen.statusCode).toBe(200);
    const text = gen.json<{ data: { text: string } }>().data.text.replace(/^\[데모 응답\]\s*/, '');
    const res = await check(e, e.staff, { text, useAi: true });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: AdcheckResponse }>().data;
    expect(data.ruleHits.map((h) => h.phrase)).toEqual(expect.arrayContaining(['국내 최고', '50% 할인']));
    expect(data.notice).toBe(ADCHECK_NOTICE);
  });

  test('phase-04-task-06 AC4: 리뷰 답글 초안도 같은 API로 점검된다(리뷰 화면 점검 버튼이 부르는 곳)', async () => {
    const e = await setup();
    const reply = '소중한 후기 감사합니다. 저희는 지역 1위 치과로 통증 없는 치료를 약속드려요.';
    const data = (await check(e, e.staff, { text: reply, useAi: false })).json<{ data: AdcheckResponse }>().data;
    expect(data.ruleHits.map((h) => h.phrase)).toEqual(expect.arrayContaining(['지역 1위', '통증 없']));
    expect(data.ruleHits.map((h) => h.phrase)).not.toContain('후기');
  });
});

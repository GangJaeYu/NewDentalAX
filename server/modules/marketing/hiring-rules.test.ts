// 이 파일이 하는 일: 채용 공고·면접 질문(phase-04-task-07 AC1~AC3, FR-084)의 서버 쪽을 확인한다.
// 차별 소지 표현 규칙 사전(순수 함수), POST /api/hiring/check(권한·입력 검사·위치), hiring 데모 응답(직무·태도·상황 질문 구분),
// 보관함(saved_texts kind=hiring) 저장·다시 읽기를 실제 라우트·DB로 본다. 03-05 후속인 데모 답글 조사 고침(review_reply·script)도 함께 본다.
// AI는 데모 공급자만 쓰고 실제 키는 쓰지 않는다.
import { afterEach, describe, expect, test } from 'vitest';
import { makeAiEnv, runAi, type AiTestEnv } from '../../../tests/helpers/ai-app.ts';
import type { HiringCheckResponse } from '../../../shared/schemas/hiring.ts';
import { extractJson } from '../../ai/gateway.ts';
import { hiring } from '../../ai/features/hiring.ts';
import { review_reply } from '../../ai/features/review_reply.ts';
import { script } from '../../ai/features/script.ts';
import type { PromptContext } from '../../ai/features/types.ts';
import { findHiringRisks, HIRING_RULES, runHiringCheck } from './hiring-rules.ts';

const ctx: PromptContext = { clinic: { name: '하늘숲치과', phone: '02-555-0100' }, user: { name: '김실장', role: 'manager', jobType: 'manager' }, today: '2026-11-03' };

let env: AiTestEnv | null = null;
afterEach(async () => {
  if (env) await env.close();
  env = null;
});

async function setup(): Promise<AiTestEnv> {
  env = await makeAiEnv();
  return env;
}

describe('차별 소지 표현 규칙 사전', () => {
  test('phase-04-task-07 AC2: "20대 여성 우대" → 나이("20대")·성별("여성 우대") 두 표현을 위치·이유·바꿀 말과 함께 찾는다', () => {
    const text = '주 5일 근무, 20대 여성 우대';
    const hits = findHiringRisks(text);
    expect(hits.map((h) => [h.phrase, h.category, h.severity])).toEqual([
      ['20대', 'age', 'high'],
      ['여성 우대', 'gender', 'high'],
    ]);
    for (const h of hits) {
      expect(text.slice(h.start, h.end)).toBe(h.phrase);
      expect(h.reason.length).toBeGreaterThan(10);
      expect(h.suggestion.length).toBeGreaterThan(5);
    }
  });

  test('phase-04-task-07 AC2: 결혼·임신·출신·외모·종교·가족 조건도 찾고, 평범한 근무 조건은 걸리지 않는다', () => {
    const cases: Array<[string, string]> = [
      ['미혼자 우대', 'marriage'],
      ['임신 계획 없는 분', 'marriage'],
      ['서울 출신 우대', 'origin'],
      ['키 160 이상', 'body'],
      ['교회 다니는 분', 'religion'],
      ['부모님 직업 기재', 'family'],
      ['만 35세 이하', 'age'],
      ['95년생까지', 'age'],
      ['젊은 직원 환영', 'age'],
      ['남자만 지원', 'gender'],
    ];
    for (const [text, category] of cases) {
      const hits = findHiringRisks(text);
      expect(hits.length, text).toBeGreaterThan(0);
      expect(hits[0]?.category, text).toBe(category);
    }
    const clean = '주 5일(월~금 9:30~18:30), 토요일 격주 근무, 4대 보험, 연차 15일, 치과위생사 면허 소지자, 경력 1년 이상 우대, 싱글벙글 밝게 응대하는 분';
    expect(findHiringRisks(clean)).toEqual([]);
  });

  test('phase-04-task-07 AC2: 같은 곳에 여러 규칙이 걸려도 한 번만 표시하고, 규칙 key는 서로 다르다', () => {
    const hits = findHiringRisks('여성 우대, 여성 우대');
    expect(hits).toHaveLength(2);
    expect(hits[0]!.end).toBeLessThanOrEqual(hits[1]!.start);
    expect(new Set(HIRING_RULES.map((r) => r.key)).size).toBe(HIRING_RULES.length);
    expect(runHiringCheck('   ')).toEqual({ text: '', hits: [] });
  });

  test('phase-04-task-07 AC2: 데모 공고 본문 자체에는 차별 소지 표현이 없다(입력이 깨끗하면 경고도 없다)', () => {
    const input = hiring.inputSchema.parse({ jobType: '치과위생사', conditions: '주 5일, 4대 보험', preferred: '경력 1년 이상' });
    const out = extractJson(hiring.demo(input, ctx), hiring.outputSchema!) as { posting: string; questions: Array<{ text: string }> };
    expect(findHiringRisks(out.posting)).toEqual([]);
    for (const q of out.questions) expect(findHiringRisks(q.text), q.text).toEqual([]);
  });
});

describe('POST /api/hiring/check', () => {
  test('phase-04-task-07 AC2: 직원이 "20대 여성 우대"를 점검하면 2건이 오고, 로그인 없이는 401, 너무 긴 글은 400이다', async () => {
    const e = await setup();
    const res = await e.app.inject({ method: 'POST', url: '/api/hiring/check', headers: e.staff.writeHeaders, payload: { text: '  20대 여성 우대  ' } });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: HiringCheckResponse }>().data;
    expect(data.text).toBe('20대 여성 우대');
    expect(data.hits.map((h) => h.phrase)).toEqual(['20대', '여성 우대']);
    expect(data.hits[0]).toMatchObject({ start: 0, end: 3, category: 'age', severity: 'high' });

    const anon = await e.app.inject({ method: 'POST', url: '/api/hiring/check', payload: { text: '20대' } });
    expect(anon.statusCode).toBe(401);
    const long = await e.app.inject({ method: 'POST', url: '/api/hiring/check', headers: e.staff.writeHeaders, payload: { text: '가'.repeat(10001) } });
    expect(long.statusCode).toBe(400);
    expect(long.body).toContain('10,000자까지');
    const bad = await e.app.inject({ method: 'POST', url: '/api/hiring/check', headers: e.staff.writeHeaders, payload: { text: 3 } });
    expect(bad.statusCode).toBe(400);
  });
});

describe('hiring AI 기능(데모)', () => {
  test('phase-04-task-07 AC1: 데모 모드로 공고(마크다운)와 직무·태도·상황 질문이 2개씩 온다', async () => {
    const e = await setup();
    const res = await runAi(e, e.staff, { feature: 'hiring', input: { jobType: '치과위생사', conditions: '주 5일(월~금 9:30~18:30), 4대 보험', preferred: '경력 1년 이상' } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { demo: boolean; extra: { posting: string; questions: Array<{ type: string; text: string }> } };
    expect(data.demo).toBe(true);
    expect(data.extra.posting).toContain('## 저희 치과 치과위생사 채용'); // 병원 정보를 아직 안 넣은 서버
    expect(data.extra.posting).toContain('- 주 5일(월~금 9:30~18:30)');
    expect(data.extra.posting).toContain('### 우대 사항');
    const byType = (t: string) => data.extra.questions.filter((q) => q.type === t);
    expect(byType('직무')).toHaveLength(2);
    expect(byType('태도')).toHaveLength(2);
    expect(byType('상황')).toHaveLength(2);
    expect(byType('직무')[0]!.text).toMatch(/스케일링|구강/);
  });

  test('phase-04-task-07 AC1: 직무마다 직무 질문이 다르고, 프롬프트는 차별 조건을 빼고 세 구분 질문을 JSON으로 요청한다', () => {
    const q = (jobType: string) => {
      const out = extractJson(hiring.demo(hiring.inputSchema.parse({ jobType, conditions: '주 5일' }), ctx), hiring.outputSchema!) as { questions: Array<{ type: string; text: string }> };
      return out.questions.filter((x) => x.type === '직무').map((x) => x.text);
    };
    expect(q('데스크·상담 코디네이터')).not.toEqual(q('치과위생사'));
    expect(q('방사선사')[0]).toContain('방사선사');
    const p = hiring.buildPrompt(hiring.inputSchema.parse({ jobType: '간호조무사', conditions: '20대 여성 우대' }), ctx);
    expect(p.system).toMatch(/나이·성별·결혼/);
    expect(p.system).toContain('직무·태도·상황');
    expect(p.system).toContain('"type":"직무"');
    expect(p.user).toContain('근무 조건: 20대 여성 우대');
    // AI가 질문을 글로만 돌려줘도 받아 준다
    expect(extractJson('{"posting":"공고","questions":["직무: 질문 하나"]}', hiring.outputSchema!)).not.toBeNull();
  });
});

describe('보관함(saved_texts kind=hiring)', () => {
  test('phase-04-task-07 AC3: 채용 공고 초안을 kind=hiring으로 저장하면 보관함 목록에서 같은 본문·직무 정보로 다시 읽힌다', async () => {
    const e = await setup();
    const body = '## 하늘숲치과 치과위생사 채용\n\n### 근무 조건\n- 주 5일\n\n## 면접 질문\n\n### 직무 질문\n- 스케일링 순서를 말씀해 주세요.';
    const created = await e.app.inject({
      method: 'POST',
      url: '/api/saved-texts',
      headers: e.staff.writeHeaders,
      payload: { kind: 'hiring', category: '치과위생사', title: '치과위생사 채용 공고', body, meta: { jobType: '치과위생사', conditions: '주 5일', preferred: '' } },
    });
    expect(created.statusCode).toBe(201);
    const list = await e.app.inject({ method: 'GET', url: '/api/saved-texts?kind=hiring', headers: e.staff.headers });
    expect(list.statusCode).toBe(200);
    const rows = list.json<{ data: Array<{ kind: string; title: string; body: string; meta: Record<string, unknown> }> }>().data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'hiring', title: '치과위생사 채용 공고', body, meta: { jobType: '치과위생사', conditions: '주 5일' } });
    // 다른 종류 보관함에는 섞이지 않는다
    const other = await e.app.inject({ method: 'GET', url: '/api/saved-texts?kind=review_reply', headers: e.staff.headers });
    expect(other.json<{ data: unknown[] }>().data).toEqual([]);
  });
});

describe('데모 문구 조사(03-05 후속)', () => {
  test('phase-04-task-07 리뷰 답글 데모: "직원 응대를", "하늘숲치과가 되도록"처럼 받침에 맞는 조사를 쓴다', () => {
    const out = extractJson(review_reply.demo(review_reply.inputSchema.parse({ review: '직원분들이 친절했어요.', tones: ['따뜻하게', '정중하게'] }), ctx), review_reply.outputSchema!) as {
      replies: Array<{ text: string }>;
    };
    const warm = out.replies[0]!.text;
    expect(warm).toContain('직원 응대를 좋게 봐 주셔서');
    expect(warm).toContain('편안한 하늘숲치과가 되도록');
    const all = out.replies.map((r) => r.text).join('\n');
    expect(all).not.toMatch(/을\(를\)|이\(가\)|치과이 /);
    // 설명 칭찬이면 "설명을"
    const explain = extractJson(review_reply.demo(review_reply.inputSchema.parse({ review: '설명이 자세했어요.', tones: ['따뜻하게', '간결하게'] }), { ...ctx, clinic: null }), review_reply.outputSchema!) as {
      replies: Array<{ text: string }>;
    };
    expect(explain.replies[0]!.text).toContain('설명을 좋게 봐 주셔서');
    expect(explain.replies[0]!.text).toContain('편안한 저희 치과가 되도록');
  });

  test('phase-04-task-07 스크립트 데모: 대표번호 끝자리 소리에 맞춰 "02-555-0100으로", "02-123-4567로"라고 쓴다', () => {
    const input = script.inputSchema.parse({ situation: '주차 문의' });
    expect(script.demo(input, ctx)).toContain('대표번호 02-555-0100으로 연락 주세요');
    expect(script.demo(input, { ...ctx, clinic: { name: '하늘숲치과', phone: '02-123-4567' } })).toContain('대표번호 02-123-4567로 연락 주세요');
  });
});

// 이 파일이 하는 일: AI 게이트웨이를 실제 라우트·DB와 가짜 LLM 서버(tests/fake-llm)로 확인한다(phase-02-task-02 AC1~AC7).
// 데모 응답, 공급자 3종 요청 형식·사용량·비용, 오류 변환, 예산 80% 알림·100% 차단, 개인정보 차단·가리기, 키 비노출, 기능 끄기·역할 제한.
// 실제 공급자·실제 키는 쓰지 않는다. 키 문자열은 테스트용 가짜 값이다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { ERROR_CODES } from '../lib/errors.ts';
import { loginAs } from '../../tests/helpers/auth.ts';
import { lastUsage, makeAiEnv, putAiSettings, runAi, type AiTestEnv } from '../../tests/helpers/ai-app.ts';
import { ANTHROPIC_VERSION } from './providers/anthropic.ts';
import { serverLogPath } from './log.ts';

let env: AiTestEnv | null = null;
afterEach(async () => {
  if (env) await env.close();
  env = null;
});

const KEYS = {
  anthropic: 'sk-ant-FAKE-test-anthropic-0001',
  openai: 'sk-FAKE-test-openai-key-0002',
  gemini: 'AIzaFAKE-test-gemini-key-0003',
} as const;

/** 공급자와 키를 저장한다 */
async function useProvider(e: AiTestEnv, provider: keyof typeof KEYS) {
  await putAiSettings(e, { provider, keys: { [provider]: KEYS[provider] } });
}

describe('phase-02-task-02 AC1: 키가 없으면 데모 응답', () => {
  test('phase-02-task-02 AC1: 키 없는 상태에서 POST /api/ai/run {feature:"quick"}이 "[데모 응답]"과 demo:true를 돌려주고 ai_usage에 0원·demo로 기록된다', async () => {
    env = await makeAiEnv();
    const res = await runAi(env, env.staff, { feature: 'quick', input: '내일 아침 회의 준비 목록' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json<{ data: { text: string; demo: boolean; usage: { costKrw: number }; requestId: number } }>();
    expect(data.text.startsWith('[데모 응답]')).toBe(true);
    expect(data.text).toContain('내일 아침 회의 준비 목록');
    expect(data.demo).toBe(true);
    expect(data.usage.costKrw).toBe(0);
    const row = lastUsage(env);
    expect(row).toMatchObject({ id: data.requestId, feature: 'quick', provider: 'demo', demo: 1, cost_krw: 0, cost_usd: 0, status: 'ok', user_id: env.staff.userId });
    expect(env.fake.requests).toHaveLength(0);
  });

  test('phase-02-task-02 AC1: 입력 없이 {feature:"quick"}만 보내도 데모 응답이 온다', async () => {
    env = await makeAiEnv();
    const res = await runAi(env, env.staff, { feature: 'quick' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { text: string; demo: boolean } }>().data).toMatchObject({ demo: true, text: expect.stringMatching(/^\[데모 응답\]/) });
  });

  test('phase-02-task-02 AC1: 공급자를 골랐어도 그 키가 없으면 데모로 돌아간다', async () => {
    env = await makeAiEnv();
    await putAiSettings(env, { provider: 'openai' });
    const res = await runAi(env, env.staff, { feature: 'quick', input: '안내 문구' });
    expect(res.json<{ data: { demo: boolean } }>().data.demo).toBe(true);
    expect(env.fake.requests).toHaveLength(0);
  });
});

describe('phase-02-task-02 AC2: 공급자 3종 요청 형식·사용량·비용', () => {
  /** 저장된 모델 단가로 기대 비용을 계산한다 */
  function expectedKrw(e: AiTestEnv, provider: string, tier: string, inTok: number, outTok: number, fx = 1450) {
    const m = e.app.db.get<{ input_usd_per_m: number; output_usd_per_m: number }>('SELECT * FROM ai_models WHERE provider = ? AND tier = ? AND active = 1', [provider, tier]);
    if (!m) throw new Error('모델 없음');
    return ((inTok * m.input_usd_per_m + outTok * m.output_usd_per_m) / 1e6) * fx;
  }

  test('phase-02-task-02 AC2: Anthropic — x-api-key·anthropic-version 헤더, {model,max_tokens,system,messages} 본문, usage → cost_krw', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'anthropic');
    env.fake.setReply('응대 순서는 이렇습니다.', { input: 1200, output: 340 });
    const res = await runAi(env, env.staff, { feature: 'quick', input: '전화 응대 순서' });
    expect(res.statusCode).toBe(200);
    const req = env.fake.requests[0];
    expect(req?.url).toBe('/v1/messages');
    expect(req?.headers['x-api-key']).toBe(KEYS.anthropic);
    expect(req?.headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(req?.headers['content-type']).toMatch(/application\/json/);
    expect(req?.body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 1024, system: expect.any(String), messages: [{ role: 'user', content: '전화 응대 순서' }] });
    expect((req?.body as Record<string, unknown>).stream).toBeUndefined();
    const { data } = res.json<{ data: { text: string; demo: boolean; usage: { inputTokens: number; outputTokens: number; costKrw: number; estimated: boolean } } }>();
    expect(data).toMatchObject({ text: '응대 순서는 이렇습니다.', demo: false, usage: { inputTokens: 1200, outputTokens: 340, estimated: false } });
    const krw = expectedKrw(env, 'anthropic', 'fast', 1200, 340);
    expect(data.usage.costKrw).toBeCloseTo(krw, 10);
    expect(lastUsage(env)).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', input_tokens: 1200, output_tokens: 340, demo: 0, status: 'ok', estimated: 0 });
    expect(lastUsage(env)?.cost_krw as number).toBeCloseTo(krw, 10);
  });

  test('phase-02-task-02 AC2: OpenAI — Authorization: Bearer, Responses 본문 {model,instructions,input,max_output_tokens,store:false}, usage → cost_krw', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'openai');
    env.fake.setReply('오픈AI 가짜 답', { input: 2000, output: 500 });
    const res = await runAi(env, env.staff, { feature: 'doc_writer', input: { kind: '감염관리 지침', points: '손 씻기, 장갑 교체' }, tier: 'premium' });
    expect(res.statusCode).toBe(200);
    const req = env.fake.requests[0];
    expect(req?.url).toBe('/v1/responses');
    expect(req?.headers.authorization).toBe(`Bearer ${KEYS.openai}`);
    expect(req?.body).toMatchObject({
      model: 'gpt-6.1-sol',
      instructions: expect.any(String),
      input: [{ role: 'user', content: expect.stringContaining('감염관리 지침') }],
      max_output_tokens: 4000,
      store: false,
    });
    const krw = expectedKrw(env, 'openai', 'premium', 2000, 500);
    const { data } = res.json<{ data: { text: string; tier: string; usage: { costKrw: number } } }>();
    expect(data).toMatchObject({ text: '오픈AI 가짜 답', tier: 'premium' });
    expect(data.usage.costKrw).toBeCloseTo(krw, 10);
    expect(lastUsage(env)?.cost_krw as number).toBeCloseTo(krw, 10);
  });

  test('phase-02-task-02 AC2: Gemini — x-goog-api-key 헤더, :generateContent 주소, {systemInstruction,contents,generationConfig} 본문, usageMetadata → cost_krw', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'gemini');
    await putAiSettings(env, { fxKrwPerUsd: 1500 });
    env.fake.setReply('제미나이 가짜 답', { input: 800, output: 120 });
    const res = await runAi(env, env.staff, { feature: 'assistant', input: { question: '멸균기 점검 주기', chunks: [{ n: 1, text: '매일 점검' }] } });
    expect(res.statusCode).toBe(200);
    const req = env.fake.requests[0];
    expect(req?.url).toBe('/v1beta/models/gemini-3.8-flash:generateContent');
    expect(req?.headers['x-goog-api-key']).toBe(KEYS.gemini);
    expect(req?.url).not.toContain('key=');
    expect(req?.body).toMatchObject({
      systemInstruction: { parts: [{ text: expect.any(String) }] },
      contents: [{ role: 'user', parts: [{ text: expect.stringContaining('멸균기 점검 주기') }] }],
      generationConfig: { maxOutputTokens: 1500 },
    });
    const krw = expectedKrw(env, 'gemini', 'standard', 800, 120, 1500);
    expect(res.json<{ data: { usage: { costKrw: number } } }>().data.usage.costKrw).toBeCloseTo(krw, 10);
    expect(lastUsage(env)).toMatchObject({ provider: 'gemini', model: 'gemini-3.8-flash', input_tokens: 800, output_tokens: 120 });
    expect(lastUsage(env)?.cost_krw as number).toBeCloseTo(krw, 10);
  });

  test('phase-02-task-02 AC2: JSON 기능은 응답 JSON을 검사해 extra로 돌려준다(형식이 틀리면 한 번 다시 요청, 또 틀리면 AI_BAD_OUTPUT)', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'anthropic');
    env.fake.setReply('{"items":["물품 위치 익히기","감염관리 수칙"]}');
    const ok = await runAi(env, env.staff, { feature: 'onboarding', input: { jobType: '치과위생사' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ data: { extra: unknown } }>().data.extra).toEqual({ items: ['물품 위치 익히기', '감염관리 수칙'] });

    env.fake.setReply('JSON이 아닌 답');
    const before = env.fake.requests.length;
    const bad = await runAi(env, env.staff, { feature: 'onboarding', input: { jobType: '치과위생사' } });
    expect(bad.statusCode).toBe(502);
    expect(bad.json()).toEqual({ error: { code: 'AI_BAD_OUTPUT', message: ERROR_CODES.AI_BAD_OUTPUT[1] } });
    expect(env.fake.requests.length - before).toBe(2);
    expect(lastUsage(env)).toMatchObject({ status: 'error', error_code: 'AI_BAD_OUTPUT' });
  });
});

describe('phase-02-task-02 AC3: 공급자 오류 → 한국어 오류 코드', () => {
  const cases = [
    { name: '401', mode: { kind: 'status', status: 401 } as const, code: 'AI_AUTH', http: 502 },
    { name: '429', mode: { kind: 'status', status: 429 } as const, code: 'AI_RATE_LIMIT', http: 429 },
    { name: '500', mode: { kind: 'status', status: 500 } as const, code: 'AI_UNAVAILABLE', http: 502 },
    { name: '지연', mode: { kind: 'delay', ms: 1500 } as const, code: 'AI_TIMEOUT', http: 504 },
  ] as const;
  for (const provider of ['anthropic', 'openai', 'gemini'] as const) {
    for (const c of cases) {
      test(`phase-02-task-02 AC3: ${provider} 가짜 서버 ${c.name} → ${c.code} 한국어 문구, ai_usage status=error`, async () => {
        env = await makeAiEnv({ timeoutMs: 300 });
        await useProvider(env, provider);
        env.fake.setMode(c.mode);
        const res = await runAi(env, env.staff, { feature: 'quick', input: '오늘 할 일' });
        expect(res.statusCode).toBe(c.http);
        const body = res.json<{ error: { code: string; message: string } }>();
        expect(body).toEqual({ error: { code: c.code, message: ERROR_CODES[c.code][1] } });
        expect(body.error.message).toMatch(/[가-힣]/);
        expect(body.error.message).not.toMatch(/fake error|status|key/i);
        expect(lastUsage(env)).toMatchObject({ status: 'error', error_code: c.code, provider, feature: 'quick', cost_krw: 0 });
      });
    }
  }

  test('phase-02-task-02 AC3: 공급자에 연결할 수 없으면 AI_NETWORK', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'anthropic');
    await env.fake.close();
    const res = await runAi(env, env.staff, { feature: 'quick', input: '연결 확인' });
    expect(res.json()).toEqual({ error: { code: 'AI_NETWORK', message: ERROR_CODES.AI_NETWORK[1] } });
    expect(lastUsage(env)).toMatchObject({ status: 'error', error_code: 'AI_NETWORK' });
  });
});

describe('phase-02-task-02 AC4: 월 예산 80% 알림·100% 차단', () => {
  /** 이번 달 사용 기록을 직접 넣는다 */
  function addSpend(e: AiTestEnv, krw: number, at = e.clock.now().toISOString()) {
    e.app.db.run("INSERT INTO ai_usage (at, user_id, feature, provider, model, cost_usd, cost_krw, status) VALUES (?, NULL, 'quick', 'anthropic', 'claude-haiku-5-5', 0, ?, 'ok')", [at, krw]);
  }
  const budgetNotes = (e: AiTestEnv) => e.app.db.all<{ user_id: number; dedupe_key: string; title: string; link: string }>("SELECT * FROM notifications WHERE type = 'ai_budget'");

  test('phase-02-task-02 AC4: 80%에서 호출하면 admin에게만 알림 1건, 두 번째 호출에서도 중복 없음', async () => {
    env = await makeAiEnv();
    const admin2 = loginAs(env.app, 'admin');
    const manager = loginAs(env.app, 'manager');
    addSpend(env, 31_000);
    expect((await runAi(env, env.staff, { feature: 'quick', input: '하나' })).statusCode).toBe(200);
    expect(budgetNotes(env)).toHaveLength(0);
    addSpend(env, 1_000); // 32,000 / 40,000 = 80%
    expect((await runAi(env, env.staff, { feature: 'quick', input: '둘' })).statusCode).toBe(200);
    const notes = budgetNotes(env);
    expect(notes.map((n) => n.user_id).sort()).toEqual([env.admin.userId, admin2.userId].sort());
    expect(notes.every((n) => n.dedupe_key === 'budget80:2026-11' && n.link === '/admin/ai-usage')).toBe(true);
    expect(notes.some((n) => n.user_id === manager.userId || n.user_id === env?.staff.userId)).toBe(false);
    expect((await runAi(env, env.staff, { feature: 'quick', input: '셋' })).statusCode).toBe(200);
    expect(budgetNotes(env).filter((n) => n.user_id === env?.admin.userId)).toHaveLength(1);
  });

  test('phase-02-task-02 AC4: 100% 이상이면 402 AI_BUDGET_EXCEEDED, 예산을 올리면 바로 성공', async () => {
    env = await makeAiEnv();
    addSpend(env, 40_000);
    const blocked = await runAi(env, env.staff, { feature: 'quick', input: '막힘' });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'AI_BUDGET_EXCEEDED',
      message: '이번 달 AI 예산을 모두 사용했습니다. 관리자에게 한도 조정을 요청하세요.',
    });
    // 스트림도 같은 이유로 막힌다
    const s = await env.app.inject({ method: 'POST', url: '/api/ai/stream', headers: env.staff.writeHeaders, payload: { feature: 'quick', input: '막힘' } });
    expect(s.statusCode).toBe(402);
    await putAiSettings(env, { monthlyBudgetKrw: 60_000 });
    const ok = await runAi(env, env.staff, { feature: 'quick', input: '다시' });
    expect(ok.statusCode).toBe(200);
  });

  test('phase-02-task-02 AC4: 지난달 사용은 이번 달 누적에 들어가지 않는다(매월 1일 새로 시작)', async () => {
    env = await makeAiEnv();
    addSpend(env, 50_000, '2026-10-31T14:59:59.000Z'); // 10월 31일 23:59:59 KST
    expect((await runAi(env, env.staff, { feature: 'quick', input: '새 달' })).statusCode).toBe(200);
    const usage = await env.app.inject({ method: 'GET', url: '/api/ai/usage', headers: env.admin.headers });
    expect(usage.json<{ data: { month: string; monthKrw: number; calls: number } }>().data).toMatchObject({ month: '2026-11', monthKrw: 0, calls: 1 });
    const oct = await env.app.inject({ method: 'GET', url: '/api/ai/usage?month=2026-10', headers: env.admin.headers });
    expect(oct.json<{ data: { monthKrw: number; pct: number } }>().data).toMatchObject({ monthKrw: 50_000, pct: 125 });
  });
});

describe('phase-02-task-02 AC5: 개인정보 차단·가리기', () => {
  test('phase-02-task-02 AC5: 주민번호가 든 입력은 422 AI_PII_BLOCKED이고 가짜 서버에 요청이 가지 않는다', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'anthropic');
    const res = await runAi(env, env.staff, { feature: 'quick', input: '직원 주민번호 900101-1234567 확인해 줘' });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: { code: string; message: string; findings: { type: string; count: number }[] } }>();
    expect(body.error.code).toBe('AI_PII_BLOCKED');
    expect(body.error.message).toBe('주민등록번호로 보이는 내용이 있어 AI로 보내지 않았습니다. 해당 부분을 지우고 다시 시도해 주세요.');
    expect(body.error.findings).toEqual([{ type: 'rrn', count: 1 }]);
    expect(env.fake.requests).toHaveLength(0);
    expect(lastUsage(env)).toMatchObject({ status: 'blocked', error_code: 'AI_PII_BLOCKED', privacy: '{"rrn":1}', cost_krw: 0 });
    // 스트림도 열리기 전에 막힌다
    const s = await env.app.inject({ method: 'POST', url: '/api/ai/stream', headers: env.staff.writeHeaders, payload: { feature: 'quick', input: '900101-1234567' } });
    expect(s.statusCode).toBe(422);
    expect(env.fake.requests).toHaveLength(0);
  });

  test('phase-02-task-02 AC5: 전화번호는 [전화번호]로 가려진 채 전송되고, 응답에 가림 안내가 붙는다', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'openai');
    const res = await runAi(env, env.staff, { feature: 'quick', input: '거래처 담당 010-1234-5678 에게 보낼 문자' });
    expect(res.statusCode).toBe(200);
    const sent = env.fake.requests[0];
    expect(sent?.rawBody).not.toContain('010-1234-5678');
    expect(sent?.rawBody).not.toContain('1234-5678');
    expect(sent?.rawBody).toContain('[전화번호]');
    const { data } = res.json<{ data: { privacy: { findings: unknown[]; redacted: boolean; notice: string } } }>();
    expect(data.privacy).toMatchObject({ findings: [{ type: 'phone', count: 1 }], redacted: true, notice: '전화번호 1건을 가리고 보냈습니다' });
    expect(lastUsage(env)?.privacy).toBe('{"phone":1}');
  });

  test('phase-02-task-02 AC5: 공급자 응답에 든 전화번호도 저장·표시 전에 가린다', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'gemini');
    env.fake.setReply('담당자 연락처는 010-9876-5432 입니다.');
    const res = await runAi(env, env.staff, { feature: 'quick', input: '담당자 연락처' });
    const { data } = res.json<{ data: { text: string; privacy: { outputFindings: unknown[] } } }>();
    expect(data.text).toBe('담당자 연락처는 [전화번호] 입니다.');
    expect(data.privacy.outputFindings).toEqual([{ type: 'phone', count: 1 }]);
  });

  test('phase-02-task-02 AC5: 병원 대표번호(허용 목록)는 가리지 않는다', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'anthropic');
    env.app.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('privacy', ?, ?)", [JSON.stringify({ allowlist: ['02-123-4567'] }), env.clock.now().toISOString()]);
    await runAi(env, env.staff, { feature: 'quick', input: '대표번호 02-123-4567 안내 문구' });
    expect(env.fake.requests[0]?.rawBody).toContain('02-123-4567');
  });
});

describe('phase-02-task-02 AC6: 저장한 키는 어디에도 원문으로 나오지 않는다', () => {
  test('phase-02-task-02 AC6: /api/ai/settings 응답·HTML·로그 파일·DB 파일 어디에도 키 원문이 없고 끝 4자리 가림만 보인다', async () => {
    const key = 'sk-ant-FAKE-AC6-secret-9f8e7d6c';
    env = await makeAiEnv({ timeoutMs: 300, withWeb: true });
    const { app, admin, staff, dataDir } = env;

    const responses: string[] = [];
    const put = await app.inject({ method: 'PUT', url: '/api/ai/settings', headers: admin.writeHeaders, payload: { provider: 'anthropic', keys: { anthropic: key } } });
    expect(put.statusCode).toBe(200);
    responses.push(put.body);
    const get = await app.inject({ method: 'GET', url: '/api/ai/settings', headers: admin.headers });
    responses.push(get.body);
    expect(get.json<{ data: { keys: { anthropic: { saved: boolean; maskedKey: string } } } }>().data.keys.anthropic).toEqual({ saved: true, maskedKey: '••••7d6c' });

    // 성공·오류 호출, 연결 확인, 사용량·상태·모델 응답도 모두 모은다(오류 본문에 키 일부가 담긴 가짜 응답 포함)
    responses.push((await app.inject({ method: 'POST', url: '/api/ai/run', headers: staff.writeHeaders, payload: { feature: 'quick', input: '확인' } })).body);
    responses.push((await app.inject({ method: 'POST', url: '/api/ai/test', headers: admin.writeHeaders, payload: { provider: 'anthropic' } })).body);
    for (const mode of [{ kind: 'status', status: 401 }, { kind: 'status', status: 500 }, { kind: 'delay', ms: 800 }] as const) {
      env.fake.setMode(mode);
      responses.push((await app.inject({ method: 'POST', url: '/api/ai/run', headers: staff.writeHeaders, payload: { feature: 'quick', input: '오류' } })).body);
      responses.push((await app.inject({ method: 'POST', url: '/api/ai/test', headers: admin.writeHeaders, payload: { provider: 'anthropic' } })).body);
    }
    for (const url of ['/api/ai/usage', '/api/ai/status', '/api/ai/models', '/api/audit', '/api/session']) {
      responses.push((await app.inject({ method: 'GET', url, headers: admin.headers })).body);
    }
    const html: string[] = [];
    for (const url of ['/', '/admin/ai', '/admin/ai-usage', '/dashboard']) {
      const r = await app.inject({ method: 'GET', url, headers: admin.headers });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toMatch(/text\/html/);
      html.push(r.body);
    }

    for (const body of [...responses, ...html]) expect(body).not.toContain(key);
    // 로그 폴더의 모든 파일
    const logDir = path.dirname(serverLogPath(dataDir));
    const logs = fs.readdirSync(logDir).map((f) => fs.readFileSync(path.join(logDir, f), 'utf8'));
    expect(logs.join('')).toContain('AI 오류');
    for (const l of logs) expect(l).not.toContain(key);
    // DB 파일(WAL 포함)에도 원문이 없다(암호화 저장, FR-031 AC2). 암호화 키는 DB와 다른 파일(secret.key)에 있다
    for (const f of fs.readdirSync(dataDir).filter((n) => n.startsWith('app.db'))) {
      expect(fs.readFileSync(path.join(dataDir, f)).includes(Buffer.from(key))).toBe(false);
    }
    expect(fs.statSync(path.join(dataDir, 'secret.key')).size).toBe(32);
    // 가짜 공급자는 원문 키를 받았다(헤더로만 전달)
    expect(env.fake.requests[0]?.headers['x-api-key']).toBe(key);
  });

  test('phase-02-task-02 AC6: 키를 지우면(null) 저장된 키가 없어지고 데모로 돌아간다', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'anthropic');
    const res = await putAiSettings(env, { keys: { anthropic: null } });
    expect(res.json<{ data: { demo: boolean; keys: { anthropic: { saved: boolean; maskedKey: null } } } }>().data).toMatchObject({
      demo: true,
      keys: { anthropic: { saved: false, maskedKey: null } },
    });
  });

  test('phase-02-task-02 AC6: AI 설정 API는 admin만 부를 수 있다', async () => {
    env = await makeAiEnv();
    const manager = loginAs(env.app, 'manager');
    for (const who of [env.staff, manager]) {
      expect((await env.app.inject({ method: 'GET', url: '/api/ai/settings', headers: who.headers })).statusCode).toBe(403);
      expect((await env.app.inject({ method: 'PUT', url: '/api/ai/settings', headers: who.writeHeaders, payload: { provider: 'demo' } })).statusCode).toBe(403);
      expect((await env.app.inject({ method: 'GET', url: '/api/ai/usage', headers: who.headers })).statusCode).toBe(403);
    }
  });
});

describe('phase-02-task-02 AC7: 기능 끄기·역할 제한', () => {
  test('phase-02-task-02 AC7: 관리자가 기능을 끄면 403 AI_DISABLED', async () => {
    env = await makeAiEnv();
    await putAiSettings(env, { features: { script: { enabled: false } } });
    const res = await runAi(env, env.staff, { feature: 'script', input: { situation: '예약 변경 문의' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'AI_DISABLED', message: '관리자가 이 AI 기능을 꺼 두었습니다.' } });
    // 다른 기능은 그대로 쓸 수 있다
    expect((await runAi(env, env.staff, { feature: 'quick', input: '예약' })).statusCode).toBe(200);
    // 스트림도 막힌다
    const s = await env.app.inject({ method: 'POST', url: '/api/ai/stream', headers: env.staff.writeHeaders, payload: { feature: 'script', input: { situation: '예약' } } });
    expect(s.statusCode).toBe(403);
    expect(s.json<{ error: { code: string } }>().error.code).toBe('AI_DISABLED');
  });

  test('phase-02-task-02 AC7: 역할을 manager 이상으로 제한하면 staff는 403 AI_DISABLED, manager는 성공', async () => {
    env = await makeAiEnv();
    const manager = loginAs(env.app, 'manager');
    await putAiSettings(env, { features: { promo: { roles: ['admin', 'manager'] } } });
    const input = { topic: '가을 스케일링 안내', channel: '블로그' };
    const staffRes = await runAi(env, env.staff, { feature: 'promo', input });
    expect(staffRes.statusCode).toBe(403);
    expect(staffRes.json<{ error: { code: string } }>().error.code).toBe('AI_DISABLED');
    expect((await runAi(env, manager, { feature: 'promo', input })).statusCode).toBe(200);
    const status = await env.app.inject({ method: 'GET', url: '/api/ai/status', headers: env.staff.headers });
    const promo = status.json<{ data: { features: { id: string; allowed: boolean }[] } }>().data.features.find((f) => f.id === 'promo');
    expect(promo?.allowed).toBe(false);
  });

  test('phase-02-task-02 AC7: 권한 표에 없는 역할(staff의 월간 요약)은 403 FORBIDDEN, 관리자가 역할을 넓혀도 늘어나지 않는다', async () => {
    env = await makeAiEnv();
    await putAiSettings(env, { features: { monthly_summary: { roles: ['admin', 'manager', 'staff'] } } });
    const res = await runAi(env, env.staff, { feature: 'monthly_summary', input: { month: '2026-10', numbers: { 지출: 1000 } } });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
  });
});

describe('phase-02-task-02 기타 API', () => {
  test('phase-02-task-02 AC2: 모델·단가를 고치면 그 뒤 호출부터 새 단가로 계산한다(FR-036 AC2)', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'anthropic');
    const put = await env.app.inject({
      method: 'PUT',
      url: '/api/ai/models',
      headers: env.admin.writeHeaders,
      payload: { models: [{ provider: 'anthropic', tier: 'fast', modelId: 'claude-haiku-test', inputUsdPerM: 1, outputUsdPerM: 2 }] },
    });
    expect(put.statusCode).toBe(200);
    env.fake.setReply('답', { input: 1000, output: 1000 });
    const res = await runAi(env, env.staff, { feature: 'quick', input: '단가' });
    expect((env.fake.requests[0]?.body as { model: string }).model).toBe('claude-haiku-test');
    expect(res.json<{ data: { usage: { costKrw: number } } }>().data.usage.costKrw).toBeCloseTo(((1000 * 1 + 1000 * 2) / 1e6) * 1450, 10);
    const models = await env.app.inject({ method: 'GET', url: '/api/ai/models', headers: env.admin.headers });
    const list = models.json<{ data: { models: { provider: string; tier: string; modelId: string; checkedOn: string; sourceUrl: string }[] } }>().data.models;
    expect(list).toHaveLength(9);
    expect(list.find((m) => m.provider === 'openai' && m.tier === 'fast')).toMatchObject({ modelId: 'gpt-6-luna', checkedOn: '2026-11-02', sourceUrl: expect.stringMatching(/^https:\/\//) });
    expect(env.app.db.get<{ action: string }>("SELECT action FROM audit_log WHERE action = 'ai.models_update'")).toBeTruthy();
  });

  test('phase-02-task-02 AC2: 연결 확인은 아주 작은 요청을 보내고 결과를 쉬운 말로 알려 준다', async () => {
    env = await makeAiEnv();
    const none = await env.app.inject({ method: 'POST', url: '/api/ai/test', headers: env.admin.writeHeaders, payload: { provider: 'openai' } });
    expect(none.json<{ data: { ok: boolean; message: string } }>().data).toMatchObject({ ok: false, message: expect.stringContaining('저장된 키가 없습니다') });
    await useProvider(env, 'openai');
    const ok = await env.app.inject({ method: 'POST', url: '/api/ai/test', headers: env.admin.writeHeaders, payload: { provider: 'openai' } });
    expect(ok.json<{ data: { ok: boolean; message: string } }>().data).toEqual({ ok: true, message: '연결되었습니다. 이 키로 AI를 쓸 수 있습니다.' });
    expect(env.fake.requests[0]?.body).toMatchObject({ max_output_tokens: 16 });
    env.fake.setMode({ kind: 'status', status: 401 });
    const bad = await env.app.inject({ method: 'POST', url: '/api/ai/test', headers: env.admin.writeHeaders, payload: { provider: 'openai' } });
    expect(bad.json<{ data: { ok: boolean; message: string } }>().data).toEqual({ ok: false, message: ERROR_CODES.AI_AUTH[1] });
  });

  test('phase-02-task-02 AC6: 설정 변경 감사 로그에는 키가 아니라 바뀐 공급자 이름만 남는다', async () => {
    env = await makeAiEnv();
    await useProvider(env, 'gemini');
    const row = env.app.db.get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'ai.settings_update' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(row?.detail ?? '{}')).toMatchObject({ provider: 'gemini', keysChanged: ['gemini'] });
    expect(row?.detail).not.toContain(KEYS.gemini);
  });

  test('phase-02-task-02: 잘못된 입력은 400 VALIDATION과 항목별 한국어 이유', async () => {
    env = await makeAiEnv();
    const unknown = await runAi(env, env.staff, { feature: 'nope' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json<{ error: { fields: Record<string, string> } }>().error.fields).toEqual({ feature: '알 수 없는 AI 기능입니다.' });
    const missing = await runAi(env, env.staff, { feature: 'script', input: {} });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<{ error: { fields: Record<string, string> } }>().error.fields['input.situation']).toBe('상황을(를) 적어 주세요.');
    const badKey = await env.app.inject({ method: 'PUT', url: '/api/ai/settings', headers: env.admin.writeHeaders, payload: { keys: { openai: 'short' } } });
    expect(badKey.statusCode).toBe(400);
  });
});

// 이 파일이 하는 일: AI 스트림(POST /api/ai/stream, SSE)을 실제로 포트를 연 서버와 fetch로 확인한다(phase-02-task-02 AC8).
// delta 이벤트가 여러 번 온 뒤 done 이벤트가 오는지, 브라우저(클라이언트)가 중지하면 가짜 LLM 서버 쪽 연결도 끊기는지, 오류는 error 이벤트로 오는지 본다.
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { lastUsage, makeAiEnv, putAiSettings, type AiTestEnv } from '../../tests/helpers/ai-app.ts';
import type { TestLogin } from '../../tests/helpers/auth.ts';

let env: AiTestEnv | null = null;
afterEach(async () => {
  if (env) await env.close();
  env = null;
});

/** 서버 포트를 연다(127.0.0.1의 빈 포트) */
async function listen(e: AiTestEnv): Promise<string> {
  await e.app.listen({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${(e.app.server.address() as AddressInfo).port}`;
}

/** SSE 이벤트 하나 */
interface Ev {
  event: string;
  data: Record<string, unknown>;
}

/** 스트림을 열고 이벤트를 읽는 도우미. onEvent가 false를 돌려주면 그 자리에서 중지한다 */
async function readStream(base: string, who: TestLogin, payload: unknown, onEvent?: (ev: Ev) => boolean, ctrl = new AbortController()) {
  const res = await fetch(`${base}/api/ai/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: who.cookie, 'x-csrf-token': who.csrf, origin: base },
    body: JSON.stringify(payload),
    signal: ctrl.signal,
  });
  const events: Ev[] = [];
  if (!res.body) return { res, events };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
        const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}') as Record<string, unknown>;
        const ev = { event, data };
        events.push(ev);
        if (onEvent && !onEvent(ev)) {
          ctrl.abort();
          return { res, events };
        }
      }
    }
  } catch (e) {
    if (!ctrl.signal.aborted) throw e;
  }
  return { res, events };
}

describe('phase-02-task-02 AC8: SSE 스트림과 중지', () => {
  for (const provider of ['anthropic', 'openai', 'gemini'] as const) {
    test(`phase-02-task-02 AC8: ${provider} 스트림에서 delta 이벤트 여러 개 뒤 done 이벤트가 온다`, async () => {
      env = await makeAiEnv();
      await putAiSettings(env, { provider, keys: { [provider]: `FAKE-stream-key-${provider}-0001` } });
      env.fake.setReply('첫째 줄입니다.\n둘째 줄입니다.\n셋째 줄입니다.\n넷째 줄입니다.\n다섯째 줄입니다.\n여섯째 줄입니다.', { input: 900, output: 210 });
      env.fake.setStream({ pieces: 6, gapMs: 10 });
      const base = await listen(env);
      const { res, events } = await readStream(base, env.staff, { feature: 'quick', input: '스트림 확인' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const deltas = events.filter((e) => e.event === 'delta');
      expect(deltas.length).toBeGreaterThan(1);
      expect(events.at(-1)?.event).toBe('done');
      expect(events.findIndex((e) => e.event === 'done')).toBe(events.length - 1);
      const joined = deltas.map((d) => d.data.text).join('');
      const done = events.at(-1)?.data as { text: string; demo: boolean; usage: { inputTokens: number; outputTokens: number } };
      expect(joined).toBe(done.text);
      expect(done).toMatchObject({ demo: false, usage: { inputTokens: 900, outputTokens: 210 } });
      expect(env.fake.requests[0]?.stream).toBe(true);
      if (provider === 'gemini') expect(env.fake.requests[0]?.url).toContain(':streamGenerateContent?alt=sse');
      else expect(env.fake.requests[0]?.body).toMatchObject({ stream: true });
      expect(lastUsage(env)).toMatchObject({ status: 'ok', provider, input_tokens: 900, output_tokens: 210 });
    });
  }

  test('phase-02-task-02 AC8: 클라이언트가 중지하면 가짜 서버 연결이 끊기고 기록은 status=error', async () => {
    env = await makeAiEnv();
    await putAiSettings(env, { provider: 'anthropic', keys: { anthropic: 'FAKE-stream-key-abort-0001' } });
    env.fake.setReply(Array.from({ length: 40 }, (_, i) => `${i + 1}번째 문장입니다. `).join('\n'));
    env.fake.setStream({ pieces: 40, gapMs: 50 });
    const base = await listen(env);
    let seen = 0;
    const { events } = await readStream(base, env.staff, { feature: 'quick', input: '긴 답' }, (ev) => {
      if (ev.event === 'delta') seen++;
      return seen < 1;
    });
    expect(events.some((e) => e.event === 'delta')).toBe(true);
    expect(events.some((e) => e.event === 'done')).toBe(false);
    // 브라우저가 끊으면 서버가 공급자 요청도 끊는다
    expect(await env.fake.waitClosedEarly(3000)).toBe(true);
    // 기록이 남을 때까지 잠깐 기다린다
    for (let i = 0; i < 50 && lastUsage(env)?.status !== 'error'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(lastUsage(env)).toMatchObject({ status: 'error', error_code: 'AI_ABORTED', estimated: 1 });
  });

  test('phase-02-task-02 AC8: 데모 모드도 delta 여러 개 뒤 done(demo:true)', async () => {
    env = await makeAiEnv();
    const base = await listen(env);
    const { events } = await readStream(base, env.staff, { feature: 'quick', input: '데모 스트림' });
    expect(events.filter((e) => e.event === 'delta').length).toBeGreaterThan(1);
    const done = events.at(-1);
    expect(done?.event).toBe('done');
    expect(done?.data).toMatchObject({ demo: true, text: expect.stringMatching(/^\[데모 응답\]/) });
  });

  test('phase-02-task-02 AC8: 스트림 도중 공급자 오류는 error 이벤트(한국어 문구)로 온다', async () => {
    env = await makeAiEnv({ timeoutMs: 300 });
    await putAiSettings(env, { provider: 'openai', keys: { openai: 'FAKE-stream-key-error-0001' } });
    env.fake.setMode({ kind: 'status', status: 429 });
    const base = await listen(env);
    const { res, events } = await readStream(base, env.staff, { feature: 'quick', input: '오류' });
    expect(res.status).toBe(200);
    expect(events).toEqual([{ event: 'error', data: { code: 'AI_RATE_LIMIT', message: 'AI 서비스 요청이 많아 잠시 막혔습니다. 1분 뒤 다시 시도해 주세요.' } }]);
    expect(lastUsage(env)).toMatchObject({ status: 'error', error_code: 'AI_RATE_LIMIT' });
  });

  test('phase-02-task-02 AC8: 스트림 응답의 전화번호는 조각으로 나뉘어 와도 가려진다', async () => {
    env = await makeAiEnv();
    await putAiSettings(env, { provider: 'gemini', keys: { gemini: 'FAKE-stream-key-pii-0001' } });
    env.fake.setReply('담당자에게 연락하세요. 번호는 010-2345-6789 이고 오전에 받습니다. 그 밖의 안내는 공지를 보세요.', { input: 10, output: 10 });
    env.fake.setStream({ pieces: 12, gapMs: 5 });
    const base = await listen(env);
    const { events } = await readStream(base, env.staff, { feature: 'quick', input: '연락처' });
    const joined = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
    expect(joined).not.toMatch(/2345|6789/);
    expect(joined).toContain('[전화번호]');
  });
});

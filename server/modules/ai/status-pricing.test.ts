// 이 파일이 하는 일: phase-02-task-03이 GET /api/ai/status에 더한 등급별 단가(pricing)와 관리 화면이 쓰는 API 흐름을 확인하는 통합 테스트.
// 가짜 LLM 서버(tests/fake-llm)와 임시 데이터 폴더를 쓰고 실제 공급자·키는 쓰지 않는다(tests/helpers/ai-app.ts).
import { afterEach, describe, expect, test } from 'vitest';
import { makeAiEnv, putAiSettings, runAi, type AiTestEnv } from '../../../tests/helpers/ai-app.ts';

let env: AiTestEnv | null = null;
afterEach(async () => {
  await env?.close();
  env = null;
});

interface StatusBody {
  data: { demo: boolean; pricing: { fxKrwPerUsd: number; tiers: Record<string, { modelId: string; inputUsdPerM: number; outputUsdPerM: number }> } | null };
}

describe('AI 상태의 단가(예상 비용 표시용)', () => {
  test('phase-02-task-03 AC2: 데모면 pricing이 null이고, 공급자 키를 저장하면 등급별 단가·환율이 오며, 단가를 고치면 status와 실제 호출 비용이 새 단가를 쓴다', async () => {
    env = await makeAiEnv();
    const e = env;
    const status = async () => (await e.app.inject({ method: 'GET', url: '/api/ai/status', headers: e.staff.headers })).json<StatusBody>().data;

    expect((await status()).pricing).toBeNull();

    await putAiSettings(e, { provider: 'anthropic', keys: { anthropic: 'sk-ant-unit-test-0001' }, fxKrwPerUsd: 1000 });
    const before = await status();
    expect(before.demo).toBe(false);
    expect(before.pricing?.fxKrwPerUsd).toBe(1000);
    expect(before.pricing?.tiers.fast).toEqual({ modelId: 'claude-haiku-5-5', inputUsdPerM: 0.1, outputUsdPerM: 0.5 });

    const put = await e.app.inject({
      method: 'PUT',
      url: '/api/ai/models',
      headers: e.admin.writeHeaders,
      payload: { models: [{ provider: 'anthropic', tier: 'fast', inputUsdPerM: 50, outputUsdPerM: 100 }] },
    });
    expect(put.statusCode).toBe(200);
    expect((await status()).pricing?.tiers.fast).toEqual({ modelId: 'claude-haiku-5-5', inputUsdPerM: 50, outputUsdPerM: 100 });

    // 가짜 공급자 사용량(입력 1200, 출력 340) × 새 단가 × 환율 1000
    e.fake.setReply('새 단가 확인', { input: 1200, output: 340 });
    const res = await runAi(e, e.staff, { feature: 'quick', input: '주차 안내 멘트' });
    expect(res.statusCode).toBe(200);
    const cost = res.json<{ data: { usage: { costKrw: number; estimated: boolean } } }>().data.usage;
    expect(cost.estimated).toBe(false);
    expect(cost.costKrw).toBeCloseTo(((1200 * 50 + 340 * 100) / 1_000_000) * 1000, 6);
    expect(e.fake.requests.length).toBe(1);
  });
});

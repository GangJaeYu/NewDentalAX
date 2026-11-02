// 이 파일이 하는 일: 화면 AI 도우미(lib/ai.ts)의 순수 로직 단위 테스트(phase-02-task-03).
// 예상 비용 계산·작은 금액 표시·오류별 다음 행동 안내·달 옮기기·예산 색, 그리고 스트림 래퍼(runAiStream)가 delta·done·error 사건과
// 스트림 전 오류(예산 초과 402)를 바르게 다루는지 가짜 fetch로 확인한다. 실제 서버·공급자는 쓰지 않는다.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { redactedMessage } from '../../../shared/privacy-rules.ts';
import { ApiError } from './api.ts';
import { aiErrorHelp, budgetTone, costText, estimateCostKrw, estimateTokens, formatSmallWon, monthLabel, runAiStream, shiftMonth, tierCostLabel } from './ai.ts';
import { inputPrivacyWarning } from './privacy.ts';

/** SSE 본문을 주는 가짜 fetch 응답 */
function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('예상 비용·표시', () => {
  test('phase-02-task-03 AC2: 예상 비용은 등급 단가×토큰÷100만×환율로 계산하고, 단가를 바꾸면 그 단가로 다시 계산한다', () => {
    const text = '가'.repeat(400); // 200토큰 + 안내 300 = 입력 500, 출력 = quick 최대 1024의 절반 512
    expect(estimateTokens(text)).toBe(200);
    const old = estimateCostKrw(text, 'quick', { modelId: 'm', inputUsdPerM: 0.1, outputUsdPerM: 0.5 }, 1450);
    expect(old).toBeCloseTo(((500 * 0.1 + 512 * 0.5) / 1_000_000) * 1450, 10);
    const neu = estimateCostKrw(text, 'quick', { modelId: 'm', inputUsdPerM: 50, outputUsdPerM: 100 }, 1000);
    expect(neu).toBeCloseTo(((500 * 50 + 512 * 100) / 1_000_000) * 1000, 10);
    expect(estimateCostKrw(text, 'quick', null, 1450)).toBeNull();
  });

  test('phase-02-task-03 AC2: 작은 금액은 알아보게 쓰고, 데모는 0원·단가 모름은 따로 표시한다', () => {
    expect(formatSmallWon(0)).toBe('0원');
    expect(formatSmallWon(0.4)).toBe('1원 미만');
    expect(formatSmallWon(2.94)).toBe('2.9원');
    expect(formatSmallWon(94.2)).toBe('94원');
    expect(formatSmallWon(12400.4)).toBe('12,400원');
    expect(costText(9.4, false)).toBe('약 9.4원');
    expect(costText(9.4, true)).toBe('데모 0원');
    expect(costText(null, false)).toBe('예상 비용 모름');
    expect(tierCostLabel('fast', 3, false)).toBe('빠름 모델 · 예상 3원');
  });
});

describe('사용량 화면 도우미', () => {
  test('phase-02-task-03 AC3: 예산 비율 색은 경고 비율 이상 주의, 100% 이상 위험, 그 밖은 정상이다', () => {
    expect(budgetTone(31, 80)).toBe('ok');
    expect(budgetTone(80, 80)).toBe('warn');
    expect(budgetTone(99.9, 80)).toBe('warn');
    expect(budgetTone(100, 80)).toBe('danger');
  });

  test('phase-02-task-03 AC3: 달 옮기기와 달 이름(연도 넘어가기 포함)', () => {
    expect(shiftMonth('2026-11', -1)).toBe('2026-10');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthLabel('2026-11')).toBe('2026년 11월');
  });
});

describe('개인정보 경고·처리 결과 문구', () => {
  test('phase-02-task-03 AC4: 입력에 휴대전화 번호가 있으면 노란 경고 문구가 나오고, 처리 결과 문구는 "전화번호 1건을 가리고 보냈습니다"이다', () => {
    const w = inputPrivacyWarning('주차 안내 문자 만들어줘. 문의 010-1234-5678');
    expect(w?.types).toEqual(['phone']);
    expect(w?.message).toContain('전화번호');
    expect(w?.message).toContain('가려집니다');
    expect(inputPrivacyWarning('주차 2시간 무료 안내 멘트 만들어줘')).toBeNull();
    expect(redactedMessage([{ type: 'phone', count: 1 }])).toBe('전화번호 1건을 가리고 보냈습니다');
  });
});

describe('오류 안내·스트림 래퍼', () => {
  test('phase-02-task-03 AC5: 예산 초과 안내는 직원에게 관리자 문의를, 관리자에게 예산 올리는 곳을 알려 준다', () => {
    expect(aiErrorHelp('AI_BUDGET_EXCEEDED', false)).toContain('관리자');
    expect(aiErrorHelp('AI_BUDGET_EXCEEDED', true)).toContain('월 예산');
    for (const code of ['AI_AUTH', 'AI_TIMEOUT', 'AI_RATE_LIMIT', 'AI_NETWORK', 'AI_UNAVAILABLE', 'AI_PII_BLOCKED', 'AI_DISABLED']) {
      expect(aiErrorHelp(code, false), code).toMatch(/[가-힣]/);
    }
    expect(aiErrorHelp('SOMETHING_ELSE', false)).toBeNull();
  });

  test('phase-02-task-03 AC5: 스트림 전에 402 예산 초과가 오면 서버의 한국어 문구 그대로 ApiError를 던진다', async () => {
    const message = '이번 달 AI 예산을 모두 사용했습니다. 관리자에게 한도 조정을 요청하세요.';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'AI_BUDGET_EXCEEDED', message } }), { status: 402, headers: { 'content-type': 'application/json' } })));
    const err = await runAiStream({ feature: 'quick', input: 'x' }, { onDelta: () => {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('AI_BUDGET_EXCEEDED');
    expect((err as ApiError).message).toBe(message);
  });

  test('phase-02-task-03 AC4: 스트림 글 조각을 차례로 넘기고, done 사건의 결과(개인정보 처리 결과 포함)를 돌려준다', async () => {
    const done = {
      text: '안녕하세요 [전화번호]',
      demo: true,
      usage: { inputTokens: 1, outputTokens: 2, costKrw: 0, estimated: true },
      privacy: { findings: [{ type: 'phone', count: 1 }], redacted: true, notice: '전화번호 1건을 가리고 보냈습니다', outputFindings: [] },
      requestId: 7,
      feature: 'quick',
      provider: 'demo',
      model: null,
      tier: 'fast',
    };
    // 사건 경계가 조각 중간에 걸쳐도 이어 붙여 읽는다
    const all = `event: delta\ndata: {"text":"안녕"}\n\nevent: delta\ndata: {"text":"하세요 "}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([all.slice(0, 17), all.slice(17, 60), all.slice(60)])));
    const parts: string[] = [];
    const r = await runAiStream({ feature: 'quick', input: 'x' }, { onDelta: (t) => parts.push(t) });
    expect(parts).toEqual(['안녕', '하세요 ']);
    expect(r.requestId).toBe(7);
    expect(r.privacy.notice).toBe('전화번호 1건을 가리고 보냈습니다');
  });

  test('phase-02-task-03 AC5: 스트림 도중 error 사건이 오면 그 코드·문구로 ApiError를 던지고, done 없이 끝나면 끊김 안내를 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['event: delta\ndata: {"text":"앞"}\n\nevent: error\ndata: {"code":"AI_TIMEOUT","message":"AI 응답이 너무 오래 걸려 중단했습니다."}\n\n'])));
    const err = await runAiStream({ feature: 'quick', input: 'x' }, { onDelta: () => {} }).catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('AI_TIMEOUT');
    expect((err as ApiError).message).toBe('AI 응답이 너무 오래 걸려 중단했습니다.');

    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['event: delta\ndata: {"text":"앞"}\n\n'])));
    const cut = await runAiStream({ feature: 'quick', input: 'x' }, { onDelta: () => {} }).catch((e: unknown) => e);
    expect((cut as ApiError).message).toContain('끊겼습니다');
  });
});

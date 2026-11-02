// 이 파일이 하는 일: 명세서·영수증 사진 → 입고·지출 입력(FR-122, phase-04-task-08)을 실제 라우트·DB·가짜 LLM 서버로 확인한다.
// AC1 확인 체크 없이 보내면 400 / AC2 긴 변 1600px 초과는 413, 1600px 이하만 받고 받은 크기를 돌려준다(사진 머리 읽기 포함) /
// AC3 데모 결과 줄마다 기존 품목 후보 → 확인 후 저장하면 입고 기록과(실장이 고르면) 지출(재료비·사진 첨부) / AC4 가짜 공급자가 카드번호를 돌려주면 가린 채 응답 /
// AC5 이미지 미지원 모델이면 상태 API가 비활성 안내를, 사진 읽기는 403 AI_DISABLED를 돌려준다. 실제 공급자·키는 쓰지 않는다.
import { afterEach, describe, expect, test } from 'vitest';
import { makeAiEnv, putAiSettings, type AiTestEnv } from '../../../tests/helpers/ai-app.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { fakeJpeg, fakePng, fakeWebp } from '../../../tests/fixtures/receipt/images.ts';
import { seedDemo } from './seed.ts';
import { readImageSize } from './receipt-image.ts';
import { linesTotal, nameSimilarity, normalizeName, rankByName, type ReceiptCommitResult, type ReceiptReadResult, type ReceiptStatus } from './receipt.service.ts';

const KEY = 'sk-ant-unit-ONLYFAKE-receipt-7Qa1';

let env: AiTestEnv | null = null;
afterEach(async () => {
  if (env) await env.close();
  env = null;
});

interface ErrBody {
  error?: { code: string; message: string; fields?: Record<string, string> };
}

/** multipart 본문(사진 하나 + 글 칸) */
function multipart(file: { name: string; data: Buffer; type?: string }, fields: Record<string, string> = {}) {
  const boundary = '----dentalaxReceiptBoundary9xQ';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'image/jpeg'}\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** 데모 품목·거래처를 넣은 테스트 서버(공급자는 데모) */
async function demoEnv() {
  env = await makeAiEnv();
  seedDemo(env.app.db, { clock: env.clock, scale: 1 });
  const manager = loginAs(env.app, 'manager');
  return { env, manager };
}

async function upload(e: AiTestEnv, who: TestLogin, file: { name: string; data: Buffer; type?: string }, confirmed = true) {
  const m = multipart(file, confirmed ? { confirmed: 'true' } : {});
  const res = await e.app.inject({ method: 'POST', url: '/api/ai/receipt', headers: { ...who.writeHeaders, 'content-type': m.contentType }, payload: m.payload });
  return { status: res.statusCode, body: res.json<{ data: ReceiptReadResult } & ErrBody>() };
}

async function commit(e: AiTestEnv, who: TestLogin, payload: unknown) {
  const res = await e.app.inject({ method: 'POST', url: '/api/inventory/receipt-commit', headers: who.writeHeaders, payload: payload as object });
  return { status: res.statusCode, body: res.json<{ data: ReceiptCommitResult } & ErrBody>() };
}

async function status(e: AiTestEnv, who: TestLogin): Promise<ReceiptStatus> {
  const res = await e.app.inject({ method: 'GET', url: '/api/inventory/receipt-status', headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: ReceiptStatus }>().data;
}

const stockOf = (e: AiTestEnv, itemId: number) =>
  e.app.db.get<{ s: number }>("SELECT COALESCE(SUM(CASE WHEN type = 'out' THEN -qty ELSE qty END), 0) AS s FROM stock_moves WHERE item_id = ?", [itemId])?.s ?? 0;

describe('phase-04-task-08 사진 머리 읽기·이름 비슷한 정도', () => {
  test('phase-04-task-08 AC2: 서버가 JPEG·PNG·WebP 머리에서 가로·세로를 읽는다(깨진 파일은 null)', () => {
    expect(readImageSize(fakeJpeg(4000, 3000))).toEqual({ width: 4000, height: 3000, format: 'jpeg' });
    expect(readImageSize(fakeJpeg(1600, 1200))).toEqual({ width: 1600, height: 1200, format: 'jpeg' });
    expect(readImageSize(fakePng(1200, 1600))).toEqual({ width: 1200, height: 1600, format: 'png' });
    expect(readImageSize(fakeWebp(1600, 900))).toEqual({ width: 1600, height: 900, format: 'webp' });
    expect(readImageSize(fakeWebp(2000, 1500, 'VP8L'))).toEqual({ width: 2000, height: 1500, format: 'webp' });
    expect(readImageSize(fakeWebp(3000, 2000, 'VP8X'))).toEqual({ width: 3000, height: 2000, format: 'webp' });
    expect(readImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(readImageSize(Buffer.from('not an image'))).toBeNull();
  });

  test('phase-04-task-08 AC3: 2-gram 유사도로 비슷한 이름이 앞에 온다', () => {
    expect(normalizeName('거즈 2×2 (200매)')).toBe('거즈2x2200매');
    expect(nameSimilarity('니트릴 글러브 M (100매)', '니트릴 글러브 M')).toBe(0.75);
    expect(nameSimilarity('니트릴 글러브 M (100매)', '니트릴 글러브 M')).toBeGreaterThan(nameSimilarity('니트릴 글러브 M (100매)', '니트릴 글러브 S'));
    expect(nameSimilarity('석션팁', '복합레진 A2')).toBe(0);
    const ranked = rankByName('석션팁 일회용', [{ name: '석션 팁 (일회용)' }, { name: '배엽 팁' }, { name: '일회용 앞치마' }, { name: 'MTA' }]);
    expect(ranked.map((r) => r.name)).toEqual(['석션 팁 (일회용)', '일회용 앞치마']);
    expect(linesTotal([{ qty: 10, unitPrice: 8400 }, { qty: 2.5, unitPrice: 1001 }, { qty: 3, unitPrice: null }])).toBe(86503);
  });
});

describe('phase-04-task-08 사진 업로드 검사', () => {
  test('phase-04-task-08 AC1: 경고 확인 체크(confirmed) 없이 보내면 400이고 AI를 부르지 않는다', async () => {
    const { env: e } = await demoEnv();
    const r = await upload(e, e.staff, { name: 'st.jpg', data: fakeJpeg(1600, 1200) }, false);
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe('VALIDATION');
    expect(r.body.error?.fields?.confirmed).toContain('확인하고 체크');
    expect(e.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_usage WHERE feature = 'receipt'")?.n).toBe(0);
    expect(e.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM files')?.n).toBe(0);
  });

  test('phase-04-task-08 AC2: 긴 변 1600px를 넘는 4000×3000 사진은 413, 1600×1200은 받고 받은 크기를 돌려준다', async () => {
    const { env: e } = await demoEnv();
    const big = await upload(e, e.staff, { name: 'big.jpg', data: fakeJpeg(4000, 3000) });
    expect(big.status).toBe(413);
    expect(big.body.error?.code).toBe('FILE_TOO_LARGE');
    expect(big.body.error?.message).toContain('4000×3000px');
    expect(e.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM files')?.n).toBe(0);

    const ok = await upload(e, e.staff, { name: 'ok.jpg', data: fakeJpeg(1600, 1200) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(Math.max(ok.body.data.image.width, ok.body.data.image.height)).toBeLessThanOrEqual(1600);
    expect(ok.body.data.image).toMatchObject({ width: 1600, height: 1200, format: 'jpeg' });
    const file = e.app.db.get<{ purpose: string; mime: string }>('SELECT purpose, mime FROM files WHERE id = ?', [ok.body.data.fileId]);
    expect(file).toEqual({ purpose: 'receipt', mime: 'image/jpeg' });
  });

  test('phase-04-task-08 AC2: 8MB 넘는 사진은 413, 사진이 아닌 파일·PDF는 415', async () => {
    const { env: e } = await demoEnv();
    const heavy = await upload(e, e.staff, { name: 'heavy.jpg', data: fakeJpeg(1600, 1200, 8 * 1024 * 1024) });
    expect(heavy.status).toBe(413);
    expect(heavy.body.error?.message).toContain('8MB');
    const fake = await upload(e, e.staff, { name: 'evil.jpg', data: Buffer.from('MZ this is not a photo') });
    expect(fake.status).toBe(415);
    const pdf = await upload(e, e.staff, { name: 'st.pdf', data: Buffer.from('%PDF-1.4\n'), type: 'application/pdf' });
    expect(pdf.status).toBe(415);
    expect(pdf.body.error?.message).toContain('JPG·PNG·WEBP');
  });
});

describe('phase-04-task-08 데모 결과 → 품목 후보 → 입고·지출', () => {
  test('phase-04-task-08 AC3: 데모 결과의 각 줄에 기존 품목 후보(상위 3개)가 붙고 거래처 후보도 나온다', async () => {
    const { env: e } = await demoEnv();
    expect(await status(e, e.staff)).toEqual({ state: 'ready', demo: true, message: null });
    const r = await upload(e, e.staff, { name: 'st.png', data: fakePng(1200, 1600), type: 'image/png' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d.ai.demo).toBe(true);
    expect(d.draft.lines).toHaveLength(3);
    expect(d.candidates).toHaveLength(3);
    expect(d.candidates.every((c) => c.length >= 1 && c.length <= 3)).toBe(true);
    expect(d.candidates.map((c) => c[0]?.name)).toEqual(['니트릴 글러브 M', '석션 팁 (일회용)', '거즈 2×2']);
    expect(d.vendorCandidates[0]?.name).toBe('한빛덴탈');
  });

  test('phase-04-task-08 AC3: 실장이 확인 후 저장하면 입고 기록과 지출(재료비·사진 첨부·receipt 참조)이 생긴다', async () => {
    const { env: e, manager } = await demoEnv();
    const r = await upload(e, manager, { name: 'st.jpg', data: fakeJpeg(1600, 1200) });
    expect(r.status).toBe(200);
    const d = r.body.data;
    const glove = d.candidates[0]?.[0]?.itemId as number;
    const tip = d.candidates[1]?.[0]?.itemId as number;
    const before = { glove: stockOf(e, glove), tip: stockOf(e, tip) };
    const c = await commit(e, manager, {
      fileId: d.fileId,
      vendorId: d.vendorCandidates[0]?.vendorId,
      date: '2026-11-01',
      lines: [
        { itemId: glove, qty: 10, unitPrice: 8400 },
        { itemId: tip, qty: 6, unitPrice: 4200, lot: 'L-77', expiryOn: '2027-06-30' },
        { newItem: { name: '새 거즈 3×3', category: '소모품', unit: '팩', par: 2 }, qty: 4, unitPrice: 3200 },
      ],
      alsoExpense: { payMethod: 'card' },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.data.moves).toBe(3);
    expect(c.body.data.createdItems).toBe(1);
    expect(stockOf(e, glove)).toBe(before.glove + 10);
    expect(stockOf(e, tip)).toBe(before.tip + 6);
    const moves = e.app.db.all<{ type: string; qty: number; unit_price: number; vendor_id: number; lot: string | null; reason: string }>(
      "SELECT type, qty, unit_price, vendor_id, lot, reason FROM stock_moves WHERE reason LIKE '명세서 사진 입고%' ORDER BY id",
    );
    expect(moves).toHaveLength(3);
    expect(moves.every((m) => m.type === 'in' && m.vendor_id === d.vendorCandidates[0]?.vendorId)).toBe(true);
    expect(moves[1]).toMatchObject({ qty: 6, unit_price: 4200, lot: 'L-77' });
    const ex = c.body.data.expense;
    expect(ex).not.toBeNull();
    expect(ex).toMatchObject({ amount: 84000 + 25200 + 12800, payMethod: 'card', vendorName: '한빛덴탈', date: '2026-11-01', stockMoveRef: `receipt:${d.fileId}`, category: '재료비' });
    expect(ex?.file?.id).toBe(d.fileId);
    expect(e.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'receipt.commit'")?.n).toBe(1);

    // 같은 사진으로 다시 저장하면 409(두 번 입고 방지)
    const again = await commit(e, manager, { fileId: d.fileId, lines: [{ itemId: glove, qty: 1 }] });
    expect(again.status).toBe(409);
    expect(stockOf(e, glove)).toBe(before.glove + 10);
  });

  test('phase-04-task-08 AC3: 직원은 입고만 되고, 지출 동시 기록·새 품목 등록은 403(아무것도 저장되지 않음)', async () => {
    const { env: e } = await demoEnv();
    const r = await upload(e, e.staff, { name: 'st.jpg', data: fakeJpeg(1200, 900) });
    const d = r.body.data;
    const glove = d.candidates[0]?.[0]?.itemId as number;
    const before = stockOf(e, glove);
    const withExpense = await commit(e, e.staff, { fileId: d.fileId, lines: [{ itemId: glove, qty: 2, unitPrice: 8400 }], alsoExpense: { payMethod: 'card' } });
    expect(withExpense.status).toBe(403);
    const withNew = await commit(e, e.staff, { fileId: d.fileId, lines: [{ newItem: { name: '몰래 품목', category: '소모품', unit: '개' }, qty: 1 }] });
    expect(withNew.status).toBe(403);
    expect(stockOf(e, glove)).toBe(before);
    expect(e.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM expenses')?.n).toBe(0);

    const ok = await commit(e, e.staff, { fileId: d.fileId, vendorName: '한빛덴탈', lines: [{ itemId: glove, qty: 2, unitPrice: 8400 }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.expense).toBeNull();
    expect(stockOf(e, glove)).toBe(before + 2);
    expect(e.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM expenses')?.n).toBe(0);
  });

  test('phase-04-task-08 AC3: 입력이 틀리면 400(품목 없는 줄·0 수량·없는 사진 번호는 404)', async () => {
    const { env: e, manager } = await demoEnv();
    const bad = await commit(e, manager, { fileId: 1, lines: [{ qty: 0 }] });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error?.fields ?? {}).sort()).toEqual(['lines.0.itemId', 'lines.0.qty']);
    const missing = await commit(e, manager, { fileId: 9999, lines: [{ itemId: 1, qty: 1 }] });
    expect(missing.status).toBe(404);
  });
});

describe('phase-04-task-08 가짜 공급자 응답', () => {
  /** 가짜 Anthropic 공급자로 바꾼다 */
  async function fakeProvider(e: AiTestEnv) {
    await putAiSettings(e, { provider: 'anthropic', keys: { anthropic: KEY } });
  }

  test('phase-04-task-08 AC4: 가짜 공급자가 카드번호가 든 글을 돌려주면 가린 채 응답하고 감지 건수를 알려 준다', async () => {
    const { env: e } = await demoEnv();
    await fakeProvider(e);
    e.fake.setReply(
      JSON.stringify({
        vendorName: '미소치재',
        date: '2026-11-01',
        lines: [{ name: '카드 4111-1111-1111-1111 결제 니트릴 글러브 M', qty: 2, unitPrice: 8400, amount: 16800 }],
        total: 16800,
      }),
      { input: 1200, output: 80 },
    );
    const r = await upload(e, e.staff, { name: 'st.jpg', data: fakeJpeg(1600, 1200) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data;
    expect(d.ai.demo).toBe(false);
    expect(d.draft.lines[0]?.name).toContain('[카드번호]');
    expect(JSON.stringify(d)).not.toContain('4111');
    expect(d.ai.privacy.outputFindings).toEqual([{ type: 'card', count: 1 }]);
    // 사진은 이미지로 공급자에게 갔다(긴 변 1600px 이하 사진의 base64)
    const sent = e.fake.requests.at(-1)?.rawBody ?? '';
    expect(sent).toContain('"type":"image"');
    expect(sent).toContain('"media_type":"image/jpeg"');
  });

  test('phase-04-task-08 AC5: 이미지 미지원 모델이면 상태 API가 비활성 안내를, 사진 읽기는 403 AI_DISABLED를 돌려준다', async () => {
    const { env: e } = await demoEnv();
    await fakeProvider(e);
    expect((await status(e, e.staff)).state).toBe('ready');
    const res = await e.app.inject({ method: 'PUT', url: '/api/ai/models', headers: e.admin.writeHeaders, payload: { models: [{ provider: 'anthropic', tier: 'standard', supportsImages: false }] } });
    expect(res.statusCode, res.body).toBe(200);
    expect(await status(e, e.staff)).toEqual({ state: 'no_image_model', demo: false, message: '사진을 읽을 수 있는 AI 모델이 설정되지 않았습니다.' });
    const before = e.fake.requests.length;
    const r = await upload(e, e.staff, { name: 'st.jpg', data: fakeJpeg(1600, 1200) });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: 'AI_DISABLED', message: '사진을 읽을 수 있는 AI 모델이 설정되지 않았습니다.' });
    expect(e.fake.requests.length).toBe(before);

    // 관리자가 기능을 끄면 "꺼 두었습니다" 안내
    await putAiSettings(e, { features: { receipt: { enabled: false } } });
    expect((await status(e, e.staff)).state).toBe('disabled');
  });
});

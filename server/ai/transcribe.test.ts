// 이 파일이 하는 일: 회의 녹음 받아쓰기(phase-06-task-03, FR-132)를 실제 라우트·DB와 가짜 공급자 서버(tests/fake-llm/audio.ts)로 확인한다.
// AC1 데모 모드: 녹음 업로드 → 예시 받아쓰기 글 → 그 글로 회의록 요약(minutes)이 결정 사항·할 일로 나뉜다. 녹음은 저장되지 않는다.
// AC2 음성 미지원 공급자(Anthropic)면 상태 API가 비활성 안내를, 업로드는 403 AI_DISABLED("음성을 지원하지 않아요")를 돌려준다.
// AC3 20MB 넘는 파일은 413으로 거부한다. 그 밖에 확인 체크·형식 검사, OpenAI·Gemini 요청 모양과 분·토큰 단위 비용 기록, 예산 차단, 개인정보 가림을 본다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { manualClock } from '../lib/clock.ts';
import { MB } from '../lib/files.ts';
import { loginAs, type TestLogin } from '../../tests/helpers/auth.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';
import { startFakeAudio, type FakeAudio } from '../../tests/fake-llm/audio.ts';
import { DEMO_TRANSCRIPT } from './features/transcribe.ts';
import { checkAudio, estimateSeconds, geminiAudioCostUsd, openaiAudioCostUsd, TRANSCRIBE_MAX_BYTES, type TranscribeResult, type TranscribeStatus } from './transcribe.ts';
import { GEMINI_INLINE_MAX_BYTES } from './providers/audio.ts';

const FX = 1450;

interface Env {
  app: FastifyInstance;
  fake: FakeAudio;
  dataDir: string;
  admin: TestLogin;
  staff: TestLogin;
}

let env: Env | null = null;
afterEach(async () => {
  if (!env) return;
  await env.app.close();
  await env.fake.close();
  fs.rmSync(env.dataDir, { recursive: true, force: true });
  env = null;
});

/** 가짜 공급자 주소를 넣은 테스트 서버 */
async function makeEnv(): Promise<Env> {
  const fake = await startFakeAudio();
  const dataDir = makeTmpDir('dentalax-transcribe-');
  const app = await buildApp({
    dataDir,
    webDist: path.join(dataDir, 'no-web'),
    clock: manualClock('2026-11-02T09:00:00+09:00'),
    ai: { baseUrls: { anthropic: fake.url, openai: fake.url, gemini: fake.url }, demoStreamDelayMs: 1 },
  });
  env = { app, fake, dataDir, admin: loginAs(app, 'admin'), staff: loginAs(app, 'staff') };
  return env;
}

/** 가짜 m4a(앞부분 'ftyp' 머리 + 채움 바이트) */
function fakeM4a(bytes = 4096): Buffer {
  const b = Buffer.alloc(bytes, 0x11);
  Buffer.from([0x00, 0x00, 0x00, 0x20]).copy(b, 0);
  Buffer.from('ftypM4A ', 'latin1').copy(b, 4);
  return b;
}

/** 가짜 wav(44바이트 머리, 초당 16000바이트) */
function fakeWav(seconds: number): Buffer {
  const data = 16000 * seconds;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(data, 40);
  return b;
}

/** multipart 본문(파일 하나 + 글 칸) */
function multipart(file: { name: string; data: Buffer; type?: string }, fields: Record<string, string> = {}) {
  const boundary = '----dentalaxTranscribeBoundary3Kd';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'audio/mp4'}\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

interface ErrBody {
  error?: { code: string; message: string; fields?: Record<string, string> };
}

async function upload(e: Env, who: TestLogin, file: { name: string; data: Buffer; type?: string }, confirmed = true) {
  const m = multipart(file, confirmed ? { confirmed: 'true' } : {});
  const res = await e.app.inject({ method: 'POST', url: '/api/ai/transcribe', headers: { ...who.writeHeaders, 'content-type': m.contentType }, payload: m.payload });
  return { status: res.statusCode, body: res.json<{ data: TranscribeResult } & ErrBody>() };
}

async function status(e: Env, who: TestLogin): Promise<TranscribeStatus> {
  const res = await e.app.inject({ method: 'GET', url: '/api/ai/transcribe/status', headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: TranscribeStatus }>().data;
}

async function putSettings(e: Env, body: Record<string, unknown>) {
  const res = await e.app.inject({ method: 'PUT', url: '/api/ai/settings', headers: e.admin.writeHeaders, payload: body });
  expect(res.statusCode, res.body).toBe(200);
}

const lastUsage = (e: Env) => e.app.db.get<Record<string, unknown>>('SELECT * FROM ai_usage ORDER BY id DESC LIMIT 1');
const fileCount = (e: Env) => e.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM files')?.n ?? 0;

describe('phase-06-task-03 회의 녹음 받아쓰기', () => {
  test('phase-06-task-03 AC1: 데모 모드에서 녹음 업로드 → 예시 받아쓰기 글 → 그 글로 회의록 요약이 결정 사항·할 일로 나뉜다(녹음은 저장하지 않음)', async () => {
    const e = await makeEnv();
    const st = await status(e, e.staff);
    expect(st).toMatchObject({ state: 'ready', demo: true, provider: 'demo', maxBytes: 20 * MB });
    expect(st.exts).toEqual(['.m4a', '.mp3', '.wav', '.webm']);

    const r = await upload(e, e.staff, { name: '회의 녹음.m4a', data: fakeM4a() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.demo).toBe(true);
    expect(r.body.data.text).toBe(DEMO_TRANSCRIPT);
    expect(r.body.data.text.startsWith('[데모 응답]')).toBe(true);
    expect(r.body.data.usage.costKrw).toBe(0);
    expect(lastUsage(e)).toMatchObject({ feature: 'transcribe', provider: 'demo', demo: 1, status: 'ok', cost_krw: 0 });

    // 받아쓴 글을 그대로 회의록 요약에 넘긴다
    const m = await e.app.inject({ method: 'POST', url: '/api/ai/run', headers: e.staff.writeHeaders, payload: { feature: 'minutes', input: { notes: r.body.data.text } } });
    expect(m.statusCode, m.body).toBe(200);
    const extra = m.json<{ data: { extra: { decisions: string[]; todos: { text: string; role: string | null; due: string | null }[] } } }>().data.extra;
    expect(extra.decisions.some((d) => d.includes('30분으로 바꾸기로'))).toBe(true);
    expect(extra.todos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: '데스크', due: '2026-11-06' }),
        expect.objectContaining({ role: '치과위생사', due: '2026-11-07' }),
        expect.objectContaining({ role: '치과조무사', due: '2026-11-10' }),
      ]),
    );

    // 녹음 파일은 서버에 남지 않는다(files 줄 없음, 업로드 폴더 없음)
    expect(fileCount(e)).toBe(0);
    expect(fs.existsSync(path.join(e.dataDir, 'uploads'))).toBe(false);
  });

  test('phase-06-task-03 AC1: /api/ai/run(JSON)으로는 받아쓰기를 부를 수 없고, 확인 체크 없이 올리면 400, 녹음 형식이 아니면 415', async () => {
    const e = await makeEnv();
    const run = await e.app.inject({ method: 'POST', url: '/api/ai/run', headers: e.staff.writeHeaders, payload: { feature: 'transcribe', input: { audio: 'AAAA', mime: 'audio/m4a' } } });
    expect(run.statusCode).toBe(400);
    expect(run.json<ErrBody>().error?.fields?.['input.audio']).toBe('녹음 파일은 회의록 화면에서 올려 주세요.');

    const noCheck = await upload(e, e.staff, { name: 'a.m4a', data: fakeM4a() }, false);
    expect(noCheck.status).toBe(400);
    expect(noCheck.body.error?.message).toBe('환자 이야기가 들어간 녹음이 아닌지 확인하고 체크해 주세요.');

    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
    const fake = await upload(e, e.staff, { name: '녹음.m4a', data: exe });
    expect(fake.status).toBe(415);
    expect(fake.body.error?.message).toContain('M4A 녹음 파일이 아니에요');
    const txt = await upload(e, e.staff, { name: 'memo.txt', data: Buffer.from('hello') });
    expect(txt.status).toBe(415);
    expect(txt.body.error?.message).toBe('올릴 수 없는 파일 형식이에요. 녹음 파일(M4A·MP3·WAV·WEBM)만 올릴 수 있어요.');
    // 막힌 요청은 기록·비용이 없다
    expect(e.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ai_usage WHERE feature = 'transcribe'")?.n).toBe(0);
  });

  test('phase-06-task-03 AC2: 음성 미지원 공급자(Anthropic)면 상태가 비활성 안내이고, 올려도 공급자에 보내지 않고 403 AI_DISABLED', async () => {
    const e = await makeEnv();
    await putSettings(e, { provider: 'anthropic', keys: { anthropic: 'sk-ant-unit-ONLYFAKE-transcribe-7Qa1' } });
    const st = await status(e, e.staff);
    expect(st.state).toBe('unsupported');
    expect(st.demo).toBe(false);
    expect(st.message).toContain('지금 설정된 AI(Anthropic Claude)는 음성을 지원하지 않아요');
    const r = await upload(e, e.staff, { name: 'a.m4a', data: fakeM4a() });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('AI_DISABLED');
    expect(r.body.error?.message).toContain('음성을 지원하지 않아요');
    expect(e.fake.requests).toHaveLength(0);
  });

  test('phase-06-task-03 AC2: 관리자가 받아쓰기를 끄면 상태가 disabled이고 업로드는 403', async () => {
    const e = await makeEnv();
    await putSettings(e, { features: { transcribe: { enabled: false } } });
    expect((await status(e, e.staff)).state).toBe('disabled');
    const r = await upload(e, e.staff, { name: 'a.m4a', data: fakeM4a() });
    expect(r.status).toBe(403);
    expect(r.body.error?.code).toBe('AI_DISABLED');
  });

  test('phase-06-task-03 AC3: 20MB를 넘는 녹음은 413으로 거부하고, 딱 20MB는 받는다', async () => {
    const e = await makeEnv();
    const big = await upload(e, e.staff, { name: '긴 회의.m4a', data: fakeM4a(TRANSCRIBE_MAX_BYTES + 1) });
    expect(big.status).toBe(413);
    expect(big.body.error?.code).toBe('FILE_TOO_LARGE');
    expect(big.body.error?.message).toContain('20MB');
    const ok = await upload(e, e.staff, { name: '회의.m4a', data: fakeM4a(TRANSCRIBE_MAX_BYTES) });
    expect(ok.status).toBe(200);
    // 서비스 검사도 같은 기준(라우트를 거치지 않을 때)
    expect(() => checkAudio('a.m4a', fakeM4a(TRANSCRIBE_MAX_BYTES + 1))).toThrow(/20MB/);
    expect(checkAudio('a.MP3', Buffer.from('ID3\x04\x00\x00', 'latin1')).ext).toBe('.mp3');
    expect(checkAudio('a.webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0])).ext).toBe('.webm');
  });

  test('phase-06-task-03 OpenAI: 받아쓰기 API에 multipart(gpt-transcribe)로 보내고, 분 단위 비용을 기록하며 받아쓴 글의 개인정보를 가린다', async () => {
    const e = await makeEnv();
    await putSettings(e, { provider: 'openai', keys: { openai: 'sk-proj-unit-ONLYFAKE-transcribe-7Qa1' } });
    e.fake.setText('데스크: 예약 문자 고치기로 해요. 문의는 010-1234-5678로 받아요.');
    e.fake.setOpenaiUsage({ type: 'duration', seconds: 120 });
    const audio = fakeM4a();
    const r = await upload(e, e.staff, { name: '회의.m4a', data: audio });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const req = e.fake.requests[0];
    expect(req?.url).toBe('/v1/audio/transcriptions');
    expect(req?.headers.authorization).toBe('Bearer sk-proj-unit-ONLYFAKE-transcribe-7Qa1');
    const body = req?.body.toString('latin1') ?? '';
    expect(body).toMatch(/name="model"\r\n\r\ngpt-transcribe\r\n/);
    expect(body).toMatch(/name="response_format"\r\n\r\njson\r\n/);
    expect(body).toMatch(/name="file"; filename="meeting\.m4a"\r\nContent-Type: audio\/mp4/);
    expect(req?.body.includes(audio.subarray(0, 64))).toBe(true);

    expect(r.body.data.text).not.toContain('010-1234-5678');
    expect(r.body.data.privacy.notice).toBe('받아쓴 글에서 전화번호 1건을 가렸어요.');
    expect(r.body.data.model).toBe('gpt-transcribe');
    expect(r.body.data.usage.seconds).toBe(120);
    expect(r.body.data.usage.estimated).toBe(false);
    const usd = openaiAudioCostUsd(120);
    expect(usd).toBeCloseTo(0.009, 10);
    expect(r.body.data.usage.costKrw).toBeCloseTo(usd * FX, 8);
    expect(lastUsage(e)).toMatchObject({ feature: 'transcribe', provider: 'openai', model: 'gpt-transcribe', status: 'ok', demo: 0, estimated: 0 });
    expect(lastUsage(e)?.cost_krw as number).toBeCloseTo(usd * FX, 8);
  });

  test('phase-06-task-03 OpenAI: 공급자가 길이를 안 알려 주면 녹음 크기로 어림해 "추정"으로 기록하고, 공급자 오류는 쉬운 말로 돌려준다', async () => {
    const e = await makeEnv();
    await putSettings(e, { provider: 'openai', keys: { openai: 'sk-proj-unit-ONLYFAKE-transcribe-7Qa1' } });
    e.fake.setOpenaiUsage(null);
    const wav = fakeWav(30);
    expect(estimateSeconds('.wav', wav)).toBe(30);
    const r = await upload(e, e.staff, { name: 'a.wav', data: wav, type: 'audio/wav' });
    expect(r.status).toBe(200);
    expect(r.body.data.usage).toMatchObject({ seconds: 30, estimated: true });
    expect(r.body.data.usage.costKrw).toBeCloseTo(openaiAudioCostUsd(30) * FX, 8);

    e.fake.setStatus(401);
    const bad = await upload(e, e.staff, { name: 'a.m4a', data: fakeM4a() });
    expect(bad.status).toBe(502);
    expect(bad.body.error?.code).toBe('AI_AUTH');
    expect(JSON.stringify(bad.body)).not.toContain('7Qa1');
    expect(lastUsage(e)).toMatchObject({ feature: 'transcribe', status: 'error', error_code: 'AI_AUTH' });
  });

  test('phase-06-task-03 Gemini: 작은 녹음은 inlineData로 보내고 오디오 토큰 단가로 비용을 계산한다', async () => {
    const e = await makeEnv();
    await putSettings(e, { provider: 'gemini', keys: { gemini: 'AIza-unit-ONLYFAKE-transcribe-7Qa1' } });
    expect((await status(e, e.staff)).state).toBe('ready');
    const audio = fakeM4a();
    const r = await upload(e, e.staff, { name: '회의.m4a', data: audio });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(e.fake.requests).toHaveLength(1);
    const req = e.fake.requests[0];
    expect(req?.url).toBe('/v1beta/models/gemini-3.1-flash-lite:generateContent');
    expect(req?.headers['x-goog-api-key']).toBe('AIza-unit-ONLYFAKE-transcribe-7Qa1');
    const json = req?.json as { contents: { parts: Record<string, unknown>[] }[]; systemInstruction: { parts: { text: string }[] } };
    expect(json.contents[0]?.parts[0]).toEqual({ inlineData: { mimeType: 'audio/m4a', data: audio.toString('base64') } });
    expect(json.systemInstruction.parts[0]?.text).toContain('받아씁니다');
    const usd = geminiAudioCostUsd({ modelId: 'gemini-3.1-flash-lite', inputUsdPerM: 0.25, outputUsdPerM: 1.5, longThresholdTokens: null, longInputUsdPerM: null, longOutputUsdPerM: null }, { audioIn: 3840, textIn: 60, output: 500 });
    expect(usd).toBeCloseTo((3840 * 0.5 + 60 * 0.25 + 500 * 1.5) / 1e6, 12);
    expect(r.body.data.usage).toMatchObject({ seconds: 120, estimated: false });
    expect(r.body.data.usage.costKrw).toBeCloseTo(usd * FX, 8);
    expect(lastUsage(e)).toMatchObject({ provider: 'gemini', model: 'gemini-3.1-flash-lite', input_tokens: 3900, output_tokens: 500 });
  });

  test('phase-06-task-03 Gemini: 큰 녹음은 Files API로 올려 fileData로 가리키고, 받아쓴 뒤 공급자 쪽 파일도 지운다', async () => {
    const e = await makeEnv();
    await putSettings(e, { provider: 'gemini', keys: { gemini: 'AIza-unit-ONLYFAKE-transcribe-7Qa1' } });
    const audio = fakeM4a(GEMINI_INLINE_MAX_BYTES + 1024);
    const r = await upload(e, e.staff, { name: '긴 회의.m4a', data: audio });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(e.fake.requests.map((q) => `${q.method} ${q.url}`)).toEqual([
      'POST /upload/v1beta/files',
      'POST /upload-session/s1',
      'POST /v1beta/models/gemini-3.1-flash-lite:generateContent',
      'DELETE /v1beta/files/fakeaudio1',
    ]);
    const [start, put, gen] = e.fake.requests;
    expect(start?.headers['x-goog-upload-protocol']).toBe('resumable');
    expect(start?.headers['x-goog-upload-header-content-length']).toBe(String(audio.length));
    // 일회용 올리기 주소에는 키를 붙이지 않는다
    expect(put?.headers['x-goog-api-key']).toBeUndefined();
    expect(put?.headers['x-goog-upload-command']).toBe('upload, finalize');
    expect(put?.body.length).toBe(audio.length);
    const parts = (gen?.json as { contents: { parts: Record<string, unknown>[] }[] }).contents[0]?.parts;
    expect(parts?.[0]).toEqual({ fileData: { mimeType: 'audio/m4a', fileUri: `${e.fake.url}/v1beta/files/fakeaudio1` } });
  });

  test('phase-06-task-03 예산: 이번 달 예산을 다 쓰면 상태가 budget이고 업로드는 402로 막힌다(공급자 호출 없음)', async () => {
    const e = await makeEnv();
    await putSettings(e, { provider: 'openai', keys: { openai: 'sk-proj-unit-ONLYFAKE-transcribe-7Qa1' }, monthlyBudgetKrw: 10 });
    e.fake.setOpenaiUsage({ type: 'duration', seconds: 600 });
    // 600초 = 10분 × $0.0045 × 1450 ≈ 65원 → 예산 10원을 넘긴다
    const first = await upload(e, e.staff, { name: 'a.m4a', data: fakeM4a() });
    expect(first.status).toBe(200);
    expect(first.body.data.usage.costKrw).toBeGreaterThan(10);
    expect((await status(e, e.staff)).state).toBe('budget');
    const n = e.fake.requests.length;
    const second = await upload(e, e.staff, { name: 'a.m4a', data: fakeM4a() });
    expect(second.status).toBe(402);
    expect(second.body.error?.code).toBe('AI_BUDGET_EXCEEDED');
    expect(e.fake.requests.length).toBe(n);
  });
});

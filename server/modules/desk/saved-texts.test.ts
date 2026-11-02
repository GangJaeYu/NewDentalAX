// 이 파일이 하는 일: 데스크 AI(응대 스크립트·리뷰 답글·템플릿)와 보관 문구 API(saved-texts.ts)를 실제 라우트와 DB로 확인한다(phase-03-task-05 AC1~AC5).
// AI는 키가 없는 데모 공급자로 부른다(실제 API 호출 없음). 병원 정보 저장 → 데모 스크립트에 반영, 리뷰 속 전화번호 가림·안내, 말투별 답글 2개 이상과 저장,
// 템플릿의 개인 정보 치환자 거부, 내 문구/공용 문구 권한, 검색·분류, 데모 seed를 본다. 데이터는 작업 사본 안 .tmp/ 임시 폴더만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { defaultClinic } from '../../../shared/schemas/admin.ts';
import { checkReplyFacts, REVIEW_TONES, type SavedText } from '../../../shared/desk-texts.ts';
import { featureModule } from '../../ai/features/index.ts';
import type { PromptContext } from '../../ai/features/types.ts';
import { DEMO_SAVED_TEXTS } from './saved-texts-seed.ts';
import { seedDemo, tables } from './seed.ts';

const START = '2026-11-02T09:00:00+09:00';

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

async function makeApp() {
  tmp = makeTmpDir('dentalax-saved-texts-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock, ai: { demoStreamDelayMs: 1 } });
  return { app, clock };
}

async function runAi(a: FastifyInstance, who: TestLogin, feature: string, input: unknown) {
  return a.inject({ method: 'POST', url: '/api/ai/run', headers: who.writeHeaders, payload: { feature, input } });
}

async function saveClinic(a: FastifyInstance, admin: TestLogin, patch: Record<string, unknown>) {
  const res = await a.inject({ method: 'PUT', url: '/api/settings/clinic', headers: admin.writeHeaders, payload: { ...defaultClinic('하늘숲치과'), ...patch } });
  expect(res.statusCode).toBe(200);
}

async function create(a: FastifyInstance, who: TestLogin, body: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: '/api/saved-texts', headers: who.writeHeaders, payload: body });
}

async function list(a: FastifyInstance, who: TestLogin, query = ''): Promise<SavedText[]> {
  const res = await a.inject({ method: 'GET', url: `/api/saved-texts${query}`, headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: SavedText[] }>().data;
}

describe('전화 응대 스크립트(script)', () => {
  test('phase-03-task-05 AC1: 병원 정보에 토요일 9:30~14:00을 저장하면 데모 스크립트 결과에 그 값이 들어간다(데모도 병원 정보 치환)', async () => {
    const { app: a } = await makeApp();
    const admin = loginAs(a, 'admin');
    const staff = loginAs(a, 'staff');
    const base = defaultClinic('하늘숲치과').hours;

    // 먼저 다른 값(토 10:00~13:00)을 저장하면 그 값이 나온다 → 기본값이 아니라 저장값을 읽는다는 뜻
    await saveClinic(a, admin, { hours: { ...base, sat: { open: '10:00', close: '13:00', lunch: null } }, parking: '건물 지하 1~2층, 1시간 무료' });
    const first = await runAi(a, staff, 'script', { situation: '진료시간 문의', tone: '친절하고 차분하게' });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.demo).toBe(true);
    expect(first.json().data.text).toContain('토요일 10:00~13:00');
    expect(first.json().data.text).toContain('하늘숲치과');

    // 토요일 9:30~14:00으로 저장 → 진료시간 문의·주차 문의 모두 결과에 그 값이 들어간다
    await saveClinic(a, admin, { hours: { ...base, sat: { open: '09:30', close: '14:00', lunch: null } }, parking: '건물 지하 1~2층, 1시간 무료' });
    const hours = (await runAi(a, staff, 'script', { situation: '진료시간 문의' })).json().data.text as string;
    expect(hours.startsWith('[데모 응답]')).toBe(true);
    expect(hours).toContain('토요일 9:30~14:00');
    expect(hours).not.toContain('토요일 10:00~13:00');
    const parking = (await runAi(a, staff, 'script', { situation: '주차 문의', tone: '밝고 상냥하게' })).json().data.text as string;
    expect(parking).toContain('건물 지하 1~2층, 1시간 무료');
    expect(parking).toContain('토요일 9:30~14:00');
    expect(parking).toContain('좋은 하루 보내세요');
  });

  test('phase-03-task-05 AC1: 공급자에게 보내는 프롬프트에도 병원 정보가 글로 들어간다(JSON 원문이 아님)', () => {
    const ctx: PromptContext = {
      clinic: { name: '하늘숲치과', phone: '02-123-4567', hours: defaultClinic().hours, parking: '지하 주차장' },
      user: { name: '직원', role: 'staff', jobType: 'desk' },
      today: '2026-11-02',
    };
    const mod = featureModule('script');
    const p = mod.buildPrompt(mod.inputSchema.parse({ situation: '주차 문의', tone: '간결하고 정중하게' }), ctx);
    expect(p.system).toContain('진료시간: 월~금 9:30~18:30(점심시간 13:00~14:00), 토요일 9:30~14:00, 일요일 휴진');
    expect(p.system).toContain('주차: 지하 주차장');
    expect(p.system).not.toContain('"open"');
    expect(p.user).toContain('말투: 간결하고 정중하게');
  });
});

describe('리뷰 답글(review_reply)', () => {
  test('phase-03-task-05 AC2: 리뷰에 전화번호가 있으면 가린 뒤 처리되고 "전화번호 1건을 가리고" 안내가 결과에 붙는다', async () => {
    const { app: a } = await makeApp();
    const staff = loginAs(a, 'staff');
    const res = await runAi(a, staff, 'review_reply', { review: '대기가 너무 길었어요. 010-1234-5678로 연락 주세요.', tones: ['정중하게', '간결하게'] });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.privacy.redacted).toBe(true);
    expect(data.privacy.findings).toEqual([expect.objectContaining({ type: 'phone', count: 1 })]);
    expect(data.privacy.notice).toMatch(/전화번호 1건을 가리고/);
    expect(data.text).not.toContain('010-1234-5678');
    // 사용 기록에도 "가림"이 남고 원문 번호는 남지 않는다
    const usage = a.db.get<{ privacy: string }>("SELECT privacy FROM ai_usage WHERE feature = 'review_reply' ORDER BY id DESC LIMIT 1");
    expect(usage?.privacy).toContain('phone');
    expect(usage?.privacy).not.toContain('5678');
  });

  test('phase-03-task-05 AC3: 말투 2~3개를 고르면 말투별로 서로 다른 답글 초안이 오고, 진료 사실 확인 표현이 없다', async () => {
    const { app: a } = await makeApp();
    const staff = loginAs(a, 'staff');
    const res = await runAi(a, staff, 'review_reply', { review: '직원분들이 정말 친절하고 설명도 자세했어요.', tones: [...REVIEW_TONES] });
    expect(res.statusCode).toBe(200);
    const replies = res.json().data.extra.replies as Array<{ tone: string; text: string }>;
    expect(replies.map((r) => r.tone)).toEqual(['정중하게', '따뜻하게', '간결하게']);
    expect(new Set(replies.map((r) => r.text)).size).toBe(3);
    for (const r of replies) expect(checkReplyFacts(r.text), r.text).toEqual([]);
    // 불만 리뷰는 사과하는 답글
    const sorry = (await runAi(a, staff, 'review_reply', { review: '대기 시간이 너무 길어서 불편했어요.', tones: ['정중하게', '따뜻하게'] })).json().data.extra.replies as Array<{ text: string }>;
    expect(sorry).toHaveLength(2);
    for (const r of sorry) expect(r.text).toMatch(/죄송|사과/);
    // 말투는 2개 이상 골라야 한다
    const one = await runAi(a, staff, 'review_reply', { review: '좋아요', tones: ['정중하게'] });
    expect(one.statusCode).toBe(400);
    expect(one.json().error.fields['input.tones']).toBe('말투를 2개 이상 골라 주세요.');
  });

  test('phase-03-task-05 AC3: 답글 초안을 보관함에 저장하고 다시 불러온다', async () => {
    const { app: a } = await makeApp();
    const staff = loginAs(a, 'staff');
    const saved = await create(a, staff, { kind: 'review_reply', category: '좋은 리뷰', title: '친절 칭찬 답글(따뜻하게)', body: '따뜻한 리뷰 감사합니다.', meta: { tone: '따뜻하게' } });
    expect(saved.statusCode).toBe(201);
    expect(saved.json<{ data: SavedText }>().data).toMatchObject({ kind: 'review_reply', shared: false, canEdit: true, meta: { tone: '따뜻하게' }, createdBy: { id: staff.userId } });
    const rows = await list(a, staff, '?kind=review_reply');
    expect(rows.map((r) => r.title)).toEqual(['친절 칭찬 답글(따뜻하게)']);
  });
});

describe('문자·안내문 템플릿(template)', () => {
  test('phase-03-task-05 AC5: 템플릿에 {이름}·{환자명} 같은 개인 정보 치환자는 저장되지 않고, AI 데모 템플릿에도 쓰이지 않는다', async () => {
    const { app: a } = await makeApp();
    const staff = loginAs(a, 'staff');
    const bad = await create(a, staff, { kind: 'template', category: '예약 안내', title: '이름 넣은 문자', body: '{이름}님 {날짜} 예약입니다.' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.body).toMatch(/\{이름\} 같은 환자 개인 정보 치환자는 쓸 수 없어요/);
    const ok = await create(a, staff, { kind: 'template', category: '예약 안내', title: '예약 안내', body: '[{병원이름}] {날짜} {시간} 예약 안내입니다. 문의 {대표번호}' });
    expect(ok.statusCode).toBe(201);
    const id = ok.json<{ data: SavedText }>().data.id;
    const patch = await a.inject({ method: 'PATCH', url: `/api/saved-texts/${id}`, headers: staff.writeHeaders, payload: { body: '{환자명}님 안녕하세요' } });
    expect(patch.statusCode).toBe(400);

    for (const length of ['short', 'medium', 'long']) {
      const res = await runAi(a, staff, 'template', { purpose: '예약 하루 전 안내', length });
      expect(res.statusCode).toBe(200);
      const text = res.json().data.text as string;
      expect(text).toContain('{병원이름}');
      expect(text).not.toMatch(/\{(이름|환자명|성함)\}/);
    }
    const prompt = featureModule('template').buildPrompt({ purpose: '휴진 안내', length: 'short' }, { clinic: null, user: { name: '직원', role: 'staff', jobType: 'desk' }, today: '2026-11-02' });
    expect(prompt.system).toContain('{진료시간}(진료시간)');
    expect(prompt.system).toMatch(/환자 이름·연락처 같은 개인 정보 치환자\(\{이름\} 등\)는 쓰지 않고/);
  });
});

describe('보관함 권한·검색', () => {
  test('phase-03-task-05 AC3: 내 문구는 나만 보고 고치며, 공용 문구는 실장 이상만 만들고 고친다', async () => {
    const { app: a } = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const staff2 = loginAs(a, 'staff');

    const mine = (await create(a, staff, { kind: 'script', category: '주차 문의', title: '내 주차 응대', body: '직원: 지하 주차장을 이용해 주세요.' })).json<{ data: SavedText }>().data;
    // 다른 직원은 내 문구를 보지 못한다(목록에도 없고 직접 열면 404)
    expect(await list(a, staff2, '?kind=script')).toEqual([]);
    expect((await a.inject({ method: 'GET', url: `/api/saved-texts/${mine.id}`, headers: staff2.headers })).statusCode).toBe(404);
    expect((await a.inject({ method: 'DELETE', url: `/api/saved-texts/${mine.id}`, headers: staff2.writeHeaders })).statusCode).toBe(404);

    // 직원은 공용 문구를 만들 수 없다
    const denied = await create(a, staff, { kind: 'script', title: '공용 시도', body: '본문', shared: true });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toMatch(/실장 이상만/);
    // 실장이 만든 공용 문구는 모두 보지만, 직원은 고치거나 지우지 못한다
    const shared = (await create(a, manager, { kind: 'script', category: '진료시간 문의', title: '공용 진료시간 응대', body: '직원: 진료시간 안내드립니다.', shared: true })).json<{ data: SavedText }>().data;
    expect(shared.shared).toBe(true);
    const seen = await list(a, staff2, '?kind=script');
    expect(seen.map((t) => [t.title, t.canEdit])).toEqual([['공용 진료시간 응대', false]]);
    expect((await a.inject({ method: 'PATCH', url: `/api/saved-texts/${shared.id}`, headers: staff.writeHeaders, payload: { title: '바꿈' } })).statusCode).toBe(403);
    expect((await a.inject({ method: 'DELETE', url: `/api/saved-texts/${shared.id}`, headers: staff.writeHeaders })).statusCode).toBe(403);
    // 실장은 고칠 수 있고, 감사 기록이 남는다
    const edited = await a.inject({ method: 'PATCH', url: `/api/saved-texts/${shared.id}`, headers: manager.writeHeaders, payload: { title: '공용 진료시간 응대(수정)' } });
    expect(edited.statusCode).toBe(200);
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('savedtext.create', 'savedtext.update')")?.n).toBe(2);
    // 직원은 자기 문구를 고치고 지운다
    expect((await a.inject({ method: 'PATCH', url: `/api/saved-texts/${mine.id}`, headers: staff.writeHeaders, payload: { category: '위치·교통 문의' } })).json().data.category).toBe('위치·교통 문의');
    expect((await a.inject({ method: 'DELETE', url: `/api/saved-texts/${mine.id}`, headers: staff.writeHeaders })).statusCode).toBe(204);
    expect((await list(a, staff, '?kind=script')).map((t) => t.title)).toEqual(['공용 진료시간 응대(수정)']);
  });

  test('phase-03-task-05 AC3: 저장한 스크립트를 제목·본문·분류로 검색하고 분류로 거른다', async () => {
    const { app: a, clock } = await makeApp();
    const staff = loginAs(a, 'staff');
    for (const [category, title, body] of [
      ['주차 문의', '주차 응대', '지하 주차장 1시간 무료'],
      ['진료시간 문의', '토요일 진료 안내', '토요일은 2시까지 진료'],
      ['예약 변경 안내', '예약 변경', '원하시는 날짜를 말씀해 주세요'],
    ]) {
      expect((await create(a, staff, { kind: 'script', category, title, body })).statusCode).toBe(201);
      clock.advance(60_000);
    }
    expect((await list(a, staff, '?kind=script')).map((t) => t.title)).toEqual(['예약 변경', '토요일 진료 안내', '주차 응대']);
    expect((await list(a, staff, `?kind=script&q=${encodeURIComponent('주차')}`)).map((t) => t.title)).toEqual(['주차 응대']);
    expect((await list(a, staff, `?kind=script&q=${encodeURIComponent('2시까지')}`)).map((t) => t.title)).toEqual(['토요일 진료 안내']);
    expect((await list(a, staff, `?kind=script&category=${encodeURIComponent('예약 변경 안내')}`)).map((t) => t.title)).toEqual(['예약 변경']);
    // %·_ 는 글자 그대로 찾는다
    expect(await list(a, staff, `?kind=script&q=${encodeURIComponent('%')}`)).toEqual([]);
    // 잘못된 종류는 400
    expect((await a.inject({ method: 'GET', url: '/api/saved-texts?kind=letter', headers: staff.headers })).statusCode).toBe(400);
  });

  test('phase-03-task-05 데모 seed: 공용 스크립트 3·템플릿 4·답글 1이 들어가고, 템플릿에 개인 정보 치환자가 없다', async () => {
    const { app: a, clock } = await makeApp();
    loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    expect(tables).toContain('saved_texts');
    seedDemo(a.db, { clock, scale: 1 });
    seedDemo(a.db, { clock, scale: 1 }); // 두 번 불러도 한 번만 들어간다
    const all = await list(a, staff);
    expect(all).toHaveLength(DEMO_SAVED_TEXTS.length);
    expect(all.filter((t) => t.kind === 'script')).toHaveLength(3);
    expect(all.filter((t) => t.kind === 'template')).toHaveLength(4);
    expect(all.every((t) => t.shared)).toBe(true);
    for (const t of all.filter((x) => x.kind === 'template')) expect(t.body).not.toMatch(/\{(이름|환자명|성함)\}/);
  });
});

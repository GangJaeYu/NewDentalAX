// 이 파일이 하는 일: 신규 직원 온보딩 API(onboarding.ts·onboarding-routes.ts)와 AI 온보딩 초안(server/ai/features/onboarding.ts, FR-083)을 실제 라우트와 DB로 확인한다(phase-04-task-02 AC3).
// AI(데모)로 치과위생사 초안 → 템플릿(source ai) 저장 → 신규 직원에게 멘토와 함께 배정 → 직원·멘토가 항목 체크 → 두 사람이 보는 진행률 %가 같이 바뀌는지 본다.
// 권한(템플릿·배정은 실장 이상, 체크는 본인·멘토만, 목록은 본인·멘토 것만)과 입력 검사도 본다. 공급자는 데모(키 없음)이고 실제 AI 호출은 없다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { demoItems } from '../../ai/features/onboarding.ts';
import { progressPercent, type OnboardingAssignment, type OnboardingTemplate } from '../../../shared/schemas/onboarding.ts';

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
  tmp = makeTmpDir('dentalax-onboarding-');
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock: manualClock(START) });
  return app;
}

async function assignments(a: FastifyInstance, who: TestLogin): Promise<OnboardingAssignment[]> {
  const res = await a.inject({ method: 'GET', url: '/api/onboarding/assignments', headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: OnboardingAssignment[] }>().data;
}

async function check(a: FastifyInstance, who: TestLogin, id: number, idx: number, done = true) {
  return a.inject({ method: 'POST', url: `/api/onboarding/assignments/${id}/items/${idx}`, headers: who.writeHeaders, payload: { done } });
}

describe('AI 초안 → 템플릿 → 배정 → 진행률', () => {
  test('phase-04-task-02 AC3: AI(데모)로 치과위생사 온보딩 초안을 만들어 템플릿으로 저장하고, 배정한 뒤 체크하면 직원·멘토 모두에게 같은 진행률이 보인다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const newbie = loginAs(a, 'staff');
    const mentor = loginAs(a, 'staff');
    const outsider = loginAs(a, 'staff');

    // 1) AI 초안(데모 공급자)
    const ai = await a.inject({ method: 'POST', url: '/api/ai/run', headers: manager.writeHeaders, payload: { feature: 'onboarding', input: { jobType: '치과위생사' } } });
    expect(ai.statusCode, ai.body).toBe(200);
    const result = ai.json<{ data: { text: string; demo: boolean; extra: { items: string[] } } }>().data;
    expect(result.demo).toBe(true);
    expect(result.text).toContain('[데모 응답]');
    const items = result.extra.items;
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items.some((s) => s.includes('스케일링'))).toBe(true);

    // 2) 템플릿으로 저장(화면처럼 "[데모 응답]" 표시를 빼고 저장)
    const clean = items.map((s) => s.replace('[데모 응답]', '').trim());
    const saved = await a.inject({
      method: 'POST',
      url: '/api/onboarding/templates',
      headers: manager.writeHeaders,
      payload: { jobType: 'hygienist', title: '치과위생사 온보딩(AI 초안)', items: clean, source: 'ai' },
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const tpl = saved.json<{ data: OnboardingTemplate }>().data;
    expect(tpl).toMatchObject({ jobType: 'hygienist', source: 'ai', active: true, items: clean });

    // 3) 신규 직원에게 배정(멘토 지정)
    const assign = await a.inject({ method: 'POST', url: '/api/onboarding/assignments', headers: manager.writeHeaders, payload: { userId: newbie.userId, templateId: tpl.id, mentorId: mentor.userId } });
    expect(assign.statusCode, assign.body).toBe(201);
    const asg = assign.json<{ data: OnboardingAssignment }>().data;
    expect(asg).toMatchObject({ startedOn: '2026-11-02', done: 0, total: clean.length, percent: 0, relation: 'viewer', canCheck: false });

    // 4) 직원이 2개, 멘토가 1개 체크 → 둘 다 같은 진행률
    for (const idx of [0, 1]) expect((await check(a, newbie, asg.id, idx)).statusCode).toBe(200);
    const byMentor = await check(a, mentor, asg.id, 2);
    expect(byMentor.statusCode).toBe(200);
    const expected = progressPercent(3, clean.length);
    expect(byMentor.json<{ data: OnboardingAssignment }>().data).toMatchObject({ done: 3, percent: expected, relation: 'mentor' });

    const mine = await assignments(a, newbie);
    const theirs = await assignments(a, mentor);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: asg.id, percent: expected, done: 3, relation: 'self', canCheck: true });
    expect(theirs[0]).toMatchObject({ id: asg.id, percent: expected, done: 3, relation: 'mentor', canCheck: true });
    expect(mine[0]?.items[2]?.doneBy?.id).toBe(mentor.userId);
    expect((await assignments(a, manager))[0]?.percent).toBe(expected);

    // 5) 해제하면 다시 줄어든다. 상관없는 직원은 보지도, 체크하지도 못한다
    const undo = await check(a, newbie, asg.id, 1, false);
    expect(undo.json<{ data: OnboardingAssignment }>().data).toMatchObject({ done: 2, percent: progressPercent(2, clean.length) });
    expect((await assignments(a, mentor))[0]?.percent).toBe(progressPercent(2, clean.length));
    expect(await assignments(a, outsider)).toEqual([]);
    expect((await check(a, outsider, asg.id, 3)).statusCode).toBe(403);
    expect((await a.inject({ method: 'GET', url: `/api/onboarding/assignments/${asg.id}`, headers: outsider.headers })).statusCode).toBe(404);
    // 실장도 멘토가 아니면 체크하지 않는다(본인·멘토만)
    expect((await check(a, manager, asg.id, 3)).statusCode).toBe(403);
    // 없는 항목 번호는 404
    expect((await check(a, newbie, asg.id, clean.length)).statusCode).toBe(404);
  });

  test('phase-04-task-02 AC3: 진행률 계산과 직무별 데모 항목', () => {
    expect([progressPercent(0, 8), progressPercent(3, 8), progressPercent(8, 8), progressPercent(1, 3), progressPercent(0, 0)]).toEqual([0, 38, 100, 33, 0]);
    expect(demoItems('치과위생사').some((s) => s.includes('스케일링'))).toBe(true);
    expect(demoItems('데스크').some((s) => s.includes('예약'))).toBe(true);
    expect(demoItems('간호조무사').some((s) => s.includes('기구 세팅'))).toBe(true);
    expect(demoItems('방사선사')[3]).toContain('방사선사');
  });
});

describe('권한과 입력 검사', () => {
  test('phase-04-task-02: 직원은 템플릿을 보거나 만들 수 없고 배정도 못 한다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const other = loginAs(a, 'staff');
    expect((await a.inject({ method: 'GET', url: '/api/onboarding/templates', headers: staff.headers })).statusCode).toBe(403);
    expect((await a.inject({ method: 'POST', url: '/api/onboarding/templates', headers: staff.writeHeaders, payload: { jobType: 'desk', title: 'x', items: ['a'] } })).statusCode).toBe(403);
    const tpl = (
      await a.inject({ method: 'POST', url: '/api/onboarding/templates', headers: manager.writeHeaders, payload: { jobType: 'desk', title: '데스크 첫 주', items: ['예약 받기', ' ', '전화 응대'] } })
    ).json<{ data: OnboardingTemplate }>().data;
    expect(tpl.items).toEqual(['예약 받기', '전화 응대']);
    expect((await a.inject({ method: 'POST', url: '/api/onboarding/assignments', headers: staff.writeHeaders, payload: { userId: other.userId, templateId: tpl.id, mentorId: staff.userId } })).statusCode).toBe(
      403,
    );
    // 항목 없음·같은 사람 멘토·같은 템플릿 두 번은 저장되지 않는다
    const empty = await a.inject({ method: 'POST', url: '/api/onboarding/templates', headers: manager.writeHeaders, payload: { jobType: 'desk', title: '빈 목록', items: ['  '] } });
    expect(empty.statusCode).toBe(400);
    const same = await a.inject({ method: 'POST', url: '/api/onboarding/assignments', headers: manager.writeHeaders, payload: { userId: staff.userId, templateId: tpl.id, mentorId: staff.userId } });
    expect(same.statusCode).toBe(400);
    expect(same.json<{ error: { fields: Record<string, string> } }>().error.fields.mentorId).toContain('다른 사람');
    const ok = await a.inject({ method: 'POST', url: '/api/onboarding/assignments', headers: manager.writeHeaders, payload: { userId: staff.userId, templateId: tpl.id, mentorId: other.userId, startedOn: '2026-11-03' } });
    expect(ok.statusCode).toBe(201);
    expect((await a.inject({ method: 'POST', url: '/api/onboarding/assignments', headers: manager.writeHeaders, payload: { userId: staff.userId, templateId: tpl.id, mentorId: other.userId } })).statusCode).toBe(409);

    // 템플릿을 고쳐도 이미 배정된 항목은 그대로
    const patched = await a.inject({ method: 'PATCH', url: `/api/onboarding/templates/${tpl.id}`, headers: manager.writeHeaders, payload: { items: ['새 항목'] } });
    expect(patched.json<{ data: OnboardingTemplate }>().data).toMatchObject({ items: ['새 항목'], assignedCount: 1 });
    expect((await assignments(a, staff))[0]?.items.map((i) => i.text)).toEqual(['예약 받기', '전화 응대']);

    // 배정 지우기(실장 이상)
    const id = ok.json<{ data: OnboardingAssignment }>().data.id;
    expect((await a.inject({ method: 'DELETE', url: `/api/onboarding/assignments/${id}`, headers: staff.writeHeaders })).statusCode).toBe(403);
    expect((await a.inject({ method: 'DELETE', url: `/api/onboarding/assignments/${id}`, headers: manager.writeHeaders })).statusCode).toBe(200);
    expect(await assignments(a, staff)).toEqual([]);
  });
});

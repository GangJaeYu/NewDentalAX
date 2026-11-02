// 이 파일이 하는 일: FR-090 AC2 알림 종류 6가지(연차 신청·결과, 재고 부족·유효기간, 점검·법정 일정, 새 공지, 멸균 불합격, AI 예산)가
// 실제 업무 API와 서버에 등록된 알림 찾기(scanner)로 모두 만들어지고, 올바른 사람에게만 가는지 한 앱에서 함께 확인한다(phase-04-task-05 AC1).
// 모듈별 시험은 scanner를 직접 넘겨 돌리지만, 여기서는 buildApp이 등록부에 넣은 scanner만으로 runNotifyScan을 돌려 "등록 빠짐"도 잡는다.
// 요청은 fastify.inject, 시간은 manualClock(2026-11-02 09:00 KST)을 쓴다. AI는 데모 공급자라 실제 API를 부르지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { manualClock, type ManualClock } from '../lib/clock.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../tests/helpers/auth.ts';
import { EXPECTED_NOTIFY_SCANNERS, listNotifyScanners, missingNotifyScanners, NOTIFY_SOURCES, runNotifyScan } from './notify-job.ts';
import { NOTIFICATION_TYPES } from '../../shared/schemas/notifications.ts';

const START = '2026-11-02T09:00:00+09:00';

/** FR-090 AC2가 말하는 알림 종류(영문 이름) */
const AC2_TYPES = ['leave_requested', 'leave_result', 'stock_low', 'stock_expiry', 'equipment_due', 'legal_due', 'notice', 'sterilizer_fail', 'ai_budget'] as const;

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

interface Env {
  app: FastifyInstance;
  clock: ManualClock;
  admin: TestLogin;
  manager: TestLogin;
  staff: TestLogin;
  staff2: TestLogin;
}

async function makeEnv(): Promise<Env> {
  tmp = makeTmpDir('dentalax-notif-src-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return { app, clock, admin: loginAs(app, 'admin'), manager: loginAs(app, 'manager'), staff: loginAs(app, 'staff'), staff2: loginAs(app, 'staff') };
}

/** 쓰기 요청을 보내고 상태 코드가 기대와 같은지 확인한 뒤 data를 돌려준다 */
async function send<T>(env: Env, who: TestLogin, method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>, status = 201): Promise<T> {
  const res = await env.app.inject({ method, url, headers: who.writeHeaders, payload });
  expect(res.statusCode, `${method} ${url} ${res.body}`).toBe(status);
  return res.json<{ data: T }>().data;
}

/** 한 사람이 받은 알림 종류(중복 없이, 이름 순) */
function typesOf(env: Env, who: TestLogin): string[] {
  return env.app.db.all<{ type: string }>('SELECT DISTINCT type FROM notifications WHERE user_id = ? ORDER BY type', [who.userId]).map((r) => r.type);
}

/** AC2 종류만 남긴 것 */
const ac2Only = (types: string[]) => types.filter((t) => (AC2_TYPES as readonly string[]).includes(t)).sort();

/** 6가지 알림을 모두 일으킨다(즉시 알림은 API로, 기한형은 등록부의 scanner로) */
async function triggerAll(env: Env): Promise<void> {
  // ① 연차 신청 → 실장 이상 / 승인 → 신청자
  const leave = await send<{ id: number }>(env, env.staff, 'POST', '/api/leave', { type: 'half_am', startOn: '2026-11-06', reason: '은행 업무' });
  await send(env, env.manager, 'POST', `/api/leave/${leave.id}/decide`, { approve: true }, 200);

  // ② 재고 부족(출고 즉시) · 유효기간 임박(scanner)
  const glove = await send<{ item: { id: number } }>(env, env.manager, 'POST', '/api/items', { name: '니트릴 글러브 M', category: '소모품', unit: '박스', par: 6 });
  await send(env, env.staff, 'POST', '/api/inventory/moves', { itemId: glove.item.id, type: 'in', qty: 8, unitPrice: 8400 });
  await send(env, env.staff, 'POST', '/api/inventory/moves', { itemId: glove.item.id, type: 'out', qty: 3 });
  const gel = await send<{ item: { id: number } }>(env, env.manager, 'POST', '/api/items', { name: '표면 마취 젤', category: '약품', unit: '개', par: 1, trackExpiry: true });
  await send(env, env.manager, 'POST', '/api/inventory/moves', { itemId: gel.item.id, type: 'in', qty: 3, expiryOn: '2026-11-14' });

  // ③ 장비 점검 임박(scanner) · 멸균 불합격(즉시)
  const eq = await send<{ id: number }>(env, env.manager, 'POST', '/api/equipment', { name: '오토클레이브 1호기', kind: 'sterilizer', inspectCycleMonths: 6 });
  await send(env, env.staff, 'POST', `/api/equipment/${eq.id}/logs`, { date: '2026-05-10', kind: 'inspection', content: '정기 점검' });
  await send(env, env.staff, 'POST', '/api/sterilizer-logs', { equipmentId: eq.id, date: '2026-11-02', testType: 'bi', cycleNo: '1002', tempC: 134, pressureKpa: 216, minutes: 4, result: 'fail' });

  // ④ 법정 일정 임박(scanner): TLD 3개월 주기를 2026-08-10에 했다 → 2026-11-10, D-8
  const legal = await env.app.inject({ method: 'GET', url: '/api/legal-tasks', headers: env.manager.headers });
  const tld = legal.json<{ data: { items: { id: number; title: string }[] } }>().data.items.find((t) => t.title === '개인 피폭선량 측정(TLD)');
  expect(tld, '기본 법정 일정에 TLD가 있어야 한다').toBeDefined();
  await send(env, env.manager, 'POST', `/api/legal-tasks/${tld?.id}/done`, { doneOn: '2026-08-10' }, 200);

  // ⑤ 새 공지(즉시, 전원)
  await send(env, env.manager, 'POST', '/api/posts', { kind: 'notice', category: '일반', title: '11월 회식 안내', body: '금요일 저녁' });

  // ⑥ AI 예산 80%(데모 호출 뒤 누적 32,000 / 40,000원)
  env.app.db.run("INSERT INTO ai_usage (at, user_id, feature, provider, model, cost_usd, cost_krw, status) VALUES (?, NULL, 'quick', 'anthropic', 'claude-haiku-5-5', 0, 32000, 'ok')", [env.clock.now().toISOString()]);
  const ai = await env.app.inject({ method: 'POST', url: '/api/ai/run', headers: env.staff.writeHeaders, payload: { feature: 'quick', input: '오늘 할 일 정리' } });
  expect(ai.statusCode, ai.body).toBe(200);

  // 기한형: 서버가 매시 하는 것처럼 등록부 전체를 돌린다(scanner를 직접 넘기지 않음)
  const scan = await runNotifyScan(env.app.db, env.clock);
  expect(scan.errors).toEqual([]);
}

describe('FR-090 AC2 알림 종류 점검', () => {
  test('phase-04-task-05 AC1: 알림 종류 표가 AC2 6가지를 모두 덮고, 서버를 만들면 기한형 scanner가 빠짐없이 등록된다', async () => {
    const categories = new Set(NOTIFY_SOURCES.map((s) => s.category));
    expect([...categories]).toEqual(['연차 신청·결과', '재고 부족·유효기간', '점검·법정 일정 임박', '새 공지', '멸균 불합격', 'AI 예산 경고']);
    expect([...new Set(NOTIFY_SOURCES.map((s) => s.type))].sort()).toEqual([...AC2_TYPES].sort());
    for (const s of NOTIFY_SOURCES) {
      expect(Object.hasOwn(NOTIFICATION_TYPES, s.type), s.type).toBe(true);
      expect(fs.existsSync(path.resolve(import.meta.dirname, '..', '..', s.where)), s.where).toBe(true);
    }
    await makeEnv();
    const names = listNotifyScanners().map((s) => s.name);
    for (const name of EXPECTED_NOTIFY_SCANNERS) expect(names, name).toContain(name);
    expect(missingNotifyScanners()).toEqual([]);
  });

  test('phase-04-task-05 AC1: 6가지 알림이 실제 업무 흐름으로 모두 생기고 역할·담당에 맞는 사람에게만 간다', async () => {
    const env = await makeEnv();
    await triggerAll(env);

    // 실장: manager 이상 알림 + 공지. AI 예산(admin 전용)·연차 결과(신청자 전용)는 받지 않는다
    expect(ac2Only(typesOf(env, env.manager))).toEqual(['equipment_due', 'leave_requested', 'legal_due', 'notice', 'sterilizer_fail', 'stock_expiry', 'stock_low']);
    // 원장(admin): 위에 AI 예산까지
    expect(ac2Only(typesOf(env, env.admin))).toEqual(['ai_budget', 'equipment_due', 'leave_requested', 'legal_due', 'notice', 'sterilizer_fail', 'stock_expiry', 'stock_low']);
    // 신청한 직원: 공지와 자기 연차 결과만
    expect(ac2Only(typesOf(env, env.staff))).toEqual(['leave_result', 'notice']);
    // 다른 직원: 공지만
    expect(ac2Only(typesOf(env, env.staff2))).toEqual(['notice']);

    // 같은 알림을 다시 찾아도 늘지 않는다(같은 날 중복 없음)
    const before = env.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications')?.n;
    const again = await runNotifyScan(env.app.db, env.clock);
    expect(again.created).toBe(0);
    expect(env.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications')?.n).toBe(before);
  });

  test('phase-04-task-05 AC1: 받은 사람은 API에서 자기 알림만 보고, 모두 읽음 뒤 읽지 않은 수가 0이 된다', async () => {
    const env = await makeEnv();
    await triggerAll(env);
    const mine = await env.app.inject({ method: 'GET', url: '/api/notifications?limit=50', headers: env.staff2.headers });
    expect(mine.statusCode).toBe(200);
    const items = mine.json<{ data: { type: string; typeLabel: string }[] }>().data;
    expect(ac2Only(items.map((i) => i.type))).toEqual(['notice']);
    expect(items.find((i) => i.type === 'notice')?.typeLabel).toBe('새 공지');

    const sum = async (who: TestLogin) => (await env.app.inject({ method: 'GET', url: '/api/notifications/summary', headers: who.headers })).json<{ data: { unread: number } }>().data.unread;
    expect(await sum(env.manager)).toBeGreaterThanOrEqual(7);
    const all = await env.app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: env.manager.writeHeaders });
    expect(all.statusCode, all.body).toBe(204);
    expect(await sum(env.manager)).toBe(0);
    // 다른 사람의 읽음 상태는 그대로다
    expect(await sum(env.admin)).toBeGreaterThanOrEqual(8);
  });
});

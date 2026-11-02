// 이 파일이 하는 일: 재고 API(품목·입출고·거래처·단가, backend.md §3.5)를 실제 라우트와 DB로 확인한다(phase-03-task-01 AC1~AC7).
// 출고하면 현재고가 줄고 기록이 남는지, 재고보다 많은 출고의 확인(409)·수량 0/음수 거부, 상태 계산, FEFO 유효기간, 단가 인상,
// 기록 있는 품목 삭제 → 사용 안 함, 부족 알림(실장 이상 1건, 같은 날 중복 없음)과 역할별 권한, 데모 데이터를 본다. 시간은 manualClock으로 움직인다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { DAY_MS, manualClock, type ManualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { runNotifyScan } from '../../jobs/notify-job.ts';
import { scanInventory } from './notify.ts';
import { seedDemo, DEMO_ITEMS } from './seed.ts';
import { formatPriceChange, type ItemDetail, type ItemPage, type ItemRow, type MoveResult, type MoveRow, type PriceRow, type VendorRow } from '../../../shared/schemas/inventory.ts';

const START = '2026-11-02T09:00:00+09:00';

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
}

async function makeEnv(): Promise<Env> {
  tmp = makeTmpDir('dentalax-inv-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return { app, clock, admin: loginAs(app, 'admin'), manager: loginAs(app, 'manager'), staff: loginAs(app, 'staff') };
}

async function call<T>(env: Env, who: TestLogin, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const res = await env.app.inject({ method, url, headers: method === 'GET' ? who.headers : who.writeHeaders, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.json<T>() };
}

/** 실장 권한으로 품목을 만든다 */
async function newItem(env: Env, body: Record<string, unknown>): Promise<ItemRow> {
  const r = await call<{ data: { item: ItemRow; warnings: string[] } }>(env, env.manager, 'POST', '/api/items', { category: '소모품', unit: '박스', par: 6, ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.item;
}

async function move(env: Env, who: TestLogin, body: Record<string, unknown>) {
  return call<{ data: MoveResult; error?: { code: string; message: string; needsConfirm?: boolean; stock?: number; fields?: Record<string, string> } }>(env, who, 'POST', '/api/inventory/moves', body);
}

async function item(env: Env, id: number): Promise<ItemDetail> {
  const r = await call<{ data: ItemDetail }>(env, env.staff, 'GET', `/api/items/${id}`);
  expect(r.status).toBe(200);
  return r.body.data;
}

describe('출고·입고', () => {
  test('phase-03-task-01 AC1: staff가 품목 검색 → 수량 → 저장으로 출고하면 현재고가 줄고 기록에 남는다', async () => {
    const env = await makeEnv();
    const glove = await newItem(env, { name: '니트릴 글러브 M' });
    expect((await move(env, env.staff, { itemId: glove.id, type: 'in', qty: 10, unitPrice: 8400 })).status).toBe(201);

    // ① 품목 검색
    const found = await call<ItemPage>(env, env.staff, 'GET', `/api/items?q=${encodeURIComponent('글러브')}`);
    expect(found.status).toBe(200);
    expect(found.body.data.map((r) => r.name)).toEqual(['니트릴 글러브 M']);
    expect(found.body.data[0]?.stock).toBe(10);

    // ② 수량 입력 → 저장
    const out = await move(env, env.staff, { itemId: glove.id, type: 'out', qty: 3 });
    expect(out.status).toBe(201);
    expect(out.body.data.item.stock).toBe(7);
    expect(out.body.data.move).toMatchObject({ type: 'out', qty: 3, itemName: '니트릴 글러브 M', userName: '테스트 staff' });

    // 현재고는 기록 합과 같고, 기록 목록에 남는다
    expect((await item(env, glove.id)).stock).toBe(7);
    const moves = await call<{ data: MoveRow[]; total: number }>(env, env.staff, 'GET', `/api/inventory/moves?itemId=${glove.id}`);
    expect(moves.body.total).toBe(2);
    expect(moves.body.data[0]).toMatchObject({ type: 'out', qty: 3 });
    const audit = env.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'stock.move' AND user_id = ?", [env.staff.userId]);
    expect(audit?.n).toBe(2); // 입고 1 + 출고 1
  });

  test('phase-03-task-01 AC2: 재고보다 많이 출고하면 409 needsConfirm이고, 확인(force)해야만 저장된다', async () => {
    const env = await makeEnv();
    const tip = await newItem(env, { name: '석션 팁', par: 2 });
    await move(env, env.staff, { itemId: tip.id, type: 'in', qty: 2 });
    const over = await move(env, env.staff, { itemId: tip.id, type: 'out', qty: 5 });
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: 'CONFLICT', needsConfirm: true, stock: 2 });
    expect(over.body.error?.message).toContain('지금 재고(2박스)보다 많이 출고하려고 해요');
    expect((await item(env, tip.id)).stock).toBe(2); // 저장되지 않았다

    const forced = await move(env, env.staff, { itemId: tip.id, type: 'out', qty: 5, force: true });
    expect(forced.status).toBe(201);
    expect(forced.body.data.item.stock).toBe(-3);
  });

  test('phase-03-task-01 AC2: 수량 0·음수 출고와 입고는 400으로 거부한다', async () => {
    const env = await makeEnv();
    const it = await newItem(env, { name: '거즈' });
    for (const [type, qty] of [['out', 0], ['out', -1], ['in', 0], ['in', -2]] as const) {
      const r = await move(env, env.staff, { itemId: it.id, type, qty });
      expect(r.status, `${type} ${qty}`).toBe(400);
      expect(r.body.error?.fields?.qty).toBe('수량은 0보다 크게 적어 주세요.');
    }
    expect(env.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_moves')?.n).toBe(0);
  });

  test('phase-03-task-01 AC1: 재고 조정은 실장 이상만, 사유가 있어야 하고 부호대로 더해진다', async () => {
    const env = await makeEnv();
    const it = await newItem(env, { name: '코튼롤', par: 1 });
    await move(env, env.staff, { itemId: it.id, type: 'in', qty: 5 });
    expect((await move(env, env.staff, { itemId: it.id, type: 'adjust', qty: -1, reason: '실사' })).status).toBe(403);
    const noReason = await move(env, env.manager, { itemId: it.id, type: 'adjust', qty: -1 });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error?.fields?.reason).toContain('사유');
    const ok = await move(env, env.manager, { itemId: it.id, type: 'adjust', qty: -2, reason: '월말 실사 차이' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.item.stock).toBe(3);
    expect((await move(env, env.manager, { itemId: it.id, type: 'adjust', qty: -9, reason: '실사' })).status).toBe(400);
  });
});

describe('상태 표시', () => {
  test('phase-03-task-01 AC3: 적정 6에서 현재 5 → 부족, 7 → 곧 부족, 8 → 정상으로 목록에 나온다', async () => {
    const env = await makeEnv();
    for (const [name, qty] of [['오', 5], ['칠', 7], ['팔', 8]] as const) {
      const it = await newItem(env, { name: `품목${name}`, par: 6 });
      await move(env, env.staff, { itemId: it.id, type: 'in', qty });
    }
    const list = await call<ItemPage>(env, env.staff, 'GET', '/api/items?sort=name');
    expect(list.body.data.map((r) => [r.name, r.stock, r.status])).toEqual([
      ['품목오', 5, 'low'],
      ['품목칠', 7, 'soon_low'],
      ['품목팔', 8, 'ok'],
    ]);
    expect(list.body.counts).toMatchObject({ all: 3, low: 1, soon_low: 1, ok: 1, warning: 2 });
    const low = await call<ItemPage>(env, env.staff, 'GET', '/api/items?status=low');
    expect(low.body.data.map((r) => r.name)).toEqual(['품목오']);
  });

  test('phase-03-task-01 AC4: 유효기간 2026-11-14 로트가 남으면 D-12, 출고로 그 로트가 소진되면 다음 로트 기준', async () => {
    const env = await makeEnv();
    const resin = await newItem(env, { name: '복합레진 A2', category: '재료', unit: '개', par: 2, trackExpiry: true });
    await move(env, env.manager, { itemId: resin.id, type: 'in', qty: 5, lot: 'B-2', expiryOn: '2026-12-20' });
    await move(env, env.manager, { itemId: resin.id, type: 'in', qty: 3, lot: 'A-1', expiryOn: '2026-11-14' });
    let d = await item(env, resin.id);
    expect(d).toMatchObject({ nearestExpiry: '2026-11-14', dday: 12, status: 'expiring' });
    expect(d.lots.map((l) => [l.lot, l.remaining])).toEqual([
      ['A-1', 3],
      ['B-2', 5],
    ]);
    // 출고 3개 → 11-14 로트가 먼저 빠진다(FEFO)
    await move(env, env.staff, { itemId: resin.id, type: 'out', qty: 3 });
    d = await item(env, resin.id);
    expect(d).toMatchObject({ stock: 5, nearestExpiry: '2026-12-20', dday: 48, status: 'ok' });
    expect(d.lots.map((l) => l.lot)).toEqual(['B-2']);
  });

  test('phase-03-task-01 AC5: 직전 단가 8,400 → 8,900 입고 시 ▲6%, 품목 상세에 단가 추이가 있다', async () => {
    const env = await makeEnv();
    const vendor = await call<{ data: VendorRow }>(env, env.manager, 'POST', '/api/vendors', { name: '한빛덴탈', phone: '02-555-0101' });
    expect(vendor.status).toBe(201);
    const glove = await newItem(env, { name: '니트릴 글러브 M', vendorId: vendor.body.data.id });
    await move(env, env.staff, { itemId: glove.id, type: 'in', qty: 5, unitPrice: 8400 });
    env.clock.advance(60 * 60 * 1000);
    const r = await move(env, env.staff, { itemId: glove.id, type: 'in', qty: 5, unitPrice: 8900 });
    expect(r.body.data.item.lastPrice).toBe(8900);
    expect(r.body.data.item.priceUpPct).toBeCloseTo(5.95, 2);
    expect(formatPriceChange(r.body.data.item.priceUpPct)).toBe('▲6%');
    // 기본 거래처가 입고 거래처로 들어간다
    expect(r.body.data.move.vendor).toBe('한빛덴탈');

    const d = await item(env, glove.id);
    expect(d.prices.map((p) => [p.unitPrice, p.up])).toEqual([
      [8400, false],
      [8900, true],
    ]);
    const prices = await call<{ data: PriceRow[]; total: number }>(env, env.staff, 'GET', '/api/prices?up=1');
    expect(prices.body.data).toHaveLength(1);
    expect(prices.body.data[0]).toMatchObject({ itemName: '니트릴 글러브 M', prevPrice: 8400, unitPrice: 8900, up: true });
  });
});

describe('품목 관리', () => {
  test('phase-03-task-01 AC6: 기록이 있는 품목을 지우면 "사용 안 함"이 되고 기본 목록에서 빠진다', async () => {
    const env = await makeEnv();
    const used = await newItem(env, { name: '쓰던 품목' });
    const fresh = await newItem(env, { name: '새 품목' });
    await move(env, env.staff, { itemId: used.id, type: 'in', qty: 1 });

    const del = await call<{ data: { deleted: boolean; deactivated: boolean } }>(env, env.manager, 'DELETE', `/api/items/${used.id}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: false, deactivated: true });
    const list = await call<ItemPage>(env, env.staff, 'GET', '/api/items');
    expect(list.body.data.map((r) => r.name)).toEqual(['새 품목']);
    const inactive = await call<ItemPage>(env, env.staff, 'GET', '/api/items?active=inactive');
    expect(inactive.body.data.map((r) => [r.name, r.active])).toEqual([['쓰던 품목', false]]);
    // 기록은 그대로 남고, 사용 안 함 품목에는 새로 기록하지 않는다
    expect(env.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_moves WHERE item_id = ?', [used.id])?.n).toBe(1);
    expect((await move(env, env.staff, { itemId: used.id, type: 'out', qty: 1 })).status).toBe(409);

    // 기록이 없는 품목은 실제로 지워진다
    const del2 = await call<{ data: { deleted: boolean } }>(env, env.manager, 'DELETE', `/api/items/${fresh.id}`);
    expect(del2.body.data).toEqual({ deleted: true, deactivated: false });
    expect((await call(env, env.staff, 'GET', `/api/items/${fresh.id}`)).status).toBe(404);

    // 다시 사용으로 바꿀 수 있다
    const back = await call<{ data: { item: ItemRow } }>(env, env.manager, 'PATCH', `/api/items/${used.id}`, { active: true });
    expect(back.body.data.item.active).toBe(true);
    const actions = env.app.db.all<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'item.%' ORDER BY id").map((a) => a.action);
    expect(actions).toEqual(['item.create', 'item.create', 'item.deactivate', 'item.delete', 'item.reactivate']);
  });

  test('phase-03-task-01 AC6: 품목 등록·수정·삭제는 실장 이상만, 같은 이름은 경고와 함께 저장된다', async () => {
    const env = await makeEnv();
    expect((await call(env, env.staff, 'POST', '/api/items', { name: '거즈', category: '소모품', unit: '팩', par: 1 })).status).toBe(403);
    const a = await newItem(env, { name: '거즈' });
    const dup = await call<{ data: { item: ItemRow; warnings: string[] } }>(env, env.admin, 'POST', '/api/items', { name: ' 거즈 ', category: '소모품', unit: '팩', par: 1 });
    expect(dup.status).toBe(201);
    expect(dup.body.data.warnings[0]).toContain('같은 이름의 품목이 이미 있어요');
    expect((await call(env, env.staff, 'PATCH', `/api/items/${a.id}`, { par: 3 })).status).toBe(403);
    expect((await call(env, env.staff, 'DELETE', `/api/items/${a.id}`)).status).toBe(403);
    const bad = await call<{ error: { fields: Record<string, string> } }>(env, env.manager, 'POST', '/api/items', { name: '', category: '소모품', unit: '팩', par: -1 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields).toMatchObject({ name: '품목 이름을 적어 주세요.', par: '적정 재고는 0 이상으로 적어 주세요.' });
  });

  test('phase-03-task-01 AC6: 거래처는 모두 보고, 등록·수정은 실장 이상, 같은 상호는 409', async () => {
    const env = await makeEnv();
    expect((await call(env, env.staff, 'POST', '/api/vendors', { name: '미소치재' })).status).toBe(403);
    const v = await call<{ data: VendorRow }>(env, env.manager, 'POST', '/api/vendors', { name: '미소치재', contactName: '이서연', email: 'sales@miso.example', orderMethod: '온라인 몰' });
    expect(v.status).toBe(201);
    expect((await call(env, env.manager, 'POST', '/api/vendors', { name: '미소치재' })).status).toBe(409);
    expect((await call(env, env.manager, 'POST', '/api/vendors', { name: '이메일틀림', email: 'abc' })).status).toBe(400);
    expect((await call(env, env.staff, 'PATCH', `/api/vendors/${v.body.data.id}`, { memo: 'x' })).status).toBe(403);
    const patched = await call<{ data: VendorRow }>(env, env.manager, 'PATCH', `/api/vendors/${v.body.data.id}`, { phone: '02-555-0202', active: false });
    expect(patched.body.data).toMatchObject({ phone: '02-555-0202', active: false });
    const list = await call<{ data: VendorRow[] }>(env, env.staff, 'GET', '/api/vendors?active=all');
    expect(list.body.data.map((x) => x.name)).toEqual(['미소치재']);
    // 감사 기록에는 연락처를 넣지 않는다
    const detail = env.app.db.all<{ detail: string }>("SELECT detail FROM audit_log WHERE action LIKE 'vendor.%'").map((r) => r.detail).join(' ');
    expect(detail).not.toContain('02-555');
  });
});

describe('부족 알림', () => {
  const count = (env: Env, who: TestLogin) =>
    env.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE type = 'stock_low' AND user_id = ?", [who.userId])?.n ?? 0;

  test('phase-03-task-01 AC7: 부족 품목이 생기면 manager에게 알림 1건, 같은 날 중복 없음, staff는 받지 않는다', async () => {
    const env = await makeEnv();
    const it = await newItem(env, { name: '니트릴 글러브 M', par: 6 });
    await move(env, env.staff, { itemId: it.id, type: 'in', qty: 8 });
    expect(count(env, env.manager)).toBe(0);
    await move(env, env.staff, { itemId: it.id, type: 'out', qty: 3 }); // 5 → 부족
    expect(count(env, env.manager)).toBe(1);
    await move(env, env.staff, { itemId: it.id, type: 'out', qty: 1 }); // 같은 날 또 부족
    const scan = await runNotifyScan(env.app.db, env.clock, [{ name: 'inventory.stock', scan: scanInventory }]);
    expect(scan.errors).toEqual([]);
    expect(count(env, env.manager)).toBe(1);
    expect(count(env, env.admin)).toBe(1);
    expect(count(env, env.staff)).toBe(0);
    const n = env.app.db.get<{ title: string; link: string; body: string }>('SELECT title, link, body FROM notifications WHERE user_id = ?', [env.manager.userId]);
    expect(n).toEqual({ title: '니트릴 글러브 M 재고가 부족해요', link: `/inventory/items/${it.id}`, body: '현재 5박스 · 적정 6박스' });
    // 다음 날 알림 찾기에서 아직 부족하면 다시 1건
    env.clock.advance(DAY_MS);
    await runNotifyScan(env.app.db, env.clock, [{ name: 'inventory.stock', scan: scanInventory }]);
    expect(count(env, env.manager)).toBe(2);
  });

  test('phase-03-task-01 AC7: 알림 찾기는 유효기간 임박·만료 품목도 단계마다 한 번 알린다', async () => {
    const env = await makeEnv();
    const it = await newItem(env, { name: '표면 마취 젤', par: 1, trackExpiry: true });
    await move(env, env.manager, { itemId: it.id, type: 'in', qty: 3, expiryOn: '2026-11-14' });
    const found = scanInventory({ db: env.app.db, clock: env.clock });
    expect(found).toEqual([expect.objectContaining({ type: 'stock_expiry', title: '표면 마취 젤 유효기간이 D-12예요', dedupeKey: `stock_expiry:item:${it.id}:2026-11-14:warn` })]);
    await runNotifyScan(env.app.db, env.clock, [{ name: 'inventory.stock', scan: scanInventory }]);
    await runNotifyScan(env.app.db, env.clock, [{ name: 'inventory.stock', scan: scanInventory }]);
    const n = () => env.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE type = 'stock_expiry' AND user_id = ?", [env.manager.userId])?.n;
    expect(n()).toBe(1);
    env.clock.advance(13 * DAY_MS); // 11-15: 지남
    await runNotifyScan(env.app.db, env.clock, [{ name: 'inventory.stock', scan: scanInventory }]);
    expect(n()).toBe(2);
  });
});

describe('데모 데이터', () => {
  test('phase-03-task-01 범위: 데모 seed는 거래처 5곳·품목 약 80개·90일 기록과 상태 시연 품목을 넣는다', async () => {
    const env = await makeEnv();
    seedDemo(env.app.db, { clock: env.clock, scale: 1 });
    const db = env.app.db;
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM vendors')?.n).toBe(5);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM items')?.n).toBe(DEMO_ITEMS.length);
    expect(DEMO_ITEMS.length).toBeGreaterThanOrEqual(75);
    const span = db.get<{ first: string; last: string; n: number }>('SELECT MIN(moved_at) AS first, MAX(moved_at) AS last, COUNT(*) AS n FROM stock_moves');
    expect(span?.n).toBeGreaterThan(1000);
    expect(span!.first >= '2026-08-03').toBe(true);
    expect(span!.last < '2026-11-02T00:00:00.000Z').toBe(true);

    const list = await call<ItemPage>(env, env.staff, 'GET', '/api/items?pageSize=200');
    const by = (name: string) => list.body.data.find((r) => r.name === name);
    expect(by('니트릴 글러브 M')).toMatchObject({ stock: 2, status: 'low', lastPrice: 8900 });
    expect(formatPriceChange(by('니트릴 글러브 M')!.priceUpPct)).toBe('▲6%');
    expect(by('석션 팁 (일회용)')?.status).toBe('low');
    expect(by('멸균 파우치 90×260')?.status).toBe('soon_low');
    expect(by('복합레진 A2')).toMatchObject({ status: 'expiring', dday: 12, nearestExpiry: '2026-11-14' });
    expect(by('차아염소산 소독액')?.status).toBe('expired');
    expect(list.body.counts.low).toBeGreaterThanOrEqual(3);
    // 재고가 음수인 품목은 없다
    expect(list.body.data.filter((r) => r.stock < 0)).toEqual([]);
    // 다른 품목은 대부분 정상이다
    expect(list.body.counts.ok).toBeGreaterThan(60);
  });
});

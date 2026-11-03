// 이 파일이 하는 일: 품목 바코드(FR-130, phase-06-task-01)를 실제 라우트·DB로 확인한다.
// 바코드 저장·앞뒤 공백 정리·병원 안 중복 거부(409), 바코드로 품목 찾기(GET /api/items/by-barcode, 모든 역할)와 없는 바코드의 쉬운 404 안내,
// 품목 CSV 내보내기·양식·가져오기의 바코드 열(신규·변경·중복 오류), 데모 데이터의 바코드(겹치지 않음)를 본다.
// 화면에서 스캐너 입력 → 출고 창이 수량 1로 열리는 것(AC1)과 사진 해독(AC2)은 tests/e2e/inventory-barcode.spec.ts가 본다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { fixedClock, manualClock } from '../../lib/clock.ts';
import { openDb } from '../../db/index.ts';
import { migrate } from '../../db/migrate.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { normalizeBarcode, type ItemRow } from '../../../shared/schemas/inventory.ts';
import type { ImportPreview } from '../../../shared/schemas/inventory-csv.ts';
import { DEMO_ITEMS, seedDemo } from './seed.ts';

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
  manager: TestLogin;
  staff: TestLogin;
}

async function makeEnv(): Promise<Env> {
  tmp = makeTmpDir('dentalax-barcode-');
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock: manualClock(START) });
  return { app, manager: loginAs(app, 'manager'), staff: loginAs(app, 'staff') };
}

type Body<T> = T & { error?: { code: string; message: string; fields?: Record<string, string> } };

async function call<T>(env: Env, who: TestLogin, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const res = await env.app.inject({ method, url, headers: method === 'GET' ? who.headers : who.writeHeaders, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.json<Body<T>>() };
}

async function newItem(env: Env, body: Record<string, unknown>) {
  return call<{ data: { item: ItemRow } }>(env, env.manager, 'POST', '/api/items', { category: '소모품', unit: '박스', par: 6, ...body });
}

const byBarcode = (env: Env, who: TestLogin, code: string) => call<{ data: ItemRow }>(env, who, 'GET', `/api/items/by-barcode?code=${encodeURIComponent(code)}`);

/** multipart 본문(CSV 파일 하나)으로 가져오기 미리보기 */
async function preview(env: Env, csv: string) {
  const boundary = '----dentalaxBarcodeBoundary';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="items.csv"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.from(csv, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await env.app.inject({ method: 'POST', url: '/api/import/items/preview', headers: { ...env.manager.writeHeaders, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
  return { status: res.statusCode, body: res.json<{ data: ImportPreview }>() };
}

describe('품목 바코드 저장', () => {
  test('phase-06-task-01 AC1(서버): 바코드를 넣어 등록하면 앞뒤 공백을 지워 저장하고, 직원도 바코드로 그 품목을 찾는다', async () => {
    const env = await makeEnv();
    const r = await newItem(env, { name: '니트릴 글러브 M', barcode: '  2001000000029\r\n' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.item.barcode).toBe('2001000000029');
    const found = await byBarcode(env, env.staff, '2001000000029');
    expect(found.status).toBe(200);
    expect(found.body.data).toMatchObject({ id: r.body.data.item.id, name: '니트릴 글러브 M', unit: '박스', barcode: '2001000000029', active: true });
    // 스캐너가 끝에 붙인 Enter·공백이 있어도 찾는다
    expect((await byBarcode(env, env.staff, ' 2001000000029\n')).body.data.id).toBe(r.body.data.item.id);
    // 목록 검색도 바코드가 정확히 같으면 찾는다(일부만 같으면 찾지 않는다)
    const list = await call<{ data: ItemRow[] }>(env, env.staff, 'GET', '/api/items?q=2001000000029');
    expect(list.body.data.map((i) => i.name)).toEqual(['니트릴 글러브 M']);
    expect((await call<{ data: ItemRow[] }>(env, env.staff, 'GET', '/api/items?q=20010000')).body.data).toEqual([]);
  });

  test('phase-06-task-01: 없는 바코드는 404와 쉬운 안내, 빈 바코드는 400', async () => {
    const env = await makeEnv();
    const r = await byBarcode(env, env.staff, '9999999999999');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatchObject({ code: 'NOT_FOUND', message: '이 바코드로 등록된 품목이 없어요. 품목 수정에서 바코드를 넣어 주세요.' });
    expect((await call(env, env.staff, 'GET', '/api/items/by-barcode')).status).toBe(400);
    expect((await byBarcode(env, env.staff, '   ')).status).toBe(404);
  });

  test('phase-06-task-01: 같은 바코드는 다른 품목에 쓸 수 없고(409), 고칠 때 비우면 바코드가 없어진다', async () => {
    const env = await makeEnv();
    const a = (await newItem(env, { name: '덴탈 마스크', barcode: 'HS-MASK-01' })).body.data.item;
    const dup = await newItem(env, { name: '덴탈 마스크(소)', barcode: 'HS-MASK-01' });
    expect(dup.status).toBe(409);
    expect(dup.body.error?.message).toBe('이 바코드는 이미 "덴탈 마스크" 품목에 등록돼 있어요. 바코드를 다시 확인해 주세요.');
    expect(dup.body.error?.fields?.barcode).toContain('덴탈 마스크');
    const b = (await newItem(env, { name: '거즈' })).body.data.item;
    expect(b.barcode).toBeNull();
    expect((await call(env, env.manager, 'PATCH', `/api/items/${b.id}`, { barcode: 'HS-MASK-01' })).status).toBe(409);
    // 자기 바코드를 그대로 다시 보내는 것은 괜찮다
    expect((await call(env, env.manager, 'PATCH', `/api/items/${a.id}`, { barcode: 'HS-MASK-01', memo: '바코드 확인' })).status).toBe(200);
    // 비우면 null, 그러면 다른 품목이 그 바코드를 쓸 수 있다
    const cleared = await call<{ data: { item: ItemRow } }>(env, env.manager, 'PATCH', `/api/items/${a.id}`, { barcode: '' });
    expect(cleared.body.data.item.barcode).toBeNull();
    expect((await call<{ data: { item: ItemRow } }>(env, env.manager, 'PATCH', `/api/items/${b.id}`, { barcode: 'HS-MASK-01' })).body.data.item.barcode).toBe('HS-MASK-01');
    // 줄바꿈이 섞인 값·너무 긴 값은 400
    expect((await newItem(env, { name: 'x1', barcode: 'AB\tCD' })).status).toBe(400);
    expect((await newItem(env, { name: 'x2', barcode: '1'.repeat(65) })).status).toBe(400);
    // DB에도 부분 고유 색인이 있다(서비스를 거치지 않아도 겹치지 않는다)
    expect(() => env.app.db.run("UPDATE items SET barcode = 'HS-MASK-01' WHERE id = ?", [a.id])).toThrow();
  });

  test('phase-06-task-01: "사용 안 함" 품목도 바코드로 찾되 active:false로 알려 준다(화면이 출고 대신 안내)', async () => {
    const env = await makeEnv();
    const it = (await newItem(env, { name: '석션 팁', barcode: '2001000000135' })).body.data.item;
    await call(env, env.staff, 'POST', '/api/inventory/moves', { itemId: it.id, type: 'in', qty: 3 });
    await env.app.inject({ method: 'DELETE', url: `/api/items/${it.id}`, headers: env.manager.writeHeaders });
    const r = await byBarcode(env, env.staff, '2001000000135');
    expect(r.status).toBe(200);
    expect(r.body.data.active).toBe(false);
  });

  test('phase-06-task-01: normalizeBarcode는 앞뒤 공백·제어 글자를 지우고, 비면 null', () => {
    expect(normalizeBarcode('\t 2001000000029 \r\n')).toBe('2001000000029');
    expect(normalizeBarcode('HS STER 090')).toBe('HS STER 090');
    expect(normalizeBarcode('   ')).toBeNull();
    expect(normalizeBarcode(null)).toBeNull();
  });
});

describe('품목 CSV의 바코드 열', () => {
  test('phase-06-task-01: 내보내기·양식에 바코드 열이 있고, 내보낸 값은 글자 그대로(앞자리 0 유지)', async () => {
    const env = await makeEnv();
    await newItem(env, { name: '코튼롤', barcode: '0012345678905' });
    const items = await env.app.inject({ method: 'GET', url: '/api/export/items.csv', headers: env.manager.headers });
    const text = items.rawPayload.toString('utf8');
    expect(text.slice(1).startsWith('품목명,분류,단위,적정 재고,유효기간 관리,기본 거래처,보관 위치,메모,바코드,현재고')).toBe(true);
    expect(text).toContain('코튼롤,소모품,박스,6,아니오,,,,0012345678905,0,');
    const tpl = await env.app.inject({ method: 'GET', url: '/api/import/items/template.csv', headers: env.manager.headers });
    expect(tpl.rawPayload.toString('utf8').split('\r\n')[0]).toBe('﻿품목명,분류,단위,적정 재고,유효기간 관리,기본 거래처,보관 위치,메모,바코드');
  });

  test('phase-06-task-01: 가져오기에서 바코드로 신규·변경을 만들고, 다른 품목 바코드·파일 안 중복은 오류 줄이 된다', async () => {
    const env = await makeEnv();
    await newItem(env, { name: '니트릴 글러브 S', barcode: '2001000000012' });
    await newItem(env, { name: '니트릴 글러브 L' });
    const csv = [
      '품목명,분류,단위,적정 재고,바코드',
      '니트릴 글러브 L,,,,2001000000036', // 2: 기존 품목에 바코드 넣기(변경)
      '덴탈 마스크,소모품,박스,8, 2001000000050 ', // 3: 신규(앞뒤 공백 정리)
      '거즈,소모품,팩,10,2001000000012', // 4: 다른 품목 바코드 → 오류
      '코튼롤,소모품,봉,8,2001000000050', // 5: 3번 줄과 같은 바코드 → 오류
      '니트릴 글러브 S,,,,2001000000012', // 6: 자기 바코드 그대로 → 변경 없음
    ].join('\r\n');
    const p = await preview(env, csv);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const rows = p.body.data.rows;
    expect(rows.map((r) => r.action)).toEqual(['update', 'new', 'error', 'error', 'unchanged']);
    expect(rows[0]?.changes).toEqual([{ field: 'barcode', label: '바코드', from: '(비어 있음)', to: '2001000000036' }]);
    expect(rows[1]?.data.barcode).toBe('2001000000050');
    expect(rows[2]?.errors).toContain('바코드 "2001000000012"는 이미 "니트릴 글러브 S" 품목이 쓰고 있어요. 바코드를 다시 확인해 주세요.');
    expect(rows[3]?.errors).toContain('같은 바코드가 파일 안에 또 있어요(3번 줄). 품목마다 다른 바코드를 적어 주세요.');

    const commit = await call<{ data: { created: number; updated: number } }>(env, env.manager, 'POST', '/api/import/items/commit', { token: p.body.data.token, skipErrors: true });
    expect(commit.status).toBe(200);
    expect(commit.body.data).toMatchObject({ created: 1, updated: 1 });
    expect((await byBarcode(env, env.staff, '2001000000036')).body.data.name).toBe('니트릴 글러브 L');
    expect((await byBarcode(env, env.staff, '2001000000050')).body.data.name).toBe('덴탈 마스크');
  });
});

describe('데모 데이터', () => {
  test('phase-06-task-01: 데모 품목 일부에 바코드가 있고 모두 다르며, 10배 데이터에서도 겹치지 않는다', () => {
    const withCode = DEMO_ITEMS.filter((i) => i.barcode);
    expect(withCode.length).toBeGreaterThanOrEqual(8);
    expect(new Set(withCode.map((i) => i.barcode)).size).toBe(withCode.length);
    tmp = makeTmpDir('dentalax-barcode-seed-');
    const db = openDb(path.join(tmp, 'app.db'));
    try {
      migrate(db);
      seedDemo(db, { clock: fixedClock(START), scale: 10 });
      const rows = db.all<{ barcode: string; name: string }>('SELECT barcode, name FROM items WHERE barcode IS NOT NULL ORDER BY name');
      expect(rows.length).toBe(withCode.length);
      expect(rows.find((r) => r.barcode === '2001000000029')?.name).toBe('니트릴 글러브 M');
    } finally {
      db.close();
    }
  });
});

// 이 파일이 하는 일: 재고 CSV 가져오기·내보내기(FR-056, TD-016, phase-03-task-03 AC1~AC4)를 실제 라우트·DB로 확인한다.
// 내보낸 CSV의 BOM·한글 열 이름(AC1), CP949 예제 파일의 한글 해독과 신규·변경·오류 줄 구분(AC2), 오류 이유와 "오류 줄 건너뛰고 확정"(AC3),
// =HYPERLINK(...) 품목명 앞 작은따옴표(AC4)를 보고, 공용 CSV 함수(server/lib/csv.ts)와 권한·감사 기록·만료 표도 함께 본다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock, type ManualClock } from '../../lib/clock.ts';
import { csvCell, decodeCsvBytes, parseCsvRows, toCsv, UTF8_BOM } from '../../lib/csv.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import type { ItemRow } from '../../../shared/schemas/inventory.ts';
import type { ImportCommitResult, ImportPreview } from '../../../shared/schemas/inventory-csv.ts';
import { PREVIEW_TTL_MS } from './csv.ts';

const START = '2026-11-02T09:00:00+09:00';
const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'csv');

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
  tmp = makeTmpDir('dentalax-csv-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return { app, clock, admin: loginAs(app, 'admin'), manager: loginAs(app, 'manager'), staff: loginAs(app, 'staff') };
}

async function call<T>(env: Env, who: TestLogin, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const res = await env.app.inject({ method, url, headers: method === 'GET' ? who.headers : who.writeHeaders, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.json<T & { error?: { code: string; message: string; errorLines?: number[] } }>() };
}

/** GET으로 받은 원래 바이트와 헤더 */
async function raw(env: Env, who: TestLogin, url: string) {
  const res = await env.app.inject({ method: 'GET', url, headers: who.headers });
  return { status: res.statusCode, headers: res.headers, bytes: res.rawPayload, text: res.rawPayload.toString('utf8') };
}

/** multipart 본문(파일 하나) */
function multipart(name: string, data: Buffer) {
  const boundary = '----dentalaxCsvBoundary42';
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/csv\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function preview(env: Env, who: TestLogin, name: string, data: Buffer) {
  const m = multipart(name, data);
  const res = await env.app.inject({ method: 'POST', url: '/api/import/items/preview', headers: { ...who.writeHeaders, ...m.headers }, payload: m.payload });
  return { status: res.statusCode, body: res.json<{ data: ImportPreview; error?: { code: string; message: string } }>() };
}

async function newVendor(env: Env, name: string): Promise<number> {
  const r = await call<{ data: { id: number } }>(env, env.manager, 'POST', '/api/vendors', { name });
  expect(r.status).toBe(201);
  return r.body.data.id;
}

async function newItem(env: Env, body: Record<string, unknown>): Promise<ItemRow> {
  const r = await call<{ data: { item: ItemRow } }>(env, env.manager, 'POST', '/api/items', { category: '소모품', unit: '박스', par: 6, ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.item;
}

/** 예제 파일의 기존 품목·거래처를 준비한다(니트릴 장갑(M) 적정 6, 한빛덴탈) */
async function prepareFixtureWorld(env: Env): Promise<ItemRow> {
  const vendorId = await newVendor(env, '한빛덴탈');
  return newItem(env, { name: '니트릴 장갑(M)', par: 6, vendorId, location: '소모품 선반 1칸' });
}

const itemsByName = (env: Env) => new Map(env.app.db.all<{ name: string; par_level: number; unit: string; active: number }>('SELECT name, par_level, unit, active FROM items').map((r) => [r.name, r]));

describe('공용 CSV 함수(server/lib/csv.ts)', () => {
  test('phase-03-task-03 AC4: =·+·-·@로 시작하는 글자 칸은 앞에 작은따옴표, 숫자 음수는 그대로', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('줄\n바꿈')).toBe('"줄\n바꿈"');
    expect(csvCell(null)).toBe('');
    const csv = toCsv([['품목명', '수량'], ['거즈', 3]]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(csv).toBe(`${UTF8_BOM}품목명,수량\r\n거즈,3\r\n`);
  });

  test('phase-03-task-03 AC2: CP949 바이트는 euc-kr로, UTF-8(BOM 포함·없음)은 그대로 판별한다', () => {
    const cp949 = fs.readFileSync(path.join(FIXTURES, 'items-cp949.csv'));
    const d1 = decodeCsvBytes(cp949);
    expect(d1.encoding).toBe('cp949');
    expect(d1.text).toContain('품목명,분류,단위,적정 재고');
    expect(d1.text).not.toContain('�');
    const d2 = decodeCsvBytes(fs.readFileSync(path.join(FIXTURES, 'items-utf8-bom.csv')));
    expect(d2.encoding).toBe('utf-8');
    expect(d2.text).toContain('치과용 거즈');
    const d3 = decodeCsvBytes(Buffer.from('품목명\r\n거즈\r\n', 'utf8'));
    expect(d3).toEqual({ text: '품목명\r\n거즈\r\n', encoding: 'utf-8' });
    // 따옴표 안 쉼표·줄바꿈, 빈 줄 건너뛰기
    expect(parseCsvRows(`${UTF8_BOM}a,b\r\n\r\n"x,1","y\r\nz"\r\n`)).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 3, cells: ['x,1', 'y\r\nz'] },
    ]);
  });
});

describe('내보내기', () => {
  test('phase-03-task-03 AC1: 품목·거래처·입출고 CSV는 첫 3바이트가 BOM이고 한글 열 이름이 들어 있다', async () => {
    const env = await makeEnv();
    const vendorId = await newVendor(env, '한빛덴탈');
    const it = await newItem(env, { name: '치과용 거즈', unit: '팩', par: 20, vendorId });
    const mv = await call(env, env.staff, 'POST', '/api/inventory/moves', { itemId: it.id, type: 'in', qty: 5, unitPrice: 3000 });
    expect(mv.status).toBe(201);
    await call(env, env.staff, 'POST', '/api/inventory/moves', { itemId: it.id, type: 'out', qty: 2 });

    for (const [url, header, row] of [
      ['/api/export/items.csv', '품목명,분류,단위,적정 재고,유효기간 관리,기본 거래처,보관 위치,메모,바코드,현재고,상태', '치과용 거즈,소모품,팩,20,아니오,한빛덴탈,,,,3,'],
      ['/api/export/vendors.csv', '상호,담당자,업무용 연락처,이메일,주문 방법,메모', '한빛덴탈,,,,,,1,사용'],
      ['/api/export/moves.csv', '일시,구분,품목명,단위,수량,단가,거래처,로트,유효기간,사유·메모,기록한 사람', '2026-11-02 09:00,출고,치과용 거즈,팩,-2,'],
      ['/api/inventory/moves?format=csv&type=in', '일시,구분,품목명,단위,수량', '2026-11-02 09:00,입고,치과용 거즈,팩,5,3000,한빛덴탈'],
    ] as const) {
      const r = await raw(env, env.manager, url);
      expect(r.status, url).toBe(200);
      expect([...r.bytes.subarray(0, 3)], url).toEqual([0xef, 0xbb, 0xbf]);
      expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(String(r.headers['content-disposition'])).toContain('attachment;');
      expect(r.text.slice(1).startsWith(header), `${url}: ${r.text.slice(0, 120)}`).toBe(true);
      expect(r.text, url).toContain(row);
      expect(r.text.includes('\r\n')).toBe(true);
    }
    // ?format=csv의 조건(type=in)이 적용돼 출고 줄은 없다
    expect((await raw(env, env.manager, '/api/inventory/moves?format=csv&type=in')).text).not.toContain(',출고,');
    // 내보낸 사실이 감사 기록에 남는다
    expect(env.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'inventory.export'")?.n).toBe(5);
  });

  test('phase-03-task-03 AC4: =HYPERLINK(...)로 시작하는 품목명을 내보내면 앞에 작은따옴표가 붙는다', async () => {
    const env = await makeEnv();
    const evil = '=HYPERLINK("http://evil.example","눌러 보세요")';
    const it = await newItem(env, { name: evil, memo: '+SUM(A1)' });
    await call(env, env.staff, 'POST', '/api/inventory/moves', { itemId: it.id, type: 'in', qty: 1 });
    const items = await raw(env, env.manager, '/api/export/items.csv');
    expect(items.text).toContain(`"'=HYPERLINK(""http://evil.example"",""눌러 보세요"")"`);
    expect(items.text).toContain("'+SUM(A1)");
    expect(items.text).not.toMatch(/(^|,|\r\n)=HYPERLINK/);
    const moves = await raw(env, env.manager, '/api/export/moves.csv');
    expect(moves.text).toContain(`"'=HYPERLINK(`);
  });

  test('phase-03-task-03: 내보내기·양식은 실장 이상만, 없는 이름은 404, 직원의 ?format=csv는 403', async () => {
    const env = await makeEnv();
    for (const url of ['/api/export/items.csv', '/api/export/vendors.csv', '/api/export/moves.csv', '/api/import/items/template.csv', '/api/inventory/moves?format=csv']) {
      expect((await raw(env, env.staff, url)).status, url).toBe(403);
      expect((await raw(env, env.admin, url)).status, url).toBe(200);
    }
    expect((await raw(env, env.manager, '/api/export/users.csv')).status).toBe(404);
    // 직원도 일반 입출고 목록은 그대로 본다
    expect((await raw(env, env.staff, '/api/inventory/moves')).status).toBe(200);
  });

  test('phase-03-task-03: 양식은 BOM + 가져오기 열 이름이고, 그대로 올리면 예시 줄 하나가 신규로 보인다', async () => {
    const env = await makeEnv();
    const t = await raw(env, env.manager, '/api/import/items/template.csv');
    expect(t.text.startsWith(`${UTF8_BOM}품목명,분류,단위,적정 재고,유효기간 관리,기본 거래처,보관 위치,메모,바코드\r\n`)).toBe(true);
    const p = await preview(env, env.manager, 'template.csv', t.bytes);
    expect(p.status).toBe(200);
    expect(p.body.data.totals).toEqual({ new: 1, update: 0, unchanged: 0, error: 0 });
  });
});

describe('가져오기', () => {
  test('phase-03-task-03 AC2: CP949 예제 파일을 올리면 한글이 깨지지 않고 신규·변경·오류 줄이 구분된다', async () => {
    const env = await makeEnv();
    const glove = await prepareFixtureWorld(env);
    const p = await preview(env, env.manager, 'items-cp949.csv', fs.readFileSync(path.join(FIXTURES, 'items-cp949.csv')));
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const d = p.body.data;
    expect(d.encoding).toBe('cp949');
    expect(d.totals).toEqual({ new: 2, update: 1, unchanged: 0, error: 1 });
    expect(d.rows.map((r) => [r.line, r.action, r.data.name])).toEqual([
      [2, 'update', '니트릴 장갑(M)'],
      [3, 'new', '치과용 거즈'],
      [4, 'error', '레진 A2'],
      [5, 'new', '일회용 석션팁'],
    ]);
    expect(JSON.stringify(d)).not.toContain('�');
    expect(d.rows[0]).toMatchObject({ itemId: glove.id, changes: [{ field: 'par', label: '적정 재고', from: '6', to: '10' }] });
    expect(d.rows[1]?.data).toMatchObject({ category: '소모품', unit: '팩', par: 20, trackExpiry: false, vendor: '한빛덴탈', location: '소독실 서랍', memo: '새로 들여옴' });
    // 미리보기만으로는 아무것도 바뀌지 않는다
    expect(itemsByName(env).get('니트릴 장갑(M)')?.par_level).toBe(6);
    expect(itemsByName(env).has('치과용 거즈')).toBe(false);

    // UTF-8 BOM 파일도 같은 결과
    const u = await preview(env, env.manager, 'items-utf8-bom.csv', fs.readFileSync(path.join(FIXTURES, 'items-utf8-bom.csv')));
    expect(u.body.data.encoding).toBe('utf-8');
    expect(u.body.data.totals).toEqual(d.totals);
  });

  test('phase-03-task-03 AC3: 적정 재고에 문자가 있는 줄은 이유와 함께 오류이고, "오류 줄 건너뛰고 확정"이면 나머지만 반영된다', async () => {
    const env = await makeEnv();
    await prepareFixtureWorld(env);
    const p = await preview(env, env.manager, 'items-cp949.csv', fs.readFileSync(path.join(FIXTURES, 'items-cp949.csv')));
    const bad = p.body.data.rows.find((r) => r.action === 'error');
    expect(bad?.line).toBe(4);
    expect(bad?.errors).toEqual(['적정 재고는 숫자로 적어 주세요(지금 값: "다섯").']);

    // 건너뛰기를 고르지 않으면 409이고 아무것도 저장하지 않는다
    const refused = await call<{ data: ImportCommitResult }>(env, env.manager, 'POST', '/api/import/items/commit', { token: p.body.data.token, skipErrors: false });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.message).toContain('오류 줄이 1개 있어요');
    expect(refused.body.error?.errorLines).toEqual([4]);
    expect(itemsByName(env).size).toBe(1);

    const ok = await call<{ data: ImportCommitResult }>(env, env.manager, 'POST', '/api/import/items/commit', { token: p.body.data.token, skipErrors: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toEqual({ created: 2, updated: 1, skipped: 1, errorLines: [4] });
    const after = itemsByName(env);
    expect(after.get('니트릴 장갑(M)')?.par_level).toBe(10);
    expect(after.get('치과용 거즈')).toMatchObject({ par_level: 20, unit: '팩', active: 1 });
    expect(after.get('일회용 석션팁')).toMatchObject({ par_level: 15, unit: '봉' });
    expect(after.has('레진 A2')).toBe(false);
    const vendorOf = env.app.db.get<{ name: string }>("SELECT v.name FROM items i JOIN vendors v ON v.id = i.default_vendor_id WHERE i.name = '치과용 거즈'");
    expect(vendorOf?.name).toBe('한빛덴탈');
    const log = env.app.db.get<{ detail: string; user_id: number }>("SELECT detail, user_id FROM audit_log WHERE action = 'items.import'");
    expect(log?.user_id).toBe(env.manager.userId);
    expect(JSON.parse(log?.detail ?? '{}')).toMatchObject({ fileName: 'items-cp949.csv', created: 2, updated: 1, skipped: 1, errorLines: [4] });

    // 한 번 쓴 미리보기 표는 다시 쓸 수 없다
    const again = await call(env, env.manager, 'POST', '/api/import/items/commit', { token: p.body.data.token, skipErrors: true });
    expect(again.status).toBe(404);
  });

  test('phase-03-task-03 AC3: 줄마다 오류 이유(빈 품목명·신규 필수 칸·유효기간 값·없는 거래처·파일 안 중복)를 쉬운 말로 알려 준다', async () => {
    const env = await makeEnv();
    await prepareFixtureWorld(env);
    const csv = [
      '품목명,분류,단위,적정 재고,유효기간 관리,기본 거래처',
      ',소모품,박스,3,,',
      '새 품목,,,,,',
      '니트릴 장갑(M),,,-1,몰라,',
      '거즈,소모품,팩,"1,200",예,없는상사',
      '스케일러 팁,기구,개,4,아니오,',
      '스케일러 팁,기구,개,5,아니오,',
    ].join('\r\n');
    const p = await preview(env, env.manager, 'errors.csv', Buffer.from(csv, 'utf8'));
    expect(p.status).toBe(200);
    const byLine = new Map(p.body.data.rows.map((r) => [r.line, r]));
    expect(byLine.get(2)?.errors).toEqual(['품목명이 비어 있어요.']);
    expect(byLine.get(3)?.errors).toEqual(['새 품목은 분류를 꼭 적어 주세요.', '새 품목은 단위를 꼭 적어 주세요(예: 박스, 팩).', '새 품목은 적정 재고를 꼭 적어 주세요(모르면 0).']);
    expect(byLine.get(4)?.errors).toEqual(['적정 재고는 0 이상으로 적어 주세요.', '유효기간 관리는 "예" 또는 "아니오"로 적어 주세요(지금 값: "몰라").']);
    expect(byLine.get(5)?.errors).toEqual(['"없는상사" 거래처가 없어요. 거래처를 먼저 등록하거나 칸을 비워 주세요.']);
    expect(byLine.get(5)?.data.par).toBe(1200);
    expect(byLine.get(6)?.action).toBe('new');
    expect(byLine.get(7)?.errors).toEqual(['같은 품목명이 파일 안에 또 있어요(6번 줄). 한 줄만 남겨 주세요.']);
    // 대소문자만 다른 이름은 기존 품목과 같은 품목으로 맞추고(이름 표기만 바뀜), 빈 칸은 그대로 둔다
    const same = await preview(env, env.manager, 'same.csv', Buffer.from('품목명,적정 재고,보관 위치\r\n니트릴 장갑(m),6,\r\n'));
    expect(same.body.data.rows[0]).toMatchObject({ action: 'update', changes: [{ field: 'name', from: '니트릴 장갑(M)', to: '니트릴 장갑(m)' }] });
    const same2 = await preview(env, env.manager, 'same2.csv', Buffer.from('품목명,적정 재고,보관 위치\r\n니트릴 장갑(M),6,\r\n'));
    expect(same2.body.data.rows[0]).toMatchObject({ action: 'unchanged', changes: [] });
  });

  test('phase-03-task-03: 파일 자체 오류(확장자·빈 파일·품목명 열 없음)는 400·415로 알려 주고, 직원은 올릴 수 없다', async () => {
    const env = await makeEnv();
    expect((await preview(env, env.manager, 'items.xlsx', Buffer.from('품목명\r\n거즈'))).status).toBe(415);
    expect((await preview(env, env.manager, 'empty.csv', Buffer.alloc(0))).status).toBe(400);
    const noName = await preview(env, env.manager, 'x.csv', Buffer.from('분류,단위\r\n소모품,박스'));
    expect(noName.status).toBe(400);
    expect(noName.body.error?.message).toContain('"품목명" 열');
    const onlyHeader = await preview(env, env.manager, 'x.csv', Buffer.from('품목명,분류\r\n'));
    expect(onlyHeader.status).toBe(400);
    expect((await preview(env, env.staff, 'items-cp949.csv', fs.readFileSync(path.join(FIXTURES, 'items-cp949.csv')))).status).toBe(403);
    const commitStaff = await call(env, env.staff, 'POST', '/api/import/items/commit', { token: 'x'.repeat(24), skipErrors: true });
    expect(commitStaff.status).toBe(403);
  });

  test('phase-03-task-03: 미리보기 표는 올린 사람만 30분 안에 쓸 수 있고, 내보낸 품목 파일은 그대로 다시 올릴 수 있다', async () => {
    const env = await makeEnv();
    await prepareFixtureWorld(env);
    await newItem(env, { name: '=HYPERLINK("x")', par: 2 });
    const exported = await raw(env, env.manager, '/api/export/items.csv');
    const p = await preview(env, env.manager, 'items.csv', exported.bytes);
    expect(p.status).toBe(200);
    // 내보낸 그대로 다시 올리면 바뀌는 것이 없다(현재고·상태 등 내보내기 전용 열은 쓰지 않는다)
    expect(p.body.data.totals).toEqual({ new: 0, update: 0, unchanged: 2, error: 0 });
    expect(p.body.data.ignoredColumns).toEqual(['현재고', '상태', '가장 빠른 유효기간', '최근 입고 단가', '사용 여부']);
    expect(p.body.data.rows.map((r) => r.data.name)).toContain('=HYPERLINK("x")');

    const other = loginAs(env.app, 'manager');
    expect((await call(env, other, 'POST', '/api/import/items/commit', { token: p.body.data.token, skipErrors: true })).status).toBe(404);
    env.clock.advance(PREVIEW_TTL_MS + 1000);
    const expired = await call(env, env.manager, 'POST', '/api/import/items/commit', { token: p.body.data.token, skipErrors: true });
    expect(expired.status).toBe(404);
    expect(expired.body.error?.message).toContain('미리보기가 만료됐어요');
  });
});

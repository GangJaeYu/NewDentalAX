// 이 파일이 하는 일: 오픈·마감 체크리스트 API(checklists.ts, FR-041)를 실제 라우트와 DB로 확인한다(phase-03-task-04 AC4·AC5).
// 오늘 체크의 체크한 사람·시각, 주입 시계로 다음 날이 되면 미체크로 새로 시작, 어제 기록은 조회만 됨, 항목 순서 저장 유지, 편집 권한(staff 403)을 본다.
// 요청은 fastify.inject로 보내고, "오늘"은 manualClock으로 움직인다. 데이터는 .tmp/unit/ 임시 폴더만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { DAY_MS, manualClock, MINUTE_MS } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { createSession } from '../../auth/sessions.ts';
import type { ChecklistDay } from '../../../shared/schemas/desk.ts';

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
  tmp = makeTmpDir('dentalax-check-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return { app, clock };
}

/** 세션은 8시간 뒤 끝나므로, 시계를 다음 날로 보낸 뒤 같은 사용자로 세션을 새로 연다 */
function relogin(a: FastifyInstance, who: TestLogin): TestLogin {
  const s = createSession(a.db, a.clock, who.userId, '127.0.0.1');
  const cookie = `sid=${s.token}`;
  return { ...who, cookie, csrf: s.csrfToken, headers: { cookie }, writeHeaders: { cookie, 'x-csrf-token': s.csrfToken } };
}

async function day(a: FastifyInstance, who: TestLogin, kind: string, query = ''): Promise<ChecklistDay> {
  const res = await a.inject({ method: 'GET', url: `/api/checklists/${kind}${query}`, headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: ChecklistDay }>().data;
}

async function saveItems(a: FastifyInstance, who: TestLogin, kind: string, items: unknown[]) {
  return a.inject({ method: 'PUT', url: `/api/checklists/${kind}/items`, headers: who.writeHeaders, payload: { items } });
}

async function check(a: FastifyInstance, who: TestLogin, itemId: number, checked: boolean) {
  return a.inject({ method: 'POST', url: '/api/checklists/check', headers: who.writeHeaders, payload: { itemId, checked } });
}

/** manager가 오픈 항목 3개를 만든다 */
async function setup(a: FastifyInstance) {
  const manager = loginAs(a, 'manager');
  const staff = loginAs(a, 'staff');
  const r = await saveItems(a, manager, 'open', [
    { text: '출입문 조명 켜기', roleHint: 'desk' },
    { text: '체어 작동 확인', roleHint: 'hygienist' },
    { text: '멸균기 예열', roleHint: null },
  ]);
  expect(r.statusCode).toBe(200);
  const items = r.json<{ data: ChecklistDay }>().data.items;
  return { manager, staff, items };
}

describe('체크리스트 체크와 날짜', () => {
  test('phase-03-task-04 AC4: 오늘 항목을 체크하면 체크한 사람·시각이 보이고, 다음 날이 되면 미체크로 시작하며 어제 기록은 읽기 전용으로 조회된다', async () => {
    const { app: a, clock } = await makeApp();
    const { staff: staff0, manager, items } = await setup(a);
    let staff = staff0;
    const first = items[0]!;
    clock.advance(12 * MINUTE_MS);
    const checkedAt = clock.now().toISOString();
    const r = await check(a, staff, first.id, true);
    expect(r.statusCode).toBe(200);
    const today = r.json<{ data: ChecklistDay }>().data;
    expect(today).toMatchObject({ date: '2026-11-02', today: '2026-11-02', readOnly: false, done: 1, total: 3 });
    expect(today.items[0]).toMatchObject({ id: first.id, checked: true, checkedBy: { id: staff.userId, name: '테스트 staff' }, checkedAt });
    // 다른 사람이 다시 체크해도 처음 체크한 사람·시각을 지킨다
    clock.advance(MINUTE_MS);
    await check(a, manager, first.id, true);
    expect((await day(a, manager, 'open')).items[0]?.checkedBy?.id).toBe(staff.userId);

    // 주입 시계로 다음 날(2026-11-03 09:13)
    clock.advance(DAY_MS);
    staff = relogin(a, staff);
    const next = await day(a, staff, 'open');
    expect(next).toMatchObject({ date: '2026-11-03', today: '2026-11-03', readOnly: false, done: 0, total: 3 });
    expect(next.items.every((i) => !i.checked && i.checkedBy === null)).toBe(true);

    // 어제 기록은 그대로 조회되고 읽기 전용이다
    const yesterday = await day(a, staff, 'open', '?date=2026-11-02');
    expect(yesterday).toMatchObject({ date: '2026-11-02', today: '2026-11-03', readOnly: true, done: 1 });
    expect(yesterday.items[0]).toMatchObject({ checked: true, checkedBy: { id: staff.userId }, checkedAt });
    // 체크를 풀어도 오늘 기록만 지워지고 어제 기록은 바뀌지 않는다
    const undo = await check(a, staff, first.id, false);
    expect(undo.json<{ data: ChecklistDay }>().data.date).toBe('2026-11-03');
    expect((await day(a, staff, 'open', '?date=2026-11-02')).items[0]?.checked).toBe(true);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM checklist_checks WHERE date = ?', ['2026-11-02'])?.n).toBe(1);
  });

  test('phase-03-task-04 AC4: 체크를 풀면 오늘 줄이 지워지고, 앞으로의 날짜·잘못된 날짜는 볼 수 없다', async () => {
    const { app: a } = await makeApp();
    const { staff, items } = await setup(a);
    await check(a, staff, items[1]!.id, true);
    const off = await check(a, staff, items[1]!.id, false);
    expect(off.json<{ data: ChecklistDay }>().data.done).toBe(0);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM checklist_checks')?.n).toBe(0);
    const future = await a.inject({ method: 'GET', url: '/api/checklists/open?date=2026-11-03', headers: staff.headers });
    expect(future.statusCode).toBe(400);
    const wrong = await a.inject({ method: 'GET', url: '/api/checklists/open?date=2026-02-30', headers: staff.headers });
    expect(wrong.statusCode).toBe(400);
    const badKind = await a.inject({ method: 'GET', url: '/api/checklists/lunch', headers: staff.headers });
    expect(badKind.statusCode).toBe(400);
    const missing = await check(a, staff, 9999, true);
    expect(missing.statusCode).toBe(404);
  });
});

describe('체크리스트 항목 편집', () => {
  test('phase-03-task-04 AC5: 항목 순서를 바꿔 저장하면 다시 불러와도 그 순서가 유지된다', async () => {
    const { app: a } = await makeApp();
    const { manager, staff, items } = await setup(a);
    const [x, y, z] = items as [ChecklistDay['items'][0], ChecklistDay['items'][0], ChecklistDay['items'][0]];
    const r = await saveItems(a, manager, 'open', [
      { id: z.id, text: z.text, roleHint: z.roleHint },
      { id: x.id, text: x.text, roleHint: x.roleHint },
      { text: '대기실 정리', roleHint: 'other' },
      { id: y.id, text: '체어·석션 작동 확인', roleHint: 'assistant' },
    ]);
    expect(r.statusCode).toBe(200);
    // 새로 불러오기(다른 사용자, 새 요청)
    const again = await day(a, staff, 'open');
    expect(again.items.map((i) => i.text)).toEqual(['멸균기 예열', '출입문 조명 켜기', '대기실 정리', '체어·석션 작동 확인']);
    expect(again.items.map((i) => i.sort)).toEqual([0, 1, 2, 3]);
    expect(again.items[3]).toMatchObject({ id: y.id, roleHint: 'assistant' });
    // 마감 목록은 따로다
    expect((await day(a, staff, 'close')).total).toBe(0);
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'checklist.items_save'")?.n).toBe(2);
  });

  test('phase-03-task-04 AC5: 목록에서 뺀 항목은 사용 중지되지만, 그날 체크 기록이 있으면 지난 날짜 조회에 남는다', async () => {
    const { app: a, clock } = await makeApp();
    const { manager, staff: staff0, items } = await setup(a);
    let staff = staff0;
    await check(a, staff, items[2]!.id, true);
    const r = await saveItems(a, manager, 'open', items.slice(0, 2).map((i) => ({ id: i.id, text: i.text, roleHint: i.roleHint })));
    // 오늘 체크한 항목은 오늘 화면에 남아 기록을 보여 준다
    const today = r.json<{ data: ChecklistDay }>().data;
    expect(today.items.find((i) => i.id === items[2]!.id)).toMatchObject({ active: false, checked: true });
    // 사용 중지한 항목은 더 체크할 수 없다
    expect((await check(a, staff, items[2]!.id, false)).statusCode).toBe(404);
    clock.advance(DAY_MS);
    staff = relogin(a, staff);
    expect((await day(a, staff, 'open')).items.map((i) => i.id)).toEqual([items[0]!.id, items[1]!.id]);
    expect((await day(a, staff, 'open', '?date=2026-11-02')).items.map((i) => i.id)).toContain(items[2]!.id);
  });

  test('phase-03-task-04 AC5: staff는 항목을 편집할 수 없고(403), 잘못된 항목 번호·빈 내용은 400이다', async () => {
    const { app: a } = await makeApp();
    const { manager, staff, items } = await setup(a);
    const denied = await saveItems(a, staff, 'open', [{ text: '직원이 바꿈' }]);
    expect(denied.statusCode).toBe(403);
    const closeItem = (await saveItems(a, manager, 'close', [{ text: '마감 항목' }])).json<{ data: ChecklistDay }>().data.items[0]!;
    const wrongKind = await saveItems(a, manager, 'open', [{ id: closeItem.id, text: '마감 항목을 오픈으로' }]);
    expect(wrongKind.statusCode).toBe(400);
    const dup = await saveItems(a, manager, 'open', [{ id: items[0]!.id, text: 'a' }, { id: items[0]!.id, text: 'b' }]);
    expect(dup.statusCode).toBe(400);
    const empty = await saveItems(a, manager, 'open', [{ text: '   ' }]);
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.fields['items.0.text']).toBe('항목 내용을 적어 주세요.');
    const badRole = await saveItems(a, manager, 'open', [{ text: '항목', roleHint: 'patient' }]);
    expect(badRole.statusCode).toBe(400);
    // 아무것도 바뀌지 않았다
    expect((await day(a, staff, 'open')).items.map((i) => i.text)).toEqual(['출입문 조명 켜기', '체어 작동 확인', '멸균기 예열']);
  });
});

// 이 파일이 하는 일: 장비 점검·유지보수 API·계산·알림 scanner(equipment.ts, equipment-notify.ts)를 실제 라우트와 DB로 확인한다(FR-101, phase-04-task-03 AC3).
// 점검 주기 6개월 장비의 마지막 점검 2026-05-10 → 다음 2026-11-10·D-8, 점검 기록이 없을 때 설치일 기준 계산, 등록·수정 권한(manager 이상),
// 첨부 파일(multipart, purpose equipment) 이력, 연결된 법정 일정 표시, D-30/D-7 알림과 중복 방지, 데모 데이터 모양을 본다.
// 요청은 fastify.inject로 보내고, 시계는 manualClock(기준 2026-11-02 09:00 KST)으로 움직인다. 데이터는 임시 폴더만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock, type ManualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { runNotifyScan } from '../../jobs/notify-job.ts';
import type { Equipment, EquipmentDetail, EquipmentList, EquipmentLog } from '../../../shared/schemas/equipment.ts';
import { equipmentDueState, listEquipmentDue, nextInspectionOn } from './equipment.ts';
import { equipmentNotifyScanner } from './equipment-notify.ts';
import { DEMO_EQUIPMENT, seedDemo, tables } from './seed.ts';

const START = '2026-11-02T09:00:00+09:00';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

async function makeApp(): Promise<{ app: FastifyInstance; clock: ManualClock }> {
  tmp = makeTmpDir('dentalax-equip-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return { app, clock };
}

async function createEq(a: FastifyInstance, who: TestLogin, payload: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: '/api/equipment', headers: who.writeHeaders, payload });
}
async function addLog(a: FastifyInstance, who: TestLogin, id: number, payload: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: `/api/equipment/${id}/logs`, headers: who.writeHeaders, payload });
}
async function list(a: FastifyInstance, who: TestLogin): Promise<EquipmentList> {
  const r = await a.inject({ method: 'GET', url: '/api/equipment', headers: who.headers });
  expect(r.statusCode).toBe(200);
  return r.json<{ data: EquipmentList }>().data;
}

/** multipart 본문(파일 하나 + 글 칸) */
function multipart(file: { name: string; data: Buffer }, fields: Record<string, string>) {
  const boundary = '----dentalaxEquipBoundary42';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('장비 다음 점검일', () => {
  test('phase-04-task-03 AC3: 점검 주기 6개월 장비의 마지막 점검 2026-05-10 → 다음 점검 2026-11-10, D-8(기준일 2026-11-02)', async () => {
    const { app: a } = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const r = await createEq(a, manager, { name: '오토클레이브 1호기', kind: 'sterilizer', installedOn: '2022-03-15', vendorName: '한빛메디칼', inspectCycleMonths: 6 });
    expect(r.statusCode).toBe(201);
    const eq = r.json<{ data: Equipment }>().data;
    // 점검 기록 전: 설치일 기준(2022-03-15 + 6개월 = 2022-09-15, 이미 지남)
    expect(eq.dueBase).toBe('installed');
    expect(eq.nextInspectionOn).toBe('2022-09-15');
    expect(eq.dueState).toBe('overdue');
    // 직원이 점검 이력을 남긴다(예전 기록 → 최근 기록 순서가 아니어도 가장 늦은 날이 기준)
    expect((await addLog(a, staff, eq.id, { date: '2026-05-10', kind: 'inspection', content: '정기 점검: 필터 교체', vendorName: '한빛메디칼' })).statusCode).toBe(201);
    expect((await addLog(a, staff, eq.id, { date: '2025-11-10', kind: 'inspection', content: '정기 점검' })).statusCode).toBe(201);
    expect((await addLog(a, staff, eq.id, { date: '2026-08-01', kind: 'repair', content: '급수 펌프 교체', cost: 280000 })).statusCode).toBe(201);
    const after = (await list(a, staff)).items.find((i) => i.id === eq.id);
    expect(after).toMatchObject({ lastInspectionOn: '2026-05-10', lastRepairOn: '2026-08-01', dueBase: 'inspection', nextInspectionOn: '2026-11-10', daysLeft: 8, dueState: 'upcoming', logCount: 3, repairCostTotal: 280000 });
    // 대시보드용 목록에 D-8로 들어간다
    expect(listEquipmentDue(a.db, a.clock).map((e) => [e.name, e.daysLeft])).toEqual([['오토클레이브 1호기', 8]]);
  });

  test('phase-04-task-03 AC3: 계산 규칙 — 주기 없음·기준일 없음·사용 중지·월말 처리', () => {
    expect(nextInspectionOn('2026-05-10', '2022-03-15', 6)).toEqual({ base: 'inspection', next: '2026-11-10' });
    expect(nextInspectionOn(null, '2026-08-31', 6)).toEqual({ base: 'installed', next: '2027-02-28' });
    expect(nextInspectionOn(null, null, 6)).toEqual({ base: null, next: null });
    expect(nextInspectionOn('2026-05-10', null, null)).toEqual({ base: null, next: null });
    expect(equipmentDueState({ active: false, hasCycle: true, daysLeft: 3 })).toBe('off');
    expect(equipmentDueState({ active: true, hasCycle: false, daysLeft: null })).toBe('no_cycle');
    expect(equipmentDueState({ active: true, hasCycle: true, daysLeft: null })).toBe('first_needed');
    expect(equipmentDueState({ active: true, hasCycle: true, daysLeft: -1 })).toBe('overdue');
    expect(equipmentDueState({ active: true, hasCycle: true, daysLeft: 0 })).toBe('today');
    expect(equipmentDueState({ active: true, hasCycle: true, daysLeft: 7 })).toBe('soon');
    expect(equipmentDueState({ active: true, hasCycle: true, daysLeft: 8 })).toBe('upcoming');
    expect(equipmentDueState({ active: true, hasCycle: true, daysLeft: 31 })).toBe('ok');
  });
});

describe('장비 등록·이력 API', () => {
  test('phase-04-task-03 FR-101: 등록·수정은 manager 이상만, 이력은 직원도 남긴다. 앞날짜·잘못된 값은 400', async () => {
    const { app: a } = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    expect((await createEq(a, staff, { name: '석션', kind: 'suction' })).statusCode).toBe(403);
    const bad = await createEq(a, manager, { name: '', kind: 'robot', inspectCycleMonths: 0 });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json<{ error: { fields: Record<string, string> } }>().error.fields).sort()).toEqual(['inspectCycleMonths', 'kind', 'name']);
    expect((await createEq(a, manager, { name: '석션', kind: 'suction', installedOn: '2026-11-03' })).statusCode).toBe(400);
    const eq = (await createEq(a, manager, { name: '석션', kind: 'suction' })).json<{ data: Equipment }>().data;
    expect(eq.dueState).toBe('no_cycle');

    expect((await a.inject({ method: 'PATCH', url: `/api/equipment/${eq.id}`, headers: staff.writeHeaders, payload: { inspectCycleMonths: 12 } })).statusCode).toBe(403);
    const patched = await a.inject({ method: 'PATCH', url: `/api/equipment/${eq.id}`, headers: manager.writeHeaders, payload: { inspectCycleMonths: 12, installedOn: '2026-01-05', memo: '진료실 공용' } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ data: Equipment }>().data).toMatchObject({ inspectCycleMonths: 12, nextInspectionOn: '2027-01-05', dueState: 'ok' });
    const unknown = await a.inject({ method: 'PATCH', url: `/api/equipment/${eq.id}`, headers: manager.writeHeaders, payload: { lastInspectionOn: '2026-01-01' } });
    expect(unknown.statusCode).toBe(400);
    const audit = a.db.get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'equipment.update' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(audit?.detail ?? '{}').changes.inspect_cycle_months).toEqual({ from: null, to: 12 });

    expect((await addLog(a, staff, eq.id, { date: '2026-11-03', kind: 'repair', content: '모터 교체' })).statusCode).toBe(400);
    expect((await addLog(a, staff, eq.id, { date: '2026-11-01', kind: 'repair', content: '' })).statusCode).toBe(400);
    expect((await addLog(a, staff, eq.id, { date: '2026-11-01', kind: 'repair', content: '모터', cost: -5 })).statusCode).toBe(400);
    expect((await addLog(a, staff, 9999, { date: '2026-11-01', kind: 'repair', content: '모터' })).statusCode).toBe(404);
    const ok = await addLog(a, staff, eq.id, { date: '2026-11-01', kind: 'repair', content: '모터 교체', cost: 120000, vendorName: '하늘덴탈서비스' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json<{ data: EquipmentLog }>().data).toMatchObject({ kind: 'repair', cost: 120000, user: { id: staff.userId } });
    // 사용 중지하면 다음 점검 상태가 off가 되고 대시보드 목록에서 빠진다
    await a.inject({ method: 'PATCH', url: `/api/equipment/${eq.id}`, headers: manager.writeHeaders, payload: { active: false } });
    expect((await list(a, staff)).items.find((i) => i.id === eq.id)?.dueState).toBe('off');
  });

  test('phase-04-task-03 FR-101: 첨부 파일(PDF)과 함께 점검 이력을 남기면 장비 상세에 파일 이름이 보이고 내려받을 수 있다', async () => {
    const { app: a } = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const eq = (await createEq(a, manager, { name: '파노라마 촬영장치', kind: 'xray', inspectCycleMonths: 12 })).json<{ data: Equipment }>().data;
    const m = multipart({ name: '점검성적서.pdf', data: PDF }, { date: '2026-10-28', kind: 'inspection', content: '업체 정기 점검', cost: '55,000' });
    const r = await a.inject({ method: 'POST', url: `/api/equipment/${eq.id}/logs`, headers: { ...staff.writeHeaders, ...m.headers }, payload: m.payload });
    expect(r.statusCode).toBe(201);
    const log = r.json<{ data: EquipmentLog }>().data;
    expect(log).toMatchObject({ cost: 55000, file: { name: '점검성적서.pdf' } });
    expect(a.db.get<{ purpose: string }>('SELECT purpose FROM files WHERE id = ?', [log.file?.id ?? 0])?.purpose).toBe('equipment');
    const file = await a.inject({ method: 'GET', url: `/api/files/${log.file?.id}`, headers: staff.headers });
    expect(file.statusCode).toBe(200);
    // 실행 파일은 받지 않는다
    const exe = multipart({ name: 'virus.pdf', data: Buffer.from('MZ\x90\x00 not a pdf') }, { date: '2026-10-28', kind: 'inspection', content: 'x' });
    expect((await a.inject({ method: 'POST', url: `/api/equipment/${eq.id}/logs`, headers: { ...staff.writeHeaders, ...exe.headers }, payload: exe.payload })).statusCode).toBe(415);
    // 다른 쓰임새 파일 번호는 거절
    expect((await addLog(a, staff, eq.id, { date: '2026-10-28', kind: 'inspection', content: 'x', fileId: 999 })).statusCode).toBe(400);
  });

  test('phase-04-task-03 FR-101: 장비에 연결한 법정 일정(방사선 정기검사)이 장비 상세에 다음 예정일과 함께 보인다', async () => {
    const { app: a } = await makeApp();
    const manager = loginAs(a, 'manager');
    const eq = (await createEq(a, manager, { name: '파노라마 촬영장치', kind: 'xray', inspectCycleMonths: 12 })).json<{ data: Equipment }>().data;
    const now = a.clock.now().toISOString();
    a.db.run(
      "INSERT INTO legal_tasks (template_key, title, category, cycle_months, basis, verify_status, applicability, enabled, equipment_id, last_done_on, created_at, updated_at) VALUES (NULL, '파노라마 정기검사', 'radiation', 36, '진단용 방사선 규칙 제4조', 'verified', 'always', 1, ?, '2023-11-23', ?, ?)",
      [eq.id, now, now],
    );
    const d = (await a.inject({ method: 'GET', url: `/api/equipment/${eq.id}`, headers: manager.headers })).json<{ data: EquipmentDetail }>().data;
    expect(d.legalTasks).toEqual([{ id: expect.any(Number), title: '파노라마 정기검사', lastDoneOn: '2023-11-23', nextDueOn: '2026-11-23' }]);
    expect((await a.inject({ method: 'GET', url: '/api/equipment/9999', headers: manager.headers })).statusCode).toBe(404);
  });
});

describe('장비 점검 알림', () => {
  test('phase-04-task-03 FR-101: 다음 점검일이 30일 안이면 manager 이상에게 equipment_due 알림, 같은 단계는 한 번만, 7일 안이 되면 새 단계', async () => {
    const { app: a, clock } = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const eq = (await createEq(a, manager, { name: '오토클레이브 1호기', kind: 'sterilizer', inspectCycleMonths: 6 })).json<{ data: Equipment }>().data;
    await addLog(a, staff, eq.id, { date: '2026-05-10', kind: 'inspection', content: '정기 점검' });
    const r1 = await runNotifyScan(a.db, clock, [equipmentNotifyScanner]);
    expect(r1.errors).toEqual([]);
    const rows = () => a.db.all<{ user_id: number; title: string; link: string; dedupe_key: string }>("SELECT user_id, title, link, dedupe_key FROM notifications WHERE type = 'equipment_due' ORDER BY id");
    expect(rows().map((n) => n.user_id)).toEqual([manager.userId]);
    expect(rows()[0]).toMatchObject({ title: '오토클레이브 1호기 정기 점검이 8일 남았어요', link: `/facility/equipment?open=${eq.id}`, dedupe_key: `equipment:${eq.id}:2026-11-10:d30` });
    await runNotifyScan(a.db, clock, [equipmentNotifyScanner]);
    expect(rows()).toHaveLength(1);
    clock.advance(2 * 24 * 3600 * 1000);
    await runNotifyScan(a.db, clock, [equipmentNotifyScanner]);
    expect(rows().map((n) => n.title)).toEqual(['오토클레이브 1호기 정기 점검이 8일 남았어요', '오토클레이브 1호기 정기 점검이 6일 남았어요']);
  });
});

describe('장비 데모 데이터', () => {
  test('phase-04-task-03 seed: 장비 6대·이력·멸균 기록 30일이 들어가고, 1호기는 D-8, 방사선 장비가 법정 일정에 연결된다. 다시 넣어도 늘지 않는다', async () => {
    const { app: a } = await makeApp();
    loginAs(a, 'manager', { username: 'yoongaram' });
    expect(tables).toEqual(expect.arrayContaining(['equipment', 'equipment_logs', 'sterilizer_logs']));
    seedDemo(a.db, { clock: a.clock, scale: 1 });
    const n = (sql: string) => a.db.get<{ n: number }>(sql)?.n ?? 0;
    expect(n('SELECT COUNT(*) AS n FROM equipment')).toBe(DEMO_EQUIPMENT.length);
    expect(DEMO_EQUIPMENT).toHaveLength(6);
    const due = listEquipmentDue(a.db, a.clock).map((e) => [e.name, e.daysLeft]);
    expect(due).toContainEqual(['오토클레이브 1호기', 8]);
    expect(due).toContainEqual(['파노라마 촬영장치', -5]);
    const days = n('SELECT COUNT(DISTINCT date) AS n FROM sterilizer_logs');
    expect(days).toBeGreaterThanOrEqual(25);
    expect(n("SELECT COUNT(*) AS n FROM sterilizer_logs WHERE result = 'fail' AND action_at IS NULL")).toBe(1);
    expect(n("SELECT COUNT(*) AS n FROM sterilizer_logs WHERE result = 'fail' AND action_at IS NOT NULL")).toBe(1);
    expect(n('SELECT COUNT(*) AS n FROM legal_tasks WHERE equipment_id IS NOT NULL')).toBe(2);
    const before = n('SELECT COUNT(*) AS n FROM sterilizer_logs');
    seedDemo(a.db, { clock: a.clock, scale: 1 });
    expect(n('SELECT COUNT(*) AS n FROM sterilizer_logs')).toBe(before);
  });
});

// 이 파일이 하는 일: 멸균기 점검 기록 API(sterilizer.ts)를 실제 라우트와 DB로 확인한다(FR-102, phase-04-task-03 AC1·AC2·AC4의 서버 부분).
// 입력 칸 목록·DB 열에 환자 관련 칸이 없는지(AC1), "불합격" 저장 → manager 이상 알림 즉시 1건 → 조치 전 경고 목록에 남음 → 조치 기록 후 빠짐(AC2),
// 기간 조회·CSV 내보내기가 그 기간 기록을 모두 담는지(AC4), 멸균기 아닌 장비·앞날짜·모르는 칸 거절을 본다.
// 요청은 fastify.inject로 보내고, 시계는 manualClock(기준 2026-11-02 09:00 KST)이다. 데이터는 임시 폴더만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock } from '../../lib/clock.ts';
import { addDays } from '../../lib/dates.ts';
import { decodeCsvBytes, parseCsvRows } from '../../lib/csv.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { STERILIZER_INPUT_FIELDS, type Equipment, type SterilizerLog, type SterilizerLogList } from '../../../shared/schemas/equipment.ts';
import { listOpenSterilizerFailures, STERILIZER_CSV_HEADER, sterilizerLogSchema } from './sterilizer.ts';

const START = '2026-11-02T09:00:00+09:00';

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

async function makeApp(): Promise<FastifyInstance> {
  tmp = makeTmpDir('dentalax-steril-');
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock: manualClock(START) });
  return app;
}

async function makeEq(a: FastifyInstance, who: TestLogin, name: string, kind = 'sterilizer'): Promise<Equipment> {
  const r = await a.inject({ method: 'POST', url: '/api/equipment', headers: who.writeHeaders, payload: { name, kind, inspectCycleMonths: 6 } });
  expect(r.statusCode).toBe(201);
  return r.json<{ data: Equipment }>().data;
}
async function post(a: FastifyInstance, who: TestLogin, payload: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: '/api/sterilizer-logs', headers: who.writeHeaders, payload });
}
async function listLogs(a: FastifyInstance, who: TestLogin, query = ''): Promise<SterilizerLogList> {
  const r = await a.inject({ method: 'GET', url: `/api/sterilizer-logs${query}`, headers: who.headers });
  expect(r.statusCode).toBe(200);
  return r.json<{ data: SterilizerLogList }>().data;
}

/** 환자 관련으로 볼 이름 조각(입력 칸·DB 열 검사용) */
const PATIENT_WORDS = ['patient', 'chart', 'rrn', 'resident', 'ssn', 'birth', 'diagnos', 'treatment', 'insurance', 'phone', 'address', 'name'];

describe('멸균 기록 입력 칸', () => {
  test('phase-04-task-03 AC1: 멸균 기록 입력 칸 목록과 sterilizer_logs 열에 환자 관련 칸이 없고, 환자 칸을 보내면 저장하지 않는다', async () => {
    const a = await makeApp();
    // 입력 칸 목록(화면 양식과 API가 함께 쓰는 목록) = 서버 스키마 칸
    expect(Object.keys(sterilizerLogSchema.shape).sort()).toEqual([...STERILIZER_INPUT_FIELDS].sort());
    expect([...STERILIZER_INPUT_FIELDS]).toEqual(['equipmentId', 'date', 'testType', 'cycleNo', 'tempC', 'pressureKpa', 'minutes', 'result', 'actionTaken']);
    for (const f of STERILIZER_INPUT_FIELDS) for (const w of PATIENT_WORDS) expect(f.toLowerCase(), f).not.toContain(w);
    // DB 열
    const cols = a.db.all<{ name: string }>('PRAGMA table_info(sterilizer_logs)').map((c) => c.name);
    expect(cols).toEqual(['id', 'equipment_id', 'date', 'test_type', 'cycle_no', 'temp_c', 'pressure_kpa', 'minutes', 'result', 'action_taken', 'action_at', 'action_user_id', 'user_id', 'created_at']);
    for (const c of cols) for (const w of PATIENT_WORDS) expect(c, c).not.toContain(w);
    // 환자 이름 칸을 끼워 보내면 400, 저장되지 않는다
    const manager = loginAs(a, 'manager');
    const eq = await makeEq(a, manager, '오토클레이브 1호기');
    const r = await post(a, manager, { equipmentId: eq.id, date: '2026-11-02', testType: 'bd', result: 'pass', patientName: '홍길동', chartNo: '12345' });
    expect(r.statusCode).toBe(400);
    expect(r.json<{ error: { fields: Record<string, string> } }>().error.fields._).toBe('멸균 기록에 없는 칸이 들어 있어요. 환자 정보는 적지 않아요.');
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sterilizer_logs')?.n).toBe(0);
  });
});

describe('멸균 불합격 알림·조치', () => {
  test('phase-04-task-03 AC2: BI "불합격" 저장 → manager 이상 알림 즉시 1건씩, 조치 전 경고 목록에 남고 → 조치 기록 후 빠진다', async () => {
    const a = await makeApp();
    const admin = loginAs(a, 'admin');
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const eq = await makeEq(a, manager, '오토클레이브 1호기');
    // 합격은 알림이 없다
    const pass = await post(a, staff, { equipmentId: eq.id, date: '2026-11-02', testType: 'bd', cycleNo: '1001', tempC: 134, pressureKpa: 216, minutes: 3.5, result: 'pass' });
    expect(pass.statusCode).toBe(201);
    expect(pass.json<{ notified: number }>().notified).toBe(0);
    // 불합격(직원이 기록)
    const fail = await post(a, staff, { equipmentId: eq.id, date: '2026-11-02', testType: 'bi', cycleNo: '1002', tempC: 134, pressureKpa: 216, minutes: 4, result: 'fail' });
    expect(fail.statusCode).toBe(201);
    const log = fail.json<{ data: SterilizerLog; notified: number }>();
    expect(log.notified).toBe(2);
    expect(log.data).toMatchObject({ result: 'fail', actionAt: null, user: { id: staff.userId }, testType: 'bi', equipmentName: '오토클레이브 1호기' });
    const notes = a.db.all<{ user_id: number; title: string; link: string }>("SELECT user_id, title, link FROM notifications WHERE type = 'sterilizer_fail' ORDER BY user_id");
    expect(notes.map((n) => n.user_id).sort((x, y) => x - y)).toEqual([admin.userId, manager.userId].sort((x, y) => x - y));
    expect(notes.filter((n) => n.user_id === manager.userId)).toHaveLength(1);
    expect(notes.find((n) => n.user_id === staff.userId)).toBeUndefined();
    expect(notes[0]).toMatchObject({ title: '오토클레이브 1호기 BI(생물학적 지표) 불합격이에요', link: `/facility/sterilizer?focus=${log.data.id}` });
    // 조치 전 경고: 대시보드용 함수와 화면 목록(기간 밖이어도)에 남는다
    expect(listOpenSterilizerFailures(a.db).map((l) => l.id)).toEqual([log.data.id]);
    expect((await listLogs(a, staff, '?from=2026-10-01&to=2026-10-31')).openFailures.map((l) => l.id)).toEqual([log.data.id]);
    // 조치 기록(빈 내용은 400, 합격 기록은 409)
    expect((await a.inject({ method: 'POST', url: `/api/sterilizer-logs/${log.data.id}/action`, headers: staff.writeHeaders, payload: { actionTaken: ' ' } })).statusCode).toBe(400);
    const passId = pass.json<{ data: SterilizerLog }>().data.id;
    expect((await a.inject({ method: 'POST', url: `/api/sterilizer-logs/${passId}/action`, headers: staff.writeHeaders, payload: { actionTaken: '재멸균' } })).statusCode).toBe(409);
    const act = await a.inject({ method: 'POST', url: `/api/sterilizer-logs/${log.data.id}/action`, headers: staff.writeHeaders, payload: { actionTaken: '기구 전부 재멸균, BI 재검사 의뢰' } });
    expect(act.statusCode).toBe(200);
    expect(act.json<{ data: SterilizerLog }>().data).toMatchObject({ actionTaken: '기구 전부 재멸균, BI 재검사 의뢰', actionUser: { id: staff.userId } });
    expect(act.json<{ data: SterilizerLog }>().data.actionAt).toBeTruthy();
    expect(listOpenSterilizerFailures(a.db)).toEqual([]);
    expect((await listLogs(a, staff)).openFailures).toEqual([]);
    // 두 번 조치하면 409, 알림은 그대로 1건씩
    expect((await a.inject({ method: 'POST', url: `/api/sterilizer-logs/${log.data.id}/action`, headers: staff.writeHeaders, payload: { actionTaken: '또' } })).statusCode).toBe(409);
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE type = 'sterilizer_fail'")?.n).toBe(2);
    expect(a.db.all<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'sterilizer.%' ORDER BY id").map((r) => r.action)).toEqual(['sterilizer.log', 'sterilizer.log', 'sterilizer.action']);
  });

  test('phase-04-task-03 AC2: 불합격과 함께 조치 내용을 적으면 알림은 가고 조치 전 경고에는 남지 않는다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const eq = await makeEq(a, manager, '오토클레이브 2호기');
    const r = await post(a, manager, { equipmentId: eq.id, date: '2026-11-01', testType: 'bd', result: 'fail', actionTaken: '도어 패킹 교체 후 재검사 합격' });
    expect(r.statusCode).toBe(201);
    expect(r.json<{ notified: number }>().notified).toBe(1);
    expect(listOpenSterilizerFailures(a.db)).toEqual([]);
    // 합격 기록에 적은 조치 내용은 저장하지 않는다
    const p = await post(a, manager, { equipmentId: eq.id, date: '2026-11-01', testType: 'ci', result: 'pass', actionTaken: '필요 없음' });
    expect(p.json<{ data: SterilizerLog }>().data.actionTaken).toBeNull();
  });

  test('phase-04-task-03 FR-102: 멸균기가 아닌 장비·사용 중지 멸균기·앞날짜·범위 밖 숫자는 400', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const xray = await makeEq(a, manager, '파노라마', 'xray');
    const st = await makeEq(a, manager, '오토클레이브 1호기');
    expect((await post(a, staff, { equipmentId: xray.id, date: '2026-11-02', testType: 'bd', result: 'pass' })).statusCode).toBe(400);
    expect((await post(a, staff, { equipmentId: st.id, date: '2026-11-03', testType: 'bd', result: 'pass' })).statusCode).toBe(400);
    const bad = await post(a, staff, { equipmentId: st.id, date: '2026-11-02', testType: 'xx', tempC: 999, result: 'maybe' });
    expect(Object.keys(bad.json<{ error: { fields: Record<string, string> } }>().error.fields).sort()).toEqual(['result', 'tempC', 'testType']);
    await a.inject({ method: 'PATCH', url: `/api/equipment/${st.id}`, headers: manager.writeHeaders, payload: { active: false } });
    const off = await post(a, staff, { equipmentId: st.id, date: '2026-11-02', testType: 'bd', result: 'pass' });
    expect(off.json<{ error: { fields: Record<string, string> } }>().error.fields.equipmentId).toBe('사용 중지한 멸균기예요. 다른 멸균기를 골라 주세요.');
  });
});

describe('멸균 기록 기간 조회·CSV', () => {
  test('phase-04-task-03 AC4: 기간을 정해 조회·CSV로 내보내면 그 기간 기록이 빠짐없이 들어 있고 기간 밖 기록은 없다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const eq1 = await makeEq(a, manager, '오토클레이브 1호기');
    const eq2 = await makeEq(a, manager, '오토클레이브 2호기');
    // 2026-09-25 ~ 2026-11-02 매일 1호기 2건, 2호기 1건
    const want: string[] = [];
    for (let d = 0; d <= 38; d += 1) {
      const date = addDays('2026-09-25', d);
      for (const [eq, n] of [[eq1, 2], [eq2, 1]] as const) {
        for (let i = 0; i < n; i += 1) {
          const cycleNo = `C${eq.id}-${date.replace(/-/g, '')}-${i}`;
          const r = await post(a, staff, { equipmentId: eq.id, date, testType: 'cycle', cycleNo, tempC: 134, pressureKpa: 216, minutes: 4, result: 'pass' });
          expect(r.statusCode).toBe(201);
          if (date >= '2026-10-01' && date <= '2026-10-31') want.push(cycleNo);
        }
      }
    }
    expect(want).toHaveLength(93);
    const l = await listLogs(a, staff, '?from=2026-10-01&to=2026-10-31');
    expect(l.items.map((i) => i.cycleNo).sort()).toEqual([...want].sort());
    expect(l.items[0]?.date).toBe('2026-10-01');
    expect(l.sterilizers.map((s) => s.name)).toEqual(['오토클레이브 1호기', '오토클레이브 2호기']);
    // 멸균기 하나만
    expect((await listLogs(a, staff, `?from=2026-10-01&to=2026-10-31&equipmentId=${eq2.id}`)).items).toHaveLength(31);
    // 기본 기간: 오늘 포함 지난 30일
    const def = await listLogs(a, staff);
    expect([def.from, def.to]).toEqual(['2026-10-04', '2026-11-02']);

    const csv = await a.inject({ method: 'GET', url: '/api/sterilizer-logs/export?from=2026-10-01&to=2026-10-31', headers: staff.headers });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(String(csv.headers['content-disposition'])).toContain(encodeURIComponent('멸균기록_2026-10-01_2026-10-31.csv'));
    const rows = parseCsvRows(decodeCsvBytes(csv.rawPayload).text).map((r) => r.cells);
    expect(rows[0]).toEqual([...STERILIZER_CSV_HEADER]);
    expect(rows.slice(1).map((r) => r[3]).sort()).toEqual([...want].sort());
    expect(rows[1]?.slice(0, 8)).toEqual(['2026-10-01', '오토클레이브 1호기', '사이클 기록', expect.any(String), '134', '216', '4', '합격']);
    // 거꾸로 된 기간·너무 긴 기간은 400
    expect((await a.inject({ method: 'GET', url: '/api/sterilizer-logs?from=2026-11-01&to=2026-10-01', headers: staff.headers })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/api/sterilizer-logs?from=2025-01-01&to=2026-11-01', headers: staff.headers })).statusCode).toBe(400);
  });

  test('phase-04-task-03 AC4: CSV 칸이 =, +, -, @로 시작하면 수식으로 실행되지 않게 작은따옴표를 붙인다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const eq = await makeEq(a, manager, '=HYPERLINK("x")');
    await post(a, manager, { equipmentId: eq.id, date: '2026-11-02', testType: 'bd', cycleNo: '@SUM(1)', result: 'fail', actionTaken: '-재멸균' });
    const csv = await a.inject({ method: 'GET', url: '/api/sterilizer-logs/export', headers: manager.headers });
    const rows = parseCsvRows(decodeCsvBytes(csv.rawPayload).text).map((r) => r.cells);
    expect(rows[1]?.[1]).toBe(`'=HYPERLINK("x")`);
    expect(rows[1]?.[3]).toBe("'@SUM(1)");
    expect(rows[1]?.[9]).toBe("'-재멸균");
  });
});

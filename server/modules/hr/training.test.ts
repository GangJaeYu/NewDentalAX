// 이 파일이 하는 일: 교육 이수 기록 API(training.ts·training-routes.ts·training-notify.ts, FR-082)를 실제 라우트와 DB로 확인한다(phase-04-task-02 AC1·AC2).
// 주기 12개월 교육을 2025-12-01에 이수 → 다음 예정 2026-12-01(D-29) → 해당 직원과 manager 이상에게 알림(다른 직원은 받지 않음), 같은 단계는 한 번만.
// 증빙 파일(PDF) 업로드 → 같은 바이트로 내려받기(첨부 파일), 다른 직원은 403, 형식이 틀리면 415. 권한·날짜 계산·상태 규칙도 본다.
// 요청은 fastify.inject로 보내고 시계는 2026-11-02 09:00(월)으로 고정한다. 데이터는 .tmp/unit/ 임시 폴더만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { runNotifyScan } from '../../jobs/notify-job.ts';
import { seedDemo as seedAdminDemo } from '../admin/seed.ts';
import { seedDemo as seedHrDemo } from './seed.ts';
import { clearableTables } from '../admin/demo-service.ts';
import { trainingNextDue, trainingState } from './training.ts';
import { trainingNotifyScanner, trainingStage } from './training-notify.ts';
import type { TrainingItem, TrainingOverview, TrainingRecordItem, TrainingRecordResult } from '../../../shared/schemas/training.ts';
import { cycleLabel } from '../../../shared/schemas/training.ts';

const START = '2026-11-02T09:00:00+09:00';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

async function makeApp() {
  tmp = makeTmpDir('dentalax-training-');
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock: manualClock(START) });
  return app;
}

/** multipart 본문(파일 하나 + 글 칸) */
function multipart(file: { name: string; data: Buffer; type?: string }, fields: Record<string, string> = {}) {
  const boundary = '----dentalaxTrainingBoundary9xYz';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function createTraining(a: FastifyInstance, who: TestLogin, body: Record<string, unknown>): Promise<TrainingItem> {
  const res = await a.inject({ method: 'POST', url: '/api/trainings', headers: who.writeHeaders, payload: body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ data: TrainingItem }>().data;
}

async function overview(a: FastifyInstance, who: TestLogin): Promise<TrainingOverview> {
  const res = await a.inject({ method: 'GET', url: '/api/trainings', headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: TrainingOverview }>().data;
}

function notesOf(a: FastifyInstance, userId: number) {
  return a.db.all<{ type: string; title: string; body: string | null; link: string | null; dedupe_key: string }>(
    "SELECT type, title, body, link, dedupe_key FROM notifications WHERE user_id = ? AND type = 'training_due' ORDER BY id",
    [userId],
  );
}

describe('다음 예정일과 임박 알림', () => {
  test('phase-04-task-02 AC1: 주기 12개월 교육을 2025-12-01 이수로 기록하면 다음 예정 2026-12-01(D-29)이고, 해당 직원과 manager에게만 알림이 간다', async () => {
    const a = await makeApp();
    const admin = loginAs(a, 'admin');
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const other = loginAs(a, 'staff');
    const t = await createTraining(a, manager, { name: '감염관리 교육', cycleMonths: 12, description: '해마다' });
    expect(t.cycleMonths).toBe(12);

    // 직원 본인이 기록한다(JSON, 파일 없음)
    const res = await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: staff.writeHeaders, payload: { completedOn: '2025-12-01' } });
    expect(res.statusCode, res.body).toBe(201);
    const saved = res.json<{ data: TrainingRecordResult }>().data;
    expect(saved.status).toMatchObject({ userId: staff.userId, lastCompletedOn: '2025-12-01', nextDueOn: '2026-12-01', daysLeft: 29, state: 'soon' });
    expect(saved.notified).toBeGreaterThanOrEqual(3); // 직원 + 실장 + 원장

    // 받는 사람: 해당 직원·manager·admin. 다른 직원은 받지 않는다
    for (const who of [staff, manager, admin]) {
      const n = notesOf(a, who.userId);
      expect(n, who.username).toHaveLength(1);
      expect(n[0]).toMatchObject({ type: 'training_due', link: '/hr/training', body: '다음 이수 예정일 2026-12-01' });
      expect(n[0]?.title).toContain('감염관리 교육 이수 예정일이 29일 남았어요');
      expect(n[0]?.dedupe_key).toBe(`training:${t.id}:${staff.userId}:2026-12-01:d30`);
    }
    expect(notesOf(a, other.userId)).toHaveLength(0);

    // 실장 화면 목록에도 같은 값이 보인다
    const ov = await overview(a, manager);
    const row = ov.trainings.find((x) => x.id === t.id)?.statuses.find((s) => s.userId === staff.userId);
    expect(row).toMatchObject({ nextDueOn: '2026-12-01', daysLeft: 29, state: 'soon' });
    expect(ov.warnDays).toBe(30);

    // 정시 scanner가 다시 돌아도 같은 단계 알림은 늘지 않는다
    const scan = await runNotifyScan(a.db, a.clock, [trainingNotifyScanner]);
    expect(scan.errors).toEqual([]);
    expect(scan.created).toBe(0);
    expect(notesOf(a, staff.userId)).toHaveLength(1);
  });

  test('phase-04-task-02 AC1: 예정일이 30일보다 멀면 알림이 없고, D-7 단계가 되면 다시 한 번 간다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const t = await createTraining(a, manager, { name: '개인정보 보호 교육', cycleMonths: 12 });
    // 2026-01-15 이수 → 2027-01-15 예정(D-74): 알림 없음
    const far = await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: manager.writeHeaders, payload: { userId: staff.userId, completedOn: '2026-01-15' } });
    expect(far.statusCode, far.body).toBe(201);
    expect(far.json<{ data: TrainingRecordResult }>().data).toMatchObject({ notified: 0, status: { nextDueOn: '2027-01-15', state: 'ok' } });
    expect(notesOf(a, staff.userId)).toHaveLength(0);

    // 2025-11-07 이수를 더 넣어도 최근 이수일(2026-01-15)이 기준이다
    await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: manager.writeHeaders, payload: { userId: staff.userId, completedOn: '2025-11-07' } });
    expect((await overview(a, staff)).trainings[0]?.statuses[0]).toMatchObject({ lastCompletedOn: '2026-01-15', recordCount: 2 });

    // 따로 2025-11-08 이수만 있는 직원: 2026-11-08(D-6) → d7 단계
    const s2 = loginAs(a, 'staff');
    const near = await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: s2.writeHeaders, payload: { completedOn: '2025-11-08' } });
    expect(near.json<{ data: TrainingRecordResult }>().data.status).toMatchObject({ nextDueOn: '2026-11-08', daysLeft: 6, state: 'soon' });
    expect(notesOf(a, s2.userId).map((n) => n.dedupe_key)).toEqual([`training:${t.id}:${s2.userId}:2026-11-08:d7`]);
  });

  test('phase-04-task-02 AC1: 날짜 계산(말일 보정·윤년)과 상태·단계 규칙', () => {
    expect(trainingNextDue('2025-12-01', 12)).toBe('2026-12-01');
    expect(trainingNextDue('2027-02-28', 12)).toBe('2028-02-28');
    expect(trainingNextDue('2028-02-29', 12)).toBe('2029-02-28');
    expect(trainingNextDue('2026-08-31', 6)).toBe('2027-02-28');
    expect(trainingNextDue('2026-01-01', null)).toBeNull();
    expect(trainingNextDue(null, 12)).toBeNull();
    expect(trainingState({ lastCompletedOn: null, cycleMonths: 12, daysLeft: null }, 30)).toBe('none');
    expect(trainingState({ lastCompletedOn: '2026-01-01', cycleMonths: null, daysLeft: null }, 30)).toBe('once');
    expect(trainingState({ lastCompletedOn: '2025-01-01', cycleMonths: 12, daysLeft: -1 }, 30)).toBe('overdue');
    expect(trainingState({ lastCompletedOn: '2025-11-02', cycleMonths: 12, daysLeft: 0 }, 30)).toBe('today');
    expect(trainingState({ lastCompletedOn: '2025-12-01', cycleMonths: 12, daysLeft: 30 }, 30)).toBe('soon');
    expect(trainingState({ lastCompletedOn: '2025-12-03', cycleMonths: 12, daysLeft: 31 }, 30)).toBe('ok');
    expect([trainingStage(-3), trainingStage(0), trainingStage(7), trainingStage(8), trainingStage(30)]).toEqual(['over', 'd0', 'd7', 'd30', 'd30']);
    expect([cycleLabel(12), cycleLabel(24), cycleLabel(6), cycleLabel(null)]).toEqual(['1년마다', '2년마다', '6개월마다', '한 번만']);
  });
});

describe('증빙 파일', () => {
  test('phase-04-task-02 AC2: 증빙 PDF를 올려 기록하면 같은 파일이 첨부 파일로 내려받아지고, 다른 직원은 받을 수 없다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const other = loginAs(a, 'staff');
    const t = await createTraining(a, manager, { name: '감염관리 교육', cycleMonths: 12 });
    const mp = multipart({ name: '감염관리 이수증.pdf', data: PDF, type: 'application/pdf' }, { completedOn: '2026-10-20', note: '보건소 온라인', userId: '' });
    const res = await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: { ...staff.writeHeaders, 'content-type': mp.contentType }, payload: mp.payload });
    expect(res.statusCode, res.body).toBe(201);
    const rec = res.json<{ data: TrainingRecordResult }>().data.record;
    expect(rec).toMatchObject({ completedOn: '2026-10-20', note: '보건소 온라인', user: { id: staff.userId } });
    expect(rec.file).toMatchObject({ name: '감염관리 이수증.pdf', size: PDF.length });
    expect(a.db.get<{ purpose: string }>('SELECT purpose FROM files WHERE id = ?', [rec.file?.id ?? 0])?.purpose).toBe('training');

    // 기록 목록에 파일이 보이고, 본인·실장은 내려받는다
    const list = await a.inject({ method: 'GET', url: `/api/trainings/${t.id}/records`, headers: staff.headers });
    expect(list.json<{ data: TrainingRecordItem[] }>().data.map((r) => r.file?.name)).toEqual(['감염관리 이수증.pdf']);
    for (const who of [staff, manager]) {
      const dl = await a.inject({ method: 'GET', url: `/api/trainings/records/${rec.id}/file`, headers: who.headers });
      expect(dl.statusCode).toBe(200);
      expect(dl.rawPayload.equals(PDF)).toBe(true);
      expect(dl.headers['content-type']).toBe('application/pdf');
      expect(String(dl.headers['content-disposition'])).toContain("attachment; filename=");
      expect(String(dl.headers['content-disposition'])).toContain(encodeURIComponent('감염관리 이수증.pdf'));
    }
    // 다른 직원은 받을 수 없고, 목록에서도 그 기록이 보이지 않는다
    expect((await a.inject({ method: 'GET', url: `/api/trainings/records/${rec.id}/file`, headers: other.headers })).statusCode).toBe(403);
    const otherList = await a.inject({ method: 'GET', url: `/api/trainings/${t.id}/records`, headers: other.headers });
    expect(otherList.json<{ data: TrainingRecordItem[] }>().data).toEqual([]);
  });

  test('phase-04-task-02 AC2: 형식이 틀린 파일은 415로 막고 기록도 남기지 않는다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const t = await createTraining(a, manager, { name: '방사선 안전 교육', cycleMonths: 12 });
    const exe = multipart({ name: '이수증.pdf', data: Buffer.from('MZ\x90\x00 not a pdf') }, { completedOn: '2026-10-01' });
    const res = await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: { ...manager.writeHeaders, 'content-type': exe.contentType }, payload: exe.payload });
    expect(res.statusCode).toBe(415);
    expect(res.json<{ error: { code: string; message: string } }>().error.message).toContain('올릴 수 없는 파일 형식');
    const hwp = multipart({ name: '이수증.docx', data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]) }, { completedOn: '2026-10-01' });
    expect((await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: { ...manager.writeHeaders, 'content-type': hwp.contentType }, payload: hwp.payload })).statusCode).toBe(415);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM training_records')?.n).toBe(0);
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM files WHERE purpose = 'training'")?.n).toBe(0);
  });
});

describe('권한과 입력 검사', () => {
  test('phase-04-task-02: 직원은 교육 항목을 만들거나 다른 직원 기록을 넣을 수 없고, 본인 상태만 본다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const other = loginAs(a, 'staff');
    expect((await a.inject({ method: 'POST', url: '/api/trainings', headers: staff.writeHeaders, payload: { name: '아무 교육' } })).statusCode).toBe(403);
    const t = await createTraining(a, manager, { name: '감염관리 교육', cycleMonths: 12 });
    expect((await a.inject({ method: 'PATCH', url: `/api/trainings/${t.id}`, headers: staff.writeHeaders, payload: { name: 'x' } })).statusCode).toBe(403);
    const forOther = await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: staff.writeHeaders, payload: { userId: other.userId, completedOn: '2026-10-01' } });
    expect(forOther.statusCode).toBe(403);
    // 미래 이수일·없는 날짜는 저장되지 않는다
    const future = await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: staff.writeHeaders, payload: { completedOn: '2026-11-03' } });
    expect(future.statusCode).toBe(400);
    expect(future.json<{ error: { fields: Record<string, string> } }>().error.fields.completedOn).toContain('오늘이나 그 전');
    expect((await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: staff.writeHeaders, payload: { completedOn: '2026-02-30' } })).statusCode).toBe(400);
    // 같은 이름 항목은 409
    expect((await a.inject({ method: 'POST', url: '/api/trainings', headers: manager.writeHeaders, payload: { name: '감염관리 교육' } })).statusCode).toBe(409);

    const mine = await overview(a, staff);
    expect(mine.people.map((p) => p.id)).toEqual([staff.userId]);
    expect(mine.trainings[0]?.statuses.map((s) => s.state)).toEqual(['none']);
    const all = await overview(a, manager);
    expect(all.people.map((p) => p.id)).toEqual(expect.arrayContaining([manager.userId, staff.userId, other.userId]));

    // 끈 항목은 직원 목록에서 빠지고 기록도 받지 않는다
    const off = await a.inject({ method: 'PATCH', url: `/api/trainings/${t.id}`, headers: manager.writeHeaders, payload: { active: false } });
    expect(off.statusCode).toBe(200);
    expect((await overview(a, staff)).trainings).toEqual([]);
    expect((await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: staff.writeHeaders, payload: { completedOn: '2026-10-01' } })).statusCode).toBe(409);
  });

  test('phase-04-task-02: 법정 일정과 연결하고, 잘못 넣은 기록은 본인이나 실장이 지운다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const other = loginAs(a, 'staff');
    const legal = a.db.get<{ id: number; title: string }>("SELECT id, title FROM legal_tasks WHERE template_key = 'infection-edu'");
    expect(legal).toBeTruthy();
    const t = await createTraining(a, manager, { name: '감염관리 교육', cycleMonths: 12, legalTaskId: legal?.id });
    expect(t.legalTask).toEqual({ id: legal?.id, title: legal?.title });
    expect((await a.inject({ method: 'POST', url: '/api/trainings', headers: manager.writeHeaders, payload: { name: '없는 연결', legalTaskId: 99999 } })).statusCode).toBe(400);

    const rec = (await a.inject({ method: 'POST', url: `/api/trainings/${t.id}/records`, headers: staff.writeHeaders, payload: { completedOn: '2026-10-01' } })).json<{ data: TrainingRecordResult }>().data
      .record;
    expect((await a.inject({ method: 'DELETE', url: `/api/trainings/records/${rec.id}`, headers: other.writeHeaders })).statusCode).toBe(403);
    expect((await a.inject({ method: 'DELETE', url: `/api/trainings/records/${rec.id}`, headers: staff.writeHeaders })).statusCode).toBe(200);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM training_records')?.n).toBe(0);
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('training.create', 'training.record', 'training.record.delete')")?.n).toBe(3);
  });
});

describe('데모 데이터', () => {
  test('phase-04-task-02: 데모 교육 항목·이수 기록·온보딩이 들어가고 scanner가 임박·지남 알림을 만든다', async () => {
    const a = await makeApp();
    const ctx = { clock: a.clock, scale: 1 };
    await seedAdminDemo(a.db, ctx);
    seedHrDemo(a.db, ctx);
    seedHrDemo(a.db, ctx); // 두 번 불러도 늘지 않는다
    // 데모 초기화가 비우는 테이블에 교육·온보딩 테이블이 모두 들어 있다(등록표 밖 테이블도 모두 비운다)
    expect(clearableTables(a.db)).toEqual(expect.arrayContaining(['trainings', 'training_records', 'onboarding_templates', 'onboarding_assignments', 'onboarding_progress']));
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM trainings')?.n).toBe(6);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM trainings WHERE legal_task_id IS NOT NULL')?.n).toBe(4);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM onboarding_assignments')?.n).toBe(2);
    const scan = await runNotifyScan(a.db, a.clock, [trainingNotifyScanner]);
    expect(scan.errors).toEqual([]);
    expect(scan.created).toBeGreaterThan(0);
    const seodaon = a.db.get<{ id: number }>("SELECT id FROM users WHERE username = 'seodaon'")?.id ?? 0;
    expect(notesOf(a, seodaon).map((n) => n.title)).toContain('서다온 님 감염관리 교육 이수 기한이 6일 지났어요');
  });
});

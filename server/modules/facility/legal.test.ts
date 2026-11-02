// 이 파일이 하는 일: 법정 의무 일정 API·계산·알림 scanner(legal.ts, legal-notify.ts, legal-templates.ts)를 실제 라우트와 DB로 확인한다(phase-03-task-08 AC1~AC5).
// 기본 템플릿 22개(TD-022)의 근거·출처·확인 상태, 수행 기록 → 다음 예정일·D-day, "해당 없음" 항목이 대시보드 목록·알림에서 빠지는지,
// admin 주기 수정 → 예정일 재계산·감사 로그, manager·staff 권한 거부, D-30/D-7/당일/기한 지남 알림과 중복 방지를 본다.
// 요청은 fastify.inject로 보내고, 시계는 manualClock(기준 2026-11-02 09:00 KST)으로 움직인다. 데이터는 .tmp/unit/ 임시 폴더만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock, type ManualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { runNotifyScan } from '../../jobs/notify-job.ts';
import { ensureLegalTemplates, LEGAL_TEMPLATES } from '../../db/seed/legal-templates.ts';
import { cycleLabel, LEGAL_CHECKED_ON, LEGAL_NOTICE, type LegalTask, type LegalTaskList, type LegalTaskLog } from '../../../shared/schemas/legal.ts';
import { dueStateOf, listLegalDue, nextDueOn } from './legal.ts';
import { legalNotifyScanner, legalStage } from './legal-notify.ts';
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

async function makeApp(): Promise<{ app: FastifyInstance; clock: ManualClock }> {
  tmp = makeTmpDir('dentalax-legal-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return { app, clock };
}

async function list(a: FastifyInstance, who: TestLogin): Promise<LegalTaskList> {
  const res = await a.inject({ method: 'GET', url: '/api/legal-tasks', headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: LegalTaskList }>().data;
}

const byTitle = (l: LegalTaskList, title: string): LegalTask => {
  const t = l.items.find((i) => i.title === title);
  if (!t) throw new Error(`항목 없음: ${title}`);
  return t;
};

async function create(a: FastifyInstance, who: TestLogin, payload: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: '/api/legal-tasks', headers: who.writeHeaders, payload });
}
async function patch(a: FastifyInstance, who: TestLogin, id: number, payload: Record<string, unknown>) {
  return a.inject({ method: 'PATCH', url: `/api/legal-tasks/${id}`, headers: who.writeHeaders, payload });
}
async function done(a: FastifyInstance, who: TestLogin, id: number, payload: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: `/api/legal-tasks/${id}/done`, headers: who.writeHeaders, payload });
}

/** 파노라마 정기검사(3년)를 admin이 만든다 */
async function makePanorama(a: FastifyInstance, admin: TestLogin): Promise<LegalTask> {
  const r = await create(a, admin, {
    title: '파노라마 정기검사',
    category: 'radiation',
    cycleMonths: 36,
    basis: '진단용 방사선 규칙 제4조',
    sourceUrl: 'https://www.law.go.kr/법령/진단용방사선발생장치의안전관리에관한규칙',
    verifyStatus: 'verified',
  });
  expect(r.statusCode).toBe(201);
  return r.json<{ data: LegalTask }>().data;
}

describe('법정 의무 일정 템플릿', () => {
  test('phase-03-task-08 AC1: 목록에 TD-022의 22개 항목이 근거·출처 링크·확인 상태(확인됨/권장값/확인 필요)와 함께 들어 있다', async () => {
    const { app: a } = await makeApp();
    const staff = loginAs(a, 'staff');
    const l = await list(a, staff);
    const templates = l.items.filter((i) => i.templateKey);
    expect(templates).toHaveLength(22);
    expect(templates.map((t) => t.title)).toEqual(LEGAL_TEMPLATES.map((t) => t.title));
    for (const t of templates) {
      expect(t.basis.length, t.title).toBeGreaterThan(3);
      expect(t.sourceUrl, t.title).toMatch(/^https:\/\/www\.law\.go\.kr\//);
      expect(t.checkedOn, t.title).toBe(LEGAL_CHECKED_ON);
      expect(t.appliesText, t.title).toBeTruthy();
      expect(t.cycleText, t.title).toBeTruthy();
    }
    // 상태별 개수: 권장값 3(자체 교육·개인정보 교육·감염병 교육), 확인 필요 1(간호조무사), 나머지 확인됨
    const count = (s: string) => templates.filter((t) => t.verifyStatus === s).length;
    expect([count('verified'), count('recommended'), count('needs_check')]).toEqual([18, 3, 1]);
    expect(byTitle(l, '간호조무사 보수교육·신고')).toMatchObject({ verifyStatus: 'needs_check', cycleMonths: null, dueState: 'no_cycle' });
    expect(byTitle(l, '진단용 방사선 발생장치 정기검사(장비별)')).toMatchObject({ cycleMonths: 36, cycleText: '3년, 만료일 전후 31일이 검사기간', verifyStatus: 'verified' });
    expect(byTitle(l, '의료폐기물 보관시설 소독')).toMatchObject({ cycleDays: 7, cycleText: '주 1회' });
    // 적용 배제 설명(규칙 제18조)이 해당 시 ※ 세 항목에 들어 있다
    for (const title of ['방사선 안전관리책임자 보수교육', '개인 피폭선량 측정(TLD)', '방사선 관계 종사자 건강진단']) {
      expect(byTitle(l, title)).toMatchObject({ applicability: 'conditional' });
      expect(byTitle(l, title).guidance).toContain('10mA·분');
    }
    // 수행 기록이 없으면 "최초 수행일 입력 필요"
    expect(byTitle(l, '의료폐기물 배출자 교육').dueState).toBe('first_needed');
    expect(l).toMatchObject({ today: '2026-11-02', warnDays: 30 });
  });

  test('phase-03-task-08 AC1: 템플릿은 다시 채워도 늘지 않고 관리자가 고친 값을 덮어쓰지 않는다', async () => {
    const { app: a, clock } = await makeApp();
    const admin = loginAs(a, 'admin');
    const t = byTitle(await list(a, admin), '간호조무사 보수교육·신고');
    expect((await patch(a, admin, t.id, { cycleMonths: 12, verifyStatus: 'verified' })).statusCode).toBe(200);
    expect(ensureLegalTemplates(a.db, clock)).toBe(0);
    a.db.run("DELETE FROM legal_tasks WHERE template_key = 'fire-drill'");
    expect(ensureLegalTemplates(a.db, clock)).toBe(1);
    const l = await list(a, admin);
    expect(l.items.filter((i) => i.templateKey)).toHaveLength(22);
    expect(byTitle(l, '간호조무사 보수교육·신고')).toMatchObject({ cycleMonths: 12, verifyStatus: 'verified' });
  });

  test('phase-03-task-08 AC5: 법령 변경 고지 문구에 확인일 2026-11-02가 들어 있다', () => {
    expect(LEGAL_NOTICE).toContain('법령은 바뀔 수 있습니다(확인일 2026-11-02)');
    expect(LEGAL_NOTICE).toContain('관할 기관 안내를 확인하세요');
  });
});

describe('수행 기록과 다음 예정일', () => {
  test('phase-03-task-08 AC2: "파노라마 정기검사" 최근 수행일 2023-11-23 → 다음 예정일 2026-11-23, 2026-11-02 기준 D-21', async () => {
    const { app: a } = await makeApp();
    const admin = loginAs(a, 'admin');
    const manager = loginAs(a, 'manager');
    const pano = await makePanorama(a, admin);
    expect(pano).toMatchObject({ dueState: 'first_needed', nextDueOn: null, cycleText: '3년마다' });
    const r = await done(a, manager, pano.id, { doneOn: '2023-11-23', note: '검사기관 합격' });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ data: LegalTask }>().data).toMatchObject({ lastDoneOn: '2023-11-23', nextDueOn: '2026-11-23', daysLeft: 21, dueState: 'upcoming' });
    expect(byTitle(await list(a, manager), '파노라마 정기검사')).toMatchObject({ nextDueOn: '2026-11-23', daysLeft: 21 });
    // 이력·감사 로그
    const logs = (await a.inject({ method: 'GET', url: `/api/legal-tasks/${pano.id}/logs`, headers: manager.headers })).json<{ data: LegalTaskLog[] }>().data;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ doneOn: '2023-11-23', note: '검사기관 합격', user: { id: manager.userId } });
    const row = a.db.get<{ detail: string; user_id: number }>("SELECT detail, user_id FROM audit_log WHERE action = 'legal.done'");
    expect(row?.user_id).toBe(manager.userId);
    expect(JSON.parse(row?.detail ?? '{}')).toMatchObject({ doneOn: '2023-11-23', nextDueOn: { from: null, to: '2026-11-23' } });
  });

  test('phase-03-task-08 AC2: 예전 날짜를 늦게 적어도 예정일이 뒤로 가지 않고, 앞으로의 날짜·잘못된 날짜는 받지 않는다', async () => {
    const { app: a } = await makeApp();
    const admin = loginAs(a, 'admin');
    const pano = await makePanorama(a, admin);
    expect((await done(a, admin, pano.id, { doneOn: '2023-11-23' })).statusCode).toBe(200);
    const older = await done(a, admin, pano.id, { doneOn: '2020-11-20' });
    expect(older.json<{ data: LegalTask }>().data).toMatchObject({ lastDoneOn: '2023-11-23', nextDueOn: '2026-11-23' });
    const future = await done(a, admin, pano.id, { doneOn: '2026-11-03' });
    expect(future.statusCode).toBe(400);
    expect(future.json().error.fields.doneOn).toBe('오늘이나 지난 날짜를 적어 주세요.');
    expect((await done(a, admin, pano.id, { doneOn: '2026-02-30' })).statusCode).toBe(400);
    expect((await done(a, admin, 9999, { doneOn: '2026-11-01' })).statusCode).toBe(404);
  });

  test('phase-03-task-08 AC2: 주기 계산(개월은 말일 맞춤, 주 단위, 주기 없음)과 상태 구분', () => {
    expect(nextDueOn('2023-11-23', 36, null)).toBe('2026-11-23');
    expect(nextDueOn('2026-08-31', 3, null)).toBe('2026-11-30');
    expect(nextDueOn('2026-10-28', null, 7)).toBe('2026-11-04');
    expect(nextDueOn('2026-10-28', null, null)).toBeNull();
    expect(nextDueOn(null, 12, null)).toBeNull();
    const s = (daysLeft: number | null, extra: Partial<{ enabled: boolean; hasCycle: boolean; lastDoneOn: string | null }> = {}) =>
      dueStateOf({ enabled: true, hasCycle: true, lastDoneOn: '2026-01-01', daysLeft, ...extra }, 30);
    expect([s(-1), s(0), s(7), s(8), s(30), s(31)]).toEqual(['overdue', 'today', 'soon', 'upcoming', 'upcoming', 'ok']);
    expect([s(5, { enabled: false }), s(null, { hasCycle: false }), s(null, { lastDoneOn: null })]).toEqual(['off', 'no_cycle', 'first_needed']);
    expect([cycleLabel(36, null), cycleLabel(3, null), cycleLabel(12, null), cycleLabel(null, 7), cycleLabel(null, 10), cycleLabel(null, null)]).toEqual([
      '3년마다',
      '3개월마다',
      '1년마다',
      '1주마다',
      '10일마다',
      '주기 없음',
    ]);
  });
});

describe('해당 없음·알림', () => {
  test('phase-03-task-08 AC3: "해당 없음"으로 끈 항목은 대시보드 목록(listLegalDue)과 알림에서 빠진다', async () => {
    const { app: a, clock } = await makeApp();
    const admin = loginAs(a, 'admin');
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const l = await list(a, admin);
    const tld = byTitle(l, '개인 피폭선량 측정(TLD)'); // 3개월
    const drill = byTitle(l, '소방훈련·교육'); // 1년
    expect((await done(a, manager, tld.id, { doneOn: '2026-08-10' })).statusCode).toBe(200); // 2026-11-10, D-8
    expect((await done(a, manager, drill.id, { doneOn: '2025-11-20' })).statusCode).toBe(200); // 2026-11-20, D-18
    expect(listLegalDue(a.db, clock).map((t) => t.title)).toEqual(['개인 피폭선량 측정(TLD)', '소방훈련·교육']);

    const off = await patch(a, admin, tld.id, { enabled: false });
    expect(off.statusCode).toBe(200);
    expect(off.json<{ data: LegalTask }>().data).toMatchObject({ enabled: false, dueState: 'off', nextDueOn: null });
    expect(listLegalDue(a.db, clock).map((t) => t.title)).toEqual(['소방훈련·교육']);

    const scan = await runNotifyScan(a.db, clock, [legalNotifyScanner]);
    expect(scan.errors).toEqual([]);
    const titles = a.db.all<{ title: string; user_id: number }>("SELECT title, user_id FROM notifications WHERE type = 'legal_due' ORDER BY id");
    expect(titles.map((n) => n.title)).toEqual(expect.arrayContaining(['소방훈련·교육 기한이 18일 남았어요']));
    expect(titles.some((n) => n.title.includes('피폭선량'))).toBe(false);
    // manager 이상만 받는다
    expect(new Set(titles.map((n) => n.user_id))).toEqual(new Set([admin.userId, manager.userId]));
    expect(titles.some((n) => n.user_id === staff.userId)).toBe(false);
    // 꺼진 항목은 수행 기록도 받지 않는다(409)
    expect((await done(a, manager, tld.id, { doneOn: '2026-11-01' })).statusCode).toBe(409);
  });

  test('phase-03-task-08 AC3: D-30·D-7·당일·기한 지남 네 단계로 한 번씩만 알림이 간다', async () => {
    const { app: a, clock } = await makeApp();
    const admin = loginAs(a, 'admin');
    const pano = await makePanorama(a, admin);
    expect((await done(a, admin, pano.id, { doneOn: '2023-11-23' })).statusCode).toBe(200); // 예정 2026-11-23
    const mine = () => a.db.all<{ title: string; dedupe_key: string }>("SELECT title, dedupe_key FROM notifications WHERE type = 'legal_due' AND user_id = ? ORDER BY id", [admin.userId]);
    const scanAt = async (iso: string) => {
      clock.set(iso);
      const r = await runNotifyScan(a.db, clock, [legalNotifyScanner]);
      expect(r.errors).toEqual([]);
    };
    await scanAt('2026-10-20T09:00:00+09:00'); // D-34: 아직
    expect(mine()).toEqual([]);
    await scanAt('2026-11-02T09:00:00+09:00'); // D-21
    await scanAt('2026-11-02T10:00:00+09:00'); // 같은 단계는 다시 안 감
    await scanAt('2026-11-16T09:00:00+09:00'); // D-7
    await scanAt('2026-11-20T09:00:00+09:00'); // D-3: 같은 d7 단계
    await scanAt('2026-11-23T09:00:00+09:00'); // 당일
    await scanAt('2026-11-25T09:00:00+09:00'); // 기한 지남
    await scanAt('2026-11-26T09:00:00+09:00');
    expect(mine()).toEqual([
      { title: '파노라마 정기검사 기한이 21일 남았어요', dedupe_key: `legal:${pano.id}:2026-11-23:d30` },
      { title: '파노라마 정기검사 기한이 7일 남았어요', dedupe_key: `legal:${pano.id}:2026-11-23:d7` },
      { title: '오늘이 파노라마 정기검사 기한이에요', dedupe_key: `legal:${pano.id}:2026-11-23:d0` },
      { title: '파노라마 정기검사 기한이 2일 지났어요', dedupe_key: `legal:${pano.id}:2026-11-23:over` },
    ]);
    expect([legalStage(-1), legalStage(0), legalStage(1), legalStage(7), legalStage(8), legalStage(30)]).toEqual(['over', 'd0', 'd7', 'd7', 'd30', 'd30']);
  });

  test('phase-03-task-08 AC3: 알림 일수(settings.legal.warnDays)를 바꾸면 그 일수부터 알린다', async () => {
    const { app: a, clock } = await makeApp();
    const admin = loginAs(a, 'admin');
    const pano = await makePanorama(a, admin);
    await done(a, admin, pano.id, { doneOn: '2023-11-23' }); // D-21
    a.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('legal', '{\"warnDays\":14}', '2026-11-02T00:00:00Z')");
    expect(listLegalDue(a.db, clock)).toEqual([]);
    expect(byTitle(await list(a, admin), '파노라마 정기검사')).toMatchObject({ dueState: 'ok' });
    a.db.run("UPDATE settings SET value = '{\"warnDays\":60}' WHERE key = 'legal'");
    expect(listLegalDue(a.db, clock).map((t) => t.title)).toEqual(['파노라마 정기검사']);
  });
});

describe('주기 수정 권한·감사 로그', () => {
  test('phase-03-task-08 AC4: admin이 주기를 바꾸면 다음 예정일이 다시 계산되고 감사 로그에 남는다', async () => {
    const { app: a } = await makeApp();
    const admin = loginAs(a, 'admin');
    const pano = await makePanorama(a, admin);
    await done(a, admin, pano.id, { doneOn: '2023-11-23' });
    const r = await patch(a, admin, pano.id, { cycleMonths: 24 });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ data: LegalTask }>().data).toMatchObject({ cycleMonths: 24, cycleText: '2년마다', nextDueOn: '2025-11-23', dueState: 'overdue', daysLeft: -344 });
    const row = a.db.get<{ detail: string; user_id: number; target_id: string }>("SELECT detail, user_id, target_id FROM audit_log WHERE action = 'legal.update'");
    expect(row).toMatchObject({ user_id: admin.userId, target_id: String(pano.id) });
    expect(JSON.parse(row?.detail ?? '{}')).toMatchObject({
      title: '파노라마 정기검사',
      changes: { cycle_months: { from: 36, to: 24 } },
      nextDueOn: { from: '2026-11-23', to: '2025-11-23' },
    });
    // 템플릿의 주기 설명은 숫자만 바꾸면 비워져 새 주기로 보인다. 설명을 함께 보내면 그 설명을 쓴다
    const tpl = byTitle(await list(a, admin), '의료폐기물 배출자 교육');
    expect((await patch(a, admin, tpl.id, { cycleMonths: 24 })).json<{ data: LegalTask }>().data.cycleText).toBe('2년마다');
    expect((await patch(a, admin, tpl.id, { cycleMonths: 36, cycleText: '3년(최초는 1년 이내)' })).json<{ data: LegalTask }>().data.cycleText).toBe('3년(최초는 1년 이내)');
    // 바뀐 것이 없으면 감사 로그를 더 남기지 않는다
    const before = a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'legal.update'")?.n;
    await patch(a, admin, tpl.id, { cycleMonths: 36 });
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'legal.update'")?.n).toBe(before);
  });

  test('phase-03-task-08 AC4: manager는 주기·상태·적용 여부를 바꾸거나 항목을 추가할 수 없고(403), staff는 수행 기록도 못 한다', async () => {
    const { app: a } = await makeApp();
    const admin = loginAs(a, 'admin');
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const pano = await makePanorama(a, admin);
    for (const body of [{ cycleMonths: 12 }, { verifyStatus: 'needs_check' }, { enabled: false }]) {
      const r = await patch(a, manager, pano.id, body);
      expect(r.statusCode).toBe(403);
      expect(r.json().error.code).toBe('FORBIDDEN');
    }
    expect((await create(a, manager, { title: '직접 일정' })).statusCode).toBe(403);
    expect((await done(a, staff, pano.id, { doneOn: '2026-11-01' })).statusCode).toBe(403);
    expect(byTitle(await list(a, staff), '파노라마 정기검사')).toMatchObject({ cycleMonths: 36, enabled: true, lastDoneOn: null });
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'legal.update'")?.n).toBe(0);
  });

  test('phase-03-task-08 AC4: 잘못된 입력(주기 범위·출처 주소·모르는 칸)은 쉬운 한국어 오류로 거절한다', async () => {
    const { app: a } = await makeApp();
    const admin = loginAs(a, 'admin');
    const pano = await makePanorama(a, admin);
    const bad = async (body: Record<string, unknown>) => (await patch(a, admin, pano.id, body)).json().error.fields as Record<string, string>;
    expect((await bad({ cycleMonths: 0 })).cycleMonths).toBe('주기(개월)는 1~120 사이로 적어 주세요.');
    expect((await bad({ sourceUrl: 'javascript:alert(1)' })).sourceUrl).toBe('출처 주소는 https://로 시작하게 적어 주세요.');
    expect((await bad({ lastDoneOn: '2026-01-01' })).lastDoneOn).toBe('바꿀 수 없는 칸이에요.');
    expect((await create(a, admin, { title: '  ' })).json().error.fields.title).toBe('항목 이름을 적어 주세요.');
  });
});

describe('데모 데이터', () => {
  test('phase-03-task-08 범위(seed): 하늘숲치과 데모는 템플릿에 수행 기록을 넣고 장비별 정기검사 2개를 더하며, 두 번 불러도 늘지 않는다', async () => {
    const { app: a, clock } = await makeApp();
    expect(tables).toEqual(['legal_tasks', 'legal_task_logs']);
    seedDemo(a.db, { clock, scale: 1 });
    seedDemo(a.db, { clock, scale: 1 });
    const admin = loginAs(a, 'admin');
    const l = await list(a, admin);
    expect(l.items).toHaveLength(24);
    expect(byTitle(l, '파노라마 정기검사')).toMatchObject({ templateKey: null, nextDueOn: '2026-11-23', daysLeft: 21 });
    const states = new Set(l.items.map((i) => i.dueState));
    for (const s of ['overdue', 'soon', 'upcoming', 'ok', 'first_needed', 'no_cycle']) expect(states.has(s as LegalTask['dueState']), s).toBe(true);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM legal_task_logs')?.n).toBe(13 + 12 + 2);
  });
});

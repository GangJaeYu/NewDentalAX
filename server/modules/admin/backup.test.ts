// 이 파일이 하는 일: 백업·복원 API를 실제 라우트·DB·파일로 확인한다(phase-02-task-05 AC1·AC2·AC4·AC6, FR-006).
// 값 A로 백업 → 값 B로 바꾸기 → 복원 → 값 A와 pre-restore 백업 확인, 보관 개수 정리, 업로드 파일이 zip에 들어가는지,
// 확인 문구가 틀리면 아무것도 바뀌지 않는지, 복원 실패 때 원래 상태로 되돌리는지, 복원 중 다른 API가 503인지 본다. 요청은 fastify.inject로 보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { unzipSync } from 'fflate';
import { buildApp } from '../../app.ts';
import { manualClock, MINUTE_MS, type ManualClock } from '../../lib/clock.ts';
import { hashPassword } from '../../auth/password.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import type { BackupItem } from '../../../shared/schemas/backup.ts';
import { createBackup, listBackups } from './backup-service.ts';

const START = '2026-11-02T09:00:00+09:00';
const ADMIN_PW = 'Backup-Admin-Pw-2026';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

interface Env {
  app: FastifyInstance;
  clock: ManualClock;
  dataDir: string;
  backupDir: string;
  admin: TestLogin;
}

/** 임시 데이터 폴더로 서버를 만들고, 실제 비밀번호를 가진 관리자로 로그인한 세션을 돌려준다 */
async function makeEnv(): Promise<Env> {
  const dataDir = makeTmpDir('dentalax-backup-');
  const backupDir = path.join(dataDir, 'backups');
  const clock = manualClock(START);
  const app = await buildApp({ dataDir, backupDir, webDist: path.join(dataDir, 'no-web'), clock });
  cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  cleanups.push(() => app.close());
  const admin = loginAs(app, 'admin', { username: 'boss01', passwordHash: await hashPassword(ADMIN_PW) });
  setClinicName(app, '값A치과');
  return { app, clock, dataDir, backupDir, admin };
}

/** 병원 이름(settings.clinic.name)을 바꾼다 — 백업·복원으로 오가는 "값" */
function setClinicName(app: FastifyInstance, name: string): void {
  app.db.run(
    "INSERT INTO settings (key, value, updated_at) VALUES ('clinic', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [JSON.stringify({ name }), app.clock.now().toISOString()],
  );
}

/** 화면이 보는 병원 이름(GET /api/session) */
async function clinicName(app: FastifyInstance): Promise<string | null> {
  const r = await app.inject({ method: 'GET', url: '/api/session' });
  return r.json<{ data: { clinicName: string | null } }>().data.clinicName;
}

/** "지금 백업" */
async function backupNow(env: Env): Promise<BackupItem> {
  const r = await env.app.inject({ method: 'POST', url: '/api/backups', headers: env.admin.writeHeaders });
  expect(r.statusCode).toBe(201);
  return r.json<{ data: BackupItem }>().data;
}

/** 백업 폴더 안 app.db에서 병원 이름을 직접 읽는다 */
function clinicNameInBackup(backupDir: string, name: string): string {
  const db = new DatabaseSync(path.join(backupDir, name, 'app.db'), { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'clinic'").get() as { value: string };
    return (JSON.parse(row.value) as { name: string }).name;
  } finally {
    db.close();
  }
}

describe('백업·복원', () => {
  test('phase-02-task-05 AC1: 값 A로 백업 → 값 B로 수정 → 복원하면 값 A가 보이고 pre-restore 백업(값 B)이 생긴다; 세션은 모두 끊긴다', async () => {
    const env = await makeEnv();
    const { app } = env;
    expect(await clinicName(app)).toBe('값A치과');
    const a = await backupNow(env);
    expect(a.reason).toBe('manual');

    env.clock.advance(5 * MINUTE_MS);
    setClinicName(app, '값B치과');
    expect(await clinicName(app)).toBe('값B치과');

    const r = await app.inject({ method: 'POST', url: `/api/backups/${a.name}/restore`, headers: env.admin.writeHeaders, payload: { confirm: '복원합니다' } });
    expect(r.statusCode).toBe(204);
    expect(await clinicName(app)).toBe('값A치과');

    // 복원 직전 상태(값 B)가 pre-restore로 따로 남는다
    const list = listBackups(env.backupDir);
    const pre = list.find((b) => b.reason === 'pre-restore');
    expect(pre).toBeDefined();
    expect(clinicNameInBackup(env.backupDir, (pre as BackupItem).name)).toBe('값B치과');

    // 세션이 모두 지워져 옛 쿠키는 401, 다시 로그인하면 된다
    const old = await app.inject({ method: 'GET', url: '/api/backups', headers: env.admin.headers });
    expect(old.statusCode).toBe(401);
    expect(app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')?.n).toBe(0);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'boss01', password: ADMIN_PW } });
    expect(login.statusCode).toBe(200);
    // 복원은 감사 로그에 남는다(복원한 DB 쪽)
    const row = app.db.get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'backup.restore'");
    expect(JSON.parse(row?.detail ?? '{}')).toMatchObject({ preRestore: pre?.name });
  });

  test('phase-02-task-05 AC1: 백업 데이터 파일이 손상됐으면 아무것도 바꾸지 않고 멈춘다(값 B 유지, pre-restore 없음)', async () => {
    const env = await makeEnv();
    const { app } = env;
    const a = await backupNow(env);
    env.clock.advance(MINUTE_MS);
    setClinicName(app, '값B치과');
    fs.writeFileSync(path.join(env.backupDir, a.name, 'app.db'), 'this is not a sqlite file');

    const r = await app.inject({ method: 'POST', url: `/api/backups/${a.name}/restore`, headers: env.admin.writeHeaders, payload: { confirm: '복원합니다' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toContain('손상');
    expect(await clinicName(app)).toBe('값B치과');
    expect(listBackups(env.backupDir).some((b) => b.reason === 'pre-restore')).toBe(false);
  });

  test('phase-02-task-05 AC1: 복원 도중(다시 열기·마이그레이션)에 실패하면 pre-restore로 되돌려 값 B가 그대로 보이고 서버가 계속 동작한다', async () => {
    const env = await makeEnv();
    const { app } = env;
    const a = await backupNow(env);
    env.clock.advance(MINUTE_MS);
    setClinicName(app, '값B치과');
    // 백업 DB를 "지금 프로그램보다 새 버전"으로 만들어 다시 열 때 마이그레이션이 멈추게 한다
    const bad = new DatabaseSync(path.join(env.backupDir, a.name, 'app.db'));
    bad.prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (999, ?, ?)').run('999_future', new Date().toISOString());
    bad.close();

    const r = await app.inject({ method: 'POST', url: `/api/backups/${a.name}/restore`, headers: env.admin.writeHeaders, payload: { confirm: '복원합니다' } });
    expect(r.statusCode).toBe(500);
    expect(r.json().error.message).toContain('원래 상태로 되돌렸어요');
    expect(await clinicName(app)).toBe('값B치과');
    expect(app.maintenance.on).toBe(false);
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toMatchObject({ ok: true, db: 'ok' });
    // 실패도 감사 로그에 남고, 세션은 살아 있다
    expect(app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'backup.restore_failed'")?.n).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/backups', headers: env.admin.headers })).statusCode).toBe(200);
  });

  test('phase-02-task-05 AC6: 확인 문구를 틀리게 입력하면 복원되지 않는다(400, 값 B 유지, pre-restore 백업 없음)', async () => {
    const env = await makeEnv();
    const { app } = env;
    const a = await backupNow(env);
    setClinicName(app, '값B치과');
    for (const payload of [{ confirm: '복원' }, { confirm: '복원 합니다' }, {}]) {
      const r = await app.inject({ method: 'POST', url: `/api/backups/${a.name}/restore`, headers: env.admin.writeHeaders, payload });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION');
    }
    expect(await clinicName(app)).toBe('값B치과');
    expect(listBackups(env.backupDir).map((b) => b.reason)).toEqual(['manual']);
    // 세션도 그대로다
    expect((await app.inject({ method: 'GET', url: '/api/backups', headers: env.admin.headers })).statusCode).toBe(200);
  });

  test('phase-02-task-05 AC2: 보관 개수 3으로 설정 후 5번 백업하면 최신 3개만 남는다', async () => {
    const env = await makeEnv();
    const { app } = env;
    const put = await app.inject({ method: 'PUT', url: '/api/settings/backup', headers: env.admin.writeHeaders, payload: { keep: 3 } });
    expect(put.statusCode).toBe(200);
    expect(put.json().data).toMatchObject({ keep: 3 });
    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      made.push((await backupNow(env)).name);
      env.clock.advance(MINUTE_MS);
    }
    const r = await app.inject({ method: 'GET', url: '/api/backups', headers: env.admin.headers });
    const names = r.json<{ data: BackupItem[] }>().data.map((b) => b.name);
    expect(names).toEqual(made.slice(2).reverse());
    expect(fs.readdirSync(env.backupDir).filter((n) => !n.startsWith('.')).sort()).toEqual(made.slice(2).sort());
  });

  test('phase-02-task-05 AC2: 같은 초에 여러 번 백업해도 이름이 겹치지 않고 최신 3개가 남는다', async () => {
    const env = await makeEnv();
    await env.app.inject({ method: 'PUT', url: '/api/settings/backup', headers: env.admin.writeHeaders, payload: { keep: 3 } });
    const made: string[] = [];
    for (let i = 0; i < 5; i++) made.push((await backupNow(env)).name);
    expect(new Set(made).size).toBe(5);
    expect(listBackups(env.backupDir).map((b) => b.name)).toEqual(made.slice(2).reverse());
  });

  test('phase-02-task-05 AC2: 보관 개수는 1~365 정수만 받고, 기본값은 30이다', async () => {
    const env = await makeEnv();
    const get = await env.app.inject({ method: 'GET', url: '/api/settings/backup', headers: env.admin.headers });
    expect(get.json().data).toMatchObject({ keep: 30 });
    for (const keep of [0, 366, 2.5, '3']) {
      const r = await env.app.inject({ method: 'PUT', url: '/api/settings/backup', headers: env.admin.writeHeaders, payload: { keep } });
      expect(r.statusCode).toBe(400);
    }
  });

  test('phase-02-task-05 AC4: 업로드 파일이 백업 zip 안에 포함된다(app.db·secret.key·manifest.json과 함께)', async () => {
    const env = await makeEnv();
    const file = path.join(env.dataDir, 'uploads', '2026', '11', 'receipt-abc123.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '영수증 사진 대신 넣은 시험 파일');
    fs.writeFileSync(path.join(env.dataDir, 'secret.key'), Buffer.alloc(32, 7));
    const b = await backupNow(env);

    const r = await env.app.inject({ method: 'GET', url: `/api/backups/${b.name}/download`, headers: env.admin.headers });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(String(r.headers['content-disposition'])).toContain(`${b.name}.zip`);
    const files = unzipSync(new Uint8Array(r.rawPayload));
    expect(Object.keys(files).sort()).toEqual(['app.db', 'manifest.json', 'secret.key', 'uploads/2026/11/receipt-abc123.txt']);
    expect(Buffer.from(files['uploads/2026/11/receipt-abc123.txt'] as Uint8Array).toString('utf8')).toBe('영수증 사진 대신 넣은 시험 파일');
    expect(Buffer.from(files['secret.key'] as Uint8Array).equals(Buffer.alloc(32, 7))).toBe(true);
    expect(JSON.parse(Buffer.from(files['manifest.json'] as Uint8Array).toString('utf8'))).toMatchObject({ name: b.name, reason: 'manual', files: { uploads: 1, secretKey: true } });
  });

  test('phase-02-task-05 AC4: 복원하면 업로드 파일과 secret.key도 백업 때 것으로 돌아온다', async () => {
    const env = await makeEnv();
    const up = path.join(env.dataDir, 'uploads', '2026', '11');
    fs.mkdirSync(up, { recursive: true });
    fs.writeFileSync(path.join(up, 'a.txt'), 'A');
    fs.writeFileSync(path.join(env.dataDir, 'secret.key'), Buffer.alloc(32, 1));
    const b = await backupNow(env);
    fs.rmSync(path.join(up, 'a.txt'));
    fs.writeFileSync(path.join(up, 'b.txt'), 'B');
    fs.writeFileSync(path.join(env.dataDir, 'secret.key'), Buffer.alloc(32, 2));

    const r = await env.app.inject({ method: 'POST', url: `/api/backups/${b.name}/restore`, headers: env.admin.writeHeaders, payload: { confirm: '복원합니다' } });
    expect(r.statusCode).toBe(204);
    expect(fs.readdirSync(up)).toEqual(['a.txt']);
    expect(fs.readFileSync(path.join(env.dataDir, 'secret.key')).equals(Buffer.alloc(32, 1))).toBe(true);
  });

  test('phase-02-task-05 범위: 복원 중(점검 모드)에는 health 말고 다른 API가 503 MAINTENANCE다', async () => {
    const env = await makeEnv();
    env.app.maintenance.on = true;
    const r = await env.app.inject({ method: 'GET', url: '/api/backups', headers: env.admin.headers });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatchObject({ code: 'MAINTENANCE', message: '백업 복원 중입니다. 잠시 후 다시 시도해 주세요.' });
    expect((await env.app.inject({ method: 'GET', url: '/api/session' })).statusCode).toBe(503);
    expect((await env.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    env.app.maintenance.on = false;
    expect((await env.app.inject({ method: 'GET', url: '/api/backups', headers: env.admin.headers })).statusCode).toBe(200);
  });

  test('phase-02-task-05 범위: 복원이 도는 동안 들어온 요청은 503을 받고, 끝나면 다시 동작한다', async () => {
    const env = await makeEnv();
    const b = await backupNow(env);
    const restoring = env.app.inject({ method: 'POST', url: `/api/backups/${b.name}/restore`, headers: env.admin.writeHeaders, payload: { confirm: '복원합니다' } });
    // 복원은 파일 복사를 기다리는 동안 점검 모드를 켜 둔다
    let saw503 = false;
    for (let i = 0; i < 200 && !saw503; i++) {
      await new Promise((res) => setImmediate(res));
      if (!env.app.maintenance.on) continue;
      const r = await env.app.inject({ method: 'GET', url: '/api/session' });
      saw503 = r.statusCode === 503;
    }
    expect((await restoring).statusCode).toBe(204);
    expect(saw503).toBe(true);
    expect((await env.app.inject({ method: 'GET', url: '/api/session' })).statusCode).toBe(200);
  });

  test('phase-02-task-05 범위: 없는 백업·경로를 벗어나는 이름은 404이고, staff·manager는 백업 API에 403이다', async () => {
    const env = await makeEnv();
    for (const name of ['20261102-090000-manual', '..%2F..%2Fapp', 'nope']) {
      const r = await env.app.inject({ method: 'GET', url: `/api/backups/${name}/download`, headers: env.admin.headers });
      expect(r.statusCode).toBe(404);
    }
    for (const role of ['staff', 'manager'] as const) {
      const u = loginAs(env.app, role);
      expect((await env.app.inject({ method: 'GET', url: '/api/backups', headers: u.headers })).statusCode).toBe(403);
      expect((await env.app.inject({ method: 'POST', url: '/api/backups', headers: u.writeHeaders })).statusCode).toBe(403);
    }
  });

  test('phase-02-task-05 범위: 백업 폴더 이름은 한국 시각 날짜-시각-이유다', async () => {
    const dataDir = makeTmpDir('dentalax-backup-name-');
    cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const clock = manualClock('2026-11-02T23:30:05+09:00');
    const app = await buildApp({ dataDir, webDist: path.join(dataDir, 'no-web'), clock });
    cleanups.push(() => app.close());
    const item = createBackup({ db: app.db, dataDir, backupDir: path.join(dataDir, 'backups'), clock }, 'auto');
    expect(item.name).toBe('20261102-233005-auto');
  });
});

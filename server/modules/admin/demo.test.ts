// 이 파일이 하는 일: 데모 데이터 넣기·초기화 API를 실제 라우트·DB·파일로 확인한다(phase-02-task-05 AC5·AC6, FR-007, database.md §11).
// 초기화 뒤 업무 테이블은 비고 관리자 계정·설정·감사 로그·AI 모델/사용 기록·legal_tasks 템플릿이 남는지, 직전 자동 백업(pre-reset)이 있는지,
// 확인 문구가 틀리면 아무것도 지우지 않는지, 첫 설정 withDemo와 "데모 데이터 넣기"가 같은 데이터를 넣는지 본다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { listBackups } from './backup-service.ts';
import { clearableTables, KEEP_TABLES } from './demo-service.ts';
import { LEGAL_TEMPLATES } from '../../db/seed/legal-templates.ts';
import { DEMO_STAFF } from './seed.ts';

const START = '2026-11-02T09:00:00+09:00';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

interface Env {
  app: FastifyInstance;
  dataDir: string;
  backupDir: string;
}

async function makeEnv(): Promise<Env> {
  const dataDir = makeTmpDir('dentalax-demo-');
  const backupDir = path.join(dataDir, 'backups');
  const app = await buildApp({ dataDir, backupDir, webDist: path.join(dataDir, 'no-web'), clock: manualClock(START) });
  cleanups.push(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  cleanups.push(() => app.close());
  return { app, dataDir, backupDir };
}

function count(app: FastifyInstance, sql: string): number {
  return app.db.get<{ n: number }>(sql)?.n ?? 0;
}

/**
 * 여러 모듈의 업무 데이터가 쌓인 상태를 흉내 낸다. 아직 다른 태스크가 만들지 않은 업무 테이블은 시험용으로 만든다
 * (서로 외래키로 이어진 표, 검색 색인, legal_tasks 템플릿·사용자 추가 항목). 핵심 테이블(알림·파일·AI 사용 기록)은 001·010 마이그레이션 것이다.
 * 검색 색인 kb_fts는 041_kb.sql(phase-03-task-07)이 이미 만들므로 IF NOT EXISTS로 둔다.
 */
function fillBusinessData(env: Env, admin: TestLogin): void {
  const { app } = env;
  const now = app.clock.now().toISOString();
  app.db.exec(`
    CREATE TABLE aaa_vendors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE zzz_moves (id INTEGER PRIMARY KEY, vendor_id INTEGER NOT NULL REFERENCES aaa_vendors(id), user_id INTEGER REFERENCES users(id), qty REAL);
    CREATE TABLE equipment (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS expense_categories (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL); -- 070_finance.sql(phase-04-task-04)이 이미 만든다
    CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(heading, grams, cross, tokenize='unicode61');
  `);
  const staff = loginAs(app, 'staff');
  const manager = loginAs(app, 'manager');
  app.db.run("INSERT INTO aaa_vendors (id, name) VALUES (1, '가상거래처')");
  app.db.run('INSERT INTO zzz_moves (vendor_id, user_id, qty) VALUES (1, ?, 3), (1, ?, 5)', [staff.userId, manager.userId]);
  app.db.run("INSERT INTO equipment (id, name) VALUES (1, '고압증기멸균기')");
  // legal_tasks는 050 마이그레이션의 실제 표다(phase-03-task-08). 서버가 켜질 때 넣은 템플릿 하나에 수행 기록·장비 연결을 넣고, 직접 추가한 항목과 이력을 더한다
  app.db.run("UPDATE legal_tasks SET last_done_on = '2026-10-01', equipment_id = 1 WHERE template_key = 'radiation-inspection'");
  app.db.run("INSERT INTO legal_tasks (template_key, title, category, last_done_on, created_at, updated_at) VALUES (NULL, '직접 추가한 일정', 'other', '2026-10-02', ?, ?)", [now, now]);
  app.db.run("INSERT INTO legal_task_logs (legal_task_id, done_on, user_id, created_at) SELECT id, '2026-10-01', ?, ? FROM legal_tasks WHERE template_key = 'radiation-inspection'", [manager.userId, now]);
  app.db.run("INSERT OR IGNORE INTO expense_categories (name) VALUES ('재료비'), ('기타'), ('시험용 분류')");
  app.db.run("INSERT INTO kb_fts (rowid, heading, grams, cross) VALUES (1, '멸균', '멸균 균기', '')");
  app.db.run("INSERT INTO notifications (user_id, type, title, created_at) VALUES (?, 'notice', '공지', ?), (?, 'notice', '공지', ?)", [staff.userId, now, admin.userId, now]);
  app.db.run("INSERT INTO files (stored_path, original_name, mime, size, sha256, purpose, uploaded_by, created_at) VALUES ('2026/11/a.pdf', 'a.pdf', 'application/pdf', 3, 'x', 'form', ?, ?)", [staff.userId, now]);
  app.db.run("INSERT INTO ai_usage (at, user_id, feature, provider, status, cost_krw) VALUES (?, ?, 'quick', 'demo', 'ok', 12.5), (?, ?, 'quick', 'demo', 'ok', 3)", [now, staff.userId, now, admin.userId]);
  app.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('demo', '{\"loaded\":true}', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [now]);
  app.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('clinic', '{\"name\":\"하늘숲치과\"}', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [now]);
  const up = path.join(env.dataDir, 'uploads', '2026', '11');
  fs.mkdirSync(up, { recursive: true });
  fs.writeFileSync(path.join(up, 'a.pdf'), 'pdf');
}

describe('데모 데이터 초기화', () => {
  test('phase-02-task-05 AC5: 초기화 실행 후 업무 테이블은 비고 admin 계정·설정·감사 로그·AI 사용 기록은 남으며 직전 자동 백업이 있다', async () => {
    const env = await makeEnv();
    const { app } = env;
    const admin = loginAs(app, 'admin');
    const admin2 = loginAs(app, 'admin');
    fillBusinessData(env, admin);
    const auditBefore = count(app, 'SELECT COUNT(*) AS n FROM audit_log');
    const modelsBefore = count(app, 'SELECT COUNT(*) AS n FROM ai_models');
    expect(modelsBefore).toBeGreaterThan(0);

    const r = await app.inject({ method: 'POST', url: '/api/demo/reset', headers: admin.writeHeaders, payload: { confirm: '초기화합니다' } });
    expect(r.statusCode).toBe(200);
    const backupName = r.json<{ data: { backup: string } }>().data.backup;

    // 업무 테이블은 비었다
    for (const t of ['aaa_vendors', 'zzz_moves', 'equipment', 'notifications', 'files', 'kb_fts']) expect(count(app, `SELECT COUNT(*) AS n FROM ${t}`), t).toBe(0);
    expect(fs.existsSync(path.join(env.dataDir, 'uploads'))).toBe(false);
    // 관리자 계정(실행한 admin과 다른 admin)만 남고, 그 세션도 살아 있다
    expect(app.db.all<{ id: number; role: string }>('SELECT id, role FROM users ORDER BY id').map((u) => u.id)).toEqual([admin.userId, admin2.userId]);
    expect((await app.inject({ method: 'GET', url: '/api/backups', headers: admin.headers })).statusCode).toBe(200);
    // 설정은 남고 demo.loaded만 false
    expect(JSON.parse(app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'clinic'")?.value ?? '{}')).toMatchObject({ name: '하늘숲치과' });
    expect(JSON.parse(app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'demo'")?.value ?? '{}')).toMatchObject({ loaded: false });
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: admin.headers })).json()).toMatchObject({ data: { demoMode: false } });
    // 감사 로그는 그대로 + 초기화 기록, AI 모델·사용 기록 유지(지운 직원의 사용자 칸은 비워짐)
    expect(count(app, 'SELECT COUNT(*) AS n FROM audit_log')).toBe(auditBefore + 1);
    expect(JSON.parse(app.db.get<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'demo.reset'")?.detail ?? '{}')).toMatchObject({ backup: backupName });
    expect(count(app, 'SELECT COUNT(*) AS n FROM ai_models')).toBe(modelsBefore);
    expect(app.db.all<{ user_id: number | null; cost_krw: number }>('SELECT user_id, cost_krw FROM ai_usage ORDER BY id')).toEqual([
      { user_id: null, cost_krw: 12.5 },
      { user_id: admin.userId, cost_krw: 3 },
    ]);
    // 지출 분류는 남고, legal_tasks는 템플릿만 남아 수행 기록·장비 연결이 비워진다
    expect(count(app, "SELECT COUNT(*) AS n FROM expense_categories WHERE name IN ('재료비', '기타', '시험용 분류')")).toBe(3);
    expect(count(app, 'SELECT COUNT(*) AS n FROM legal_tasks WHERE template_key IS NULL')).toBe(0);
    expect(count(app, 'SELECT COUNT(*) AS n FROM legal_tasks WHERE last_done_on IS NOT NULL OR equipment_id IS NOT NULL')).toBe(0);
    expect(count(app, 'SELECT COUNT(*) AS n FROM legal_tasks')).toBe(LEGAL_TEMPLATES.length);
    expect(count(app, 'SELECT COUNT(*) AS n FROM legal_task_logs')).toBe(0);
    expect(app.db.all('PRAGMA foreign_key_check')).toEqual([]);

    // 직전 자동 백업(pre-reset)에 초기화 전 데이터가 그대로 있다
    const pre = listBackups(env.backupDir).find((b) => b.name === backupName);
    expect(pre?.reason).toBe('pre-reset');
    const bdb = new DatabaseSync(path.join(env.backupDir, backupName, 'app.db'), { readOnly: true });
    try {
      expect((bdb.prepare('SELECT COUNT(*) AS n FROM zzz_moves').get() as { n: number }).n).toBe(2);
      expect((bdb.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(4);
    } finally {
      bdb.close();
    }
    expect(fs.existsSync(path.join(env.backupDir, backupName, 'uploads', '2026', '11', 'a.pdf'))).toBe(true);
  });

  test('phase-02-task-05 AC6: 확인 문구를 틀리게 입력하면 초기화가 실행되지 않는다(400, 데이터·업로드 그대로, 백업 없음)', async () => {
    const env = await makeEnv();
    const { app } = env;
    const admin = loginAs(app, 'admin');
    fillBusinessData(env, admin);
    for (const payload of [{ confirm: '초기화' }, { confirm: ' 초기화합니다 ' }, { confirm: '복원합니다' }, {}]) {
      const r = await app.inject({ method: 'POST', url: '/api/demo/reset', headers: admin.writeHeaders, payload });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('VALIDATION');
    }
    expect(count(app, 'SELECT COUNT(*) AS n FROM zzz_moves')).toBe(2);
    expect(count(app, "SELECT COUNT(*) AS n FROM users WHERE role <> 'admin'")).toBe(2);
    expect(fs.existsSync(path.join(env.dataDir, 'uploads', '2026', '11', 'a.pdf'))).toBe(true);
    expect(listBackups(env.backupDir)).toEqual([]);
  });

  test('phase-02-task-05 범위: 비울 테이블 목록에 남길 테이블(settings·audit_log·ai_usage 등)과 users·sessions는 들어가지 않는다', async () => {
    const env = await makeEnv();
    const tables = clearableTables(env.app.db);
    for (const keep of [...KEEP_TABLES, 'users', 'sessions', 'legal_tasks']) expect(tables).not.toContain(keep);
    expect(tables).toEqual(expect.arrayContaining(['notifications', 'files']));
  });

  test('phase-02-task-05 범위: staff·manager는 초기화·데모 넣기 API에 403이다', async () => {
    const env = await makeEnv();
    for (const role of ['staff', 'manager'] as const) {
      const u = loginAs(env.app, role);
      expect((await env.app.inject({ method: 'POST', url: '/api/demo/reset', headers: u.writeHeaders, payload: { confirm: '초기화합니다' } })).statusCode).toBe(403);
      expect((await env.app.inject({ method: 'POST', url: '/api/demo/load', headers: u.writeHeaders })).statusCode).toBe(403);
      expect((await env.app.inject({ method: 'GET', url: '/api/demo/status', headers: u.headers })).statusCode).toBe(403);
    }
  });
});

describe('데모 데이터 넣기', () => {
  test('phase-02-task-05 범위(/setup withDemo): 첫 설정에서 데모를 고르면 하늘숲치과 직원이 모두 9명이 되고 데모 표시가 켜진다', async () => {
    const env = await makeEnv();
    const r = await env.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { clinicName: '우리치과', name: '김원장', username: 'owner01', password: 'Owner-Pass-2026', withDemo: true },
    });
    expect(r.statusCode).toBe(201);
    const users = env.app.db.all<{ username: string; role: string; must_change_pw: number }>('SELECT username, role, must_change_pw FROM users ORDER BY id');
    expect(users).toHaveLength(9);
    // 실제 비밀번호는 첫 설정 관리자만: 데모 직원은 모두 비밀번호를 바꿔야 한다
    expect(users[0]).toMatchObject({ username: 'owner01', role: 'admin', must_change_pw: 0 });
    expect(users.slice(1).every((u) => u.must_change_pw === 1 && u.role !== 'admin')).toBe(true);
    // 첫 설정에서 적은 병원 이름은 덮지 않고, 빈 항목만 채운다
    const clinic = JSON.parse(env.app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'clinic'")?.value ?? '{}') as Record<string, unknown>;
    expect(clinic).toMatchObject({ name: '우리치과', parking: expect.any(String) });
    expect((await env.app.inject({ method: 'GET', url: '/api/session' })).json()).toMatchObject({ data: { demoMode: true, clinicName: '우리치과' } });
    expect(env.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'demo.load'")?.n).toBe(1);
  });

  test('phase-02-task-05 범위: 빈 상태에서만 "데모 데이터 넣기"가 되고, 데이터가 있으면 409다; 초기화 뒤에는 다시 넣을 수 있다', async () => {
    const env = await makeEnv();
    const { app } = env;
    const admin = loginAs(app, 'admin');
    const s0 = await app.inject({ method: 'GET', url: '/api/demo/status', headers: admin.headers });
    expect(s0.json()).toEqual({ data: { loaded: false, empty: true } });

    expect((await app.inject({ method: 'POST', url: '/api/demo/load', headers: admin.writeHeaders })).statusCode).toBe(204);
    expect(count(app, 'SELECT COUNT(*) AS n FROM users')).toBe(DEMO_STAFF.length);
    expect((await app.inject({ method: 'GET', url: '/api/demo/status', headers: admin.headers })).json()).toEqual({ data: { loaded: true, empty: false } });

    const again = await app.inject({ method: 'POST', url: '/api/demo/load', headers: admin.writeHeaders });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toContain('이미 업무 데이터가 있어');

    const reset = await app.inject({ method: 'POST', url: '/api/demo/reset', headers: admin.writeHeaders, payload: { confirm: '초기화합니다' } });
    expect(reset.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/demo/status', headers: admin.headers })).json()).toEqual({ data: { loaded: false, empty: true } });
    expect((await app.inject({ method: 'POST', url: '/api/demo/load', headers: admin.writeHeaders })).statusCode).toBe(204);
  });
});

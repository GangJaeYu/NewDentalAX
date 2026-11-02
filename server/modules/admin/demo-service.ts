// 이 파일이 하는 일: 데모 데이터 넣기·초기화·상태 확인(FR-007, database.md §11, TD-024).
// 넣기: seed 등록표(server/db/seed/registry.ts)의 모든 모듈 seedDemo를 차례로 부르고 settings.demo.loaded를 true로 둔다(첫 설정 withDemo도 이 함수를 쓴다).
// 초기화: ① 자동 백업(pre-reset) → ② 업무 테이블 비우기(남기는 것: settings·관리자 계정·감사 로그·AI 모델/사용 기록·legal_tasks 템플릿·
//        지출 분류·근무 종류·광고 점검 사전) → ③ 업로드 파일 지우기 → settings.demo.loaded=false.
// 업무 테이블은 등록표의 tables와, DB에 실제로 있는 테이블 중 남길 목록에 없는 것 전부다(새 모듈 테이블도 빠짐없이 비우기 위해).
import fs from 'node:fs';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError } from '../../lib/errors.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { SEED_MODULES, SEED_REGISTRY, seedDemoAll } from '../../db/seed/registry.ts';
import { createBackup, uploadsDir, type BackupEnv } from './backup-service.ts';
import { retryFsSync } from './backup-fs.ts';

/** 초기화해도 그대로 남기는 테이블(database.md §11 + 시스템 테이블) */
export const KEEP_TABLES: ReadonlySet<string> = new Set([
  'schema_version',
  'settings',
  'audit_log',
  'ai_models',
  'ai_usage',
  'expense_categories',
  'shift_types',
  'ad_rules',
  'login_attempts',
]);

/** 행 일부만 남기는 테이블: users(관리자만 남김), sessions(남는 관리자 것만), legal_tasks(템플릿만 남기고 수행 기록 지움) */
export const PARTIAL_TABLES: ReadonlySet<string> = new Set(['users', 'sessions', 'legal_tasks']);

/** settings 한 키의 JSON을 읽는다(없거나 깨졌으면 빈 객체) */
function readSettingObject(db: Db, key: string): Record<string, unknown> {
  const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return {};
  try {
    const v: unknown = JSON.parse(row.value);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** settings 한 키에 값을 합쳐 저장한다 */
function mergeSettingObject(db: Db, clock: Clock, key: string, patch: Record<string, unknown>): void {
  db.run(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, JSON.stringify({ ...readSettingObject(db, key), ...patch }), clock.now().toISOString()],
  );
}

/** DB에 있는 테이블 이름 → 종류('table' 또는 'virtual'). 내부 테이블과 검색 색인의 보조 테이블(shadow)은 뺀다 */
function existingTables(db: Db): Map<string, 'table' | 'virtual'> {
  const out = new Map<string, 'table' | 'virtual'>();
  for (const t of db.all<{ name: string; type: string; schema: string }>('PRAGMA table_list')) {
    if (t.schema !== 'main' || t.name.startsWith('sqlite_')) continue;
    if (t.type === 'table' || t.type === 'virtual') out.set(t.name, t.type);
  }
  return out;
}

/** 테이블에 그 열이 있는지 */
function hasColumn(db: Db, table: string, column: string): boolean {
  return db.all<{ name: string }>(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).some((c) => c.name === column);
}

/** 초기화 때 모두 비울 업무 테이블(등록표 순서의 역순 → 나머지 DB 테이블). 남길 테이블·일부만 남길 테이블은 빼고, DB에 있는 것만 */
export function clearableTables(db: Db): string[] {
  const exist = existingTables(db);
  const ordered: string[] = [];
  const add = (t: string) => {
    if (!exist.has(t) || KEEP_TABLES.has(t) || PARTIAL_TABLES.has(t) || ordered.includes(t)) return;
    ordered.push(t);
  };
  // 뒤에 등록된 모듈(앞 모듈의 데이터를 가리키는 쪽)부터 지운다
  for (const name of [...SEED_MODULES].reverse()) for (const t of [...SEED_REGISTRY[name].tables].reverse()) add(t);
  for (const t of [...exist.keys()].sort()) add(t);
  return ordered;
}

/** 이름을 SQL 식별자로(큰따옴표) */
function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** 업무 데이터가 하나도 없는지: 비울 테이블이 모두 비었고, 관리자가 아닌 직원이 없으면 true */
export function isBusinessEmpty(db: Db): boolean {
  for (const t of clearableTables(db)) if (db.get(`SELECT 1 AS x FROM ${ident(t)} LIMIT 1`)) return false;
  return !db.get("SELECT 1 AS x FROM users WHERE role <> 'admin' LIMIT 1");
}

/** 데모 상태(화면 안내용) */
export function demoStatus(db: Db): { loaded: boolean; empty: boolean } {
  return { loaded: readSettingObject(db, 'demo').loaded === true, empty: isBusinessEmpty(db) };
}

/**
 * 데모 데이터를 넣는다(등록된 모든 모듈의 seedDemo). 업무 데이터가 이미 있으면 409.
 * ctx가 있으면 감사 로그(demo.load)를 남긴다. 첫 설정(POST /api/setup의 withDemo)도 이 함수를 부른다.
 */
export async function loadDemo(db: Db, clock: Clock, ctx: AuditContext | null, opts: { scale?: number } = {}): Promise<void> {
  if (!isBusinessEmpty(db)) {
    throw new AppError('CONFLICT', { message: '이미 업무 데이터가 있어 데모 데이터를 넣지 않았어요. 먼저 초기화한 뒤 다시 시도해 주세요.' });
  }
  await seedDemoAll(db, { clock, scale: opts.scale ?? 1 });
  mergeSettingObject(db, clock, 'demo', { loaded: true, loadedAt: clock.now().toISOString() });
  if (ctx) audit({ ...ctx, db }, 'demo.load', 'settings', 'demo', null);
}

/**
 * 업무 테이블을 비운다(한 트랜잭션). 외래키 순서를 몰라도 되게, 지우다 막힌 테이블은 다른 테이블을 지운 뒤 다시 시도한다.
 * 지운 테이블 이름을 돌려준다.
 */
export function clearBusinessData(db: Db): string[] {
  return db.tx(() => {
    // legal_tasks: 템플릿(template_key 있음)만 남기고, 수행 기록·장비 연결을 지운다
    const exist = existingTables(db);
    if (exist.has('legal_tasks')) {
      if (hasColumn(db, 'legal_tasks', 'template_key')) db.run('DELETE FROM legal_tasks WHERE template_key IS NULL');
      const resets = ['last_done_on', 'equipment_id'].filter((c) => hasColumn(db, 'legal_tasks', c));
      if (resets.length) db.run(`UPDATE legal_tasks SET ${resets.map((c) => `${ident(c)} = NULL`).join(', ')}`);
    }
    let pending = clearableTables(db);
    const done: string[] = [];
    for (let pass = 0; pending.length && pass < 20; pass++) {
      const blocked: string[] = [];
      for (const t of pending) {
        try {
          db.tx(() => db.run(`DELETE FROM ${ident(t)}`));
          done.push(t);
        } catch (e) {
          if (!/FOREIGN KEY/i.test(e instanceof Error ? e.message : String(e))) throw e;
          blocked.push(t);
        }
      }
      if (blocked.length === pending.length) throw new Error(`서로 연결된 데이터 때문에 지우지 못했어요: ${blocked.join(', ')}`);
      pending = blocked;
    }
    // 관리자가 아닌 직원 계정을 지운다(세션·알림은 함께 지워지고, AI 사용 기록의 사용자 칸은 비워진다)
    db.run("DELETE FROM users WHERE role <> 'admin'");
    db.run('DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)');
    return done;
  });
}

/** 초기화 결과 */
export interface ResetOutcome {
  /** 초기화 직전에 만든 백업 이름 */
  backup: string;
  /** 비운 테이블 */
  cleared: string[];
}

/** 데모 데이터 초기화(FR-007 AC2). 실행 직전 자동 백업(pre-reset)을 만든다 */
export function resetDemo(env: BackupEnv, ctx: AuditContext): ResetOutcome {
  const backup = createBackup(env, 'pre-reset');
  const cleared = clearBusinessData(env.db);
  retryFsSync(() => fs.rmSync(uploadsDir(env.dataDir), { recursive: true, force: true }));
  mergeSettingObject(env.db, env.clock, 'demo', { loaded: false, resetAt: env.clock.now().toISOString() });
  audit({ ...ctx, db: env.db }, 'demo.reset', 'settings', 'demo', { backup: backup.name, cleared: cleared.length });
  return { backup: backup.name, cleared };
}

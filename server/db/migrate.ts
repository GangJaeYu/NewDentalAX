// 이 파일이 하는 일: server/db/migrations/NNN_<이름>.sql 파일을 번호 순서대로 한 번씩만 적용한다(TD-003).
// 적용한 번호는 schema_version 테이블에 남겨, 서버를 다시 켜도 이미 적용한 파일은 다시 실행하지 않는다.
// 파일 하나는 한 트랜잭션으로 적용되므로 중간에 오류가 나면 그 파일 전체가 되돌려진다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appDbPath, openDb, pingDb, type Db } from './index.ts';
import { systemClock, type Clock } from '../lib/clock.ts';

/** 기본 마이그레이션 폴더 */
export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** 파일 이름 규칙: 세 자리 번호_영문 소문자 이름.sql (예: 001_core.sql) */
const FILE_RE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

/** 마이그레이션 파일 하나 */
export interface MigrationFile {
  version: number;
  name: string;
  file: string;
}

/** migrate()의 결과 */
export interface MigrateResult {
  /** 이번에 새로 적용한 파일 이름 */
  applied: string[];
  /** 적용 후 최신 번호(파일이 없으면 0) */
  version: number;
}

/** 마이그레이션 폴더의 파일을 번호 순서로 읽는다. 번호가 겹치거나 이름 규칙이 틀리면 한국어 오류를 낸다 */
export function listMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const out: MigrationFile[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.toLowerCase().endsWith('.sql')) continue;
    const m = FILE_RE.exec(name);
    if (!m) throw new Error(`마이그레이션 파일 이름 "${name}"이(가) 규칙과 달라요. 예: 001_core.sql (세 자리 번호_영문 소문자)`);
    const version = Number(m[1]);
    const dup = out.find((f) => f.version === version);
    if (dup) throw new Error(`마이그레이션 번호 ${m[1]}이(가) 두 파일(${dup.name}, ${name})에 겹쳐요. 번호 예약표(plan_setup/PLAN.md §3)를 확인해 주세요.`);
    out.push({ version, name, file: path.join(dir, name) });
  }
  return out.sort((a, b) => a.version - b.version);
}

/** 이 폴더의 최신 마이그레이션 번호 */
export function latestVersion(dir: string = MIGRATIONS_DIR): number {
  return listMigrations(dir).at(-1)?.version ?? 0;
}

/** schema_version 테이블을 만든다(없을 때만) */
function ensureVersionTable(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
}

/** DB에 적용된 최신 번호(아무것도 없으면 0) */
export function currentVersion(db: Db): number {
  ensureVersionTable(db);
  return db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_version')?.v ?? 0;
}

/**
 * 아직 적용하지 않은 마이그레이션을 번호 순서대로 적용한다.
 * - 이미 적용된 번호는 건너뛴다(두 번째 시작에서는 아무것도 하지 않는다).
 * - DB가 프로그램보다 새 버전이면(이전 버전으로 되돌려 설치한 경우) 데이터를 지키기 위해 멈춘다.
 */
export function migrate(db: Db, opts: { dir?: string; clock?: Clock } = {}): MigrateResult {
  const files = listMigrations(opts.dir ?? MIGRATIONS_DIR);
  const clock = opts.clock ?? systemClock;
  ensureVersionTable(db);
  const done = new Set(db.all<{ version: number }>('SELECT version FROM schema_version').map((r) => r.version));
  const latest = files.at(-1)?.version ?? 0;
  const dbMax = Math.max(0, ...done);
  if (dbMax > latest) {
    throw new Error(`데이터 파일(app.db)이 지금 프로그램보다 새 버전(${dbMax})으로 만들어졌어요. 최신 프로그램 파일로 다시 설치해 주세요.`);
  }

  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f.version)) continue;
    const sql = fs.readFileSync(f.file, 'utf8');
    try {
      db.tx(() => {
        db.exec(sql);
        db.run('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)', [f.version, f.name, clock.now().toISOString()]);
      });
    } catch (e) {
      throw new Error(`데이터 구조 업데이트(${f.name})를 적용하지 못했어요: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    applied.push(f.name);
  }
  return { applied, version: currentVersion(db) };
}

/**
 * 데이터 폴더의 app.db를 열고(없으면 새로 만듦) 마이그레이션까지 적용한다. 서버 시작과 테스트가 함께 쓴다.
 * 적용 중 오류가 나면 DB를 닫고 오류를 다시 던진다.
 */
export function openAppDb(dataDir: string, opts: { clock?: Clock; dir?: string } = {}): { db: Db; migration: MigrateResult } {
  const db = openDb(appDbPath(dataDir));
  try {
    return { db, migration: migrate(db, opts) };
  } catch (e) {
    db.close();
    throw e;
  }
}

/**
 * 준비 상태 확인용 DB 점검: DB가 응답하고 스키마 번호가 프로그램의 최신 번호와 같으면 true.
 * 최신 번호는 처음 한 번만 읽어 둔다.
 */
export function makeDbCheck(db: Db, dir: string = MIGRATIONS_DIR): () => boolean {
  const latest = latestVersion(dir);
  return () => {
    if (!pingDb(db)) return false;
    try {
      return currentVersion(db) === latest;
    } catch {
      return false;
    }
  };
}

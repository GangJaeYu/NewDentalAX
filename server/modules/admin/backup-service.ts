// 이 파일이 하는 일: 백업 만들기·목록·보관 개수 정리·오늘 백업 확인·zip 묶기·복원을 한다(FR-006, TD-014, overview §3.7).
// 백업 한 개 = backups/YYYYMMDD-HHmmss-<이유>/ 폴더에 app.db(VACUUM INTO로 만든 일관된 사본)·uploads/ 복사본·secret.key·manifest.json.
// 복원 순서: 점검 모드 켜기(다른 API는 503) → 지금 상태를 pre-restore로 백업 → DB 닫기 → app.db·uploads·secret.key 바꾸기
//          → 다시 열고 마이그레이션 → 세션 전부 삭제 → 점검 모드 끄기. 중간에 실패하면 pre-restore 백업으로 되돌린다.
// 시각은 주입한 clock으로 정하고(테스트가 "어제"·"오늘"을 흉내 냄), 폴더 이름의 날짜는 한국 시각(KST)이다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zipSync, type Zippable } from 'fflate';
import type { Db } from '../../db/index.ts';
import { appDbPath } from '../../db/index.ts';
import { currentVersion, openAppDb } from '../../db/migrate.ts';
import type { Clock } from '../../lib/clock.ts';
import { kstParts, kstDate } from '../../lib/dates.ts';
import { secretKeyPath } from '../../lib/crypto.ts';
import { AppError } from '../../lib/errors.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { BACKUP_KEEP_DEFAULT, BACKUP_KEEP_MAX, BACKUP_KEEP_MIN, BACKUP_REASONS, type BackupItem, type BackupReason, type BackupSettings } from '../../../shared/schemas/backup.ts';
import type { SwappableDb } from './backup-swap.ts';
import { retryFs, retryFsSync } from './backup-fs.ts';

/** 백업에 필요한 값: DB, 업무 데이터 폴더, 백업 폴더, 시계 */
export interface BackupEnv {
  db: Db;
  dataDir: string;
  backupDir: string;
  clock: Clock;
}

/** 복원은 DB를 바꿔 끼워야 하므로 바꿔 끼우는 DB와 점검 모드 표시가 필요하다 */
export interface RestoreEnv extends BackupEnv {
  db: SwappableDb;
  maintenance: MaintenanceState;
}

/** 점검 모드(복원 중) 표시. on이면 다른 API가 503 MAINTENANCE를 돌려준다(app.ts) */
export interface MaintenanceState {
  on: boolean;
}

/** manifest.json 내용 */
export interface BackupManifest {
  format: 1;
  name: string;
  createdAt: string;
  reason: BackupReason;
  /** 같은 초에 여러 개 만들 때 순서를 가리는 번호(클수록 나중) */
  seq: number;
  schemaVersion: number;
  /** 백업에 들어간 파일 크기 합(바이트) */
  sizeBytes: number;
  files: { db: boolean; secretKey: boolean; uploads: number };
}

/** 업로드 파일 폴더(TRD: data/uploads/YYYY/MM/...) */
export function uploadsDir(dataDir: string): string {
  return path.join(dataDir, 'uploads');
}

/** 백업 폴더 이름 규칙: 날짜-시각-이유(-번호). 경로를 벗어나는 이름(..·/)을 막는 데도 쓴다 */
const NAME_RE = /^\d{8}-\d{6}-(auto|manual|pre-restore|pre-reset)(-\d{1,6}){0,2}$/;

/** 백업 이름이 규칙에 맞는지 */
export function isBackupName(name: string): boolean {
  return NAME_RE.test(name);
}

/** 두 자리 숫자 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 시각 → 폴더 이름 앞부분(KST, 예: 20261102-090000) */
export function backupStamp(at: Date): string {
  const p = kstParts(at);
  return `${p.year}${pad2(p.month)}${pad2(p.day)}-${pad2(p.hour)}${pad2(p.minute)}${pad2(p.second)}`;
}

/** 폴더 안 파일 크기 합과 파일 개수(하위 폴더까지) */
function folderStats(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  if (!fs.existsSync(dir)) return { bytes, files };
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const s = folderStats(p);
      bytes += s.bytes;
      files += s.files;
    } else if (ent.isFile()) {
      bytes += fs.statSync(p).size;
      files += 1;
    }
  }
  return { bytes, files };
}

/** manifest.json을 읽는다(없거나 깨졌으면 null) */
function readManifest(dir: string): BackupManifest | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
    if (typeof m.createdAt !== 'string' || !BACKUP_REASONS.includes(m.reason)) return null;
    return m;
  } catch {
    return null;
  }
}

/** 백업 하나의 manifest와 폴더 경로 */
interface BackupEntry {
  dir: string;
  manifest: BackupManifest;
}

/** 백업 폴더 안의 올바른 백업을 새것부터 늘어놓는다 */
function listEntries(backupDir: string): BackupEntry[] {
  if (!fs.existsSync(backupDir)) return [];
  const out: BackupEntry[] = [];
  for (const ent of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!ent.isDirectory() || !isBackupName(ent.name)) continue;
    const dir = path.join(backupDir, ent.name);
    const manifest = readManifest(dir);
    if (!manifest || !fs.existsSync(path.join(dir, 'app.db'))) continue;
    out.push({ dir, manifest: { ...manifest, name: ent.name } });
  }
  return out.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt) || (b.manifest.seq ?? 0) - (a.manifest.seq ?? 0));
}

/** 백업 목록(새것부터) */
export function listBackups(backupDir: string): BackupItem[] {
  return listEntries(backupDir).map(({ manifest: m }) => ({ name: m.name, createdAt: m.createdAt, reason: m.reason, sizeBytes: m.sizeBytes }));
}

/** 백업 설정을 읽는다(없거나 틀린 값이면 기본값: 보관 30개) */
export function readBackupSettings(db: Db): BackupSettings {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'backup'");
  let v: Partial<BackupSettings> = {};
  try {
    if (row) v = JSON.parse(row.value) as Partial<BackupSettings>;
  } catch {
    v = {};
  }
  const keep = Number.isInteger(v.keep) && (v.keep as number) >= BACKUP_KEEP_MIN && (v.keep as number) <= BACKUP_KEEP_MAX ? (v.keep as number) : BACKUP_KEEP_DEFAULT;
  const hour = Number.isInteger(v.hour) && (v.hour as number) >= 0 && (v.hour as number) <= 23 ? (v.hour as number) : 12;
  return { keep, hour };
}

/** 백업 설정을 저장한다(보관 개수). 저장한 뒤 넘치는 백업을 바로 정리한다 */
export function writeBackupSettings(env: BackupEnv, patch: { keep: number }, ctx: AuditContext | null): BackupSettings {
  const before = readBackupSettings(env.db);
  const next: BackupSettings = { ...before, keep: patch.keep };
  env.db.run(
    "INSERT INTO settings (key, value, updated_at) VALUES ('backup', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [JSON.stringify(next), env.clock.now().toISOString()],
  );
  if (ctx) audit(ctx, 'settings.update', 'settings', 'backup', { keep: { from: before.keep, to: next.keep } });
  pruneBackups(env.backupDir, next.keep);
  return next;
}

/** 보관 개수를 넘는 오래된 백업을 지운다. 지운 이름을 돌려준다. except에 든 이름은 지우지 않는다 */
export function pruneBackups(backupDir: string, keep: number, except: readonly string[] = []): string[] {
  const removed: string[] = [];
  const entries = listEntries(backupDir);
  let kept = 0;
  for (const e of entries) {
    if (kept < keep || except.includes(e.manifest.name)) {
      kept += 1;
      continue;
    }
    // 잠깐 잠긴 오래된 백업은 이번에는 건너뛰고 다음 정리 때 다시 지운다(새 백업 만들기를 실패시키지 않는다)
    try {
      retryFsSync(() => fs.rmSync(e.dir, { recursive: true, force: true }));
      removed.push(e.manifest.name);
    } catch {
      continue;
    }
  }
  return removed;
}

/** SQL 문자열 안에 넣을 값(작은따옴표 두 번) */
function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * 백업 하나를 만든다. 만든 항목을 돌려준다.
 * - app.db는 VACUUM INTO로 쓰는 중에도 일관된 사본을 만든다(트랜잭션 안에서는 부를 수 없다).
 * - 폴더 이름을 정해(mkdir로 자리 잡기) 그 안에 바로 쓰고, manifest.json을 마지막에 쓴다. manifest가 없는 폴더는 목록·복원에서 빠지므로
 *   만드는 도중의 백업이 보이지 않는다. 임시 폴더를 만들어 이름을 바꾸는 방식은 Windows에서 백신 등이 방금 쓴 파일을 열어 두면
 *   EPERM으로 실패해서 쓰지 않는다(2026-11-02 통합 unit 간헐 실패 원인).
 * - prune이 true(기본)면 만든 뒤 보관 개수를 넘는 오래된 백업을 지운다(이번 것은 남긴다). 정리 실패는 이번 백업을 실패시키지 않는다.
 */
export function createBackup(env: BackupEnv, reason: BackupReason, opts: { prune?: boolean } = {}): BackupItem {
  const now = env.clock.now();
  const existing = listEntries(env.backupDir);
  const seq = Math.max(0, ...existing.map((e) => e.manifest.seq ?? 0)) + 1;
  const stamp = backupStamp(now);
  const base = `${stamp}-${reason}`;
  // 같은 초에 만든 백업이 이미 있으면 순번을 붙인다(순번은 계속 커지므로 지운 백업의 이름을 다시 쓰지 않는다)
  const first = existing.some((e) => e.manifest.name.startsWith(`${stamp}-`)) ? `${base}-${seq}` : base;

  fs.mkdirSync(env.backupDir, { recursive: true });
  const name = reserveFolder(env.backupDir, first, `${base}-${seq}`);
  const dir = path.join(env.backupDir, name);
  let manifest: BackupManifest;
  try {
    env.db.exec(`VACUUM INTO ${sqlString(path.join(dir, 'app.db'))}`);
    const up = uploadsDir(env.dataDir);
    const hasUploads = fs.existsSync(up);
    if (hasUploads) retryFsSync(() => fs.cpSync(up, path.join(dir, 'uploads'), { recursive: true, force: true }));
    const key = secretKeyPath(env.dataDir);
    const hasKey = fs.existsSync(key);
    if (hasKey) retryFsSync(() => fs.copyFileSync(key, path.join(dir, 'secret.key')));
    manifest = {
      format: 1,
      name,
      createdAt: now.toISOString(),
      reason,
      seq,
      schemaVersion: currentVersion(env.db),
      sizeBytes: folderStats(dir).bytes,
      files: { db: true, secretKey: hasKey, uploads: hasUploads ? folderStats(path.join(dir, 'uploads')).files : 0 },
    };
    // 마지막에 manifest를 쓴다 = 이 백업이 다 만들어졌다는 표시
    retryFsSync(() => fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2)));
  } catch (e) {
    try {
      retryFsSync(() => fs.rmSync(dir, { recursive: true, force: true }));
    } catch {
      // 못 지운 반쪽 폴더는 manifest가 없어 목록에 나오지 않는다
    }
    throw e;
  }
  if (opts.prune !== false) pruneBackups(env.backupDir, readBackupSettings(env.db).keep, [name]);
  return { name, createdAt: manifest.createdAt, reason, sizeBytes: manifest.sizeBytes };
}

/**
 * 백업 폴더 자리를 잡는다(mkdir가 성공한 이름을 돌려준다). 이미 있으면 base-2, base-3 …을 쓴다.
 * 남아 있던 반쪽 폴더(manifest 없음)와도 겹치지 않는다.
 */
function reserveFolder(backupDir: string, first: string, base: string): string {
  for (let i = 1; i < 10000; i++) {
    const name = i === 1 ? first : `${base}-${i}`;
    try {
      retryFsSync(() => fs.mkdirSync(path.join(backupDir, name)));
      return name;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('백업 폴더 이름을 정하지 못했어요. 백업 폴더를 정리해 주세요.');
}

/** 오늘(KST) 만든 백업이 있는지. 이유와 관계없이 하나라도 있으면 있다고 본다 */
export function hasBackupOn(backupDir: string, date: string): boolean {
  return listEntries(backupDir).some((e) => kstDate(new Date(e.manifest.createdAt)) === date);
}

/**
 * 오늘 날짜 백업이 없으면 자동 백업을 만든다(서버 시작 때 한 번, 그 뒤 매시 정각). 만들었으면 그 항목, 이미 있으면 null.
 * 서버가 꺼져 있어 어제 이후 백업이 없었다면 켜자마자 여기서 바로 만든다(FR-006 AC1).
 */
export function ensureDaily(env: BackupEnv): BackupItem | null {
  if (hasBackupOn(env.backupDir, kstDate(env.clock.now()))) return null;
  return createBackup(env, 'auto');
}

/** 이름으로 백업 폴더를 찾는다. 없으면 404 */
export function backupFolder(backupDir: string, name: string): string {
  if (!isBackupName(name)) throw new AppError('NOT_FOUND', { message: '찾는 백업이 없어요. 목록을 새로 고쳐 주세요.' });
  const dir = path.join(backupDir, name);
  if (!fs.existsSync(path.join(dir, 'app.db')) || !readManifest(dir)) throw new AppError('NOT_FOUND', { message: '찾는 백업이 없어요. 목록을 새로 고쳐 주세요.' });
  return dir;
}

/** 폴더 안 파일을 zip에 넣을 모양으로 모은다(경로 구분자는 /) */
function collectZip(dir: string, prefix: string, out: Zippable): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    const key = prefix ? `${prefix}/${ent.name}` : ent.name;
    if (ent.isDirectory()) collectZip(p, key, out);
    else if (ent.isFile()) out[key] = new Uint8Array(fs.readFileSync(p));
  }
}

/** 백업 하나를 zip 파일 내용으로 묶는다(app.db·secret.key·manifest.json·uploads/...) */
export function zipBackup(backupDir: string, name: string): Uint8Array {
  const dir = backupFolder(backupDir, name);
  const files: Zippable = {};
  collectZip(dir, '', files);
  return zipSync(files, { level: 6 });
}

/**
 * 데이터 폴더의 app.db·uploads·secret.key를 백업 폴더의 것으로 바꾸고 DB를 다시 연다(마이그레이션 포함).
 * 부르기 전에 DB 안쪽 연결을 닫아야 한다. 성공하면 새 연결을 바꿔 끼운다.
 * 파일 지우기·복사는 Windows의 잠깐 잠김(백신·색인이 방금 닫은 app.db를 여는 등)에 대비해 다시 시도한다(backup-fs.ts).
 * 특히 다른 프로그램이 열어 둔 파일을 지우면 "지우는 중" 상태로 남아, 같은 이름으로 복사하는 일이 그 프로그램이 닫을 때까지 EPERM이 된다.
 */
async function replaceDataFrom(env: RestoreEnv, fromDir: string): Promise<void> {
  const dbFile = appDbPath(env.dataDir);
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) await retryFs(() => fs.promises.rm(f, { force: true }));
  await retryFs(() => fs.promises.copyFile(path.join(fromDir, 'app.db'), dbFile));

  const up = uploadsDir(env.dataDir);
  await retryFs(() => fs.promises.rm(up, { recursive: true, force: true }));
  const fromUploads = path.join(fromDir, 'uploads');
  if (fs.existsSync(fromUploads)) await retryFs(() => fs.promises.cp(fromUploads, up, { recursive: true, force: true }));

  // secret.key가 백업에 있으면 바꾼다. 없으면(키를 만들기 전 백업) 지금 키를 그대로 둔다
  const fromKey = path.join(fromDir, 'secret.key');
  if (fs.existsSync(fromKey)) await retryFs(() => fs.promises.copyFile(fromKey, secretKeyPath(env.dataDir)));

  const { db } = openAppDb(env.dataDir, { clock: env.clock });
  env.db.swap(db);
}

/**
 * DB 파일이 멀쩡한 SQLite 파일인지 읽기 전용으로 열어 확인한다(머리글 + quick_check). 연 연결은 반드시 닫는다.
 * 백업 파일을 직접 고쳐 쓰지 않도록 읽기 전용으로 연다. server/db/index.ts의 openDb는 WAL로 바꾸며 파일을 고치고,
 * 망가진 파일에서 설정 중 오류가 나면 연결이 남을 수 있어서, 이 확인만 node:sqlite를 직접 읽기 전용으로 쓴다.
 */
export function isHealthyDbFile(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(16);
    try {
      fs.readSync(fd, head, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (head.toString('latin1') !== 'SQLite format 3\u0000') return false;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const row = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
      return row?.quick_check === 'ok';
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** 복원 결과 */
export interface RestoreResult {
  /** 복원한 백업 이름 */
  restored: string;
  /** 복원 직전 상태를 담은 백업 이름 */
  preRestore: string;
}

/**
 * 백업을 복원한다(overview §3.7). 다른 API는 그동안 503 MAINTENANCE를 받는다.
 * 실패하면 pre-restore 백업으로 되돌리고 오류를 던진다. 성공하면 모든 세션을 지우므로 모두 다시 로그인해야 한다.
 */
export async function restoreBackup(env: RestoreEnv, name: string, ctx: AuditContext): Promise<RestoreResult> {
  const fromDir = backupFolder(env.backupDir, name);
  if (env.maintenance.on) throw new AppError('MAINTENANCE');
  // ① 전에 백업 파일이 멀쩡한지 먼저 본다(망가졌으면 아무것도 바꾸지 않고 멈춘다)
  if (!isHealthyDbFile(path.join(fromDir, 'app.db'))) {
    throw new AppError('VALIDATION', { message: '이 백업의 데이터 파일이 손상돼 복원할 수 없어요. 다른 백업을 골라 주세요.' });
  }
  env.maintenance.on = true;
  try {
    // ② 지금 상태를 따로 백업(정리는 복원이 끝난 뒤에 한다 — 복원할 백업이 지워지지 않게)
    const pre = createBackup(env, 'pre-restore', { prune: false });
    const preDir = path.join(env.backupDir, pre.name);
    try {
      // ③~⑤ DB 닫기 → 파일 바꾸기 → 다시 열고 마이그레이션
      env.db.current.close();
      await replaceDataFrom(env, fromDir);
    } catch (e) {
      // 실패: 복원 직전 상태로 되돌린다
      try {
        env.db.current.close();
        await replaceDataFrom(env, preDir);
      } catch (e2) {
        throw new AppError('INTERNAL', {
          message: `복원에 실패했고 원래 상태로 되돌리지도 못했어요. 서버를 끈 뒤 백업 폴더의 "${pre.name}"을(를) 직접 복사해 주세요.`,
          cause: e2,
        });
      }
      audit({ ...ctx, db: env.db }, 'backup.restore_failed', 'backup', name, { preRestore: pre.name, reason: e instanceof Error ? e.message.slice(0, 200) : String(e) });
      throw new AppError('INTERNAL', { message: '백업 파일을 복원하지 못해 원래 상태로 되돌렸어요. 다른 백업을 골라 다시 시도해 주세요.', cause: e });
    }
    // ⑥ 모든 세션을 끊는다(복원한 데이터의 세션도 함께)
    env.db.run('DELETE FROM sessions');
    audit({ ...ctx, db: env.db }, 'backup.restore', 'backup', name, { preRestore: pre.name });
    pruneBackups(env.backupDir, readBackupSettings(env.db).keep, [pre.name]);
    return { restored: name, preRestore: pre.name };
  } finally {
    // ⑦ 점검 모드 끄기
    env.maintenance.on = false;
  }
}

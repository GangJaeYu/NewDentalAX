// 이 파일이 하는 일: DB 스키마에 환자 정보 테이블·열이 없는지 자동으로 확인한다(NFR-001 AC1, database.md §4).
// 마이그레이션을 모두 적용한 새 DB에서 모든 테이블·열 이름을 PRAGMA table_info로 읽어 금지어와 대조한다(대소문자 무시).
// 금지어 열(예: patient_name)을 더하는 임시 마이그레이션을 넣으면 검사가 위반을 찾아내는지도 확인한다(phase-01-task-02 AC3).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openDb, type Db } from '../server/db/index.ts';
import { listMigrations, migrate, MIGRATIONS_DIR } from '../server/db/migrate.ts';
import { makeTmpDir } from './helpers/tmp-dir.ts';

/** 어느 테이블에서도 쓰면 안 되는 이름 조각(database.md §4 — 이 목록은 이 파일 안에 그대로 둔다) */
const BANNED_ANYWHERE = ['patient', 'rrn', 'resident', 'ssn', 'chart', 'diagnos', 'treatment', 'medical_record', 'insurance_no', 'birth'];
/** users 테이블(직원 정보)에서 쓰면 안 되는 이름 조각. vendors.phone(사업자 연락처)은 허용한다 */
const BANNED_IN_USERS = ['phone', 'address'];

/** DB의 모든 테이블(뷰 포함)과 열 이름을 읽는다 */
function schemaNames(db: Db): { table: string; columns: string[] }[] {
  const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return tables.map((t) => ({
    table: t.name,
    // 테이블 이름은 바인딩할 수 없어 따옴표로 감싼다(sqlite_master에서 읽은 이름만 넣는다)
    columns: db.all<{ name: string }>(`PRAGMA table_info("${t.name.replaceAll('"', '""')}")`).map((c) => c.name),
  }));
}

/** 금지어에 걸린 '테이블' 또는 '테이블.열' 목록을 돌려준다(없으면 빈 배열) */
function findPrivacyViolations(db: Db): string[] {
  const out: string[] = [];
  for (const { table, columns } of schemaNames(db)) {
    const t = table.toLowerCase();
    if (BANNED_ANYWHERE.some((w) => t.includes(w))) out.push(table);
    for (const col of columns) {
      const c = col.toLowerCase();
      if (BANNED_ANYWHERE.some((w) => c.includes(w))) out.push(`${table}.${col}`);
      else if (t === 'users' && BANNED_IN_USERS.some((w) => c.includes(w))) out.push(`${table}.${col}`);
    }
  }
  return out;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** 임시 폴더에 새 DB를 만들고 지정한 마이그레이션 폴더를 모두 적용한다 */
function freshDb(dir: string, tmp: string): Db {
  const db = openDb(path.join(tmp, 'app.db'));
  cleanups.push(() => db.close());
  migrate(db, { dir });
  return db;
}

/** 실제 마이그레이션 파일을 모두 복사하고 임시 마이그레이션 하나를 더한 폴더를 만든다 */
function migrationsPlus(tmp: string, extraName: string, extraSql: string): string {
  const dir = path.join(tmp, 'migrations');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of listMigrations()) fs.copyFileSync(f.file, path.join(dir, f.name));
  fs.writeFileSync(path.join(dir, extraName), extraSql);
  return dir;
}

function newTmp(): string {
  const tmp = makeTmpDir('dentalax-privacy-');
  cleanups.unshift(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
}

describe('스키마 개인정보 검사', () => {
  test('phase-01-task-02 AC3: 마이그레이션 전체를 적용한 스키마에 환자 관련 테이블·열이 없다', () => {
    const tmp = newTmp();
    const db = freshDb(MIGRATIONS_DIR, tmp);
    const names = schemaNames(db);
    // 검사가 실제로 돌았는지: 핵심 테이블과 열을 읽었는지 확인
    expect(names.map((n) => n.table)).toEqual(expect.arrayContaining(['users', 'sessions', 'audit_log', 'settings', 'notifications', 'files', 'login_attempts']));
    expect(names.find((n) => n.table === 'users')?.columns).toEqual(expect.arrayContaining(['username', 'name', 'role', 'job_type', 'hired_on']));
    expect(findPrivacyViolations(db)).toEqual([]);
  });

  test('phase-01-task-02 AC3: 임시 마이그레이션으로 patient_name 열을 더하면 검사가 실패한다', () => {
    const tmp = newTmp();
    const dir = migrationsPlus(tmp, '999_tmp_bad.sql', '-- 이 파일이 하는 일: 검사용 나쁜 예\nALTER TABLE users ADD COLUMN patient_name TEXT;\n');
    const db = freshDb(dir, tmp);
    expect(findPrivacyViolations(db)).toEqual(['users.patient_name']);
  });

  test('phase-01-task-02 AC3: 금지어 테이블, 대문자 열, users의 phone·address도 잡아낸다', () => {
    const tmp = newTmp();
    const dir = migrationsPlus(
      tmp,
      '999_tmp_bad.sql',
      [
        'CREATE TABLE patient_charts (id INTEGER PRIMARY KEY, memo TEXT);',
        'CREATE TABLE visits (id INTEGER PRIMARY KEY, Diagnosis_Code TEXT, RRN TEXT, birth_on TEXT);',
        'ALTER TABLE users ADD COLUMN phone TEXT;',
        'ALTER TABLE users ADD COLUMN home_address TEXT;',
        // 사업자 연락처는 허용(vendors.phone)
        'CREATE TABLE vendors_tmp (id INTEGER PRIMARY KEY, phone TEXT, address TEXT);',
      ].join('\n'),
    );
    const db = freshDb(dir, tmp);
    expect(findPrivacyViolations(db).sort()).toEqual(
      ['patient_charts', 'users.home_address', 'users.phone', 'visits.Diagnosis_Code', 'visits.RRN', 'visits.birth_on'].sort(),
    );
  });
});

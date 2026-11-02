// 이 파일이 하는 일: 데모 데이터 등록 목록(seed/registry.ts)을 확인한다 — PLAN.md §3·backend.md §3의 모듈 11개가 모두
// 등록돼 있고(admin이 먼저), 각 모듈 seed 파일이 { tables, seedDemo } 모양이며, 전부 순서대로 불리는지(phase-01-task-02 범위: seed 등록 구조).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { SEED_MODULES, SEED_REGISTRY, seedDemoAll, seedTables, type ModuleSeed } from './registry.ts';
import { openAppDb } from '../migrate.ts';
import { fixedClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe('seed 등록 목록', () => {
  test('phase-01-task-02 범위(seed): 모듈 11개가 모두 등록되고 admin이 맨 앞이다', () => {
    expect([...SEED_MODULES]).toEqual(['admin', 'notifications', 'desk', 'inventory', 'docs', 'assistant', 'hr', 'facility', 'finance', 'marketing', 'ai']);
    expect(Object.keys(SEED_REGISTRY).sort()).toEqual([...SEED_MODULES].sort());
    for (const name of SEED_MODULES) {
      expect(fs.existsSync(path.join(process.cwd(), 'server', 'modules', name, 'seed.ts')), name).toBe(true);
      const seed: ModuleSeed = SEED_REGISTRY[name];
      expect(Array.isArray(seed.tables), name).toBe(true);
      expect(typeof seed.seedDemo, name).toBe('function');
    }
  });

  test('phase-01-task-02 범위(seed): 전체 적재가 오류 없이 등록 순서대로 끝난다', async () => {
    const tmp = makeTmpDir('dentalax-seed-');
    const { db } = openAppDb(tmp);
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    cleanups.push(() => db.close());
    const done = await seedDemoAll(db, { clock: fixedClock('2026-11-02T09:00:00+09:00'), scale: 1 });
    expect(done).toEqual([...SEED_MODULES]);
    // 각 모듈이 적은 업무 테이블은 겹치지 않고 실제로 있어야 한다(초기화가 이 목록을 비운다)
    const tables = seedTables();
    expect(new Set(tables).size).toBe(tables.length);
    for (const t of tables) expect(db.get('SELECT 1 AS x FROM sqlite_master WHERE name = ?', [t]), t).toBeDefined();
  });

  test('phase-02-task-05 범위(seed): 관리자가 없을 때 admin seed는 하늘숲치과 직원 9명(데모 원장 포함)을 넣고, 다시 불러도 늘지 않는다', async () => {
    const tmp = makeTmpDir('dentalax-seed-');
    const { db } = openAppDb(tmp);
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    cleanups.push(() => db.close());
    const ctx = { clock: fixedClock('2026-11-02T09:00:00+09:00'), scale: 1 };
    await SEED_REGISTRY.admin.seedDemo(db, ctx);
    const users = db.all<{ role: string; must_change_pw: number; hired_on: string }>('SELECT role, must_change_pw, hired_on FROM users');
    expect(users).toHaveLength(9);
    expect(users.filter((u) => u.role === 'admin')).toHaveLength(1);
    expect(users.every((u) => u.must_change_pw === 1 && /^\d{4}-\d{2}-\d{2}$/.test(u.hired_on) && u.hired_on < '2026-11-02')).toBe(true);
    await SEED_REGISTRY.admin.seedDemo(db, ctx);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n).toBe(9);
    expect(JSON.parse(db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'clinic'")?.value ?? '{}')).toMatchObject({ name: '하늘숲치과' });
  });
});

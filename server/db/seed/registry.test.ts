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

  test('phase-01-task-02 범위(seed): 빈 seed로 전체 적재가 오류 없이 등록 순서대로 끝나고 업무 테이블은 아직 없다', async () => {
    const tmp = makeTmpDir('dentalax-seed-');
    const { db } = openAppDb(tmp);
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    cleanups.push(() => db.close());
    const done = await seedDemoAll(db, { clock: fixedClock('2026-11-02T09:00:00+09:00'), scale: 1 });
    expect(done).toEqual([...SEED_MODULES]);
    expect(seedTables()).toEqual([]);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n).toBe(0);
  });
});

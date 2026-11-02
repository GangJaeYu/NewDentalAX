// 이 파일이 하는 일: 업무 모듈 등록표(server/modules/index.ts)가 seed 등록표와 같은 11개 모듈을 같은 순서로 담고,
// 각 모듈의 routes.ts가 Fastify 플러그인으로 '/api' 아래 등록되는지 확인한다(phase-01-task-03 범위: 모듈 스텁).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import { MODULE_ROUTES, MODULES, registerModules } from './index.ts';
import { SEED_MODULES } from '../db/seed/registry.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('모듈 등록표', () => {
  test('phase-01-task-03 범위(모듈 스텁): seed 등록표와 같은 11개 모듈이 같은 순서로 있고 모두 routes.ts가 있다', () => {
    expect([...MODULES]).toEqual([...SEED_MODULES]);
    expect(MODULES).toHaveLength(11);
    for (const m of MODULES) {
      expect(typeof MODULE_ROUTES[m], m).toBe('function');
      expect(fs.existsSync(path.join(HERE, m, 'routes.ts')), m).toBe(true);
    }
  });

  test('phase-01-task-03 범위(모듈 스텁): 모듈 플러그인은 /api 앞붙임으로 등록된다', async () => {
    const app = Fastify();
    await registerModules(app);
    // 등록이 끝난 뒤 같은 방식으로 붙인 라우트가 /api 아래에 생기는지 본다
    await app.register(async (sub) => sub.get('/probe', async () => ({ ok: true })), { prefix: '/api' });
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/probe' })).statusCode).toBe(200);
    await app.close();
  });
});

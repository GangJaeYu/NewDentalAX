// 이 파일이 하는 일: buildApp의 준비 상태 API(/api/health), 화면 파일 제공, SPA 폴백, 없는 API의 한국어 오류를
// 실제 서버를 띄우지 않고 fastify.inject로 확인한다(phase-01-task-01 AC2·AC5).
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp, fixedClock } from './app.ts';
import { makeTmpDir } from '../tests/helpers/tmp-dir.ts';

let tmp: string;
let webDist: string;

beforeAll(() => {
  tmp = makeTmpDir('dentalax-app-');
  webDist = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(webDist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>하늘숲치과 원내 업무</title><div id="root"></div>');
  fs.writeFileSync(path.join(webDist, 'assets', 'app-abc123.js'), 'console.log(1)');
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('GET /api/health', () => {
  test('phase-01-task-01 AC2/AC5: 준비 상태 확인이 {ok:true, version, db:"ok"}를 돌려준다', async () => {
    const app = await buildApp({ dataDir: tmp, webDist, version: '9.9.9', clock: fixedClock('2026-11-02T09:00:00+09:00') });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: '9.9.9', db: 'ok', now: '2026-11-02T00:00:00.000Z' });
    await app.close();
  });

  test('phase-01-task-01 AC2: 기본 DB 점검은 실제 Node 내장 SQLite를 열어 ok를 낸다', async () => {
    const app = await buildApp({ dataDir: tmp, webDist });
    const body = (await app.inject({ method: 'GET', url: '/api/health' })).json<{ ok: boolean; db: string; version: string }>();
    expect(body.ok).toBe(true);
    expect(body.db).toBe('ok');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    await app.close();
  });

  test('phase-01-task-01 AC2: DB 점검이 실패하면 503과 ok:false로 준비되지 않았음을 알린다', async () => {
    const app = await buildApp({ dataDir: tmp, webDist, checkDb: () => 'error' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, db: 'error' });
    await app.close();
  });

  test('phase-01-task-01 AC4: 자기 확인 표식(instanceId)을 넣으면 health 응답에만 X-Instance 헤더로 붙는다(원내망 밖으로 막힌 응답에도)', async () => {
    const app = await buildApp({ dataDir: tmp, webDist, instanceId: 'abc123' });
    expect((await app.inject({ method: 'GET', url: '/api/health' })).headers['x-instance']).toBe('abc123');
    expect((await app.inject({ method: 'GET', url: '/api/health?x=1' })).headers['x-instance']).toBe('abc123');
    expect((await app.inject({ method: 'GET', url: '/' })).headers['x-instance']).toBeUndefined();
    const blocked = await app.inject({ method: 'GET', url: '/api/health', remoteAddress: '8.8.8.8' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.headers['x-instance']).toBe('abc123');
    await app.close();
    const plain = await buildApp({ dataDir: tmp, webDist });
    expect((await plain.inject({ method: 'GET', url: '/api/health' })).headers['x-instance']).toBeUndefined();
    await plain.close();
  });
});

describe('화면 파일 제공', () => {
  test('phase-01-task-01 AC2: 루트(/)가 빌드된 index.html을 돌려준다', async () => {
    const app = await buildApp({ dataDir: tmp, webDist });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('하늘숲치과 원내 업무');
    await app.close();
  });

  test('phase-01-task-01 AC2: 화면 주소(/inventory/items)는 SPA 폴백으로 index.html을 돌려준다', async () => {
    const app = await buildApp({ dataDir: tmp, webDist });
    const res = await app.inject({ method: 'GET', url: '/inventory/items?tab=low' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<div id="root">');
    await app.close();
  });

  test('phase-01-task-01 AC2: 빌드 파일(assets)은 그대로, 없는 파일은 404를 돌려준다', async () => {
    const app = await buildApp({ dataDir: tmp, webDist });
    const js = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['cache-control']).toContain('immutable');
    const missing = await app.inject({ method: 'GET', url: '/assets/none.js' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  test('phase-01-task-01 AC2: 없는 API는 한국어 메시지와 함께 404 JSON을 돌려준다', async () => {
    const app = await buildApp({ dataDir: tmp, webDist });
    const res = await app.inject({ method: 'GET', url: '/api/nothing' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.stringContaining('찾을 수 없어요') } });
    await app.close();
  });

  test('phase-01-task-01 AC2: 화면 파일이 없으면 503과 빌드 방법을 한국어로 안내한다', async () => {
    const app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-dist') });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('npm run build:web');
    await app.close();
  });
});

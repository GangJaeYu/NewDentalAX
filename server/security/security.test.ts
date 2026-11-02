// 이 파일이 하는 일: 원내망 제한(FR-009)·보안 헤더(NFR-002 AC4)·입력 검증 오류 형식(NFR-002 AC5)을 실제 buildApp과 inject로 확인한다
// (phase-01-task-03 AC5·AC6). 원격 주소는 inject의 remoteAddress로 흉내 낸다.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../app.ts';
import { fixedClock } from '../lib/clock.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';
import { loginAs } from '../../tests/helpers/auth.ts';
import { isInternalAddress } from './network.ts';
import { CSP } from './headers.ts';
import { parseInput } from './validate.ts';
import { AppError } from '../lib/errors.ts';

let tmp: string;
let webDist: string;
let app: FastifyInstance;
let open: FastifyInstance;

beforeAll(async () => {
  tmp = makeTmpDir('dentalax-sec-');
  webDist = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(webDist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webDist, 'index.html'), '<!doctype html><title>하늘숲치과 원내 업무</title><div id="root"></div>');
  fs.writeFileSync(path.join(webDist, 'assets', 'app-1.js'), 'console.log(1)');
  const clock = fixedClock('2026-11-02T09:00:00+09:00');
  app = await buildApp({ dataDir: path.join(tmp, 'a'), webDist, clock });
  open = await buildApp({ dataDir: path.join(tmp, 'b'), webDist, clock, allowExternal: true });
});
afterAll(async () => {
  await app.close();
  await open.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('원내망 제한', () => {
  test('phase-01-task-03 AC5: 원격 주소 8.8.8.8로 흉내 낸 요청은 403 NETWORK_BLOCKED, 192.168.0.5와 127.0.0.1은 허용된다', async () => {
    const blocked = await app.inject({ method: 'GET', url: '/api/health', remoteAddress: '8.8.8.8' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual({ error: { code: 'NETWORK_BLOCKED', message: '원내 네트워크에서만 접속할 수 있습니다.' } });
    // 화면 주소도 막고, 쉬운 한국어 안내를 보여 준다
    const page = await app.inject({ method: 'GET', url: '/', remoteAddress: '8.8.8.8' });
    expect(page.statusCode).toBe(403);
    expect(page.body).toContain('원내 네트워크에서만 접속할 수 있습니다.');
    // 로그인 요청도 막힌다
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '8.8.8.8', payload: { username: 'a', password: 'b' } });
    expect(login.statusCode).toBe(403);
    expect(login.json()).toMatchObject({ error: { code: 'NETWORK_BLOCKED' } });

    for (const ip of ['192.168.0.5', '127.0.0.1']) {
      const ok = await app.inject({ method: 'GET', url: '/api/health', remoteAddress: ip });
      expect(ok.statusCode, ip).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/', remoteAddress: ip })).statusCode, ip).toBe(200);
    }
  });

  test('phase-01-task-03 AC5: 주소 판별 표(사설망·루프백·링크로컬·IPv6는 허용, 공인 주소는 거부)', () => {
    const allowed = ['127.0.0.1', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.0.5', '169.254.10.1', '::1', '::ffff:192.168.0.5', '::ffff:127.0.0.1', 'fe80::1%eth0', 'fd12:3456::1', 'fc00::1'];
    const denied = ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '1.1.1.1', '::ffff:8.8.8.8', '2001:4860:4860::8888', '', 'garbage', '999.1.1.1'];
    for (const ip of allowed) expect(isInternalAddress(ip), ip).toBe(true);
    for (const ip of denied) expect(isInternalAddress(ip), ip).toBe(false);
    expect(isInternalAddress(undefined)).toBe(false);
  });

  test('phase-01-task-03 AC5: X-Forwarded-For로 원내 주소를 흉내 내도 막힌다', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health', remoteAddress: '8.8.8.8', headers: { 'x-forwarded-for': '192.168.0.5' } });
    expect(r.statusCode).toBe(403);
  });

  test('phase-01-task-03 AC5: config.json의 allowExternal: true면 외부 주소도 허용된다', async () => {
    const r = await open.inject({ method: 'GET', url: '/api/health', remoteAddress: '8.8.8.8' });
    expect(r.statusCode).toBe(200);
  });
});

describe('보안 헤더', () => {
  test('phase-01-task-03 AC6: 모든 응답에 CSP·nosniff·frame-ancestors·Referrer-Policy 헤더가 있다', async () => {
    const staff = loginAs(app, 'staff');
    const cases: { name: string; req: InjectOptions }[] = [
      { name: '준비 상태 API', req: { method: 'GET', url: '/api/health' } },
      { name: '세션 조회', req: { method: 'GET', url: '/api/session' } },
      { name: '첫 화면', req: { method: 'GET', url: '/' } },
      { name: 'SPA 폴백', req: { method: 'GET', url: '/inventory/items' } },
      { name: '빌드 파일', req: { method: 'GET', url: '/assets/app-1.js' } },
      { name: '없는 파일', req: { method: 'GET', url: '/assets/none.js' } },
      { name: '없는 API', req: { method: 'GET', url: '/api/nothing' } },
      { name: '로그인 필요(401)', req: { method: 'GET', url: '/api/auth/me' } },
      { name: '권한 없음(403)', req: { method: 'GET', url: '/api/audit', headers: staff.headers } },
      { name: 'CSRF 거부', req: { method: 'POST', url: '/api/auth/logout', headers: staff.headers } },
      { name: '입력 오류(400)', req: { method: 'POST', url: '/api/auth/login', payload: {} } },
      { name: '원내망 거부', req: { method: 'GET', url: '/api/health', remoteAddress: '8.8.8.8' } },
    ];
    for (const c of cases) {
      const res = await app.inject(c.req);
      const h = res.headers;
      expect(h['content-security-policy'], c.name).toBe(CSP);
      expect(String(h['content-security-policy']), c.name).toContain("frame-ancestors 'none'");
      expect(h['x-content-type-options'], c.name).toBe('nosniff');
      expect(h['referrer-policy'], c.name).toBe('no-referrer');
      expect(h['cross-origin-opener-policy'], c.name).toBe('same-origin');
    }
    expect(CSP).toBe("default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  });

  test('phase-01-task-03 AC6: API 응답은 저장되지 않게 no-store를 붙인다', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/session' });
    expect(r.headers['cache-control']).toBe('no-store');
  });
});

describe('입력 검증 오류 형식', () => {
  test('phase-01-task-03 범위(NFR-002 AC5): 잘못된 입력은 400 VALIDATION과 항목별 한국어 이유로 바뀐다', () => {
    const schema = z.object({ name: z.string({ error: '이름을 적어 주세요.' }), age: z.number() });
    let caught: unknown;
    try {
      parseInput(schema, { age: 'x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppError);
    const body = (caught as AppError).toBody();
    expect(body).toEqual({ error: { code: 'VALIDATION', message: '입력값을 확인해 주세요.', fields: { name: '이름을 적어 주세요.', age: '이 값을 확인해 주세요.' } } });
    expect(parseInput(schema, { name: '김', age: 3 })).toEqual({ name: '김', age: 3 });
  });

  test('phase-01-task-03 범위(NFR-002 AC5): JSON이 아닌 본문·빈 본문도 400 한국어 응답이다', async () => {
    const broken = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{"username":' });
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toMatchObject({ error: { code: 'VALIDATION', message: expect.stringMatching(/[가-힣]/) } });
    const empty = await app.inject({ method: 'POST', url: '/api/auth/login' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ error: { code: 'VALIDATION', fields: { username: '아이디를 적어 주세요.', password: '비밀번호를 적어 주세요.' } } });
  });
});

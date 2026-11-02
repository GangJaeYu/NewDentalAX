// 이 파일이 하는 일: 역할(admin·manager·staff) × 대표 API 표를 실제 서버(buildApp)에 요청해 권한이 PRD §2 표대로인지 확인한다
// (phase-01-task-03 AC8, FR-003 AC1). 허용된 역할은 401·403이 아니어야 하고(모듈이 아직 비어 있으면 404), 막힌 역할은 403 FORBIDDEN이다.
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { fixedClock } from '../lib/clock.ts';
import { makeTmpDir } from '../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../tests/helpers/auth.ts';
import { can, ROLES, type Role } from '../../shared/roles.ts';
import { API_RULES, findApiRule } from './api-permissions.ts';
import { assertCan, requireCap, requireRole } from './guard.ts';

let tmp: string;
let app: FastifyInstance;
let users: Record<Role, TestLogin>;

beforeAll(async () => {
  tmp = makeTmpDir('dentalax-perm-');
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock: fixedClock('2026-11-02T09:00:00+09:00') });
  // 모듈이 붙일 라우트 흉내: preHandler 가드와 라우트 안 확인
  app.get('/api/_test/manager-only', { preHandler: requireRole('manager') }, async () => ({ data: 'ok' }));
  app.post('/api/_test/notice', { preHandler: requireCap('handover.write') }, async (req) => {
    const kind = (req.body as { kind?: string } | undefined)?.kind;
    if (kind === 'notice') assertCan(req, 'notices.write');
    return { data: kind };
  });
  users = { admin: loginAs(app, 'admin'), manager: loginAs(app, 'manager'), staff: loginAs(app, 'staff') };
});
afterAll(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Expect = 'A' | 'M' | 'S';
const allowedRoles: Record<Expect, Role[]> = { A: ['admin'], M: ['admin', 'manager'], S: ['admin', 'manager', 'staff'] };

/** 역할 × 대표 API 표(backend.md §3 표기 그대로) */
const TABLE: [method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, who: Expect][] = [
  ['GET', '/api/audit', 'A'],
  ['GET', '/api/audit?format=csv', 'A'],
  ['POST', '/api/users', 'A'],
  ['PATCH', '/api/users/3', 'A'],
  ['POST', '/api/users/3/reset-password', 'A'],
  ['PUT', '/api/settings/clinic', 'A'],
  ['GET', '/api/settings/privacy', 'A'],
  ['GET', '/api/backups', 'A'],
  ['POST', '/api/backups/2026-11-01.zip/restore', 'A'],
  ['POST', '/api/demo/reset', 'A'],
  ['GET', '/api/ai/settings', 'A'],
  ['PUT', '/api/ai/models', 'A'],
  ['GET', '/api/ai/usage', 'A'],
  ['PUT', '/api/leave/allowances', 'A'],
  ['POST', '/api/legal-tasks', 'A'],
  ['PUT', '/api/ad-rules', 'A'],
  ['GET', '/api/users', 'M'],
  ['POST', '/api/leave/7/decide', 'M'],
  ['PUT', '/api/roster/cell', 'M'],
  ['POST', '/api/orders/draft', 'M'],
  ['GET', '/api/orders', 'M'],
  ['POST', '/api/vendors', 'M'],
  ['GET', '/api/expenses?month=2026-11', 'M'],
  ['GET', '/api/finance/monthly', 'M'],
  ['POST', '/api/items', 'M'],
  ['DELETE', '/api/items/5', 'M'],
  ['POST', '/api/import/items/preview', 'M'],
  ['GET', '/api/export/items.csv', 'M'],
  ['PUT', '/api/checklists/open/items', 'M'],
  ['POST', '/api/kb/docs', 'M'],
  ['POST', '/api/legal-tasks/2/done', 'M'],
  ['GET', '/api/_test/manager-only', 'M'],
  ['GET', '/api/auth/me', 'S'],
  ['GET', '/api/session', 'S'],
  ['POST', '/api/assistant/ask', 'S'],
  ['POST', '/api/ai/receipt', 'S'],
  ['POST', '/api/adcheck', 'S'],
  ['POST', '/api/_test/notice', 'S'],
];

describe('역할 × 대표 API', () => {
  test('phase-01-task-03 AC8: staff가 admin 전용 API(GET /api/audit)를 부르면 403 FORBIDDEN이다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audit', headers: users.staff.headers });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: { code: 'FORBIDDEN', message: '이 기능을 사용할 권한이 없습니다.' } });
    const mgr = await app.inject({ method: 'GET', url: '/api/audit', headers: users.manager.headers });
    expect(mgr.statusCode).toBe(403);
  });

  test('phase-01-task-03 AC8: 역할 × 대표 API 표 — 허용된 역할은 401·403이 아니고, 나머지 역할은 403 FORBIDDEN이다', async () => {
    const rows: string[] = [];
    for (const [method, url, who] of TABLE) {
      const cells: string[] = [];
      for (const role of ROLES) {
        const u = users[role];
        const res = await app.inject({ method, url, headers: method === 'GET' ? u.headers : u.writeHeaders, ...(method === 'GET' ? {} : { payload: {} }) });
        const label = `${role} ${method} ${url}`;
        if (allowedRoles[who].includes(role)) {
          expect([401, 403], `${label} → ${res.statusCode} ${res.body}`).not.toContain(res.statusCode);
        } else {
          expect(res.statusCode, label).toBe(403);
          expect(res.json(), label).toMatchObject({ error: { code: 'FORBIDDEN' } });
        }
        cells.push(`${role}=${res.statusCode}`);
      }
      rows.push(`${method} ${url} [${who}] ${cells.join(' ')}`);
    }
    // 검증자가 표를 그대로 볼 수 있게 남긴다
    console.log(`역할 × 대표 API 결과\n${rows.join('\n')}`);
  });

  test('phase-01-task-03 AC8: 공지(notice)처럼 본문에 따라 다른 권한은 모듈의 assertCan으로 막힌다', async () => {
    const staffNotice = await app.inject({ method: 'POST', url: '/api/_test/notice', headers: users.staff.writeHeaders, payload: { kind: 'notice' } });
    expect(staffNotice.statusCode).toBe(403);
    const staffHandover = await app.inject({ method: 'POST', url: '/api/_test/notice', headers: users.staff.writeHeaders, payload: { kind: 'handover' } });
    expect(staffHandover.statusCode).toBe(200);
    const mgrNotice = await app.inject({ method: 'POST', url: '/api/_test/notice', headers: users.manager.writeHeaders, payload: { kind: 'notice' } });
    expect(mgrNotice.statusCode).toBe(200);
  });

  test('phase-01-task-03 AC8: 로그인하지 않으면 표의 모든 API(공개 API 제외)가 401이다', async () => {
    for (const [method, url] of TABLE) {
      if (url === '/api/session') continue;
      const res = await app.inject({ method, url, ...(method === 'GET' ? {} : { payload: {} }) });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  test('phase-01-task-03 AC8: 주소 권한 표(API_RULES)의 모든 줄이 roles.ts CAPS와 같은 결과를 낸다', async () => {
    expect(API_RULES.length).toBeGreaterThan(40);
    for (const rule of API_RULES) {
      const url = `/api${rule.path.replace(/:[a-z]+/g, '1')}`;
      expect(findApiRule(rule.methods[0] as string, url.slice(4))).toBe(rule);
      for (const method of rule.methods) {
        for (const role of ROLES) {
          const u = users[role];
          const res = await app.inject({ method, url, headers: method === 'GET' ? u.headers : u.writeHeaders, ...(method === 'GET' ? {} : { payload: {} }) });
          if (can(role, rule.cap)) expect([401, 403], `${role} ${method} ${url}`).not.toContain(res.statusCode);
          else expect(res.statusCode, `${role} ${method} ${url}`).toBe(403);
        }
      }
    }
  });

  test('phase-01-task-03 AC8: 경로 뒤 슬래시·%인코딩으로 권한 표를 피해 갈 수 없다', async () => {
    for (const url of ['/api/audit/', '/api/%61udit', '/api/audit?x=1']) {
      const res = await app.inject({ method: 'GET', url, headers: users.staff.headers });
      expect(res.statusCode, url).toBe(403);
    }
  });
});

// 이 파일이 하는 일: 서버에 등록된 "모든" /api 경로를 하나씩 불러 보는 보안 횡단 점검(phase-05-task-02, NFR-002, 원문 7절).
// 인증(로그인 없이 401·로그아웃 뒤 401), CSRF(토큰 없음·틀림·다른 사이트 Origin → 403), 권한 표(backend.md §3의 M·A 경로),
// 보안 헤더, 원내망 제한(IPv4-mapped 포함), 입력 검증(깨진 본문 → 4xx 한국어, 500 없음), SQL 인젝션(검색어·정렬·필터)을 확인한다.
// 경로 목록은 서버에서 직접 뽑으므로(sweep-helpers.ts) 새 API가 생겨도 자동으로 점검된다. 결과는 docs/SECURITY.md에 옮겨 적었다.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { InjectOptions } from 'fastify';
import { CSP } from '../../server/security/headers.ts';
import { findApiRule } from '../../server/auth/api-permissions.ts';
import { createSession } from '../../server/auth/sessions.ts';
import { countRows, fillParams, isWrite, listApiRoutes, makeSecEnv, PUBLIC_ROUTES, type ApiRoute, type SecEnv } from './sweep-helpers.ts';

type Method = InjectOptions['method'];

/** 로그인 세션을 끊는 경로(한 번 부르면 뒤 요청이 모두 401이 되므로 따로 시험한다) */
const LOGOUT = 'POST /api/auth/logout';

/** 요청 하나를 보낸다(쓰기 메서드는 빈 JSON 본문) */
function call(env: SecEnv, r: ApiRoute, headers: Record<string, string> = {}, extra: Partial<InjectOptions> = {}) {
  return env.app.inject({ method: r.method as Method, url: fillParams(r.url), headers, ...(isWrite(r.method) ? { payload: {} } : {}), ...extra });
}

const keyOf = (r: ApiRoute) => `${r.method} ${r.url}`;

/** 응답에 담긴 결과 수: JSON이면 배열 길이 합, CSV 같은 글이면 줄 수 */
function sizeOf(res: { headers: Record<string, unknown>; body: string; json(): unknown }): number {
  if (String(res.headers['content-type'] ?? '').includes('json')) return countRows(res.json());
  return res.body.split(/\r?\n/).filter((l) => l.trim()).length;
}

describe('phase-05-task-02 경로 전수 점검: 인증·CSRF·헤더·원내망', () => {
  let env: SecEnv;
  let routes: ApiRoute[];
  beforeAll(async () => {
    env = await makeSecEnv();
    routes = listApiRoutes(env.app);
  });
  afterAll(async () => env.close());

  test('phase-05-task-02 점검(경로 목록): 등록된 /api 경로를 100개 넘게 찾았고, 공개 API 4개가 모두 들어 있다', () => {
    expect(routes.length).toBeGreaterThan(100);
    const keys = new Set(routes.map(keyOf));
    for (const k of PUBLIC_ROUTES) expect(keys.has(k), k).toBe(true);
    // 대표 모듈 경로가 빠짐없이 잡혔는지(나무 모양 읽기가 깨지지 않았는지)
    for (const k of ['GET /api/users', 'PATCH /api/users/:id', 'POST /api/onboarding/assignments/:id/items/:idx', 'GET /api/trainings/records/:id/file', 'GET /api/export/:file'])
      expect(keys.has(k), k).toBe(true);
  });

  test('phase-05-task-02 점검(인증): 공개 4개를 뺀 모든 /api 경로는 로그인 없이 401 UNAUTHENTICATED다', async () => {
    const wrong: string[] = [];
    for (const r of routes) {
      if (PUBLIC_ROUTES.has(keyOf(r))) continue;
      const res = await call(env, r);
      if (res.statusCode !== 401 || res.json<{ error: { code: string } }>().error.code !== 'UNAUTHENTICATED') wrong.push(`${keyOf(r)} → ${res.statusCode}`);
    }
    expect(wrong).toEqual([]);
  });

  test('phase-05-task-02 점검(세션): 로그아웃하면 그 쿠키로는 모든 경로가 401이고, 만료(8시간)된 세션도 401이다', async () => {
    const s = createSession(env.app.db, env.app.clock, env.staff.userId, '127.0.0.1');
    const cookie = `sid=${s.token}`;
    const out = await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-csrf-token': s.csrfToken } });
    expect(out.statusCode).toBe(204);
    const old = createSession(env.app.db, env.app.clock, env.staff.userId, '127.0.0.1');
    env.clock.advance(8 * 60 * 60 * 1000 + 60 * 1000); // 8시간 1분 뒤
    const wrong: string[] = [];
    try {
      for (const r of routes) {
        if (PUBLIC_ROUTES.has(keyOf(r))) continue;
        for (const [name, c, t] of [
          ['로그아웃', cookie, s.csrfToken],
          ['만료', `sid=${old.token}`, old.csrfToken],
        ] as const) {
          const res = await call(env, r, { cookie: c, 'x-csrf-token': t });
          if (res.statusCode !== 401) wrong.push(`${name} ${keyOf(r)} → ${res.statusCode}`);
        }
      }
    } finally {
      env.clock.set('2026-11-02T09:00:00+09:00');
    }
    expect(wrong).toEqual([]);
  });

  test('phase-05-task-02 점검(CSRF): 로그인했어도 X-CSRF-Token이 없거나 틀리거나, 다른 사이트 Origin·Sec-Fetch-Site면 모든 상태 변경 요청이 403 CSRF이고 감사 로그가 늘지 않는다', async () => {
    const auditBefore = env.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n;
    const admin = env.admin;
    const variants: Array<[string, Record<string, string>]> = [
      ['토큰 없음', { cookie: admin.cookie }],
      ['틀린 토큰', { cookie: admin.cookie, 'x-csrf-token': 'x'.repeat(admin.csrf.length) }],
      ['다른 세션 토큰', { cookie: admin.cookie, 'x-csrf-token': env.staff.csrf }],
      ['다른 사이트 Origin', { ...admin.writeHeaders, origin: 'http://evil.example' }],
      ['다른 사이트 Referer', { ...admin.writeHeaders, referer: 'http://evil.example/page' }],
      ['Sec-Fetch-Site cross-site', { ...admin.writeHeaders, 'sec-fetch-site': 'cross-site' }],
    ];
    const wrong: string[] = [];
    let checked = 0;
    for (const r of routes) {
      if (!isWrite(r.method)) continue;
      // 공개 쓰기(첫 설정·로그인)는 토큰이 없으므로 출처만 확인한다
      const list = PUBLIC_ROUTES.has(keyOf(r)) ? variants.slice(3) : variants;
      for (const [name, headers] of list) {
        const res = await call(env, r, headers);
        checked++;
        if (res.statusCode !== 403 || res.json<{ error: { code: string } }>().error.code !== 'CSRF') wrong.push(`${name} ${keyOf(r)} → ${res.statusCode}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(300);
    expect(env.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log')?.n).toBe(auditBefore);
  });

  test('phase-05-task-02 점검(보안 헤더): 모든 경로의 응답(성공·401·403·400·404)에 CSP·nosniff·frame-ancestors·Referrer-Policy·COOP가 있다', async () => {
    const wrong: string[] = [];
    for (const r of routes) {
      if (keyOf(r) === LOGOUT) continue;
      for (const headers of [{}, isWrite(r.method) ? env.staff.writeHeaders : env.staff.headers]) {
        const res = await call(env, r, headers);
        const h = res.headers;
        const ok =
          h['content-security-policy'] === CSP &&
          h['x-content-type-options'] === 'nosniff' &&
          h['referrer-policy'] === 'no-referrer' &&
          h['cross-origin-opener-policy'] === 'same-origin' &&
          String(h['content-security-policy']).includes("frame-ancestors 'none'");
        if (!ok) wrong.push(`${keyOf(r)} (${res.statusCode})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test('phase-05-task-02 점검(원내망): 관리자 쿠키가 있어도 외부 주소(8.8.8.8·::ffff:8.8.8.8·2001:db8::1)에서 온 모든 요청은 403 NETWORK_BLOCKED다', async () => {
    const wrong: string[] = [];
    for (const r of routes) {
      for (const ip of ['8.8.8.8', '::ffff:8.8.8.8', '2001:db8::1', '::ffff:7f00:1']) {
        const res = await call(env, r, env.admin.writeHeaders, { remoteAddress: ip });
        if (res.statusCode !== 403 || res.json<{ error: { code: string } }>().error.code !== 'NETWORK_BLOCKED') wrong.push(`${ip} ${keyOf(r)} → ${res.statusCode}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

/**
 * backend.md §3에서 권한이 M(실장 이상)·A(원장·관리자)로 정해진 경로. 직원(S)이 부르면 403이어야 한다.
 * A 전용은 실장이 불러도 403이어야 한다. 본문·작성자에 따라 달라지는 경로(공지·문구·문서 등)는 모듈 테스트가 따로 확인한다.
 */
const MANAGER_ONLY: readonly string[] = [
  'GET /api/users',
  'PUT /api/checklists/:kind/items',
  'POST /api/items',
  'PATCH /api/items/:id',
  'DELETE /api/items/:id',
  'POST /api/vendors',
  'PATCH /api/vendors/:id',
  'POST /api/orders/draft',
  'GET /api/orders',
  'GET /api/orders/:id',
  'PATCH /api/orders/:id',
  'POST /api/orders/:id/order',
  'POST /api/orders/:id/cancel',
  'POST /api/orders/:id/receive',
  'GET /api/export/:file',
  'POST /api/import/items/preview',
  'POST /api/import/items/commit',
  'GET /api/import/items/template.csv',
  'POST /api/kb/docs',
  'DELETE /api/kb/docs/:id',
  'POST /api/kb/docs/:id/confirm-redact',
  'PUT /api/roster/cell',
  'POST /api/roster/copy-week',
  'PUT /api/shift-types',
  'POST /api/leave/:id/decide',
  'POST /api/trainings',
  'PATCH /api/trainings/:id',
  'GET /api/onboarding/templates',
  'POST /api/onboarding/templates',
  'PATCH /api/onboarding/templates/:id',
  'POST /api/onboarding/assignments',
  'DELETE /api/onboarding/assignments/:id',
  'POST /api/equipment',
  'PATCH /api/equipment/:id',
  'POST /api/legal-tasks/:id/done',
  'GET /api/expenses',
  'POST /api/expenses',
  'GET /api/expenses/:id',
  'PATCH /api/expenses/:id',
  'DELETE /api/expenses/:id',
  'POST /api/expenses/:id/file',
  'DELETE /api/expenses/:id/file',
  'GET /api/expense-categories',
  'PUT /api/expense-categories',
  'GET /api/finance/monthly',
  'POST /api/finance/monthly/summary',
];
const ADMIN_ONLY: readonly string[] = [
  'POST /api/users',
  'PATCH /api/users/:id',
  'POST /api/users/:id/reset-password',
  'GET /api/audit',
  'PUT /api/settings/clinic',
  'GET /api/settings/backup',
  'PUT /api/settings/backup',
  'GET /api/settings/leave',
  'PUT /api/settings/leave',
  'GET /api/backups',
  'POST /api/backups',
  'GET /api/backups/:name/download',
  'POST /api/backups/:name/restore',
  'GET /api/demo/status',
  'POST /api/demo/load',
  'POST /api/demo/reset',
  'PUT /api/leave/allowances',
  'POST /api/legal-tasks',
  'PATCH /api/legal-tasks/:id',
  'GET /api/ai/settings',
  'PUT /api/ai/settings',
  'POST /api/ai/test',
  'GET /api/ai/models',
  'PUT /api/ai/models',
  'GET /api/ai/usage',
  'PUT /api/ad-rules',
];

/** 주소만으로 권한이 정해지는데 04-02까지 모듈 assertCan으로만 막혀 있던 경로(05-02가 중앙 표에 넣음) */
const ADDED_TO_TABLE: readonly string[] = [
  'GET /api/demo/status',
  'GET /api/onboarding/templates',
  'POST /api/onboarding/assignments',
  'DELETE /api/onboarding/assignments/:id',
  'POST /api/trainings',
  'PATCH /api/trainings/:id',
  'POST /api/finance/monthly/summary',
];

describe('phase-05-task-02 경로 전수 점검: 권한 표', () => {
  let env: SecEnv;
  let routes: ApiRoute[];
  beforeAll(async () => {
    env = await makeSecEnv();
    routes = listApiRoutes(env.app);
  });
  afterAll(async () => env.close());

  test('phase-05-task-02 점검(권한 표): backend.md §3의 M·A 전용 경로를 직원이 부르면 모두 403, A 전용은 실장도 403이다', async () => {
    const known = new Set(routes.map(keyOf));
    const wrong: string[] = [];
    const check = async (key: string, who: 'staff' | 'manager') => {
      expect(known.has(key), `서버에 없는 경로: ${key}`).toBe(true);
      const [method, url] = key.split(' ') as [string, string];
      const login = env[who];
      const res = await call(env, { method, url }, isWrite(method) ? login.writeHeaders : login.headers);
      if (res.statusCode !== 403 || res.json<{ error: { code: string } }>().error.code !== 'FORBIDDEN') wrong.push(`${who} ${key} → ${res.statusCode}`);
    };
    for (const key of [...MANAGER_ONLY, ...ADMIN_ONLY]) await check(key, 'staff');
    for (const key of ADMIN_ONLY) await check(key, 'manager');
    expect(wrong).toEqual([]);
  });

  test('phase-05-task-02 점검(권한 표): 04-02가 보고한 /trainings·/onboarding/assignments 등 주소만으로 정해지는 M 경로가 중앙 표(API_RULES)에 있어 라우트에 닿기 전에 막힌다', async () => {
    for (const key of ADDED_TO_TABLE) {
      const [method, url] = key.split(' ') as [string, string];
      const rule = findApiRule(method, fillParams(url).slice('/api'.length));
      expect(rule, key).not.toBeNull();
      // 본문이 깨져 있어도(검사 전에) 403이 먼저 나온다 = 라우트 안 코드보다 앞에서 막힌다
      const res = await env.app.inject({ method: method as Method, url: fillParams(url), headers: { ...env.staff.writeHeaders, 'content-type': 'application/json' }, payload: isWrite(method) ? '{"broken":' : undefined });
      expect(res.statusCode, key).toBe(403);
    }
  });
});

/**
 * "항상 참" 조건을 만들려는 인젝션 문자열. 데모 데이터에 이 글자들이 그대로 들어 있지 않으므로,
 * 값으로만 쓰인다면 결과는 "없는 검색어"와 같아야 한다(하나라도 많으면 SQL 조건이 바뀐 것 = 데이터 노출).
 */
const TAUTOLOGIES = [
  "' OR 1=1 --",
  "' OR '1'='1",
  '" OR ""="',
  "1; DROP TABLE users; --",
  "%' OR '%'='",
  "') OR ('1'='1",
  "' UNION SELECT username, password_hash FROM users --",
];
/** 특수 글자·전문 검색(FTS) 연산자. 실제 글에 들어 있을 수 있어(마크다운 ** 등) 결과 수는 "검색어 없음"보다 많지만 않으면 된다 */
const SPECIALS = ['*', 'NEAR(a b)', 'title:*', '"', String.fromCharCode(92), "'"];
/** 모든 인젝션 문자열 */
const INJECTIONS = [...TAUTOLOGIES, ...SPECIALS];
/** 아무것도 맞지 않을 검색어 */
const NONSENSE = 'zzqq없는검색어9x';
/** 검색어로 쓰는 칸 이름 */
const SEARCH_KEYS = ['q', 'search', 'keyword', 'tag', 'folder'];
/** 정렬·필터로 쓰는 칸 이름(모듈마다 다르므로 넓게 넣는다) */
const FILTER_KEYS = ['sort', 'order', 'orderBy', 'dir', 'status', 'category', 'categoryId', 'kind', 'type', 'visibility', 'vendorId', 'itemId', 'userId', 'equipmentId', 'month', 'year', 'from', 'to', 'date', 'page', 'pageSize', 'active', 'mine', 'unresolved', 'action', 'feature', 'jobType', 'format'];

describe('phase-05-task-02 SQL 인젝션', () => {
  let env: SecEnv;
  let getRoutes: ApiRoute[];
  beforeAll(async () => {
    env = await makeSecEnv();
    getRoutes = listApiRoutes(env.app).filter((r) => r.method === 'GET' && !r.url.includes('/download') && !r.url.endsWith('/file') && r.url !== '/api/files/:id');
  });
  afterAll(async () => env.close());

  /** 관리자로 GET (경로 칸은 1, 체크리스트는 opening) */
  const get = (url: string, query: Record<string, string>) =>
    env.app.inject({ method: 'GET', url: fillParams(url, { kind: 'opening', file: 'items.csv' }), query, headers: env.admin.headers });

  /** 400이면 검사 오류(VALIDATION) 한국어 안내여야 한다(예: 검색어 길이 제한) */
  const isKoreanValidation = (res: { statusCode: number; json(): unknown }) =>
    res.statusCode === 400 && /[가-힣]/.test((res.json() as { error?: { message?: string } }).error?.message ?? '');

  test("phase-05-task-02 AC3: ' OR 1=1 -- 같은 인젝션 문자열을 검색어로 넣어도 모든 목록 API가 정상 응답(200, 길이 초과는 400 한국어)이고, 없는 검색어보다 결과가 많아지지 않는다(데이터 노출 없음)", async () => {
    const wrong: string[] = [];
    const searchedApis = new Set<string>();
    let orOneCount = 0;
    for (const r of getRoutes) {
      const base = await get(r.url, {});
      for (const key of SEARCH_KEYS) {
        const none = await get(r.url, { [key]: NONSENSE });
        if (base.statusCode === 200 && none.statusCode === 200 && sizeOf(none) < sizeOf(base)) searchedApis.add(`${r.url}?${key}`);
        for (const inj of INJECTIONS) {
          const res = await get(r.url, { [key]: inj });
          const at = `${r.url}?${key}=${inj}`;
          if (res.statusCode >= 500) {
            wrong.push(`${at} → ${res.statusCode} ${res.body.slice(0, 120)}`);
            continue;
          }
          if (res.statusCode !== none.statusCode && !isKoreanValidation(res)) {
            wrong.push(`${at} → ${res.statusCode}(없는 검색어는 ${none.statusCode})`);
            continue;
          }
          if (res.statusCode !== 200) continue;
          // 대표 문자열 ' OR 1=1 -- 는 400도 안 된다(정상 응답)
          if (inj === TAUTOLOGIES[0]) orOneCount++;
          const limit = TAUTOLOGIES.includes(inj) ? sizeOf(none) : sizeOf(base);
          if (sizeOf(res) > limit) wrong.push(`${at} → 결과 ${sizeOf(res)}건(기준 ${limit}건)`);
        }
        const orOne = await get(r.url, { [key]: TAUTOLOGIES[0] as string });
        if (none.statusCode === 200 && orOne.statusCode !== 200) wrong.push(`${r.url}?${key}=' OR 1=1 -- → ${orOne.statusCode}(정상 응답이 아님)`);
      }
    }
    expect(wrong).toEqual([]);
    expect(orOneCount).toBeGreaterThan(50);
    // 검색어가 실제로 결과를 줄이는(=검색하는) API가 여러 개여야 이 시험이 의미가 있다(사용자·글·문서·문구·품목 등)
    expect([...searchedApis].length, [...searchedApis].join(', ')).toBeGreaterThanOrEqual(6);
  });

  test('phase-05-task-02 AC3: 정렬·필터 칸(sort·order·status·kind·from·to·page 등)에 인젝션 문자열을 넣어도 500이 없고, 표·사용자 수·DB 무결성이 그대로다', async () => {
    const tables = () => env.app.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((t) => t.name);
    const users = () => env.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n;
    const beforeTables = tables();
    const beforeUsers = users();
    const wrong: string[] = [];
    let n = 0;
    for (const r of getRoutes) {
      for (const key of FILTER_KEYS) {
        for (const inj of INJECTIONS.slice(0, 7)) {
          const res = await get(r.url, { [key]: inj });
          n++;
          if (res.statusCode >= 500) wrong.push(`${r.url}?${key}=${inj} → ${res.statusCode} ${res.body.slice(0, 120)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(n).toBeGreaterThan(5000);
    expect(tables()).toEqual(beforeTables);
    expect(users()).toBe(beforeUsers);
    expect(env.app.db.get<{ integrity_check: string }>('PRAGMA integrity_check')?.integrity_check).toBe('ok');
  });

  test("phase-05-task-02 AC3: 인젝션 문자열로 저장한 글은 값 그대로 저장·조회되고, 검색어로 다시 찾아도 그 글만 나온다", async () => {
    const title = "' OR 1=1 -- 인수인계";
    const created = await env.app.inject({ method: 'POST', url: '/api/posts', headers: env.staff.writeHeaders, payload: { kind: 'handover', title, body: "'); DROP TABLE posts; --" } });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ data: { id: number } }>().data.id;
    const one = await env.app.inject({ method: 'GET', url: `/api/posts/${id}`, headers: env.staff.headers });
    expect(one.json<{ data: { title: string; body: string } }>().data).toMatchObject({ title, body: "'); DROP TABLE posts; --" });
    const found = await env.app.inject({ method: 'GET', url: '/api/posts', query: { kind: 'handover', q: "' OR 1=1 --" }, headers: env.staff.headers });
    expect(found.statusCode).toBe(200);
    const rows = found.json<{ data: Array<{ id: number }> }>().data;
    expect(rows.map((p) => p.id)).toEqual([id]);
    expect(env.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'posts'")?.n).toBe(1);
  });

  test("phase-05-task-02 AC3: 원내 도우미 질문(전문 검색 FTS MATCH)에 인젝션·FTS 연산자 문자열을 넣어도 500이 없다", async () => {
    for (const q of [...INJECTIONS, 'AND OR NOT', 'a NEAR/3 b', '^', '"unterminated', "kb_fts MATCH '*'"]) {
      const res = await env.app.inject({ method: 'POST', url: '/api/assistant/ask', headers: env.staff.writeHeaders, payload: { question: `${q} 소독 방법` } });
      expect(res.statusCode, `${q}: ${res.body.slice(0, 160)}`).toBeLessThan(500);
    }
  });
});

describe('phase-05-task-02 입력 검증(zod)', () => {
  let env: SecEnv;
  let routes: ApiRoute[];
  beforeAll(async () => {
    env = await makeSecEnv();
    routes = listApiRoutes(env.app).filter((r) => isWrite(r.method) && keyOf(r) !== LOGOUT);
  });
  afterAll(async () => env.close());

  test('phase-05-task-02 점검(입력 검증): 모든 상태 변경 API에 깨진 JSON·배열·문자열·너무 긴 값·__proto__를 보내도 500이 없고, 4xx 오류는 한국어 안내다', async () => {
    const bodies: Array<[string, string]> = [
      ['깨진 JSON', '{"title":'],
      ['배열', '[1,2,3]'],
      ['문자열', '"글자"'],
      ['숫자', '123'],
      ['__proto__', '{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}'],
      ['너무 긴 값', JSON.stringify({ title: 'a'.repeat(200000), name: 'b'.repeat(200000), body: 'c'.repeat(200000) })],
    ];
    const wrong: string[] = [];
    let n = 0;
    for (const r of routes) {
      for (const [name, payload] of bodies) {
        // 관리자로 보낸다(권한 검사를 지나 실제 입력 검사까지 닿게). 경로 칸 999는 없는 대상이라 데이터가 바뀌지 않는다
        const res = await env.app.inject({ method: r.method as Method, url: fillParams(r.url, { id: '999', name: 'none', kind: 'opening', idx: '0' }), headers: { ...env.admin.writeHeaders, 'content-type': 'application/json' }, payload });
        n++;
        if (res.statusCode >= 500) {
          wrong.push(`${name} ${keyOf(r)} → ${res.statusCode} ${res.body.slice(0, 120)}`);
          continue;
        }
        if (res.statusCode >= 400) {
          const msg = res.json<{ error?: { message?: string } }>().error?.message ?? '';
          if (!/[가-힣]/.test(msg)) wrong.push(`${name} ${keyOf(r)} → ${res.statusCode} 한국어 안내 없음: ${res.body.slice(0, 120)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(n).toBeGreaterThan(400);
    // 프로토타입 오염이 없다
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

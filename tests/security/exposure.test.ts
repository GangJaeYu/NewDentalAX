// 이 파일이 하는 일: 비밀값·위험 파일·위험 데이터가 새어 나가지 않는지 확인하는 보안 횡단 점검(phase-05-task-02, NFR-002, 원문 7절).
// - API 키: 저장한 키 원문이 어떤 GET API 응답에도 없다(끝 4자리 가림만)
// - CSV 수식 주입: 모든 CSV 내려받기에서 = + - @로 시작하는 글자 칸이 작은따옴표로 막힌다
// - 업로드: 파일을 받는 모든 API가 HTML·SVG·확장자만 바꾼 실행 파일을 거부하고 저장하지 않는다
// - AI 개인정보: 공급자 호출은 게이트웨이 한 곳에서만 일어나고, 모든 AI 입력 경로에서 주민번호가 든 글은 공급자에게 가지 않는다
// - 로그인 제한: 한 기기에서 여러 아이디로 30번 넘게 틀리면 그 기기를 막는다
// - 정적 검사: 화면 코드의 HTML 직접 넣기 금지, SQL에 요청 값 직접 붙이기 금지, 요청 값은 parseInput(zod)으로만 읽기
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AI_FEATURES, type AiFeatureId } from '../../shared/ai-features.ts';
import { featureModule } from '../../server/ai/features/index.ts';
import { uploadsRoot } from '../../server/lib/files.ts';
import { SEED_REGISTRY } from '../../server/db/seed/registry.ts';
import { makeAiEnv, putAiSettings, type AiTestEnv } from '../helpers/ai-app.ts';
import { fillParams, listApiRoutes, makeSecEnv, type SecEnv } from './sweep-helpers.ts';

const ROOT = process.cwd();

/** 폴더 아래 파일 목록(재귀). 없으면 빈 목록 */
function walk(dir: string, filter: (f: string) => boolean = () => true): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

describe('phase-05-task-02 API 키 노출', () => {
  let env: SecEnv;
  beforeAll(async () => {
    env = await makeSecEnv();
  });
  afterAll(async () => env.close());

  test('phase-05-task-02 점검(API 키): 세 공급자 키를 저장한 뒤 관리자·직원으로 모든 GET API를 불러도 응답·헤더에 키 원문이 없고, DB에는 암호문만 있다', async () => {
    const keys = { anthropic: 'sk-ant-SECSWEEP-aaaa-1111-zz91', openai: 'sk-proj-SECSWEEP-bbbb-2222-zz92', gemini: 'AIzaSECSWEEP-cccc-3333-zz93' };
    const put = await env.app.inject({ method: 'PUT', url: '/api/ai/settings', headers: env.admin.writeHeaders, payload: { provider: 'anthropic', keys } });
    expect(put.statusCode, put.body).toBe(200);
    const secrets = Object.values(keys);
    // 끝 4자리를 뺀 앞부분(가림 표시로도 나오면 안 되는 부분)
    const heads = secrets.map((k) => k.slice(0, -4));
    const wrong: string[] = [];
    const routes = listApiRoutes(env.app).filter((r) => r.method === 'GET');
    for (const r of routes) {
      for (const who of [env.admin, env.staff]) {
        const res = await env.app.inject({ method: 'GET', url: fillParams(r.url, { kind: 'opening', file: 'items.csv' }), headers: who.headers });
        const all = res.body + JSON.stringify(res.headers);
        for (const s of [...secrets, ...heads]) if (all.includes(s)) wrong.push(`${r.url} (${who.username})`);
      }
    }
    expect(wrong).toEqual([]);
    expect(routes.length).toBeGreaterThan(60);
    // 설정 응답은 끝 4자리만 보여 준다
    const settings = await env.app.inject({ method: 'GET', url: '/api/ai/settings', headers: env.admin.headers });
    expect(settings.body).toContain('••••zz91');
    // DB 파일 바이트에도 원문이 없다(AES-256-GCM 암호문만)
    const dbBytes = Buffer.concat(walk(env.dataDir, (f) => /app\.db(-wal)?$/.test(f)).map((f) => fs.readFileSync(f)));
    for (const s of secrets) expect(dbBytes.includes(Buffer.from(s)), s).toBe(false);
  });
});

describe('phase-05-task-02 CSV 수식 주입', () => {
  let env: SecEnv;
  beforeAll(async () => {
    env = await makeSecEnv();
  });
  afterAll(async () => env.close());

  test('phase-05-task-02 점검(CSV): 품목·거래처·입출고·지출·멸균·감사 기록의 글자 칸에 =HYPERLINK·+·-·@ 수식을 넣어도, 모든 CSV 내려받기의 칸이 수식으로 시작하지 않는다', async () => {
    const db = env.app.db;
    // 사용자가 적는 글자 칸에 수식 문자열을 앞에 붙인다(값으로 저장된 상태를 흉내 냄)
    const FORMULAS = ['=HYPERLINK("http://evil.example","눌러")', '+1+1', '-2+3', '@SUM(A1:A2)'];
    const columns: Array<[string, string]> = [
      ['items', 'name'],
      ['items', 'location'],
      ['items', 'memo'],
      ['vendors', 'name'],
      ['vendors', 'contact_name'],
      ['vendors', 'memo'],
      ['stock_moves', 'memo'],
      ['stock_moves', 'lot'],
      ['expenses', 'vendor_name'],
      ['expenses', 'memo'],
      ['users', 'name'],
    ];
    let changed = 0;
    columns.forEach(([t, c], i) => {
      const f = FORMULAS[i % FORMULAS.length] as string;
      try {
        changed += db.run(`UPDATE ${t} SET ${c} = ? || COALESCE(${c}, '')`, [f]).changes;
      } catch {
        // 이 표·열이 없으면(스키마 변경) 건너뛴다. 아래 "수식이 실제로 나왔는지" 검사가 빈 시험을 막는다
      }
    });
    expect(changed).toBeGreaterThan(20);
    // 멸균 기록 메모와 감사 기록(대상 이름)은 API로 넣는다
    const vendor = await env.app.inject({ method: 'POST', url: '/api/vendors', headers: env.manager.writeHeaders, payload: { name: '=cmd|"/c calc"!A1 거래처' } });
    expect(vendor.statusCode, vendor.body).toBe(201);
    for (const [t, c] of [
      ['sterilizer_logs', 'note'],
      ['sterilizer_logs', 'memo'],
    ] as const) {
      try {
        db.run(`UPDATE ${t} SET ${c} = ? || COALESCE(${c}, '')`, ['=1+2']);
      } catch {
        // 열 이름이 다르면 건너뛴다
      }
    }

    const csvUrls = [
      '/api/export/items.csv',
      '/api/export/vendors.csv',
      '/api/export/moves.csv',
      '/api/inventory/moves?format=csv',
      '/api/expenses?format=csv&month=all',
      '/api/sterilizer-logs/export',
      '/api/audit?format=csv',
      '/api/import/items/template.csv',
    ];
    const wrong: string[] = [];
    let guarded = 0;
    let cells = 0;
    for (const url of csvUrls) {
      const res = await env.app.inject({ method: 'GET', url, headers: env.admin.headers });
      expect(res.statusCode, `${url}: ${res.body.slice(0, 200)}`).toBe(200);
      expect(String(res.headers['content-type']), url).toContain('text/csv');
      expect(String(res.headers['content-disposition']), url).toMatch(/^attachment;/);
      const parsed = Papa.parse<string[]>(res.body.replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), ''), { skipEmptyLines: true });
      for (const row of parsed.data) {
        for (const cell of row) {
          cells++;
          if (cell.startsWith("'") && /^'[=+\-@]/.test(cell)) guarded++;
          // 음수 숫자(-3, -1.5)는 수식이 아니므로 그대로 둔다
          if (/^[=+\-@\t\r]/.test(cell) && !/^-\d+(\.\d+)?$/.test(cell)) wrong.push(`${url}: ${cell.slice(0, 60)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(cells).toBeGreaterThan(200);
    // 넣은 수식이 실제로 CSV에 나왔고(빈 시험이 아님), 모두 작은따옴표로 막혔다
    expect(guarded).toBeGreaterThan(20);
  });
});

/** multipart 본문을 직접 만든다(파일 하나 + 글 칸) */
function multipart(fileName: string, data: Buffer, fields: Record<string, string> = {}) {
  const boundary = '----sec5boundary' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('phase-05-task-02 파일 업로드', () => {
  let env: SecEnv;
  beforeAll(async () => {
    env = await makeSecEnv();
  });
  afterAll(async () => env.close());

  test('phase-05-task-02 점검(업로드): 파일을 받는 모든 API가 HTML·SVG·확장자만 바꾼 실행 파일(.pdf·.jpg·.png)·.exe를 4xx로 거부하고 업로드 폴더·files 표에 아무것도 남기지 않는다', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
    const html = Buffer.from('<!doctype html><html><body><script>alert(document.cookie)</script></body></html>');
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);
    const evil: Array<[string, Buffer]> = [
      ['evil.svg', svg],
      ['evil.html', html],
      ['evil.htm', html],
      ['evil.pdf', exe],
      ['evil.pdf', html],
      ['photo.jpg', svg],
      ['photo.png', html],
      ['manual.txt', exe],
      ['virus.exe', exe],
      ['evil.svgz', svg],
    ];
    // 파일을 받는 API(서버의 readUpload를 쓰는 곳). 글 칸은 검사를 지나도록 그럴듯하게 채운다
    const targets: Array<{ url: string; fields?: Record<string, string> }> = [
      { url: '/api/documents', fields: { title: '업로드 점검', folder: '서식', kind: 'form' } },
      { url: '/api/kb/docs', fields: { title: '업로드 점검', visibility: 'all' } },
      { url: '/api/ai/receipt' },
      { url: '/api/expenses/1/file' },
      { url: '/api/equipment/1/logs', fields: { kind: 'repair', date: '2026-11-01', title: '점검' } },
      { url: '/api/trainings/1/records', fields: { completedOn: '2026-10-01' } },
      { url: '/api/import/items/preview' },
    ];
    const known = new Set(listApiRoutes(env.app).map((r) => `${r.method} ${r.url}`));
    const filesRows = () => env.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM files')?.n ?? 0;
    const before = walk(uploadsRoot(env.dataDir)).length;
    const beforeRows = filesRows();
    const wrong: string[] = [];
    const statuses = new Map<number, number>();
    for (const t of targets) {
      expect(known.has(`POST ${t.url.replace(/\/1(\/|$)/, '/:id$1')}`), t.url).toBe(true);
      for (const [name, data] of evil) {
        const mp = multipart(name, data, t.fields);
        const res = await env.app.inject({ method: 'POST', url: t.url, headers: { ...env.admin.writeHeaders, 'content-type': mp.contentType }, payload: mp.payload });
        statuses.set(res.statusCode, (statuses.get(res.statusCode) ?? 0) + 1);
        if (res.statusCode < 400 || res.statusCode >= 500) wrong.push(`${t.url} ${name} → ${res.statusCode} ${res.body.slice(0, 120)}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(walk(uploadsRoot(env.dataDir)).length).toBe(before);
    expect(filesRows()).toBe(beforeRows);
    // 대부분은 형식 거부(415)여야 한다(다른 칸 오류 400에 가려지지 않았는지)
    expect(statuses.get(415) ?? 0, JSON.stringify([...statuses])).toBeGreaterThanOrEqual(40);
  });

  test('phase-05-task-02 점검(업로드): 정상 PDF는 올라가고, 내려받을 때 attachment·nosniff·원래 MIME으로 온다(브라우저가 열지 않음)', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const mp = multipart('양식 <script>.pdf', pdf, { title: '정상 PDF', folder: '서식', kind: 'form' });
    const up = await env.app.inject({ method: 'POST', url: '/api/documents', headers: { ...env.admin.writeHeaders, 'content-type': mp.contentType }, payload: mp.payload });
    expect(up.statusCode, up.body).toBe(201);
    const fileId = up.json<{ data: { file: { id: number } } }>().data.file.id;
    const dl = await env.app.inject({ method: 'GET', url: `/api/files/${fileId}`, headers: env.staff.headers });
    expect(dl.statusCode).toBe(200);
    // 첨부 파일로 내려보내고, 이름 안의 따옴표·줄바꿈은 지워져 헤더를 깨뜨리지 못한다
    expect(String(dl.headers['content-disposition'])).toMatch(/^attachment; filename="[^"\r\n]*"; filename\*=UTF-8''[^\s"]+$/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.rawPayload.equals(pdf)).toBe(true);
  });
});

describe('phase-05-task-02 로그인 시도 제한(기기별)', () => {
  let env: SecEnv;
  beforeAll(async () => {
    env = await makeSecEnv({ demo: false });
  });
  afterAll(async () => env.close());

  test('phase-05-task-02 점검(로그인 잠금): 한 기기에서 여러 아이디로 30번 틀리면 그 기기는 15분 동안 423이고, 다른 기기는 그대로 로그인을 시도할 수 있다', async () => {
    const ip = '192.168.0.77';
    for (let i = 0; i < 30; i++) {
      const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, payload: { username: `guess${i}`, password: 'wrong-password-1' } });
      expect(res.statusCode, `${i}`).toBe(401);
    }
    const blocked = await env.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, payload: { username: 'another', password: 'wrong-password-1' } });
    expect(blocked.statusCode).toBe(423);
    expect(blocked.json<{ error: { message: string } }>().error.message).toMatch(/[가-힣]/);
    const other = await env.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '192.168.0.78', payload: { username: 'another', password: 'wrong-password-1' } });
    expect(other.statusCode).toBe(401);
    env.clock.advance(15 * 60 * 1000 + 1000);
    const later = await env.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, payload: { username: 'another2', password: 'wrong-password-1' } });
    expect(later.statusCode).toBe(401);
  });
});

/** 개인정보 시험 글(주민등록번호: 기본 정책이 차단) */
const RRN_TEXT = '직원 주민번호 900101-1234567 확인';

/**
 * 기능 입력 스키마(zod)를 보고 "모든 글자 칸에 주민번호가 든" 입력 예시를 만든다.
 * 숫자는 최솟값(없으면 1), 고르는 값은 첫 번째, 목록은 최소 개수(1개 이상)로 채운다.
 */
function piiSample(schema: unknown): unknown {
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.anyOf)) return piiSample((s.anyOf as Array<Record<string, unknown>>).find((x) => x.type !== 'null') ?? s.anyOf[0]);
  if (Array.isArray(s.oneOf)) return piiSample(s.oneOf[0]);
  if ('const' in s) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  switch (s.type) {
    case 'string': {
      if (typeof s.pattern === 'string') {
        const re = new RegExp(s.pattern);
        const fit = ['2026-11-02', '2026-11', '09:00', 'a'].find((v) => re.test(v));
        if (fit) return fit;
      }
      if (s.format === 'date') return '2026-11-02';
      const max = typeof s.maxLength === 'number' ? s.maxLength : 2000;
      const min = typeof s.minLength === 'number' ? s.minLength : 0;
      return RRN_TEXT.padEnd(min, ' 내용').slice(0, Math.max(max, 20));
    }
    case 'number':
    case 'integer':
      return typeof s.minimum === 'number' ? s.minimum : 1;
    case 'boolean':
      return true;
    case 'array': {
      const n = Math.max(1, typeof s.minItems === 'number' ? s.minItems : 1);
      return Array.from({ length: n }, () => piiSample(s.items ?? { type: 'string' }));
    }
    case 'object': {
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const out = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, piiSample(v)]));
      // 이름을 마음대로 정하는 칸(record, 예: 월간 요약의 숫자 이름)은 이름 자체에 개인정보를 넣는다
      if (s.additionalProperties && typeof s.additionalProperties === 'object') out[RRN_TEXT] = piiSample(s.additionalProperties);
      return out;
    }
    default:
      return RRN_TEXT;
  }
}

describe('phase-05-task-02 AI 개인정보 필터 우회', () => {
  let env: AiTestEnv;
  beforeAll(async () => {
    env = await makeAiEnv({ timeoutMs: 2000 });
    // 원내 매뉴얼(데모)이 있어야 원내 도우미가 근거를 찾아 AI를 부른다
    await SEED_REGISTRY.assistant.seedDemo(env.app.db, { clock: env.clock, scale: 1 });
    await putAiSettings(env, { provider: 'anthropic', keys: { anthropic: 'sk-ant-FAKE-sec5-0000' } });
  });
  afterAll(async () => env.close());

  test('phase-05-task-02 점검(개인정보 필터): 공급자 호출 코드(server/ai/providers)는 게이트웨이(server/ai/gateway.ts)만 불러 쓴다', () => {
    const offenders = walk(path.join(ROOT, 'server'), (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => !f.includes(`${path.sep}ai${path.sep}providers${path.sep}`))
      .filter((f) => path.relative(ROOT, f) !== path.join('server', 'ai', 'gateway.ts'))
      .filter((f) => /from\s+['"][^'"]*ai\/providers\/|from\s+['"]\.\/providers\/|from\s+['"]\.\.\/providers\/|makeProvider\(|\.generate\(\{/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
    // 게이트웨이는 보낼 글을 공급자에게 넘기기 전에 개인정보 검사(filterTexts)를 한다
    const gw = fs.readFileSync(path.join(ROOT, 'server', 'ai', 'gateway.ts'), 'utf8');
    expect(gw.indexOf('filterTexts([prompt.system, prompt.user]')).toBeGreaterThan(0);
  });

  test('phase-05-task-02 점검(개인정보 필터): 글을 받는 13개 AI 기능 모두(/api/ai/run·/api/ai/stream)에서 주민번호가 든 입력은 422 AI_PII_BLOCKED이고 가짜 공급자에게 요청이 하나도 가지 않는다', async () => {
    const ids = (Object.keys(AI_FEATURES) as AiFeatureId[]).filter((id) => !AI_FEATURES[id].images);
    expect(ids.length).toBe(13);
    const wrong: string[] = [];
    for (const id of ids) {
      const input = piiSample(z.toJSONSchema(featureModule(id).inputSchema as z.ZodType, { io: 'input', unrepresentable: 'any' }));
      for (const url of ['/api/ai/run', '/api/ai/stream']) {
        const res = await env.app.inject({ method: 'POST', url, headers: env.admin.writeHeaders, payload: { feature: id, input } });
        const code = res.statusCode === 422 ? res.json<{ error: { code: string } }>().error.code : '';
        if (code !== 'AI_PII_BLOCKED') wrong.push(`${url} ${id} → ${res.statusCode} ${res.body.slice(0, 160)}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(env.fake.requests).toHaveLength(0);
  });

  test('phase-05-task-02 점검(개인정보 필터): 모듈 AI 경로(원내 도우미 질문·광고 점검 AI 2차)도 주민번호가 든 글을 공급자에게 보내지 않는다', async () => {
    // 근거 문서가 있는 질문(손 소독) + 주민번호 → 공급자로 가기 전에 막힌다
    const ask = await env.app.inject({ method: 'POST', url: '/api/assistant/ask', headers: env.staff.writeHeaders, payload: { question: '손소독제로 손 닦을 때 몇 초 문질러야 해요? 900101-1234567' } });
    expect(ask.statusCode, ask.body).toBe(422);
    expect(ask.json<{ error: { code: string } }>().error.code).toBe('AI_PII_BLOCKED');
    // 근거가 없는 질문이면 AI를 부르지 않고, 대화 기록(질문·안내 문구 모두)에 주민번호 숫자가 남지 않는다
    const none = await env.app.inject({ method: 'POST', url: '/api/assistant/ask', headers: env.staff.writeHeaders, payload: { question: `${RRN_TEXT} 방법 알려 줘` } });
    expect(none.statusCode, none.body).toBe(200);
    expect(none.body).not.toContain('900101');
    const stored = env.app.db.all<{ text: string }>('SELECT text FROM assistant_messages').map((m) => m.text);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.join('\n')).not.toMatch(/900101|1234567/);
    const ad = await env.app.inject({ method: 'POST', url: '/api/adcheck', headers: env.staff.writeHeaders, payload: { text: `임플란트 최고 ${RRN_TEXT}`, useAi: true } });
    // 광고 점검은 규칙 결과를 돌려주고, AI 2차 점검만 개인정보로 막힌다
    expect(ad.statusCode, ad.body).toBeLessThan(500);
    expect(env.fake.requests).toHaveLength(0);
  });
});

describe('phase-05-task-02 정적 검사', () => {
  /** 저장소 안 소스 파일(테스트 제외) */
  const sources = (dir: string, ext: RegExp) => walk(path.join(ROOT, dir), (f) => ext.test(f) && !/\.test\.tsx?$/.test(f));

  test('phase-05-task-02 점검(XSS): 화면 코드에 dangerouslySetInnerHTML·innerHTML·outerHTML·insertAdjacentHTML·document.write·eval·new Function이 없다', () => {
    const bad = /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/;
    const hits = sources('web/src', /\.(ts|tsx)$/).filter((f) => bad.test(fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')));
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  test('phase-05-task-02 점검(XSS): 화면의 바깥 링크(href)는 서버가 http(s)만 받은 값이다(법정 업무 출처·AI 가격 출처)', async () => {
    // 화면 코드에서 데이터 값을 href에 넣는 곳
    const dynamicHref = sources('web/src', /\.tsx$/).flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => /href=\{(?!`\/api\/|`#|csvHref|csvUrl)/.test(l))
        .map((l) => `${path.relative(ROOT, f)}: ${l.trim()}`),
    );
    expect(dynamicHref.map((l) => l.replace(/\\/g, '/'))).toEqual([
      'web/src/pages/admin/AiSettingsPage.tsx: <a href={m.sourceUrl} target="_blank" rel="noreferrer noopener">',
      'web/src/pages/facility/LegalPage.tsx: href={task.sourceUrl}',
    ]);
    const env = await makeSecEnv({ demo: false });
    try {
      for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']) {
        const models = await env.app.inject({ method: 'PUT', url: '/api/ai/models', headers: env.admin.writeHeaders, payload: { models: [{ provider: 'anthropic', tier: 'fast', sourceUrl: bad }] } });
        expect(models.statusCode, `${bad}: ${models.body}`).toBe(400);
        expect(models.body, bad).toContain('sourceUrl');
        const legal = await env.app.inject({ method: 'POST', url: '/api/legal-tasks', headers: env.admin.writeHeaders, payload: { title: '점검', category: 'other', cycleMonths: 12, sourceUrl: bad } });
        expect(legal.statusCode, `${bad}: ${legal.body}`).toBe(400);
        // 다른 칸이 아니라 출처 주소 때문에 거부됐다
        expect(Object.keys(legal.json<{ error: { fields?: Record<string, string> } }>().error.fields ?? {}), legal.body).toEqual(['sourceUrl']);
      }
      const legalOk = await env.app.inject({ method: 'POST', url: '/api/legal-tasks', headers: env.admin.writeHeaders, payload: { title: '점검', category: 'other', cycleMonths: 12, sourceUrl: 'https://www.law.go.kr/' } });
      expect(legalOk.statusCode, legalOk.body).toBe(201);
      const ok = await env.app.inject({ method: 'PUT', url: '/api/ai/models', headers: env.admin.writeHeaders, payload: { models: [{ provider: 'anthropic', tier: 'fast', sourceUrl: 'https://www.anthropic.com/pricing' }] } });
      expect(ok.statusCode, ok.body).toBe(200);
    } finally {
      await env.close();
    }
  });

  test('phase-05-task-02 점검(SQL): 서버 코드에서 요청 값(req.*)을 SQL 글에 직접 붙이는 곳이 없다', () => {
    const hits: string[] = [];
    for (const f of sources('server', /\.ts$/)) {
      fs.readFileSync(f, 'utf8')
        .split('\n')
        .forEach((l, i) => {
          if (/\b(SELECT|INSERT|UPDATE|DELETE|WHERE|ORDER BY)\b/.test(l) && /\$\{[^}]*\breq\./.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}`);
          if (/\.(all|get|run|exec)\(\s*[^'"`\s]*\s*\+/.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1} (문자열 더하기)`);
        });
    }
    expect(hits).toEqual([]);
  });

  test('phase-05-task-02 점검(입력 검증): 라우트는 req.body·req.query·req.params를 parseInput(zod) 없이 읽지 않는다(검토한 예외만 허용)', () => {
    // 예외: 각각 아래 이유로 직접 읽지만 바로 다음 줄에서 검사한다(05-02가 코드를 읽고 확인함)
    const allowed = new Map<string, string>([
      ['server/modules/admin/backup-routes.ts', '백업 이름은 zipBackup·restoreBackup이 NAME_RE 정규식으로 먼저 검사한다'],
      ['server/modules/facility/equipment.ts', 'multipart/JSON 둘 다 받으려고 본문을 꺼낸 뒤 parseInput으로 검사한다'],
      ['server/modules/facility/legal.ts', '모르는 항목 거부(rejectUnknownKeys) 뒤 parseInput으로 검사한다'],
      ['server/modules/hr/training-routes.ts', 'multipart/JSON 둘 다 받으려고 본문을 꺼낸 뒤 parseInput으로 검사한다'],
      ['server/modules/inventory/routes.ts', "format === 'csv' 비교만 하고 CSV 쪽에서 다시 parseInput으로 검사한다"],
    ]);
    const hits = new Set<string>();
    for (const f of sources('server', /\.ts$/)) {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      fs.readFileSync(f, 'utf8')
        .split('\n')
        .forEach((l) => {
          if (/\breq\.(body|query|params)\b/.test(l) && !/parseInput\(/.test(l) && !/^\s*(\/\/|\*)/.test(l)) hits.add(rel);
        });
    }
    expect([...hits].filter((f) => !allowed.has(f))).toEqual([]);
    // 예외 목록이 실제와 맞는지(고쳐져 없어진 예외는 목록에서도 지운다)
    for (const f of allowed.keys()) expect(hits.has(f), f).toBe(true);
  });
});

// 이 파일이 하는 일: 보안 횡단 테스트(tests/security/*.test.ts, phase-05-task-02)가 함께 쓰는 도우미.
// 데모 데이터(하늘숲치과, 환자 정보 없음)를 넣은 테스트 서버를 만들고, 서버에 실제로 등록된 모든 /api 경로를 뽑아 준다.
// 경로 목록은 Fastify의 printRoutes 결과를 읽어 만든다. 그래서 다른 태스크가 새 API를 더해도 자동으로 점검 대상에 들어간다.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { manualClock, type ManualClock } from '../../server/lib/clock.ts';
import { loadDemo } from '../../server/modules/admin/demo-service.ts';
import { loginAs, type TestLogin } from '../helpers/auth.ts';
import { makeTmpDir } from '../helpers/tmp-dir.ts';

/** 테스트 기준 시각(HARNESS §5) */
export const SEC_TEST_NOW = '2026-11-02T09:00:00+09:00';

/** 등록된 API 하나(메서드 + /api로 시작하는 경로 모양) */
export interface ApiRoute {
  method: string;
  url: string;
}

/** 보안 점검용 테스트 서버 한 벌 */
export interface SecEnv {
  app: FastifyInstance;
  clock: ManualClock;
  dataDir: string;
  admin: TestLogin;
  manager: TestLogin;
  staff: TestLogin;
  close(): Promise<void>;
}

/** 데모 데이터를 넣은 서버와 역할별 로그인을 만든다(화면 파일 없음, 실제 data/ 폴더는 쓰지 않음) */
export async function makeSecEnv(opts: { demo?: boolean } = {}): Promise<SecEnv> {
  const dataDir = makeTmpDir('dentalax-sec5-');
  const clock = manualClock(SEC_TEST_NOW);
  const app = await buildApp({ dataDir, webDist: path.join(dataDir, 'no-web'), clock });
  await app.ready();
  if (opts.demo !== false) await loadDemo(app.db, clock, null);
  const admin = loginAs(app, 'admin');
  const manager = loginAs(app, 'manager');
  const staff = loginAs(app, 'staff');
  return {
    app,
    clock,
    dataDir,
    admin,
    manager,
    staff,
    async close() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * 서버에 등록된 모든 /api 경로를 뽑는다. printRoutes({commonPrefix:false})의 나무 모양 글을 읽는다.
 * 예: "├── /api/users (GET, HEAD, POST)" 아래 "│   └── /:id (PATCH)" → GET·POST /api/users, PATCH /api/users/:id
 * HEAD·OPTIONS는 GET과 같으므로 뺀다.
 */
export function listApiRoutes(app: FastifyInstance): ApiRoute[] {
  const text = app.printRoutes({ commonPrefix: false });
  const stack: string[] = [];
  const out: ApiRoute[] = [];
  for (const line of text.split('\n')) {
    const m = /^([│ ]*)[├└]── (\S+)(?: \(([^)]*)\))?/.exec(line);
    if (!m) continue;
    const depth = (m[1] ?? '').length / 4;
    const seg = m[2] ?? '';
    const full = (depth > 0 ? (stack[depth - 1] ?? '') : '') + seg;
    stack[depth] = full;
    stack.length = depth + 1;
    if (!m[3] || !full.startsWith('/api')) continue;
    for (const method of m[3].split(',').map((s) => s.trim())) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      out.push({ method, url: full });
    }
  }
  return out;
}

/** 경로 모양의 :이름 칸을 실제 값으로 채운다(기본 '1', 칸 이름별 값은 values로) */
export function fillParams(url: string, values: Record<string, string> = {}): string {
  return url.replace(/:([A-Za-z]+)/g, (_m, name: string) => encodeURIComponent(values[name] ?? '1'));
}

/** 로그인 없이 부를 수 있는 API(server/auth/guard.ts PUBLIC_APIS와 같아야 한다) */
export const PUBLIC_ROUTES = new Set(['GET /api/health', 'GET /api/session', 'POST /api/setup', 'POST /api/auth/login']);

/** 상태를 바꾸는 메서드인지 */
export function isWrite(method: string): boolean {
  return method !== 'GET';
}

/** JSON 응답 안의 배열 길이를 모두 더한다(검색 결과가 늘었는지 비교할 때 쓴다) */
export function countRows(v: unknown): number {
  if (Array.isArray(v)) return v.length + v.reduce<number>((n, x) => n + countRows(x), 0);
  if (v && typeof v === 'object') return Object.values(v).reduce<number>((n, x) => n + countRows(x), 0);
  return 0;
}

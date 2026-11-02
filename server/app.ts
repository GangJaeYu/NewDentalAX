// 이 파일이 하는 일: Fastify 서버 인스턴스를 만든다(buildApp). 준비 상태 확인 API(GET /api/health)와
// 빌드된 화면 파일(web/dist) 제공, 화면 주소를 모두 index.html로 돌려주는 SPA 폴백을 담당한다.
// 테스트는 deps(시계·데이터 폴더·화면 폴더·DB 점검 함수)를 바꿔 끼워 실제 서버 없이 inject로 확인한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/** "지금 시각"을 알려 주는 시계. 테스트는 고정 시계를 넣는다(TD-020) */
export interface Clock {
  now(): Date;
}

/** 실제 시계 */
export const systemClock: Clock = { now: () => new Date() };

/** 정해진 시각에 멈춘 시계(테스트·E2E 전용) */
export function fixedClock(iso: string): Clock {
  const t = new Date(iso).getTime();
  return { now: () => new Date(t) };
}

/** DB 상태 점검 결과 */
export type DbStatus = 'ok' | 'error';

/** buildApp에 넣는 의존성. 비워 두면 실제 운영 기본값을 쓴다 */
export interface AppDeps {
  /** 업무 데이터 폴더 */
  dataDir: string;
  /** 시계(기본: 실제 시각) */
  clock?: Clock;
  /** 빌드된 화면 폴더(기본: web/dist) */
  webDist?: string;
  /** 화면에 보여 줄 앱 버전(기본: package.json의 version) */
  version?: string;
  /** DB 연결 점검 함수. phase-01-task-02가 실제 DB 연결 점검으로 바꿔 끼운다 */
  checkDb?: () => DbStatus;
  /** Fastify 요청 로그를 켤지(기본 꺼짐) */
  logger?: boolean;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_WEB_DIST = path.join(ROOT, 'web', 'dist');

/** package.json에서 앱 버전을 읽는다 */
export function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 기본 DB 점검: Node 내장 SQLite가 이 PC에서 동작하는지 확인한다.
 * 실제 data/app.db 연결 점검은 DB 래퍼를 만드는 phase-01-task-02가 checkDb로 넣는다.
 */
async function defaultCheckDb(): Promise<() => DbStatus> {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const ok = (db.prepare('select 1 as v').get() as { v: number } | undefined)?.v === 1;
    db.close();
    return () => (ok ? 'ok' : 'error');
  } catch {
    return () => 'error';
  }
}

/** API 오류 응답 형식(overview §2): { error: { code, message } } */
function apiError(code: string, message: string) {
  return { error: { code, message } };
}

/** 주소 끝에 확장자(.js, .png 등)가 있으면 파일 요청으로 본다 */
function looksLikeFile(urlPath: string): boolean {
  return /\.[a-z0-9]{1,8}$/i.test(urlPath);
}

/**
 * 서버 인스턴스를 만든다. listen은 하지 않는다(main.ts가 한다).
 * 테스트는 이 함수가 돌려준 인스턴스에 app.inject()로 요청을 보낸다.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const clock = deps.clock ?? systemClock;
  const webDist = deps.webDist ?? DEFAULT_WEB_DIST;
  const version = deps.version ?? readVersion();
  const checkDb = deps.checkDb ?? (await defaultCheckDb());

  const app = Fastify({ logger: deps.logger ?? false });

  // 준비 상태 확인: 포트가 열린 것만이 아니라 DB까지 응답해야 ok:true(HARNESS §2)
  app.get('/api/health', async (_req, reply) => {
    const db = checkDb();
    const ok = db === 'ok';
    reply.code(ok ? 200 : 503).header('cache-control', 'no-store');
    return { ok, version, db, now: clock.now().toISOString() };
  });

  const indexFile = path.join(webDist, 'index.html');
  const hasWeb = fs.existsSync(indexFile);
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: true,
      index: ['index.html'],
      setHeaders(res, filePath) {
        // 빌드 파일 이름에 해시가 붙은 assets는 오래 저장하고, index.html은 매번 새로 받게 한다
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header('cache-control', 'public, max-age=31536000, immutable');
        else res.header('cache-control', 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    const urlPath = req.url.split('?')[0] ?? '/';
    if (urlPath === '/api' || urlPath.startsWith('/api/')) {
      return reply.code(404).send(apiError('NOT_FOUND', '요청한 기능을 찾을 수 없어요. 주소를 다시 확인해 주세요.'));
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && !looksLikeFile(urlPath)) {
      if (!hasWeb) {
        return reply
          .code(503)
          .type('text/plain; charset=utf-8')
          .send('화면 파일(web/dist)이 없어요. 개발 PC라면 "npm run build:web"을 먼저 실행해 주세요. 설치 PC라면 프로그램 파일을 다시 내려받아 주세요.');
      }
      // 화면 주소(/inventory 등)는 모두 index.html을 돌려주고, 화면 쪽 라우터가 처리한다
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).type('text/plain; charset=utf-8').send('파일을 찾을 수 없어요.');
  });

  return app;
}

// 이 파일이 하는 일: Fastify 서버 인스턴스를 만든다(buildApp). 준비 상태 확인 API(GET /api/health)와
// 빌드된 화면 파일(web/dist) 제공, 화면 주소를 모두 index.html로 돌려주는 SPA 폴백을 담당한다.
// 테스트는 deps(시계·데이터 폴더·화면 폴더·DB·DB 점검 함수)를 바꿔 끼워 실제 서버 없이 inject로 확인한다.
// DB를 넣지 않으면 dataDir/app.db를 직접 열어 마이그레이션까지 적용하고, 서버를 닫을 때 함께 닫는다.
// 요청 순서: 원내망 검사(security/network) → 세션·CSRF·권한(auth/guard) → 인증 API(auth/routes)·업무 모듈(modules/index). 모든 응답에 보안 헤더.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { systemClock, type Clock } from './lib/clock.ts';
import { AppError, toErrorResponse } from './lib/errors.ts';
import type { Db } from './db/index.ts';
import { makeDbCheck, openAppDb } from './db/migrate.ts';
import { registerNetworkGuard } from './security/network.ts';
import { registerSecurityHeaders } from './security/headers.ts';
import { registerAuthGuard } from './auth/guard.ts';
import { authRoutes } from './auth/routes.ts';
import { registerModules } from './modules/index.ts';
import type { AiOptions } from './ai/types.ts';
import { makeSwappableDb } from './modules/admin/backup-swap.ts';
import type { MaintenanceState } from './modules/admin/backup-service.ts';

// 시계는 server/lib/clock.ts에 있다. 예전 import 경로(./app.ts)도 계속 쓸 수 있게 다시 내보낸다.
export { fixedClock, systemClock, type Clock } from './lib/clock.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** 이 서버가 쓰는 DB(server/db/index.ts 래퍼) */
    db: Db;
    /** 이 서버가 쓰는 시계 */
    clock: Clock;
    /** 업무 데이터 폴더(secret.key·로그 위치) */
    dataDir: string;
    /** AI 실행 옵션(테스트가 넣은 가짜 공급자 주소 등). 없으면 null이고 ai 모듈이 환경 변수를 본다 */
    aiOptions: AiOptions | null;
    /** 백업 폴더(BACKUP_DIR, 기본: 데이터 폴더 안 backups) */
    backupDir: string;
    /** 점검 모드(백업 복원 중). on이면 health 말고 모든 API가 503 MAINTENANCE */
    maintenance: MaintenanceState;
  }
}

/** DB 상태 점검 결과 */
export type DbStatus = 'ok' | 'error';

/** buildApp에 넣는 의존성. 비워 두면 실제 운영 기본값을 쓴다 */
export interface AppDeps {
  /** 업무 데이터 폴더 */
  dataDir: string;
  /** 백업 폴더(main.ts가 BACKUP_DIR 설정값을 넣는다). 없으면 dataDir/backups */
  backupDir?: string;
  /** 시계(기본: 실제 시각) */
  clock?: Clock;
  /** 빌드된 화면 폴더(기본: web/dist) */
  webDist?: string;
  /** 화면에 보여 줄 앱 버전(기본: package.json의 version) */
  version?: string;
  /** 이미 열어 마이그레이션한 DB(main.ts가 넣는다). 없으면 dataDir/app.db를 직접 연다 */
  db?: Db;
  /** DB 점검 함수(기본: 실제 DB가 응답하고 스키마가 최신인지 확인). 테스트가 실패 상황을 흉내 낼 때 바꿔 끼운다 */
  checkDb?: () => DbStatus;
  /** Fastify 요청 로그를 켤지(기본 꺼짐) */
  logger?: boolean;
  /** true면 원내망 밖 접속도 허용한다(config.json의 allowExternal, 기본 false) */
  allowExternal?: boolean;
  /** AI 실행 옵션(테스트 전용: 가짜 LLM 서버 주소·시간 초과). 없으면 환경 변수 AI_BASE_URL_*와 기본값 */
  ai?: AiOptions;
  /**
   * 이 서버 실행마다 새로 만드는 무작위 표식(main.ts가 넣는다). 있으면 GET /api/health 응답에 X-Instance 헤더로 붙인다.
   * main.ts는 켜진 직후 안내할 주소로 직접 물어보고, 같은 표식이 오는지로 다른 프로그램이 주소를 가로챘는지 확인한다.
   * 키·개인정보는 넣지 않는다(내부 확인용 무작위 값).
   */
  instanceId?: string;
}

/** 준비 상태 확인 주소 */
export const HEALTH_PATH = '/api/health';
/** 자기 확인 표식을 담는 응답 헤더 이름(소문자) */
export const INSTANCE_HEADER = 'x-instance';

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
  // DB: 넣어 준 것을 쓰거나, 직접 열어(마이그레이션 포함) 서버를 닫을 때 함께 닫는다
  const ownDb = !deps.db;
  // 백업 복원 때 연결을 바꿔 끼울 수 있게 감싼다(modules/admin/backup-swap.ts). 바꿔 끼운 연결은 서버를 닫을 때 함께 닫는다
  const db = makeSwappableDb(deps.db ?? openAppDb(deps.dataDir, { clock }).db);
  const dbOk = makeDbCheck(db);
  const checkDb = deps.checkDb ?? ((): DbStatus => (dbOk() ? 'ok' : 'error'));

  const app = Fastify({ logger: deps.logger ?? false });
  app.decorate('db', db);
  app.decorate('clock', clock);
  app.decorate('dataDir', deps.dataDir);
  app.decorate('aiOptions', deps.ai ?? null);
  app.decorate('backupDir', deps.backupDir ?? path.join(deps.dataDir, 'backups'));
  app.decorate('maintenance', { on: false });
  app.addHook('onClose', async () => {
    if (ownDb || db.swapped) db.close();
  });

  // 자기 확인 표식: 원내망 검사가 막는 응답에도 붙도록 다른 검사보다 먼저 건다(health 주소에만)
  const instanceId = deps.instanceId;
  if (instanceId) {
    app.addHook('onRequest', async (req, reply) => {
      if ((req.url.split('?')[0] ?? '') === HEALTH_PATH) reply.header(INSTANCE_HEADER, instanceId);
    });
  }

  // 보안 헤더(모든 응답) → 원내망 검사(가장 먼저) → 쿠키 → 세션·CSRF·권한 검사
  registerSecurityHeaders(app);
  registerNetworkGuard(app, { allowExternal: deps.allowExternal ?? false });
  // 백업 복원 중에는 준비 상태 확인 말고 모든 API를 503 MAINTENANCE로 돌려보낸다(overview §3.7 ①). DB를 닫는 동안 세션 확인보다 먼저 막는다
  app.addHook('onRequest', async (req) => {
    const urlPath = req.url.split('?')[0] ?? '';
    if (app.maintenance.on && (urlPath === '/api' || urlPath.startsWith('/api/')) && urlPath !== HEALTH_PATH) throw new AppError('MAINTENANCE');
  });
  await app.register(fastifyCookie);
  registerAuthGuard(app);

  // 오류 응답을 한 형식으로: { error: { code, message(한국어), fields? } } (lib/errors.ts)
  app.setErrorHandler((err, req, reply) => {
    const { status, body } = toErrorResponse(err);
    if (status >= 500) req.log.error(err);
    return reply.code(status).send(body);
  });

  // 준비 상태 확인: 포트가 열린 것만이 아니라 DB까지 응답해야 ok:true(HARNESS §2)
  app.get(HEALTH_PATH, async (_req, reply) => {
    const db = checkDb();
    const ok = db === 'ok';
    reply.code(ok ? 200 : 503).header('cache-control', 'no-store');
    return { ok, version, db, now: clock.now().toISOString() };
  });

  // 인증 API와 업무 모듈 API
  await authRoutes(app);
  await registerModules(app);

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

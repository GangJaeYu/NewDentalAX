// 이 파일이 하는 일: 모든 /api 요청의 "누가·무엇을 할 수 있는지"를 검사한다(overview §2 요청 처리 순서, FR-002·003).
// 순서: 세션 쿠키 확인(만료 연장) → 공개 API가 아니면 로그인 필요(401) → 상태 변경 요청이면 Origin·CSRF 확인(403 CSRF)
//      → 비밀번호를 바꿔야 하는 사용자면 비밀번호 변경 외 차단(403 PASSWORD_CHANGE_REQUIRED) → 주소별 권한 표 확인(403 FORBIDDEN).
// 모듈 라우트는 requireCap·requireRole을 preHandler로 붙여 본문·작성자에 따라 달라지는 권한을 더 확인하고, auditCtx(req)로 감사 기록을 남긴다.
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { AppError } from '../lib/errors.ts';
import type { AuditContext } from '../lib/audit.ts';
import { atLeast, can, type Cap, type Role } from '../../shared/roles.ts';
import { SESSION_COOKIE } from '../../shared/schemas/auth.ts';
import { isApiPath } from '../security/network.ts';
import { findApiRule } from './api-permissions.ts';
import { assertCsrfToken, assertSameOrigin, isUnsafeMethod } from './csrf.ts';
import { touchSession, type AuthSession } from './sessions.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** 확인된 로그인 세션(로그인하지 않았으면 null) */
    auth: AuthSession | null;
  }
}

/** 로그인 없이 부를 수 있는 API(/api 뒤 경로) */
export const PUBLIC_APIS: ReadonlySet<string> = new Set(['GET /health', 'GET /session', 'POST /setup', 'POST /auth/login']);

/** 비밀번호를 바꿔야 하는 사용자(must_change_pw=1)도 부를 수 있는 API */
export const PASSWORD_CHANGE_ALLOWED: ReadonlySet<string> = new Set(['GET /session', 'POST /auth/password', 'POST /auth/logout']);

/** 세션 쿠키 설정: HttpOnly, SameSite=Strict, Path=/ (http라 Secure는 붙이지 않음, TD-017) */
export const SESSION_COOKIE_OPTIONS = { path: '/', httpOnly: true, sameSite: 'strict', secure: false } as const;

/** 요청 주소에서 /api 뒤 경로만 뽑는다(쿼리 제외, % 글자 풀기) */
export function apiSubPath(url: string): string {
  const raw = (url.split('?')[0] ?? '').slice('/api'.length) || '/';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * /api 요청 검사 훅을 건다. buildApp이 쿠키 플러그인과 원내망 검사 뒤에 부른다.
 * 오류는 AppError로 던지고, 공통 오류 처리기가 한국어 응답으로 바꾼다.
 */
export function registerAuthGuard(app: FastifyInstance): void {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req, reply) => {
    if (!isApiPath(req.url)) return;
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const sub = apiSubPath(req.url);
    const key = `${method} ${sub}`;

    // ① 세션 확인(살아 있으면 만료를 8시간 뒤로 미룬다). 쿠키가 있는데 세션이 없으면 쿠키를 지우게 한다
    const token = req.cookies?.[SESSION_COOKIE];
    req.auth = token ? touchSession(app.db, app.clock, token) : null;
    if (token && !req.auth) reply.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTIONS);

    const unsafe = isUnsafeMethod(req.method);
    // ② 공개 API: 로그인 없이 통과. 상태 변경(첫 설정·로그인)은 출처만 확인한다
    if (PUBLIC_APIS.has(key)) {
      if (unsafe) assertSameOrigin(req);
      return;
    }
    const rule = findApiRule(method, sub);
    // 없는 API 주소이고 권한 표에도 없으면 404 처리기에 맡긴다.
    // (화면 파일용 와일드카드 경로 '/*'가 /api/없는주소까지 잡으므로, 등록된 경로가 /api로 시작하는지로 판단한다)
    const routeUrl = req.routeOptions.url ?? '';
    const isApiRoute = !req.is404 && isApiPath(routeUrl);
    if (!isApiRoute && !rule) return;

    // ③ 로그인 필요
    if (!req.auth) throw new AppError('UNAUTHENTICATED');
    // ④ 상태 변경 요청은 출처와 CSRF 토큰을 확인
    if (unsafe) {
      assertSameOrigin(req);
      assertCsrfToken(req, req.auth.csrfToken);
    }
    // ⑤ 임시 비밀번호 사용자는 비밀번호부터 바꿔야 한다
    if (req.auth.user.mustChangePw && !PASSWORD_CHANGE_ALLOWED.has(key)) throw new AppError('PASSWORD_CHANGE_REQUIRED');
    // ⑥ 주소별 권한 표
    if (rule && !can(req.auth.user.role, rule.cap)) throw new AppError('FORBIDDEN');
  });
}

/** 로그인한 사용자를 꺼낸다. 없으면 401을 던진다(라우트 안에서 쓴다) */
export function currentUser(req: FastifyRequest) {
  if (!req.auth) throw new AppError('UNAUTHENTICATED');
  return req.auth.user;
}

/** preHandler: 로그인만 확인 */
export const requireAuth: preHandlerAsyncHookHandler = async (req: FastifyRequest, _reply: FastifyReply) => {
  currentUser(req);
};

/** preHandler: 이 권한(shared/roles.ts CAPS)이 있어야 통과. 예: { preHandler: requireCap('items.manage') } */
export function requireCap(cap: Cap): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest) => {
    if (!can(currentUser(req).role, cap)) throw new AppError('FORBIDDEN');
  };
}

/** preHandler: 이 역할 이상이어야 통과. 예: requireRole('manager') */
export function requireRole(min: Role): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest) => {
    if (!atLeast(currentUser(req).role, min)) throw new AppError('FORBIDDEN');
  };
}

/** 라우트 안에서 권한을 직접 확인한다(본문에 따라 다를 때). 없으면 403을 던진다 */
export function assertCan(req: FastifyRequest, cap: Cap): void {
  if (!can(currentUser(req).role, cap)) throw new AppError('FORBIDDEN');
}

/** 감사 기록용 맥락(누가·어디서). service 함수에 넘겨 audit(ctx, ...)에 쓴다 */
export function auditCtx(req: FastifyRequest, app: FastifyInstance = req.server): AuditContext {
  const u = req.auth?.user;
  return { db: app.db, clock: app.clock, user: u ? { id: u.id, username: u.username } : null, ip: req.ip };
}

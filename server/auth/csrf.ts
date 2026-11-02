// 이 파일이 하는 일: 다른 사이트가 사용자 몰래 요청을 보내는 공격(CSRF)을 막는다(NFR-002 AC1, TD-006).
// 상태를 바꾸는 요청(POST·PUT·PATCH·DELETE)은 ① 브라우저가 보낸 Origin(없으면 Referer)이 이 서버 주소와 같아야 하고,
// ② 로그인한 세션이면 X-CSRF-Token 헤더가 세션의 토큰과 같아야 한다. 틀리면 403 CSRF를 던진다.
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { CSRF_HEADER } from '../../shared/schemas/auth.ts';

/** 상태를 바꾸는 메서드인지 */
export function isUnsafeMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

/** 두 문자열을 같은 시간에 비교한다 */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 헤더 값 하나를 문자열로 */
function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * 요청 출처가 이 서버와 같은지 확인한다.
 * - Sec-Fetch-Site가 cross-site면 거부
 * - Origin(없으면 Referer)의 호스트:포트가 Host 헤더와 다르면 거부
 * - 둘 다 없으면(브라우저가 아닌 도구) 통과시키고, 세션 요청은 CSRF 토큰으로 막는다
 */
export function assertSameOrigin(req: FastifyRequest): void {
  if (header(req, 'sec-fetch-site') === 'cross-site') throw new AppError('CSRF');
  const host = header(req, 'host');
  const source = header(req, 'origin') ?? header(req, 'referer');
  if (!source) return;
  let sourceHost: string;
  try {
    sourceHost = new URL(source).host;
  } catch {
    throw new AppError('CSRF');
  }
  if (!host || sourceHost.toLowerCase() !== host.toLowerCase()) throw new AppError('CSRF');
}

/** 로그인 세션의 CSRF 토큰이 X-CSRF-Token 헤더와 같은지 확인한다 */
export function assertCsrfToken(req: FastifyRequest, sessionToken: string): void {
  const sent = header(req, CSRF_HEADER);
  if (!sent || !safeEqual(sent, sessionToken)) throw new AppError('CSRF');
}

// 이 파일이 하는 일: 모든 응답(API·화면 파일·오류·404)에 보안 헤더를 붙인다(NFR-002 AC4, TD-007).
// CSP(frame-ancestors 포함), X-Content-Type-Options, Referrer-Policy, Cross-Origin-Opener-Policy를 별도 패키지 없이 onSend 훅에서 직접 단다.
// API 응답은 브라우저가 저장해 두지 않도록 Cache-Control: no-store를 기본으로 붙인다.
import type { FastifyInstance } from 'fastify';
import { isApiPath } from './network.ts';

/** 콘텐츠 보안 정책(TD-007 그대로). 외부 스크립트·글꼴·이미지 주소를 허용하지 않는다 */
export const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/** 모든 응답에 붙이는 보안 헤더 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

/** 보안 헤더 훅을 건다. 다른 플러그인보다 먼저 불러야 모든 응답에 붙는다 */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
    if (isApiPath(req.url) && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });
}

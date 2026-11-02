// 이 파일이 하는 일: 원내 네트워크 밖에서 온 요청을 막는다(FR-009, TD-007). 요청을 보낸 기기의 주소가
// 사설망(10/8, 172.16/12, 192.168/16, 169.254/16, IPv6 ULA·링크로컬)이나 이 PC(루프백)가 아니면 403 NETWORK_BLOCKED를 돌려준다.
// data/config.json의 allowExternal: true면 이 검사를 끈다(위험, README 안내). 모든 요청에서 가장 먼저 실행된다.
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.ts';

/** IPv4 주소 문자열을 네 숫자로 나눈다. 형식이 틀리면 null */
function parseIPv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

/** IPv4가 원내(사설망·루프백·링크로컬)인지 */
function isInternalIPv4(ip: string): boolean {
  const p = parseIPv4(ip);
  if (!p) return false;
  const [a, b] = p;
  return (
    a === 127 || // 이 PC(루프백)
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) // 링크로컬(공유기 없이 직접 연결)
  );
}

/**
 * 주소가 원내에서 온 것인지 판단한다.
 * - IPv4: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16
 * - IPv6: ::1(루프백), fc00::/7(ULA), fe80::/10(링크로컬), ::ffff:a.b.c.d(IPv4 주소를 IPv6로 쓴 것)는 IPv4 규칙으로
 * 주소를 알 수 없으면 막는다.
 */
export function isInternalAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  let ip = address.trim().toLowerCase();
  // 영역 표시(fe80::1%eth0)를 떼어 낸다
  const pct = ip.indexOf('%');
  if (pct >= 0) ip = ip.slice(0, pct);
  if (ip.includes('.') && !ip.includes(':')) return isInternalIPv4(ip);
  // IPv4-mapped IPv6 (::ffff:192.168.0.5)
  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped?.[1]) return isInternalIPv4(mapped[1]);
  if (!ip.includes(':')) return false;
  if (ip === '::1' || /^(0{1,4}:){7}0{0,3}1$/.test(ip)) return true;
  const first = ip.split(':')[0] ?? '';
  if (!/^[0-9a-f]{1,4}$/.test(first)) return false;
  const word = parseInt(first, 16);
  if ((word & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((word & 0xffc0) === 0xfe80) return true; // fe80::/10 링크로컬
  return false;
}

/** 원내망 제한 설정 */
export interface NetworkOptions {
  /** true면 외부 접속도 허용(검사 끔) */
  allowExternal: boolean;
}

/** 요청 주소가 /api로 시작하는지 */
export function isApiPath(url: string): boolean {
  const p = url.split('?')[0] ?? '';
  return p === '/api' || p.startsWith('/api/');
}

/**
 * 모든 요청의 가장 앞에서 원내망 여부를 검사하는 훅을 건다.
 * 막힌 요청: API는 { error: { code: 'NETWORK_BLOCKED' } } JSON, 화면 주소는 한국어 안내 글을 403으로 돌려준다.
 */
export function registerNetworkGuard(app: FastifyInstance, opts: NetworkOptions): void {
  if (opts.allowExternal) return;
  app.addHook('onRequest', async (req, reply) => {
    // 프록시를 쓰지 않으므로 X-Forwarded-For는 믿지 않고 실제 연결 주소만 본다
    if (isInternalAddress(req.ip)) return;
    req.log.warn({ ip: req.ip }, '원내망 밖 접속을 막았어요');
    const err = new AppError('NETWORK_BLOCKED');
    if (isApiPath(req.url)) return reply.code(err.status).send(err.toBody());
    return reply.code(err.status).type('text/plain; charset=utf-8').send(`${err.message} 병원 와이파이나 원내 PC에서 접속해 주세요.`);
  });
}

// 이 파일이 하는 일: 비밀번호를 단방향 해시로 바꾸고 확인한다(FR-002 AC5, TD-006). Node 내장 scrypt(N=2^15, r=8, p=1, 솔트 16바이트)를 쓴다.
// 저장 형식: scrypt$<N>$<r>$<p>$<솔트 base64>$<해시 base64>. 비교는 timingSafeEqual로 해서 걸린 시간으로 답을 추측하지 못하게 한다.
// 평문 비밀번호는 어디에도 저장하거나 로그에 남기지 않는다.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
/** scrypt가 쓰는 메모리 한도(128·N·r = 32MB보다 넉넉하게) */
const MAXMEM = 64 * 1024 * 1024;

/** scrypt를 Promise로 부른다 */
function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** 비밀번호를 해시 문자열로 바꾼다(같은 비밀번호도 솔트가 달라 매번 다른 값이 나온다) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/** 저장된 해시와 입력한 비밀번호가 맞는지 확인한다. 형식이 틀린 해시는 항상 false */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  if (!salt.length || !expected.length) return false;
  const actual = await scryptAsync(password, salt, expected.length, { N: n, r, p, maxmem: Math.max(MAXMEM, 256 * n * r) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 없는 아이디로 로그인할 때도 맞는 아이디와 비슷한 시간이 걸리도록 쓰는 가짜 해시 */
let dummyHash: Promise<string> | null = null;

/** 가짜 해시로 확인을 한 번 돌린다(결과는 항상 false). 아이디가 있는지 응답 시간으로 알아내지 못하게 한다 */
export async function verifyDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
  return false;
}

// 이 파일이 하는 일: 비밀번호 해시(scrypt)가 단방향·솔트 사용·형식 고정이고, 맞는 비밀번호만 통과시키는지 확인한다
// (phase-01-task-03 AC7, FR-002 AC5, TD-006).
import { describe, expect, test } from 'vitest';
import { hashPassword, verifyDummy, verifyPassword } from './password.ts';

describe('비밀번호 해시', () => {
  test('phase-01-task-03 AC7: 해시에는 평문이 없고, 같은 비밀번호도 솔트 때문에 매번 다르며, 맞는 비밀번호만 통과한다', async () => {
    const pw = '하늘숲-Password-01';
    const a = await hashPassword(pw);
    const b = await hashPassword(pw);
    expect(a).not.toBe(b);
    expect(a).not.toContain(pw);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{88}$/);
    expect(await verifyPassword(pw, a)).toBe(true);
    expect(await verifyPassword(pw, b)).toBe(true);
    expect(await verifyPassword(`${pw} `, a)).toBe(false);
    expect(await verifyPassword('', a)).toBe(false);
  });

  test('phase-01-task-03 AC7: 형식이 틀린 해시는 항상 실패하고, 가짜 확인은 false다', async () => {
    for (const bad of ['', 'plain', 'scrypt$x', 'bcrypt$1$2$3$4$5', 'scrypt$99999999$8$1$AAAA$AAAA', 'scrypt$32768$8$1$$']) {
      expect(await verifyPassword('anything', bad), bad).toBe(false);
    }
    expect(await verifyDummy('anything')).toBe(false);
  });
});

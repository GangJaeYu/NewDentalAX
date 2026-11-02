// 이 파일이 하는 일: 테스트에서 역할별 직원 계정과 로그인 세션을 빠르게 만든다(비밀번호 해시 계산 없이 DB에 직접 넣음).
// 돌려준 cookie·csrf를 app.inject의 headers에 넣으면 그 사용자로 요청한 것과 같다. 실제 로그인 흐름 시험은 /api/auth/login을 쓴다.
import type { FastifyInstance } from 'fastify';
import type { Role } from '../../shared/roles.ts';
import { createSession } from '../../server/auth/sessions.ts';

/** 만든 테스트 사용자와 그 세션 */
export interface TestLogin {
  userId: number;
  username: string;
  /** inject headers에 넣을 쿠키 문자열(sid=...) */
  cookie: string;
  /** X-CSRF-Token 헤더 값 */
  csrf: string;
  /** GET 요청용 헤더 */
  headers: Record<string, string>;
  /** 상태 변경 요청용 헤더(쿠키 + CSRF) */
  writeHeaders: Record<string, string>;
}

let seq = 0;

/** 역할을 가진 사용자를 만들고 세션을 연다. passwordHash를 주지 않으면 로그인할 수 없는 값이 들어간다 */
export function loginAs(app: FastifyInstance, role: Role, opts: { username?: string; mustChangePw?: boolean; passwordHash?: string } = {}): TestLogin {
  seq += 1;
  const username = opts.username ?? `${role}${seq}x`;
  const now = app.clock.now().toISOString();
  const r = app.db.run(
    'INSERT INTO users (username, name, role, job_type, password_hash, must_change_pw, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [username, `테스트 ${role}`, role, 'other', opts.passwordHash ?? 'scrypt$x', opts.mustChangePw ? 1 : 0, now, now],
  );
  const s = createSession(app.db, app.clock, r.lastInsertRowid, '127.0.0.1');
  const cookie = `sid=${s.token}`;
  return {
    userId: r.lastInsertRowid,
    username,
    cookie,
    csrf: s.csrfToken,
    headers: { cookie },
    writeHeaders: { cookie, 'x-csrf-token': s.csrfToken },
  };
}

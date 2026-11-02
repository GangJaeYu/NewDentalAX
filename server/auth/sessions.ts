// 이 파일이 하는 일: 로그인 세션을 만들고·확인하고·지운다(FR-002 AC3·AC4, FR-003 AC2, TD-006).
// 쿠키에는 무작위 32바이트 토큰을 넣고, DB(sessions)에는 그 토큰의 SHA-256 해시만 저장한다(DB가 새도 쿠키를 만들 수 없게).
// 요청이 올 때마다 만료를 "지금 + 8시간"으로 미룬다(슬라이딩). 마지막 요청 뒤 8시간이 지나면 세션이 사라진다.
// 비활성 사용자의 세션은 확인할 때 바로 지운다. 시각은 항상 주입된 시계(clock)에서 가져온다.
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/index.ts';
import type { Clock } from '../lib/clock.ts';
import { HOUR_MS } from '../lib/clock.ts';
import { isRole, type Role } from '../../shared/roles.ts';
import type { Me } from '../../shared/schemas/auth.ts';

/** 마지막 요청 뒤 세션이 살아 있는 시간(8시간) */
export const SESSION_IDLE_MS = 8 * HOUR_MS;

/** 요청을 보낸 사용자(서버 안에서 쓰는 값) */
export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  jobType: string;
  mustChangePw: boolean;
}

/** 확인된 세션 */
export interface AuthSession {
  sessionId: number;
  csrfToken: string;
  expiresAt: string;
  user: AuthUser;
}

/** 새로 만든 세션: 쿠키에 넣을 토큰과 CSRF 토큰 */
export interface NewSession {
  token: string;
  csrfToken: string;
  sessionId: number;
  expiresAt: string;
}

/** 무작위 토큰(base64url) */
function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** 쿠키 토큰 → DB에 저장하는 해시 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** AuthUser → 화면에 보내는 Me */
export function toMe(u: AuthUser): Me {
  return { id: u.id, username: u.username, name: u.name, role: u.role, jobType: u.jobType, mustChangePw: u.mustChangePw };
}

/** 사용자의 세션을 하나 만든다 */
export function createSession(db: Db, clock: Clock, userId: number, ip: string | null): NewSession {
  const token = randomToken();
  const csrfToken = randomToken();
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_IDLE_MS).toISOString();
  const r = db.run(
    'INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [hashToken(token), userId, csrfToken, now.toISOString(), now.toISOString(), expiresAt, ip],
  );
  return { token, csrfToken, sessionId: r.lastInsertRowid, expiresAt };
}

interface SessionRow {
  id: number;
  user_id: number;
  csrf_token: string;
  expires_at: string;
  username: string;
  name: string;
  role: string;
  job_type: string;
  must_change_pw: number;
  active: number;
}

/**
 * 쿠키 토큰으로 세션을 확인한다. 살아 있으면 만료를 지금+8시간으로 늘리고 세션 정보를 돌려준다.
 * 없거나, 만료됐거나(expires_at ≤ 지금), 사용자가 비활성이면 null을 돌려주고 해당 세션을 지운다.
 */
export function touchSession(db: Db, clock: Clock, token: string): AuthSession | null {
  if (!token || token.length > 200) return null;
  const row = db.get<SessionRow>(
    `SELECT s.id, s.user_id, s.csrf_token, s.expires_at, u.username, u.name, u.role, u.job_type, u.must_change_pw, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [hashToken(token)],
  );
  if (!row) return null;
  const now = clock.now();
  if (Date.parse(row.expires_at) <= now.getTime()) {
    db.run('DELETE FROM sessions WHERE id = ?', [row.id]);
    return null;
  }
  if (row.active !== 1 || !isRole(row.role)) {
    deleteUserSessions(db, row.user_id);
    return null;
  }
  const expiresAt = new Date(now.getTime() + SESSION_IDLE_MS).toISOString();
  db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', [now.toISOString(), expiresAt, row.id]);
  return {
    sessionId: row.id,
    csrfToken: row.csrf_token,
    expiresAt,
    user: {
      id: row.user_id,
      username: row.username,
      name: row.name,
      role: row.role,
      jobType: row.job_type,
      mustChangePw: row.must_change_pw === 1,
    },
  };
}

/** 세션 하나를 지운다(로그아웃) */
export function deleteSession(db: Db, sessionId: number): void {
  db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

/**
 * 사용자의 세션을 모두 지운다. 사용자를 비활성화하거나 비밀번호를 초기화할 때 부른다(FR-003 AC2).
 * exceptSessionId를 주면 그 세션(본인이 지금 쓰는 세션)은 남긴다. 지운 개수를 돌려준다.
 */
export function deleteUserSessions(db: Db, userId: number, exceptSessionId?: number): number {
  if (exceptSessionId === undefined) return db.run('DELETE FROM sessions WHERE user_id = ?', [userId]).changes;
  return db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [userId, exceptSessionId]).changes;
}

/** 만료된 세션을 모두 지운다(매시 정리 작업용). 지운 개수를 돌려준다 */
export function purgeExpiredSessions(db: Db, clock: Clock): number {
  return db.run('DELETE FROM sessions WHERE expires_at <= ?', [clock.now().toISOString()]).changes;
}

// 이 파일이 하는 일: 감사 로그를 남기는 함수 audit(ctx, action, targetType, targetId, detail)를 제공한다(FR-005).
// 상태를 바꾸는 서비스 함수는 모두 이 함수를 부른다. 시각은 주입된 시계에서, 사용자·IP는 요청 맥락(ctx)에서 가져온다.
// detail에는 개인정보·AI 원문·키를 넣지 않는다. 실수로 비밀번호·토큰·키 같은 항목이 들어오면 저장 전에 가린다.
import type { Db } from '../db/index.ts';
import type { Clock } from './clock.ts';

/** 감사 기록에 필요한 요청 맥락 */
export interface AuditContext {
  db: Db;
  clock: Clock;
  /** 요청한 사용자(로그인 전이면 null) */
  user?: { id: number; username: string } | null;
  /** 요청한 기기의 IP */
  ip?: string | null;
}

/** 감사 로그 한 줄(조회용) */
export interface AuditRow {
  id: number;
  at: string;
  user_id: number | null;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
}

/** detail에 들어가면 안 되는 항목 이름(대소문자 무시) */
const SECRET_KEY_RE = /password|passwd|secret|api_?key|token$|^keys?$|cookie|authorization|^pw$/i;
export const REDACTED = '[가림]';

/** detail 안의 비밀 항목을 가린다(중첩 객체·배열까지) */
export function scrubDetail(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrubDetail(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? REDACTED : scrubDetail(v, depth + 1);
  }
  return out;
}

/**
 * 감사 로그 한 줄을 남기고 그 id를 돌려준다.
 * - action: 'user.create', 'auth.login_failed'처럼 "대상.행동" 형식의 영문 이름
 * - targetType·targetId: 바뀐 대상(없으면 null)
 * - detail: 무엇이 바뀌었는지 요약(JSON으로 저장). 개인정보·원문·키 금지
 */
export function audit(
  ctx: AuditContext,
  action: string,
  targetType: string | null = null,
  targetId: string | number | null = null,
  detail: Record<string, unknown> | null = null,
): number {
  const r = ctx.db.run(
    'INSERT INTO audit_log (at, user_id, username, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      ctx.clock.now().toISOString(),
      ctx.user?.id ?? null,
      ctx.user?.username ?? null,
      action,
      targetType,
      targetId === null ? null : String(targetId),
      detail === null ? null : JSON.stringify(scrubDetail(detail)),
      ctx.ip ?? null,
    ],
  );
  return r.lastInsertRowid;
}

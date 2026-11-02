// 이 파일이 하는 일: 활동 기록(감사 로그) 조회·CSV 내보내기 API(backend.md §3.2 GET /api/audit, FR-005 AC2·AC3)를 둔다.
// ?from&to(YYYY-MM-DD, 한국 시각 기준 날짜)·userId·action(앞부분이 같으면 포함, 예: 'auth.')으로 거르고, 최근 것부터 보여 준다.
// ?format=csv면 같은 조건의 기록 전체를 엑셀에서 한글이 깨지지 않게 UTF-8 BOM을 붙인 CSV로 내려보낸다. admin만 볼 수 있다(주소별 권한 표 audit.view).
// 감사 로그를 고치거나 지우는 API는 만들지 않는다(DB 트리거도 막는다).
import type { FastifyInstance } from 'fastify';
import { audit } from '../../lib/audit.ts';
import { toCsv } from '../../lib/csv.ts';
import { kstDayRangeUtc, kstParts } from '../../lib/dates.ts';
import type { Db } from '../../db/index.ts';
import { auditCtx } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { auditActionLabel, auditQuerySchema, type AuditEntry, type AuditQuery, type PageResult } from '../../../shared/schemas/admin.ts';

/** CSV로 한 번에 내보낼 수 있는 최대 줄 수 */
export const CSV_MAX_ROWS = 50_000;

/** UTF-8 BOM·CSV 칸 만들기는 공용 server/lib/csv.ts로 모았다(phase-03-task-03). 예전 import 경로를 위해 다시 내보낸다 */
export { UTF8_BOM, csvCell } from '../../lib/csv.ts';

interface DbAudit {
  id: number;
  at: string;
  user_id: number | null;
  username: string | null;
  user_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
}

/** 조건 → WHERE 절과 값 */
function whereOf(q: AuditQuery): { sql: string; params: Array<string | number> } {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q.from) {
    where.push('a.at >= ?');
    params.push(kstDayRangeUtc(q.from).from);
  }
  if (q.to) {
    where.push('a.at < ?');
    params.push(kstDayRangeUtc(q.to).to);
  }
  if (q.userId !== undefined) {
    where.push('a.user_id = ?');
    params.push(q.userId);
  }
  if (q.action) {
    // 'auth.'처럼 점으로 끝나면 그 묶음 전체, 아니면 정확히 같은 행동
    if (q.action.endsWith('.')) {
      where.push("a.action LIKE ? ESCAPE '\\'");
      params.push(`${q.action.replace(/_/g, '\\_')}%`);
    } else {
      where.push('a.action = ?');
      params.push(q.action);
    }
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** DB 줄 → 화면에 보내는 한 줄 */
function toEntry(r: DbAudit): AuditEntry {
  let detail: Record<string, unknown> | null = null;
  if (r.detail) {
    try {
      const v: unknown = JSON.parse(r.detail);
      detail = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
    } catch {
      detail = { value: r.detail };
    }
  }
  return {
    id: r.id,
    at: r.at,
    userId: r.user_id,
    username: r.username,
    userName: r.user_name,
    action: r.action,
    actionLabel: auditActionLabel(r.action),
    targetType: r.target_type,
    targetId: r.target_id,
    detail,
    ip: r.ip,
  };
}

const SELECT = `SELECT a.id, a.at, a.user_id, a.username, u.name AS user_name, a.action, a.target_type, a.target_id, a.detail, a.ip
                  FROM audit_log a LEFT JOIN users u ON u.id = a.user_id`;

/** 조건에 맞는 활동 기록 한 쪽(최근 것부터) */
export function listAudit(db: Db, q: AuditQuery): PageResult<AuditEntry> {
  const w = whereOf(q);
  const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log a ${w.sql}`, w.params)?.n ?? 0;
  const rows = db.all<DbAudit>(`${SELECT} ${w.sql} ORDER BY a.at DESC, a.id DESC LIMIT ? OFFSET ?`, [...w.params, q.pageSize, (q.page - 1) * q.pageSize]);
  return { data: rows.map(toEntry), total };
}

/** 시각을 한국 시각 'YYYY-MM-DD HH:mm:ss'로 */
function kstSeconds(iso: string): string {
  const p = kstParts(new Date(iso));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}:${two(p.second)}`;
}

/** 활동 기록을 CSV 글로 만든다(맨 앞 UTF-8 BOM, 줄 끝 CRLF) */
export function auditCsv(entries: readonly AuditEntry[]): string {
  const header = ['시각', '아이디', '이름', '행동', '행동 코드', '대상 종류', '대상 번호', '세부 내용', 'IP'];
  const lines = [header, ...entries.map((e) => [
    kstSeconds(e.at),
    e.username ?? '',
    e.userName ?? '',
    e.actionLabel,
    e.action,
    e.targetType ?? '',
    e.targetId ?? '',
    e.detail ? JSON.stringify(e.detail) : '',
    e.ip ?? '',
  ])];
  return toCsv(lines);
}

/** 활동 기록 API를 등록한다 */
export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get('/audit', async (req, reply) => {
    const q = parseInput(auditQuerySchema, req.query);
    if (q.format !== 'csv') return listAudit(app.db, q);

    const page = listAudit(app.db, { ...q, page: 1, pageSize: CSV_MAX_ROWS });
    // 내보낸 사실도 남긴다(기록을 만든 뒤에 남기므로 이번 파일에는 들어가지 않는다)
    audit(auditCtx(req), 'audit.export', 'audit', null, { from: q.from ?? null, to: q.to ?? null, userId: q.userId ?? null, action: q.action ?? null, rows: page.data.length });
    const stamp = kstSeconds(app.clock.now().toISOString()).slice(0, 10);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="audit-${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(`활동기록-${stamp}.csv`)}`)
      .header('cache-control', 'no-store')
      .send(auditCsv(page.data));
  });
}

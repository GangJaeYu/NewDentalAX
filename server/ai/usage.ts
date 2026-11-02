// 이 파일이 하는 일: AI 호출 기록(ai_usage)을 남기고, 사용량 대시보드용 집계(이번 달 비용·예산 비율·기능별·사용자별·일별·최근 기록)를 만든다(FR-034).
// 기록에는 프롬프트 원문을 넣지 않는다. 개인정보는 {종류: 건수} 요약만 남긴다.
import type { Db } from '../db/index.ts';
import type { Clock } from '../lib/clock.ts';
import { kstDate, kstMidnight, monthRange, addDays, thisMonthKst } from '../lib/dates.ts';

/** 기록 한 줄에 넣는 값 */
export interface UsageRecord {
  userId: number | null;
  feature: string;
  provider: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costKrw: number;
  estimated: boolean;
  demo: boolean;
  status: 'ok' | 'error' | 'blocked';
  errorCode: string | null;
  privacy: Record<string, number> | null;
  durationMs: number | null;
}

/** 기록을 남기고 id를 돌려준다 */
export function recordUsage(db: Db, clock: Clock, r: UsageRecord): number {
  return db.run(
    'INSERT INTO ai_usage (at, user_id, feature, provider, model, input_tokens, output_tokens, cost_usd, cost_krw, estimated, demo, status, error_code, privacy, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      clock.now().toISOString(),
      r.userId,
      r.feature,
      r.provider,
      r.model,
      Math.max(0, Math.round(r.inputTokens)),
      Math.max(0, Math.round(r.outputTokens)),
      r.costUsd,
      r.costKrw,
      r.estimated,
      r.demo,
      r.status,
      r.errorCode,
      r.privacy && Object.keys(r.privacy).length ? JSON.stringify(r.privacy) : null,
      r.durationMs,
    ],
  ).lastInsertRowid;
}

/** 'YYYY-MM' 달의 [시작, 다음 달 시작) UTC 범위 */
export function monthRangeUtc(month: string): { from: string; to: string } {
  const { end } = monthRange(month);
  return { from: kstMidnight(`${month}-01`).toISOString(), to: kstMidnight(addDays(end, 1)).toISOString() };
}

/** 이번 달(KST) 누적 비용(원) */
export function monthTotalKrw(db: Db, clock: Clock, month: string = thisMonthKst(clock)): number {
  const { from, to } = monthRangeUtc(month);
  return db.get<{ s: number | null }>('SELECT SUM(cost_krw) AS s FROM ai_usage WHERE at >= ? AND at < ?', [from, to])?.s ?? 0;
}

/** 사용량 대시보드 응답 */
export interface UsageReport {
  month: string;
  monthKrw: number;
  budgetKrw: number;
  pct: number;
  warnPct: number;
  calls: number;
  byFeature: { feature: string; calls: number; errors: number; inputTokens: number; outputTokens: number; costKrw: number }[];
  byUser: { userId: number | null; name: string | null; calls: number; costKrw: number }[];
  byDay: { date: string; calls: number; costKrw: number }[];
  recent: {
    id: number;
    at: string;
    userName: string | null;
    feature: string;
    provider: string;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    costKrw: number;
    costUsd: number;
    estimated: boolean;
    demo: boolean;
    status: string;
    errorCode: string | null;
    privacy: Record<string, number> | null;
    durationMs: number | null;
  }[];
}

/** 예산 대비 비율(%) — 예산이 0이면 쓴 돈이 있으면 100, 없으면 0 */
export function budgetPct(monthKrw: number, budgetKrw: number): number {
  if (budgetKrw <= 0) return monthKrw > 0 ? 100 : 0;
  return Math.round((monthKrw / budgetKrw) * 1000) / 10;
}

/** 한 달 사용량을 모은다 */
export function usageReport(db: Db, month: string, budget: { budgetKrw: number; warnPct: number }): UsageReport {
  const { from, to } = monthRangeUtc(month);
  const where = 'u.at >= ? AND u.at < ?';
  const byFeature = db.all<{ feature: string; calls: number; errors: number; inputTokens: number; outputTokens: number; costKrw: number }>(
    `SELECT feature, COUNT(*) AS calls, SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS errors, SUM(input_tokens) AS inputTokens,
            SUM(output_tokens) AS outputTokens, SUM(cost_krw) AS costKrw
       FROM ai_usage u WHERE ${where} GROUP BY feature ORDER BY costKrw DESC, calls DESC`,
    [from, to],
  );
  const byUser = db.all<{ userId: number | null; name: string | null; calls: number; costKrw: number }>(
    `SELECT u.user_id AS userId, us.name AS name, COUNT(*) AS calls, SUM(u.cost_krw) AS costKrw
       FROM ai_usage u LEFT JOIN users us ON us.id = u.user_id WHERE ${where} GROUP BY u.user_id ORDER BY costKrw DESC, calls DESC`,
    [from, to],
  );
  // 날짜는 KST 기준으로 묶는다
  const rows = db.all<{ at: string; cost_krw: number }>(`SELECT at, cost_krw FROM ai_usage u WHERE ${where} ORDER BY at`, [from, to]);
  const days = new Map<string, { calls: number; costKrw: number }>();
  for (const r of rows) {
    const d = kstDate(new Date(r.at));
    const cur = days.get(d) ?? { calls: 0, costKrw: 0 };
    cur.calls += 1;
    cur.costKrw += r.cost_krw;
    days.set(d, cur);
  }
  const recent = db
    .all<{
      id: number;
      at: string;
      name: string | null;
      feature: string;
      provider: string;
      model: string | null;
      input_tokens: number;
      output_tokens: number;
      cost_krw: number;
      cost_usd: number;
      estimated: number;
      demo: number;
      status: string;
      error_code: string | null;
      privacy: string | null;
      duration_ms: number | null;
    }>(`SELECT u.*, us.name AS name FROM ai_usage u LEFT JOIN users us ON us.id = u.user_id WHERE ${where} ORDER BY u.at DESC, u.id DESC LIMIT 50`, [from, to])
    .map((r) => ({
      id: r.id,
      at: r.at,
      userName: r.name,
      feature: r.feature,
      provider: r.provider,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costKrw: r.cost_krw,
      costUsd: r.cost_usd,
      estimated: r.estimated === 1,
      demo: r.demo === 1,
      status: r.status,
      errorCode: r.error_code,
      privacy: r.privacy ? (JSON.parse(r.privacy) as Record<string, number>) : null,
      durationMs: r.duration_ms,
    }));
  const monthKrw = rows.reduce((s, r) => s + r.cost_krw, 0);
  return {
    month,
    monthKrw,
    budgetKrw: budget.budgetKrw,
    pct: budgetPct(monthKrw, budget.budgetKrw),
    warnPct: budget.warnPct,
    calls: rows.length,
    byFeature,
    byUser,
    byDay: [...days.entries()].map(([date, v]) => ({ date, ...v })),
    recent,
  };
}

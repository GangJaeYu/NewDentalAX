// 이 파일이 하는 일: AI 월 예산을 지킨다(FR-035). 호출 전에 이번 달(KST 1일 00:00부터) 누적이 예산 이상이면 402 AI_BUDGET_EXCEEDED로 막고,
// 호출 뒤 누적이 경고 비율(기본 80%) 이상이면 admin에게 알림을 한 번만 보낸다(dedupe_key = budget80:<YYYY-MM>, database.md §10).
// 예산은 요청마다 새로 읽으므로 관리자가 한도를 올리면 바로 다시 쓸 수 있다.
import type { Db } from '../db/index.ts';
import type { Clock } from '../lib/clock.ts';
import { AppError } from '../lib/errors.ts';
import { thisMonthKst } from '../lib/dates.ts';
import { emitNotification } from '../modules/notifications/emit.ts';
import type { AiSettings } from './settings.ts';
import { budgetPct, monthTotalKrw } from './usage.ts';

/** 이번 달 예산 상태 */
export interface BudgetStatus {
  month: string;
  monthKrw: number;
  budgetKrw: number;
  pct: number;
  warnPct: number;
  exceeded: boolean;
}

/** 이번 달 예산 상태를 계산한다 */
export function budgetStatus(db: Db, clock: Clock, s: Pick<AiSettings, 'monthlyBudgetKrw' | 'warnPct'>): BudgetStatus {
  const month = thisMonthKst(clock);
  const monthKrw = monthTotalKrw(db, clock, month);
  return {
    month,
    monthKrw,
    budgetKrw: s.monthlyBudgetKrw,
    pct: budgetPct(monthKrw, s.monthlyBudgetKrw),
    warnPct: s.warnPct,
    exceeded: monthKrw >= s.monthlyBudgetKrw,
  };
}

/** 예산을 다 썼으면 402를 던진다(호출 전 ②단계) */
export function assertBudget(db: Db, clock: Clock, s: AiSettings): BudgetStatus {
  const st = budgetStatus(db, clock, s);
  if (st.exceeded) throw new AppError('AI_BUDGET_EXCEEDED', { extra: { monthKrw: Math.round(st.monthKrw), budgetKrw: st.budgetKrw } });
  return st;
}

/** 원 단위 숫자를 "12,345원"으로 */
function won(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

/**
 * 호출 뒤(⑦단계) 누적이 경고 비율 이상이면 admin 모두에게 알림을 만든다. 이번 달에 이미 보냈으면 다시 만들지 않는다.
 * 새로 만든 알림 수를 돌려준다.
 */
export function warnIfNearBudget(db: Db, clock: Clock, s: AiSettings): number {
  const st = budgetStatus(db, clock, s);
  if (s.monthlyBudgetKrw <= 0 || st.monthKrw < (s.monthlyBudgetKrw * s.warnPct) / 100) return 0;
  return emitNotification(
    db,
    {
      role: 'admin',
      type: 'ai_budget',
      title: `이번 달 AI 예산의 ${s.warnPct}%를 넘었습니다`,
      body: `${st.month} 사용 ${won(st.monthKrw)} / 예산 ${won(s.monthlyBudgetKrw)} (${st.pct}%). 예산을 모두 쓰면 AI 요청이 막힙니다.`,
      link: '/admin/ai-usage',
      dedupeKey: `budget80:${st.month}`,
    },
    clock,
  );
}

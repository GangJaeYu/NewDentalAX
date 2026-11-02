// 이 파일이 하는 일: 의료광고 점검(FR-120)의 처리 함수. 규칙 사전 읽기·통째로 바꾸기(admin)와, 1차 규칙 점검 + 2차 AI 점검(adcheck 기능)을 한다.
// - listAdRules: 모든 규칙(꺼진 것 포함, 화면 순서대로)
// - replaceAdRules: 보낸 목록으로 사전을 바꾼다. id가 있으면 고치고, 없으면 새로 넣고, 빠진 규칙은 지운다(기본 규칙은 지울 수 없고 끄기만 가능)
// - runAdcheck: 켜진 규칙으로 위험 표현을 찾고, useAi이면 그 결과와 함께 AI 2차 점검을 부른다. AI가 꺼졌거나 실패해도 규칙 결과는 그대로 돌려준다
// AI 호출은 게이트웨이(server/ai/gateway.ts)를 거친다(권한·예산·개인정보 필터·사용 기록). 점검한 글 원문은 저장하지 않는다.
import { z } from 'zod';
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { audit, type AuditContext } from '../../lib/audit.ts';
import { AppError, toErrorResponse } from '../../lib/errors.ts';
import { runAi, type AiCallContext } from '../../ai/gateway.ts';
import {
  AD_MATCH_TYPES,
  AD_RULE_CATEGORIES,
  AD_SEVERITIES,
  ADCHECK_MAX_TEXT,
  ADCHECK_NOTICE,
  type AdAiReport,
  type AdcheckResponse,
  type AdMatchType,
  type AdRule,
  type AdRuleCategory,
  type AdSeverity,
} from '../../../shared/schemas/adcheck.ts';
import { checkPattern, findRuleHits, type RuleForCheck } from './rules.ts';

/** DB 한 줄 */
interface AdRuleRow {
  id: number;
  rule_key: string | null;
  pattern: string;
  match_type: AdMatchType;
  category: AdRuleCategory;
  severity: AdSeverity;
  reason: string;
  suggestion: string;
  active: number;
  sort: number;
  updated_at: string;
}

const COLS = 'id, rule_key, pattern, match_type, category, severity, reason, suggestion, active, sort, updated_at';

function toRule(r: AdRuleRow): AdRule {
  return {
    id: r.id,
    ruleKey: r.rule_key,
    pattern: r.pattern,
    matchType: r.match_type,
    category: r.category,
    severity: r.severity,
    reason: r.reason,
    suggestion: r.suggestion,
    active: r.active === 1,
    updatedAt: r.updated_at,
  };
}

// ---- 입력 검사 ----

const text = (max: number, what: string) =>
  z
    .string({ error: `${what}을(를) 적어 주세요.` })
    .trim()
    .min(1, { error: `${what}을(를) 적어 주세요.` })
    .max(max, { error: `${what}은(는) ${max}자까지 적을 수 있어요.` });

/** 규칙 하나(PUT /api/ad-rules의 rules[]) */
export const adRuleInputSchema = z
  .object({
    id: z.number({ error: '규칙 번호를 확인해 주세요.' }).int({ error: '규칙 번호를 확인해 주세요.' }).positive({ error: '규칙 번호를 확인해 주세요.' }).optional(),
    pattern: text(200, '찾을 말'),
    matchType: z.enum(AD_MATCH_TYPES, { error: '찾는 방식은 낱말·정규식 중에서 골라 주세요.' }).default('word'),
    category: z.enum(AD_RULE_CATEGORIES, { error: '분류를 목록에서 골라 주세요.' }).default('other'),
    severity: z.enum(AD_SEVERITIES, { error: '위험도는 위험·주의 중에서 골라 주세요.' }).default('medium'),
    reason: text(300, '이유'),
    suggestion: text(300, '바꿀 말'),
    active: z.boolean({ error: '사용 여부를 확인해 주세요.' }).default(true),
  })
  .superRefine((v, ctx) => {
    const bad = checkPattern(v.pattern, v.matchType);
    if (bad) ctx.addIssue({ code: 'custom', path: ['pattern'], message: bad });
  });

/** PUT /api/ad-rules 본문 */
export const putAdRulesSchema = z.object({
  rules: z.array(adRuleInputSchema, { error: '규칙 목록을 보내 주세요.' }).max(300, { error: '규칙은 300개까지 둘 수 있어요.' }),
});

/** POST /api/adcheck 본문 */
export const adcheckSchema = z.object({
  text: text(ADCHECK_MAX_TEXT, '점검할 글'),
  useAi: z.boolean({ error: 'AI 점검 여부를 확인해 주세요.' }).default(true),
});

// ---- 규칙 사전 ----

/** 모든 규칙(화면 순서) */
export function listAdRules(db: Db): AdRule[] {
  return db.all<AdRuleRow>(`SELECT ${COLS} FROM ad_rules ORDER BY sort, id`).map(toRule);
}

/** 켜진 규칙(점검용) */
export function activeRulesForCheck(db: Db): RuleForCheck[] {
  return db
    .all<AdRuleRow>(`SELECT ${COLS} FROM ad_rules WHERE active = 1 ORDER BY sort, id`)
    .map((r) => ({ id: r.id, pattern: r.pattern, matchType: r.match_type, category: r.category, severity: r.severity, reason: r.reason, suggestion: r.suggestion }));
}

/** 사전을 보낸 목록으로 바꾼다(admin). 바뀐 개수는 감사 로그에 남긴다 */
export function replaceAdRules(db: Db, clock: Clock, ctx: AuditContext, input: z.output<typeof putAdRulesSchema>): AdRule[] {
  const existing = new Map(db.all<AdRuleRow>(`SELECT ${COLS} FROM ad_rules`).map((r) => [r.id, r]));
  const fields: Record<string, string> = {};
  const seen = new Set<number>();
  input.rules.forEach((r, i) => {
    if (r.id === undefined) return;
    if (!existing.has(r.id)) fields[`rules.${i}.id`] = '없는 규칙이에요. 화면을 새로 고친 뒤 다시 시도해 주세요.';
    else if (seen.has(r.id)) fields[`rules.${i}.id`] = '같은 규칙이 두 번 들어 있어요.';
    seen.add(r.id);
  });
  const removed = [...existing.values()].filter((r) => !seen.has(r.id));
  const seedRemoved = removed.filter((r) => r.rule_key !== null);
  if (seedRemoved.length) fields.rules = `기본 규칙은 지울 수 없어요. 쓰지 않으려면 꺼 주세요(${seedRemoved.map((r) => r.pattern).slice(0, 3).join(', ')}).`;
  if (Object.keys(fields).length) throw new AppError('VALIDATION', { fields });

  const now = clock.now().toISOString();
  let added = 0;
  let updated = 0;
  db.tx(() => {
    for (const r of removed) db.run('DELETE FROM ad_rules WHERE id = ?', [r.id]);
    input.rules.forEach((r, i) => {
      if (r.id !== undefined) {
        const before = existing.get(r.id);
        const same =
          before &&
          before.pattern === r.pattern &&
          before.match_type === r.matchType &&
          before.category === r.category &&
          before.severity === r.severity &&
          before.reason === r.reason &&
          before.suggestion === r.suggestion &&
          (before.active === 1) === r.active &&
          before.sort === i;
        if (same) return;
        db.run('UPDATE ad_rules SET pattern = ?, match_type = ?, category = ?, severity = ?, reason = ?, suggestion = ?, active = ?, sort = ?, updated_at = ? WHERE id = ?', [
          r.pattern,
          r.matchType,
          r.category,
          r.severity,
          r.reason,
          r.suggestion,
          r.active ? 1 : 0,
          i,
          now,
          r.id,
        ]);
        updated += 1;
      } else {
        db.run(
          'INSERT INTO ad_rules (rule_key, pattern, match_type, category, severity, reason, suggestion, active, sort, created_at, updated_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [r.pattern, r.matchType, r.category, r.severity, r.reason, r.suggestion, r.active ? 1 : 0, i, now, now],
        );
        added += 1;
      }
    });
    audit(ctx, 'adrules.update', 'ad_rules', null, { added, updated, removed: removed.length, total: input.rules.length });
  });
  return listAdRules(db);
}

// ---- 점검 ----

/** AI 결과의 JSON을 확인해 꺼낸다(모양이 다르면 null) */
const aiReportSchema = z.object({
  issues: z.array(z.object({ phrase: z.string(), reason: z.string(), suggestion: z.string() })),
  overall: z.string(),
});

/** 1차 규칙 점검 + (원하면) 2차 AI 점검 */
export async function runAdcheck(ai: AiCallContext, input: z.output<typeof adcheckSchema>): Promise<AdcheckResponse> {
  const ruleHits = findRuleHits(input.text, activeRulesForCheck(ai.db));
  const out: AdcheckResponse = { text: input.text, ruleHits, notice: ADCHECK_NOTICE };
  if (!input.useAi) return out;
  try {
    const r = await runAi(ai, {
      feature: 'adcheck',
      input: { text: input.text, ruleHits: ruleHits.map((h) => ({ phrase: h.phrase, reason: h.reason, suggestion: h.suggestion })) },
    });
    const parsed = aiReportSchema.safeParse(r.extra);
    const report: AdAiReport | null = parsed.success ? parsed.data : null;
    out.ai = { demo: r.demo, report, requestId: r.requestId, privacyNotice: r.privacy.notice, costKrw: r.usage.costKrw };
  } catch (e) {
    // AI가 꺼졌거나(AI_DISABLED) 예산 초과·시간 초과여도 규칙 점검 결과는 그대로 보여 준다(FR-043 AC2 "점검 안내만")
    const { body } = toErrorResponse(e);
    out.aiError = { code: body.error.code, message: body.error.message };
  }
  return out;
}

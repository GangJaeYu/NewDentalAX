// 이 파일이 하는 일: 서버의 개인정보 필터. AI로 보낼 글과 AI가 돌려준 글(사진 인식 결과 포함)을 검사해서
// 가리거나 막는다(FR-032, TD-010). 규칙은 shared/privacy-rules.ts 하나만 쓰고, 여기서는 설정 읽기,
// 여러 글을 한꺼번에 검사하기, 객체 안의 글 검사하기, 사용량 기록용 요약을 더한다. 순수 함수만 있다.
// 쓰는 곳: ai/gateway(④ 보내기 전, ⑥ 응답 후 — phase-02-task-02), 원내 매뉴얼 올리기(3.5).
import { z } from 'zod';
import {
  DEFAULT_PRIVACY_POLICY,
  PII_ACTIONS,
  PII_TYPES,
  blockedMessage,
  redactedMessage,
  scanPrivacy,
  type PiiFinding,
  type PiiType,
  type PrivacyPolicy,
  type PrivacyResult,
  type PrivacySettings,
} from '../../shared/privacy-rules.ts';

export {
  DEFAULT_PRIVACY_POLICY,
  DEFAULT_PRIVACY_SETTINGS,
  PII_LABELS,
  PII_TYPES,
  blockedMessage,
  detectPii,
  piiMask,
  redactedMessage,
  scanPrivacy,
} from '../../shared/privacy-rules.ts';
export type { PiiFinding, PiiMatch, PiiType, PrivacyPolicy, PrivacyResult, PrivacySettings } from '../../shared/privacy-rules.ts';

/** settings 표의 키 이름(database.md §5) */
export const PRIVACY_SETTINGS_KEY = 'privacy';

/** 허용 목록 한도: 너무 많거나 긴 값은 저장할 때 거른다 */
export const ALLOWLIST_MAX = 50;
export const ALLOWLIST_ITEM_MAX = 100;

const actionSchema = z.enum(PII_ACTIONS).optional();

/** 관리자 설정(PUT /settings/privacy) 입력 검사용 스키마. 정책은 빠진 종류를 허용한다(기본 정책으로 채움) */
export const privacySettingsSchema = z.object({
  allowlist: z.array(z.string().trim().min(1).max(ALLOWLIST_ITEM_MAX)).max(ALLOWLIST_MAX).default([]),
  policy: z
    .object({
      rrn: actionSchema,
      phone: actionSchema,
      email: actionSchema,
      card: actionSchema,
      account: actionSchema,
      passport: actionSchema,
    })
    .default({}),
});

/**
 * settings.privacy에 저장된 값(JSON 문자열이나 객체)을 읽는다. 값이 없거나 깨졌으면 기본값을 쓴다.
 * 정책에서 빠진 종류는 기본 정책(주민·카드 차단, 나머지 가리기)으로 채운다.
 */
export function parsePrivacySettings(raw: unknown): PrivacySettings {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      value = undefined;
    }
  }
  const r = privacySettingsSchema.safeParse(value ?? {});
  if (!r.success) return { allowlist: [], policy: { ...DEFAULT_PRIVACY_POLICY } };
  const policy: PrivacyPolicy = { ...DEFAULT_PRIVACY_POLICY };
  for (const t of PII_TYPES) {
    const a = r.data.policy[t];
    if (a) policy[t] = a;
  }
  return { allowlist: [...new Set(r.data.allowlist)], policy };
}

/** 글 하나 검사(가리기·차단 판정). 설정이 없으면 기본 정책, 허용 목록 없음 */
export function filterText(text: string, settings?: Partial<PrivacySettings>): PrivacyResult {
  return scanPrivacy(text ?? '', { allowlist: settings?.allowlist, policy: settings?.policy });
}

/** 종류별 건수를 합친다(PII_TYPES 순서) */
export function mergeFindings(lists: readonly (readonly PiiFinding[])[]): PiiFinding[] {
  const total = new Map<PiiType, number>();
  for (const list of lists) for (const f of list) total.set(f.type, (total.get(f.type) ?? 0) + f.count);
  return PII_TYPES.filter((t) => (total.get(t) ?? 0) > 0).map((type) => ({ type, count: total.get(type) as number }));
}

export interface MultiPrivacyResult {
  redactedTexts: string[];
  findings: PiiFinding[];
  blocked: boolean;
  blockedTypes: PiiType[];
  redacted: boolean;
}

/** 여러 글(시스템 안내·사용자 입력 등 한 요청에 들어가는 모든 글)을 한꺼번에 검사한다 */
export function filterTexts(texts: readonly string[], settings?: Partial<PrivacySettings>): MultiPrivacyResult {
  const results = texts.map((t) => filterText(t, settings));
  const blockedTypes = PII_TYPES.filter((t) => results.some((r) => r.blockedTypes.includes(t)));
  return {
    redactedTexts: results.map((r) => r.redactedText),
    findings: mergeFindings(results.map((r) => r.findings)),
    blocked: blockedTypes.length > 0,
    blockedTypes,
    redacted: results.some((r) => r.redacted),
  };
}

export interface DeepPrivacyResult<T> {
  value: T;
  findings: PiiFinding[];
  blocked: boolean;
  blockedTypes: PiiType[];
  redacted: boolean;
}

/**
 * 객체·배열 안의 모든 글자 값을 검사해서 가린 복사본을 돌려준다(사진 인식 결과 JSON 등, FR-032 AC4).
 * 숫자·참거짓 값과 키 이름은 그대로 둔다. 원본 객체는 바꾸지 않는다.
 */
export function filterDeep<T>(value: T, settings?: Partial<PrivacySettings>): DeepPrivacyResult<T> {
  const all: PiiFinding[][] = [];
  const blockedSet = new Set<PiiType>();
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      const r = filterText(v, settings);
      all.push(r.findings);
      for (const t of r.blockedTypes) blockedSet.add(t);
      return r.redactedText;
    }
    if (depth > 20 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x, depth + 1);
    return out;
  };
  const out = walk(value, 0) as T;
  const findings = mergeFindings(all);
  const blockedTypes = PII_TYPES.filter((t) => blockedSet.has(t));
  return { value: out, findings, blocked: blockedTypes.length > 0, blockedTypes, redacted: findings.length > 0 };
}

/** ai_usage.privacy 열에 넣을 요약 {type: count}(database.md, 원문은 넣지 않는다) */
export function findingsSummary(findings: readonly PiiFinding[]): Partial<Record<PiiType, number>> {
  const out: Partial<Record<PiiType, number>> = {};
  for (const f of findings) out[f.type] = f.count;
  return out;
}

/** 결과를 사용자에게 보여 줄 한 줄 안내로 바꾼다. 차단이면 차단 문구, 가렸으면 가림 문구, 없으면 null */
export function privacyNotice(result: Pick<PrivacyResult, 'blocked' | 'blockedTypes' | 'findings'>): string | null {
  if (result.blocked) return blockedMessage(result.blockedTypes);
  return redactedMessage(result.findings);
}

// 이 파일이 하는 일: 의료광고 문구 점검(FR-120)과 광고 규칙 사전(ad_rules)의 화면·서버 공용 모양(타입)·이름표·고지 문구를 둔다(phase-04-task-06).
// POST /api/adcheck 응답, GET/PUT /api/ad-rules 본문이 이 모양을 따른다. 서버(server/modules/marketing)와 화면(web/src/components/AdCheckResult.tsx)이 함께 쓴다.

/** 규칙 분류 */
export const AD_RULE_CATEGORIES = ['superlative', 'guarantee', 'before_after', 'testimonial', 'discount', 'free', 'comparison', 'other'] as const;
export type AdRuleCategory = (typeof AD_RULE_CATEGORIES)[number];

/** 분류 이름(화면 표시용) */
export const AD_RULE_CATEGORY_LABELS: Record<AdRuleCategory, string> = {
  superlative: '최고·유일 표현',
  guarantee: '효과 보장',
  before_after: '치료 전후 비교',
  testimonial: '치료 경험담',
  discount: '할인 강조',
  free: '무료 강조',
  comparison: '비교 광고',
  other: '기타',
};

/** 찾는 방식: 낱말 그대로(word) 또는 정규식(regex) */
export const AD_MATCH_TYPES = ['word', 'regex'] as const;
export type AdMatchType = (typeof AD_MATCH_TYPES)[number];
export const AD_MATCH_TYPE_LABELS: Record<AdMatchType, string> = { word: '낱말', regex: '정규식' };

/** 위험도: high(쓰지 않기), medium(주의) */
export const AD_SEVERITIES = ['high', 'medium'] as const;
export type AdSeverity = (typeof AD_SEVERITIES)[number];
export const AD_SEVERITY_LABELS: Record<AdSeverity, string> = { high: '위험', medium: '주의' };

/** 규칙 하나(GET /api/ad-rules) */
export interface AdRule {
  id: number;
  /** 기본 규칙이면 고유 이름, admin이 추가한 규칙이면 null */
  ruleKey: string | null;
  pattern: string;
  matchType: AdMatchType;
  category: AdRuleCategory;
  severity: AdSeverity;
  reason: string;
  suggestion: string;
  active: boolean;
  updatedAt: string;
}

/** 규칙 점검에서 찾은 표현 하나. start·end는 원문 글자 위치(end는 포함하지 않음) */
export interface AdRuleHit {
  ruleId: number;
  start: number;
  end: number;
  phrase: string;
  category: AdRuleCategory;
  severity: AdSeverity;
  reason: string;
  suggestion: string;
}

/** AI 2차 점검 결과(adcheck 기능의 JSON) */
export interface AdAiIssue {
  phrase: string;
  reason: string;
  suggestion: string;
}
export interface AdAiReport {
  issues: AdAiIssue[];
  overall: string;
}

/** POST /api/adcheck 응답 */
export interface AdcheckResponse {
  /** 점검한 글(서버가 앞뒤 공백을 지운 값). start·end는 이 글 기준이다 */
  text: string;
  ruleHits: AdRuleHit[];
  /** AI 2차 점검(요청하지 않았거나 실패하면 없음) */
  ai?: {
    demo: boolean;
    report: AdAiReport | null;
    requestId: number;
    privacyNotice: string | null;
    costKrw: number;
  };
  /** AI 2차 점검을 못 했을 때의 이유(꺼짐·예산 초과 등). 규칙 점검 결과는 그대로 쓴다 */
  aiError?: { code: string; message: string };
  /** 법률 고지(FR-120 AC2) */
  notice: string;
}

/** 결과마다 붙이는 고지(FR-120 AC2, FR-038 AC1) */
export const ADCHECK_NOTICE = '이 결과는 법률 자문이 아니며, 의료광고 사전심의 대상 여부는 관련 기관에 확인하세요. AI 초안은 참고용이며 법률 자문을 대신하지 않습니다.';

/** 점검할 글의 최대 길이 */
export const ADCHECK_MAX_TEXT = 8000;

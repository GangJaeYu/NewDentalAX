// 이 파일이 하는 일: 채용 공고·면접 질문(FR-084, phase-04-task-07)의 화면·서버 공용 모양(타입)·이름표를 둔다.
// - 차별 소지 표현 점검(POST /api/hiring/check) 응답 모양과 분류 이름(나이·성별·결혼·출신 등)
// - 면접 질문 구분(직무·태도·상황)과 직무 추천 목록
// 서버(server/modules/marketing/hiring-rules.ts)와 화면(web/src/pages/hr/HiringPage.tsx)이 함께 쓴다.

/** 차별 소지 표현 분류 */
export const HIRING_RISK_CATEGORIES = ['age', 'gender', 'marriage', 'origin', 'body', 'religion', 'family', 'other'] as const;
export type HiringRiskCategory = (typeof HIRING_RISK_CATEGORIES)[number];

/** 분류 이름(화면 표시용) */
export const HIRING_RISK_LABELS: Record<HiringRiskCategory, string> = {
  age: '나이',
  gender: '성별',
  marriage: '결혼·임신·출산',
  origin: '출신 지역·학교',
  body: '외모·신체 조건',
  religion: '종교',
  family: '가족·재산',
  other: '기타',
};

/** 위험도: high(빼야 함), medium(다시 살펴볼 것) */
export type HiringRiskSeverity = 'high' | 'medium';
export const HIRING_SEVERITY_LABELS: Record<HiringRiskSeverity, string> = { high: '빼야 해요', medium: '살펴보세요' };

/** 찾은 표현 하나(글 안 위치 start~end) */
export interface HiringRiskHit {
  /** 규칙 이름(규칙 사전 안에서 하나뿐) */
  ruleKey: string;
  start: number;
  end: number;
  phrase: string;
  category: HiringRiskCategory;
  severity: HiringRiskSeverity;
  reason: string;
  suggestion: string;
}

/** POST /api/hiring/check 응답의 data */
export interface HiringCheckResponse {
  /** 점검한 글(앞뒤 공백 뗌) */
  text: string;
  hits: HiringRiskHit[];
}

/** 점검할 글 최대 길이(공고 본문까지 넣을 수 있게) */
export const HIRING_CHECK_MAX_TEXT = 10000;

/** 면접 질문 구분 */
export const QUESTION_TYPES = ['직무', '태도', '상황'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** 면접 질문 하나 */
export interface InterviewQuestion {
  type: QuestionType | '기타';
  text: string;
}

/** 직무 추천 목록(직접 적을 수도 있음) */
export const HIRING_JOB_TYPES = ['치과위생사', '간호조무사', '데스크·상담 코디네이터', '실장', '치과의사'] as const;

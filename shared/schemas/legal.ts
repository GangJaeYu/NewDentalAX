// 이 파일이 하는 일: 법정 의무 일정(FR-100, backend.md §3.8 /legal-tasks)의 API 응답 모양과 선택지·한국어 이름을 서버와 화면이 함께 쓰게 둔다.
// 확인 상태(확인됨/권장값/확인 필요), 적용 조건(항상/해당 시), 분류 이름, 법령 변경 고지 문구, 주기 설명을 만드는 순수 함수가 들어 있다.
// shared 폴더는 다른 폴더를 import하지 않는다.

/** 분류(database.md §8 CHECK와 같은 목록) */
export const LEGAL_CATEGORIES = ['radiation', 'waste', 'fire', 'privacy', 'infection', 'labor', 'report', 'license', 'other'] as const;
export type LegalCategory = (typeof LEGAL_CATEGORIES)[number];
export const LEGAL_CATEGORY_LABELS: Record<LegalCategory, string> = {
  radiation: '방사선',
  waste: '의료폐기물',
  fire: '소방',
  privacy: '개인정보',
  infection: '감염관리',
  labor: '노무·직원',
  report: '신고·보고',
  license: '면허·보수교육',
  other: '기타',
};

/** 확인 상태: 공식 출처로 주기를 확인함 / 법정 주기가 없어 권장값을 넣음 / 아직 확인하지 못함 */
export const LEGAL_VERIFY_STATUSES = ['verified', 'recommended', 'needs_check'] as const;
export type LegalVerifyStatus = (typeof LEGAL_VERIFY_STATUSES)[number];
export const LEGAL_VERIFY_LABELS: Record<LegalVerifyStatus, string> = { verified: '확인됨', recommended: '권장값', needs_check: '확인 필요' };
/** 확인 상태 칩에 마우스를 올리면 보일 설명 */
export const LEGAL_VERIFY_HINTS: Record<LegalVerifyStatus, string> = {
  verified: '법령 원문으로 주기를 확인했어요.',
  recommended: '법정 주기가 없어 권장값을 넣었어요.',
  needs_check: '공식 출처로 주기를 아직 확인하지 못했어요. 관할 기관에 확인해 주세요.',
};

/** 적용 조건: 모든 치과 / 조건에 맞는 치과만("해당 없음"으로 끌 수 있음) */
export const LEGAL_APPLICABILITIES = ['always', 'conditional'] as const;
export type LegalApplicability = (typeof LEGAL_APPLICABILITIES)[number];
export const LEGAL_APPLICABILITY_LABELS: Record<LegalApplicability, string> = { always: '항상', conditional: '해당 시' };

/** 법령을 마지막으로 확인한 날(TRD TD-022) */
export const LEGAL_CHECKED_ON = '2026-11-02';
/** 화면 고지 문구(TRD TD-022 고지, PRD FR-100 AC4) */
export const LEGAL_NOTICE = `법령은 바뀔 수 있습니다(확인일 ${LEGAL_CHECKED_ON}). 법정 주기는 법령 개정으로 바뀔 수 있으니 관할 기관 안내를 확인하세요.`;
/** 알림을 미리 보내는 기본 일수(settings.legal.warnDays) */
export const LEGAL_WARN_DAYS_DEFAULT = 30;

/**
 * 일정 상태
 * - off: "해당 없음"으로 끔 / no_cycle: 주기가 없는 안내 항목 / first_needed: 최초 수행일 입력 필요
 * - overdue: 기한 지남 / today: 오늘이 기한 / soon: 7일 안 / upcoming: 알림 일수(기본 30일) 안 / ok: 여유 있음
 */
export const LEGAL_DUE_STATES = ['off', 'no_cycle', 'first_needed', 'overdue', 'today', 'soon', 'upcoming', 'ok'] as const;
export type LegalDueState = (typeof LEGAL_DUE_STATES)[number];

/** 법정 일정 한 항목(GET /api/legal-tasks의 items 하나) */
export interface LegalTask {
  id: number;
  /** 기본 템플릿 항목이면 그 이름, 직접 추가한 항목이면 null */
  templateKey: string | null;
  title: string;
  category: LegalCategory;
  cycleMonths: number | null;
  cycleDays: number | null;
  /** 화면에 보일 주기 설명(저장된 설명이 없으면 숫자로 만든 것) */
  cycleText: string;
  basis: string;
  sourceUrl: string | null;
  verifyStatus: LegalVerifyStatus;
  applicability: LegalApplicability;
  appliesText: string | null;
  guidance: string | null;
  enabled: boolean;
  equipmentId: number | null;
  lastDoneOn: string | null;
  note: string | null;
  checkedOn: string | null;
  /** 다음 예정일(주기·최근 수행일이 없거나 꺼져 있으면 null) */
  nextDueOn: string | null;
  /** 다음 예정일까지 남은 날(오늘 0, 지나면 음수) */
  daysLeft: number | null;
  dueState: LegalDueState;
  updatedAt: string;
}

/** GET /api/legal-tasks 응답의 data */
export interface LegalTaskList {
  /** 서버 기준 오늘(한국 날짜) */
  today: string;
  /** 알림을 미리 보내는 일수 */
  warnDays: number;
  items: LegalTask[];
}

/** 수행 이력 한 건(GET /api/legal-tasks/:id/logs) */
export interface LegalTaskLog {
  id: number;
  doneOn: string;
  note: string | null;
  fileId: number | null;
  user: { id: number; name: string } | null;
  createdAt: string;
}

/** 주기 숫자를 글로: (36, null) → '3년마다', (3, null) → '3개월마다', (null, 7) → '7일마다', 둘 다 없으면 '주기 없음' */
export function cycleLabel(months: number | null | undefined, days: number | null | undefined): string {
  const parts: string[] = [];
  if (months) parts.push(months % 12 === 0 ? `${months / 12}년` : `${months}개월`);
  if (days) parts.push(days % 7 === 0 ? `${days / 7}주` : `${days}일`);
  if (parts.length === 0) return '주기 없음';
  const text = parts.join(' ');
  return text === '1년' ? '1년마다' : `${text}마다`;
}

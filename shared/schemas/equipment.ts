// 이 파일이 하는 일: 장비 점검·유지보수(FR-101)와 멸균기 점검 기록(FR-102)의 API 응답 모양, 선택지와 한국어 이름을 서버와 화면이 함께 쓰게 둔다.
// 장비 종류·이력 종류·멸균 검사 종류·판정 이름, 다음 점검 상태, 멸균 기록 입력 칸 목록(환자 관련 칸이 없음을 검사에 씀)이 들어 있다.
// backend.md §3.8 /equipment, /sterilizer-logs. shared 폴더는 다른 폴더를 import하지 않는다.

/** 장비 종류(database.md §8 CHECK와 같은 목록) */
export const EQUIPMENT_KINDS = ['xray', 'sterilizer', 'unit_chair', 'compressor', 'suction', 'other'] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];
export const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  xray: '방사선 촬영장치',
  sterilizer: '멸균기',
  unit_chair: '유닛체어',
  compressor: '컴프레서',
  suction: '석션',
  other: '기타',
};

/** 이력 종류: 정기 점검 / 수리 */
export const EQUIPMENT_LOG_KINDS = ['inspection', 'repair'] as const;
export type EquipmentLogKind = (typeof EQUIPMENT_LOG_KINDS)[number];
export const EQUIPMENT_LOG_KIND_LABELS: Record<EquipmentLogKind, string> = { inspection: '점검', repair: '수리' };

/** 다음 점검일을 미리 알리는 일수(이 안에 들면 대시보드·알림에 D-day로 보인다) */
export const EQUIPMENT_WARN_DAYS = 30;

/**
 * 다음 점검 상태
 * - off: 사용 중지한 장비 / no_cycle: 점검 주기 없음 / first_needed: 점검 기록·설치일이 없어 계산 불가
 * - overdue: 지남 / today: 오늘 / soon: 7일 안 / upcoming: 30일 안 / ok: 여유
 */
export type EquipmentDueState = 'off' | 'no_cycle' | 'first_needed' | 'overdue' | 'today' | 'soon' | 'upcoming' | 'ok';

/** 장비에 연결된 법정 일정(예: 방사선 장비 정기검사) 요약 */
export interface EquipmentLegalLink {
  id: number;
  title: string;
  nextDueOn: string | null;
  lastDoneOn: string | null;
}

/** 장비 한 대(GET /api/equipment 목록 항목) */
export interface Equipment {
  id: number;
  name: string;
  kind: EquipmentKind;
  installedOn: string | null;
  vendorName: string | null;
  inspectCycleMonths: number | null;
  memo: string | null;
  active: boolean;
  /** 가장 최근 점검일(점검 이력 중 가장 늦은 날) */
  lastInspectionOn: string | null;
  /** 가장 최근 수리일 */
  lastRepairOn: string | null;
  /** 다음 점검일 계산 기준: 마지막 점검일 / 점검 기록이 없으면 설치일 / 계산 불가 */
  dueBase: 'inspection' | 'installed' | null;
  nextInspectionOn: string | null;
  /** 다음 점검일까지 남은 날(지났으면 음수) */
  daysLeft: number | null;
  dueState: EquipmentDueState;
  /** 이력 수(점검 + 수리) */
  logCount: number;
  /** 수리비 합계(원) */
  repairCostTotal: number;
  updatedAt: string;
}

/** GET /api/equipment 응답의 data */
export interface EquipmentList {
  today: string;
  warnDays: number;
  items: Equipment[];
}

/** 점검·수리 이력 한 줄 */
export interface EquipmentLog {
  id: number;
  equipmentId: number;
  date: string;
  kind: EquipmentLogKind;
  content: string;
  cost: number | null;
  vendorName: string | null;
  file: { id: number; name: string } | null;
  user: { id: number; name: string } | null;
  createdAt: string;
}

/** GET /api/equipment/:id 응답의 data(장비 대장 인쇄에도 쓴다) */
export interface EquipmentDetail {
  today: string;
  equipment: Equipment;
  logs: EquipmentLog[];
  /** 이 장비에 연결된 법정 일정(없으면 빈 목록) */
  legalTasks: EquipmentLegalLink[];
}

// ---- 멸균기 기록 ----

/** 멸균 검사 종류(database.md §8 CHECK와 같은 목록) */
export const STERILIZER_TEST_TYPES = ['bd', 'bi', 'ci', 'cycle'] as const;
export type SterilizerTestType = (typeof STERILIZER_TEST_TYPES)[number];
export const STERILIZER_TEST_LABELS: Record<SterilizerTestType, string> = {
  bd: 'B&D 테스트',
  bi: 'BI(생물학적 지표)',
  ci: 'CI(화학적 지표)',
  cycle: '사이클 기록',
};
/** 검사 종류 설명(입력 칸 도움말) */
export const STERILIZER_TEST_HINTS: Record<SterilizerTestType, string> = {
  bd: '진공형 멸균기의 공기 제거 확인. 보통 매일 첫 사이클 전에 해요.',
  bi: '포자 검사. 보통 주 1회 이상, 배양 결과를 판정해요.',
  ci: '포장 안·밖 지시계 색 변화 확인.',
  cycle: '사이클마다 온도·압력·시간 기록.',
};

/** 판정 */
export const STERILIZER_RESULTS = ['pass', 'fail'] as const;
export type SterilizerResult = (typeof STERILIZER_RESULTS)[number];
export const STERILIZER_RESULT_LABELS: Record<SterilizerResult, string> = { pass: '합격', fail: '불합격' };

/**
 * 멸균 기록 입력 칸(POST /api/sterilizer-logs 본문 이름) 전부. 화면 입력 양식도 이 칸만 쓴다.
 * 환자 관련 칸(환자 이름·차트 번호 등)은 두지 않는다(FR-102 AC1). 담당자는 로그인한 사람으로 자동 기록한다.
 */
export const STERILIZER_INPUT_FIELDS = ['equipmentId', 'date', 'testType', 'cycleNo', 'tempC', 'pressureKpa', 'minutes', 'result', 'actionTaken'] as const;
export type SterilizerInputField = (typeof STERILIZER_INPUT_FIELDS)[number];

/** 멸균 기록 한 줄 */
export interface SterilizerLog {
  id: number;
  equipmentId: number;
  equipmentName: string;
  date: string;
  testType: SterilizerTestType;
  cycleNo: string | null;
  tempC: number | null;
  pressureKpa: number | null;
  minutes: number | null;
  result: SterilizerResult;
  actionTaken: string | null;
  /** 조치 기록 시각(ISO). 불합격인데 null이면 조치 전(경고 대상) */
  actionAt: string | null;
  actionUser: { id: number; name: string } | null;
  /** 담당자(기록한 사람) */
  user: { id: number; name: string } | null;
  createdAt: string;
}

/** 멸균기 고르기 목록 항목 */
export interface SterilizerOption {
  id: number;
  name: string;
  active: boolean;
}

/** GET /api/sterilizer-logs 응답의 data */
export interface SterilizerLogList {
  today: string;
  from: string;
  to: string;
  equipmentId: number | null;
  items: SterilizerLog[];
  /** 기간과 관계없이 조치 전인 불합격 기록(오래된 것부터) */
  openFailures: SterilizerLog[];
  sterilizers: SterilizerOption[];
}

/** 멸균 기록 기본 조회 기간(오늘 포함 지난 30일) */
export const STERILIZER_DEFAULT_DAYS = 30;
/** 한 번에 볼 수 있는 가장 긴 기간(일) */
export const STERILIZER_MAX_RANGE_DAYS = 366;

/** 온도·압력·시간을 한 줄 글로("134℃ · 216kPa · 4분"). 없으면 "—" */
export function cycleParamsText(l: Pick<SterilizerLog, 'tempC' | 'pressureKpa' | 'minutes'>): string {
  const parts: string[] = [];
  if (l.tempC !== null) parts.push(`${l.tempC}℃`);
  if (l.pressureKpa !== null) parts.push(`${l.pressureKpa}kPa`);
  if (l.minutes !== null) parts.push(`${l.minutes}분`);
  return parts.length ? parts.join(' · ') : '—';
}

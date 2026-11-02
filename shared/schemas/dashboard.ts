// 이 파일이 하는 일: 대시보드 API(GET /api/dashboard, backend.md §3.3, FR-008)의 응답 모양을 서버와 화면이 함께 쓰도록 정한다.
// 역할에 따라 빠지는 영역(approvals·orders·expenseMonth)은 staff에게 null로 온다(FR-008 AC4). 아직 기능이 없는 영역(근무표·지출·멸균)은
// 빈 값과 ready:false로 오고, 담당 태스크(phase-04-task-01·03·04)가 끝나면 서버 service에서 채운다.
import type { ChecklistKind } from './desk.ts';
import type { MoveType, StockStatus } from './inventory.ts';
import type { LegalVerifyStatus } from './legal.ts';
import type { LeaveType } from './leave.ts';
import type { OrderStatus } from './orders.ts';

/** 오늘 근무하는 사람 한 명(근무표 phase-04-task-01 todayRoster) */
export interface DashWorker {
  userId: number;
  name: string;
  jobType: string;
  shift: string;
}

/** 오늘 휴가인 사람 한 명(승인된 휴가) */
export interface DashOnLeave {
  userId: number;
  name: string;
  type: LeaveType;
}

/** 체크리스트 한 항목(오늘) */
export interface DashCheckItem {
  id: number;
  kind: ChecklistKind;
  text: string;
  checked: boolean;
}

/** 처리 전 인수인계 한 건 */
export interface DashHandover {
  id: number;
  title: string;
  author: string;
  createdAt: string;
}

/** 승인 대기 휴가 한 건(실장 이상만) */
export interface DashApproval {
  id: number;
  name: string;
  type: LeaveType;
  startOn: string;
  endOn: string;
  days: number;
}

/** 재고 경고 품목 한 개 */
export interface DashStockAlert {
  id: number;
  name: string;
  unit: string;
  stock: number;
  par: number;
  status: StockStatus;
  nearestExpiry: string | null;
  dday: number | null;
}

/** 다가오는 점검·법정 의무 한 건(법정 일정 phase-03-task-08 + 장비 점검 phase-04-task-03, 남은 날 순) */
export interface DashDue {
  /** 화면 key('legal:3', 'equipment:2') */
  key: string;
  source: 'legal' | 'equipment';
  id: number;
  title: string;
  /** 분류·주기 설명(예: '의료폐기물 · 주 1회', '장비 점검 · 멸균기 · 12개월마다') */
  detail: string;
  nextDueOn: string | null;
  daysLeft: number | null;
  /** 법정 일정의 확인 상태(장비는 null) */
  verifyStatus: LegalVerifyStatus | null;
  /** 누르면 갈 화면 */
  link: string;
}

/** 조치 전 멸균 불합격 기록 한 건(FR-102 AC2: 조치를 기록할 때까지 대시보드에 보인다) */
export interface DashSterilizerAlert {
  id: number;
  equipmentName: string;
  date: string;
  testType: string;
  link: string;
}

/** 공지 한 건(고정 먼저, 그다음 최근) */
export interface DashNotice {
  id: number;
  title: string;
  preview: string;
  pinned: boolean;
  author: string;
  createdAt: string;
  readCount: number;
  totalUsers: number;
  readByMe: boolean;
}

/** 진행 중이거나 최근 끝난 발주서 한 건(실장 이상만) */
export interface DashOrder {
  id: number;
  poNo: string;
  status: OrderStatus;
  vendor: string | null;
  lineCount: number;
  total: number;
  createdAt: string;
  orderedAt: string | null;
  receivedAt: string | null;
}

/** 이번 주 일정 한 건 */
export interface DashWeekEvent {
  date: string;
  kind: 'leave' | 'legal' | 'equipment' | 'roster' | 'training';
  title: string;
  /** 누르면 갈 화면 */
  link: string;
  /** 급함 표시(기한 지남·오늘) */
  tone: 'danger' | 'warn' | null;
}

/** 최근 입출고 한 건 */
export interface DashMove {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  type: MoveType;
  qty: number;
  unitPrice: number | null;
  movedAt: string;
  userName: string | null;
}

/** 대시보드 전체 응답(data) */
export interface DashboardData {
  /** 서버 기준 지금 시각(ISO). 인사말·날짜를 브라우저 시계가 아니라 서버 시계로 맞춘다 */
  now: string;
  today: {
    /** 한국 날짜 YYYY-MM-DD */
    date: string;
    /** 근무표에 오늘 근무가 정해져 있으면 true(phase-04-task-01 todayRoster) */
    rosterReady: boolean;
    working: DashWorker[];
    onLeave: DashOnLeave[];
  };
  kpis: {
    /** 오늘 근무 인원(오늘 근무표가 비어 있으면 null) */
    working: number | null;
    checklistOpen: { done: number; total: number };
    stock: { total: number; low: number; expiring: number; soonLow: number; expired: number };
    due: { total: number; overdue: number; today: number; needCheck: number; /** 조치 전 멸균 불합격 */ sterilizerFail: number };
    /** 승인 대기 휴가 수(실장 이상), staff는 null */
    approvals: number | null;
    /** 내가 신청하고 기다리는 휴가 수(staff 칸에 쓴다) */
    myPendingLeave: number;
  };
  checklist: {
    open: { done: number; total: number };
    close: { done: number; total: number };
    /** 오늘 쓰는 항목 전체(원래 순서, 오픈 먼저). 화면은 처음 안 한 항목 근처만 보여 준다 */
    items: DashCheckItem[];
  };
  handovers: { total: number; items: DashHandover[] };
  /** 실장 이상만. staff는 null */
  approvals: { total: number; items: DashApproval[] } | null;
  stockAlerts: { total: number; items: DashStockAlert[]; /** 발주서 초안으로 만들 수 있는 부족 품목 수(부족·곧 부족) */ orderable: number };
  dueSoon: { total: number; items: DashDue[] };
  /** 조치 전 멸균 불합격(오래된 것부터) */
  sterilizerAlerts: { total: number; items: DashSterilizerAlert[] };
  notices: { total: number; items: DashNotice[] };
  /** 실장 이상만. staff는 null */
  orders: { open: number; items: DashOrder[] } | null;
  week: { start: string; end: string; events: DashWeekEvent[] };
  recentMoves: DashMove[];
  /** 원장·실장만(finance.monthly). 지출 기록(phase-04-task-04) 전에는 ready:false. staff는 null */
  expenseMonth: { ready: boolean; total: number; trend6: Array<{ month: string; total: number }> } | null;
  ai: {
    /** 데모 모드(키 없음) 여부 */
    demo: boolean;
    month: string;
    /** 예산 대비 % */
    pct: number;
    /** 금액은 AI 사용량을 볼 수 있는 사람(ai.usage)에게만 */
    monthKrw: number | null;
    budgetKrw: number | null;
    /** 빠른 요청을 쓸 수 있는지(관리자가 끄거나 역할에서 뺐으면 false) */
    quickAllowed: boolean;
  };
}

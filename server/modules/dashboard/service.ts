// 이 파일이 하는 일: 대시보드(GET /api/dashboard, backend.md §3.3, FR-008)에 보일 내용을 한 번에 모은다.
// 각 모듈이 내보낸 함수(재고 listItems·listMoves, 발주 listOrders, 게시판 listPosts, 체크리스트 getChecklistDay,
// 법정 일정 listLegalDue, 휴가 pendingLeaveCount·listLeave·approvedLeaveDays, AI 예산 budgetStatus)를 부르고,
// 역할에 따라 보이면 안 되는 영역(승인 대기·발주·지출)은 staff에게 null로 준다(FR-008 AC4).
// 오늘 근무는 근무표(phase-04-task-01)의 todayRoster로 채운다. 아직 없는 기능은 연결 지점만 남긴다: 교육(04-02) → week 'training',
// 지출(04-04) → expenseMonth. 장비 점검(listEquipmentDue)·멸균 불합격(listOpenSterilizerFailures)은 phase-04-task-03 것을 부른다. 해당 태스크가 이 파일의 표시된 곳을 채운다.
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { addDays, todayKst, weekday } from '../../lib/dates.ts';
import { can, type Role } from '../../../shared/roles.ts';
import type { DashboardData, DashDue, DashWeekEvent } from '../../../shared/schemas/dashboard.ts';
import { LEAVE_TYPE_LABELS } from '../../../shared/schemas/leave.ts';
import { listItems, listMoves } from '../inventory/service.ts';
import { listOrders } from '../inventory/orders.service.ts';
import { listPosts } from '../desk/posts.ts';
import { getChecklistDay } from '../desk/checklists.ts';
import { listLegalDue } from '../facility/legal.ts';
import { listEquipmentDue } from '../facility/equipment.ts';
import { listOpenSterilizerFailures } from '../facility/sterilizer.ts';
import { LEGAL_CATEGORY_LABELS } from '../../../shared/schemas/legal.ts';
import { EQUIPMENT_KIND_LABELS, STERILIZER_TEST_LABELS } from '../../../shared/schemas/equipment.ts';
import { approvedLeaveDays, listLeave, pendingLeaveCount } from '../hr/leave.ts';
import { todayRoster } from '../hr/roster.ts';
import { budgetStatus } from '../../ai/budget.ts';
import { effectiveProvider, featureSettings, readAiSettings } from '../../ai/settings.ts';

/** 대시보드를 보는 사람 */
export interface DashViewer {
  id: number;
  name: string;
  role: Role;
}

/** 카드마다 보여 줄 최대 줄 수(첫 화면에 카드 4개가 보이도록 짧게 둔다, DESIGN §5-6) */
export const CARD_ROWS = 5;

/** 이번 주(월~일)의 첫날과 끝날 */
export function weekRange(today: string): { start: string; end: string } {
  const back = (weekday(today) + 6) % 7; // 월요일이면 0, 일요일이면 6
  const start = addDays(today, -back);
  return { start, end: addDays(start, 6) };
}

/** 사용자 번호 → 이름 */
function userNames(db: Db): Map<number, string> {
  return new Map(db.all<{ id: number; name: string }>('SELECT id, name FROM users').map((u) => [u.id, u.name]));
}

/** 오늘 할 일: 오픈·마감 체크리스트 오늘 항목 전체(원래 순서, 오픈 먼저). 화면이 "처음 안 한 항목" 근처만 골라 보여 준다 */
function checklistPart(db: Db, clock: Clock): DashboardData['checklist'] {
  const open = getChecklistDay(db, clock, 'open');
  const close = getChecklistDay(db, clock, 'close');
  const items = [
    ...open.items.filter((i) => i.active).map((i) => ({ id: i.id, kind: 'open' as const, text: i.text, checked: i.checked })),
    ...close.items.filter((i) => i.active).map((i) => ({ id: i.id, kind: 'close' as const, text: i.text, checked: i.checked })),
  ];
  return { open: { done: open.done, total: open.total }, close: { done: close.done, total: close.total }, items };
}

/** 다가오는 점검·의무: 법정 일정과 장비 점검을 합쳐 남은 날 순으로 */
function duePart(db: Db, clock: Clock): DashDue[] {
  const legal: DashDue[] = listLegalDue(db, clock).map((t) => ({
    key: `legal:${t.id}`,
    source: 'legal',
    id: t.id,
    title: t.title,
    detail: `${LEGAL_CATEGORY_LABELS[t.category]} · ${t.cycleText}`,
    nextDueOn: t.nextDueOn,
    daysLeft: t.daysLeft,
    verifyStatus: t.verifyStatus,
    link: '/facility/legal?view=due',
  }));
  const equipment: DashDue[] = listEquipmentDue(db, clock).map((e) => ({
    key: `equipment:${e.id}`,
    source: 'equipment',
    id: e.id,
    title: `${e.name} 정기 점검`,
    detail: `장비 점검 · ${EQUIPMENT_KIND_LABELS[e.kind]}${e.inspectCycleMonths ? ` · ${e.inspectCycleMonths}개월마다` : ''}`,
    nextDueOn: e.nextInspectionOn,
    daysLeft: e.daysLeft,
    verifyStatus: null,
    link: `/facility/equipment?open=${e.id}`,
  }));
  return [...legal, ...equipment].sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.key.localeCompare(b.key));
}

/** 이번 주 일정: 승인된 휴가·법정 일정(근무·교육은 해당 태스크가 더한다) */
function weekPart(db: Db, today: string, names: Map<number, string>, due: DashDue[]): DashboardData['week'] {
  const { start, end } = weekRange(today);
  const events: DashWeekEvent[] = [];
  for (const d of approvedLeaveDays(db, start, end)) {
    events.push({ date: d.date, kind: 'leave', title: `${names.get(d.userId) ?? '직원'} ${LEAVE_TYPE_LABELS[d.type]}`, link: '/hr/leave', tone: null });
  }
  for (const t of due) {
    if (!t.nextDueOn || t.daysLeft === null) continue;
    // 기한이 지난 일은 오늘 칸에 "기한 지남"으로 올린다
    if (t.daysLeft < 0) events.push({ date: today, kind: t.source, title: `${t.title}(기한 지남)`, link: t.link, tone: 'danger' });
    else if (t.nextDueOn <= end) events.push({ date: t.nextDueOn, kind: t.source, title: t.title, link: t.link, tone: t.daysLeft === 0 ? 'danger' : 'warn' });
  }
  // [연결 지점] phase-04-task-01 근무표(휴진·특별 근무), phase-04-task-02 교육 일정을 여기에 더한다(kind 'roster'·'training')
  events.sort((a, b) => a.date.localeCompare(b.date));
  return { start, end, events };
}

/** AI 사용: 데모 여부·예산 대비 %·빠른 요청 사용 가능 여부(금액은 ai.usage 권한자만) */
function aiPart(db: Db, clock: Clock, dataDir: string, role: Role): DashboardData['ai'] {
  const s = readAiSettings(db);
  const b = budgetStatus(db, clock, s);
  const quick = featureSettings(s, 'quick');
  const money = can(role, 'ai.usage');
  return {
    demo: effectiveProvider(dataDir, s) === 'demo',
    month: b.month,
    pct: b.pct,
    monthKrw: money ? Math.round(b.monthKrw) : null,
    budgetKrw: money ? b.budgetKrw : null,
    quickAllowed: quick.enabled && quick.roles.includes(role) && quick.defaultRoles.includes(role),
  };
}

/**
 * 대시보드 전체 내용을 만든다. 모든 영역은 비어 있어도 빈 배열·0으로 오므로 화면은 늘 빈 상태 안내를 그릴 수 있다(FR-008 AC2).
 * dataDir은 AI 키가 있는지(데모 모드 여부) 보는 데 쓴다.
 */
export function getDashboard(db: Db, clock: Clock, dataDir: string, viewer: DashViewer): DashboardData {
  const today = todayKst(clock);
  const names = userNames(db);
  const manager = can(viewer.role, 'leave.approve');

  // 재고 경고(만료→부족→임박→곧 부족 순)
  const stock = listItems(db, clock, { status: 'warning', sort: 'status', pageSize: CARD_ROWS });
  const c = stock.counts;

  // 점검·법정 일정(30일 안·기한 지남)과 조치 전 멸균 불합격
  const due = duePart(db, clock);
  const sterFails = listOpenSterilizerFailures(db);

  // 휴가
  const onLeave = approvedLeaveDays(db, today, today).map((d) => ({ userId: d.userId, name: names.get(d.userId) ?? '직원', type: d.type }));
  const approvalsTotal = manager ? pendingLeaveCount(db) : null;
  const myPendingLeave = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM leave_requests WHERE user_id = ? AND status = 'pending'", [viewer.id])?.n ?? 0;

  const roster = todayRoster(db, today);
  const checklist = checklistPart(db, clock);
  const handovers = listPosts(db, viewer.id, { unresolved: true, page: 1, pageSize: CARD_ROWS });
  const notices = listPosts(db, viewer.id, { kind: 'notice', page: 1, pageSize: 3 });

  const ordersOk = can(viewer.role, 'orders.manage');
  const orders = ordersOk ? listOrders(db, { status: 'all', pageSize: CARD_ROWS }) : null;

  return {
    now: clock.now().toISOString(),
    today: {
      date: today,
      // 근무표에 오늘 근무 유형이 하나라도 정해져 있으면 rosterReady
      rosterReady: roster.items.length > 0,
      working: roster.items
        .filter((w) => w.working)
        .map((w) => ({ userId: w.userId, name: w.name, jobType: w.jobType, shift: w.shift?.label ?? w.leave?.label ?? '' })),
      onLeave,
    },
    kpis: {
      working: roster.items.length > 0 ? roster.working : null,
      checklistOpen: checklist.open,
      stock: { total: c.warning, low: c.low, expiring: c.expiring, soonLow: c.soon_low, expired: c.expired },
      due: {
        total: due.length,
        overdue: due.filter((t) => (t.daysLeft ?? 0) < 0).length,
        today: due.filter((t) => t.daysLeft === 0).length,
        needCheck: due.filter((t) => t.verifyStatus === 'needs_check').length,
        sterilizerFail: sterFails.length,
      },
      approvals: approvalsTotal,
      myPendingLeave,
    },
    checklist,
    handovers: {
      total: handovers.total,
      items: handovers.data.map((p) => ({ id: p.id, title: p.title, author: p.author.name, createdAt: p.createdAt })),
    },
    approvals: manager
      ? {
          total: approvalsTotal ?? 0,
          items: listLeave(db, viewer, { status: 'pending' })
            .slice(0, 3)
            .map((l) => ({ id: l.id, name: l.user.name, type: l.type, startOn: l.startOn, endOn: l.endOn, days: l.days })),
        }
      : null,
    stockAlerts: {
      total: c.warning,
      orderable: c.low + c.soon_low,
      items: stock.data.map((i) => ({ id: i.id, name: i.name, unit: i.unit, stock: i.stock, par: i.par, status: i.status, nearestExpiry: i.nearestExpiry, dday: i.dday })),
    },
    dueSoon: { total: due.length, items: due.slice(0, CARD_ROWS) },
    sterilizerAlerts: {
      total: sterFails.length,
      items: sterFails.slice(0, 2).map((f) => ({
        id: f.id,
        equipmentName: f.equipmentName,
        date: f.date,
        testType: STERILIZER_TEST_LABELS[f.testType],
        link: `/facility/sterilizer?from=${f.date}&to=${f.date}&focus=${f.id}`,
      })),
    },
    notices: {
      total: notices.total,
      items: notices.data.map((p) => ({
        id: p.id,
        title: p.title,
        preview: p.preview,
        pinned: p.pinned,
        author: p.author.name,
        createdAt: p.createdAt,
        readCount: p.readCount,
        totalUsers: p.totalUsers,
        readByMe: p.readByMe,
      })),
    },
    orders: orders
      ? {
          open: orders.counts.draft + orders.counts.ordered,
          items: orders.data.map((o) => ({
            id: o.id,
            poNo: o.poNo,
            status: o.status,
            vendor: o.vendor,
            lineCount: o.lineCount,
            total: o.total,
            createdAt: o.createdAt,
            orderedAt: o.orderedAt,
            receivedAt: o.receivedAt,
          })),
        }
      : null,
    week: weekPart(db, today, names, due),
    recentMoves: listMoves(db, { pageSize: 4 }).data.map((m) => ({
      id: m.id,
      itemId: m.itemId,
      itemName: m.itemName,
      unit: m.unit,
      type: m.type,
      qty: m.qty,
      unitPrice: m.unitPrice,
      movedAt: m.movedAt,
      userName: m.userName,
    })),
    // [연결 지점] phase-04-task-04: 지출 기록이 생기면 이번 달 합계·6개월 추이를 채우고 ready를 true로 바꾼다
    expenseMonth: can(viewer.role, 'finance.monthly') ? { ready: false, total: 0, trend6: [] } : null,
    ai: aiPart(db, clock, dataDir, viewer.role),
  };
}

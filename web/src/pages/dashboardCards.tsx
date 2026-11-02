// 이 파일이 하는 일: 대시보드 카드 10개(DESIGN §4 순서)의 본문을 그린다. 모든 카드는 불러오는 중(뼈대)·오류(다시 시도)·빈 상태(안내 + 바로가기)를 갖는다(FR-008 AC2).
// 각 줄을 누르면 해당 화면·항목으로 간다(FR-008 AC3): 재고 품목 상세, 공지·인수인계 상세, 발주서 상세, 법정 일정, 연차·휴가 화면 등.
// 체크리스트 줄은 대시보드에서 바로 체크한다(NFR-009). "오늘 근무" 카드 본문은 근무표 태스크(phase-04-task-01)의 RosterTodayCard를 쓴다.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { can, type Role } from '../../../shared/roles.ts';
import type { DashboardData } from '../../../shared/schemas/dashboard.ts';
import { LEGAL_CATEGORY_LABELS, LEGAL_VERIFY_HINTS, LEGAL_VERIFY_LABELS } from '../../../shared/schemas/legal.ts';
import { ORDER_STATUS_LABELS } from '../../../shared/schemas/orders.ts';
import type { OrderStatus } from '../../../shared/schemas/orders.ts';
import { AiPanel } from '../components/AiPanel.tsx';
import { Button } from '../components/Button.tsx';
import { Card } from '../components/Card.tsx';
import { Chip, Progress, type Tone } from '../components/Chip.tsx';
import { EmptyState, ErrorState, Skeleton } from '../components/States.tsx';
import type { IconName } from '../components/Icon.tsx';
import { useToast } from '../components/Toast.tsx';
import { api } from '../lib/api.ts';
import { formatDateShort, formatDateTime } from '../lib/format.ts';
import { invalidate } from '../lib/useApi.ts';
import { RosterTodayCard } from './hr/RosterTodayCard.tsx';
import { checklistWindow, dueLabel, leaveTitle, moveLine, shortDay, stockLine, weekCells, won } from './dashboardLib.ts';

/** 대시보드 응답 상태(useApi 결과) */
export interface DashState {
  data: DashboardData | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

interface SlotProps {
  state: DashState;
  role: Role;
}

/** 카드 본문: 불러오는 중이면 뼈대, 오류면 이유와 다시 시도, 비었으면 빈 상태, 아니면 내용 */
function Body({
  state,
  rows = 4,
  isEmpty,
  empty,
  children,
}: {
  state: DashState;
  rows?: number;
  isEmpty: (d: DashboardData) => boolean;
  empty: ReactNode;
  children: (d: DashboardData) => ReactNode;
}) {
  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  if (!state.data) return <Skeleton rows={rows} label="불러오는 중" />;
  if (isEmpty(state.data)) return <>{empty}</>;
  return <>{children(state.data)}</>;
}

/** 빈 상태: 안내 문구와 바로가기 버튼 */
function Empty({ icon, title, hint, to, label }: { icon: IconName; title: string; hint: string; to: string; label: string }) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={hint}
      action={
        <Button size="sm" to={to}>
          {label}
        </Button>
      }
    />
  );
}

/** 누르면 이동하는 목록 줄 */
function RowLink({ to, children, label }: { to: string; children: ReactNode; label?: string }) {
  return (
    <li>
      <Link className="dash-row" to={to} aria-label={label}>
        {children}
      </Link>
    </li>
  );
}

/** 1. 오늘 할 일: 체크리스트(바로 체크)·처리 전 인수인계·승인 대기(실장 이상) */
export function TodoCard({ state }: SlotProps) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const d = state.data;
  const done = d ? d.checklist.open.done + d.checklist.close.done : 0;
  const total = d ? d.checklist.open.total + d.checklist.close.total : 0;

  const toggle = async (itemId: number, checked: boolean) => {
    setBusy(itemId);
    try {
      await api.post('/api/checklists/check', { itemId, checked });
      invalidate('dashboard');
      invalidate('desk:checklist');
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : '체크를 저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card id="dash-todo" title="오늘 할 일" sub={d && total ? `${done} / ${total}` : undefined} action={{ label: '전체', to: '/desk/checklist' }}>
      <Body
        state={state}
        rows={5}
        isEmpty={(x) => x.checklist.items.length === 0 && x.handovers.items.length === 0 && (x.approvals?.items.length ?? 0) === 0}
        empty={
          <Empty icon="check" title="오늘 할 일이 아직 없어요" hint="오픈·마감 체크리스트를 만들면 여기에서 바로 체크할 수 있어요." to="/desk/checklist" label="체크리스트 열기" />
        }
      >
        {(x) => {
          // 첫 화면에 카드 4개가 들어오도록 5줄까지만: 인수인계 2·승인 대기 1, 나머지는 체크리스트(최소 2). 전체는 각 화면에서 본다
          const handovers = x.handovers.items.slice(0, 2);
          const approvals = (x.approvals?.items ?? []).slice(0, 1);
          const checks = checklistWindow(x.checklist.items, Math.max(2, 5 - handovers.length - approvals.length));
          return (
            <>
              {total ? (
                <div className="dash-progress">
                  <Progress value={total ? done / total : 0} label={`체크리스트 ${done} / ${total}`} />
                </div>
              ) : null}
              <ul className="list" aria-label="오늘 할 일 목록">
                {checks.map((c) => (
                  <li key={`c${c.id}`}>
                    <label className="dash-check">
                      <input type="checkbox" checked={c.checked} disabled={busy === c.id} onChange={(e) => void toggle(c.id, e.target.checked)} />
                      <span className="txt">{c.text}</span>
                      <span className="kind">{c.kind === 'open' ? '오픈' : '마감'}</span>
                    </label>
                  </li>
                ))}
                {handovers.map((h) => (
                  <RowLink key={`h${h.id}`} to={`/desk/board/${h.id}`}>
                    <Chip tone="info">인수인계</Chip>
                    <span className="t">
                      <b>{h.title}</b>
                      <small className="num">
                        {formatDateTime(h.createdAt)} · {h.author}
                      </small>
                    </span>
                  </RowLink>
                ))}
                {approvals.map((a) => (
                  <RowLink key={`a${a.id}`} to="/hr/leave">
                    <Chip tone="warn">승인 대기</Chip>
                    <span className="t">
                      <b>{leaveTitle(a)}</b>
                      <small className="num">{a.days}일 · 원장·실장 승인 필요</small>
                    </span>
                  </RowLink>
                ))}
              </ul>
            </>
          );
        }}
      </Body>
    </Card>
  );
}

/** 2. 재고 경고: 만료·부족·임박·곧 부족 품목(누르면 품목 상세) */
export function StockCard({ state, role }: SlotProps) {
  const d = state.data;
  return (
    <Card id="dash-stock" title="재고 경고" sub={d && d.stockAlerts.total ? `${d.stockAlerts.total}건` : undefined} action={{ label: '재고 보기', to: '/inventory' }}>
      <Body
        state={state}
        isEmpty={(x) => x.stockAlerts.items.length === 0}
        empty={<Empty icon="box" title="재고 경고가 없어요" hint="부족하거나 유효기간이 가까운 품목이 생기면 여기에 보여요." to="/inventory" label="재고 현황 보기" />}
      >
        {(x) => (
          <>
            <ul className="list" aria-label="재고 경고 목록">
              {x.stockAlerts.items.map((i) => {
                const l = stockLine(i);
                return (
                  <RowLink key={i.id} to={`/inventory/items/${i.id}`}>
                    <span className="t">
                      <b>{i.name}</b>
                      <small className="num">{l.detail}</small>
                    </span>
                    <Chip tone={l.tone}>{l.chip}</Chip>
                  </RowLink>
                );
              })}
            </ul>
            {can(role, 'orders.manage') && x.stockAlerts.orderable > 0 ? (
              <div className="dash-foot">
                <Button size="sm" icon="cart" to="/inventory/orders">
                  부족 {x.stockAlerts.orderable}품목 발주서 만들기
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Body>
    </Card>
  );
}

/** 3. 다가오는 점검·의무 일정(30일 안, 기한 지남 포함) */
export function DueCard({ state }: SlotProps) {
  const d = state.data;
  return (
    <Card id="dash-due" title="다가오는 점검·의무 일정" sub={d && d.dueSoon.total ? `${d.dueSoon.total}건` : undefined} action={{ label: '전체', to: '/facility/legal' }}>
      <Body
        state={state}
        isEmpty={(x) => x.dueSoon.items.length === 0}
        empty={
          <Empty icon="shield" title="30일 안에 할 점검이 없어요" hint="장비 점검과 법정 의무 일정의 기한이 다가오면 여기에 보여요." to="/facility/legal" label="법정 일정 보기" />
        }
      >
        {(x) => (
          <ul className="list" aria-label="점검·의무 일정 목록">
            {x.dueSoon.items.map((t) => {
              const dd = dueLabel(t.daysLeft);
              return (
                <RowLink key={t.id} to="/facility/legal?view=due">
                  <span className={`dash-dday num ${dd.tone ?? ''}`}>{dd.text}</span>
                  <span className="t">
                    <b>{t.title}</b>
                    <small className="num">
                      {LEGAL_CATEGORY_LABELS[t.category]} · {t.cycleText}
                      {t.nextDueOn ? ` · ${shortDay(t.nextDueOn)}` : ''}
                    </small>
                  </span>
                  {t.verifyStatus === 'needs_check' ? (
                    <Chip tone="ghost" title={LEGAL_VERIFY_HINTS.needs_check}>
                      {LEGAL_VERIFY_LABELS.needs_check}
                    </Chip>
                  ) : null}
                </RowLink>
              );
            })}
          </ul>
        )}
      </Body>
    </Card>
  );
}

/**
 * 4. 오늘 근무. 본문은 근무표 태스크(phase-04-task-01)의 RosterTodayCard가 GET /api/roster/today로 그린다(근무자·근무 유형·휴가, 빈 상태 포함).
 * 이 카드는 틀(제목·날짜·"근무표" 링크)만 맡는다.
 */
export function RosterSlotCard({ state }: SlotProps) {
  const d = state.data;
  return (
    <Card id="dash-roster" title="오늘 근무" sub={d ? formatDateShort(d.today.date) : undefined} action={{ label: '근무표', to: '/hr/roster' }}>
      <RosterTodayCard />
    </Card>
  );
}

/** 5. 공지(2칸): 고정 공지 먼저, 읽음 수 */
export function NoticeCard({ state, role }: SlotProps) {
  const canWrite = can(role, 'notices.write');
  return (
    <Card id="dash-notice" title="공지" span={2} sub="읽음 표시로 전달 여부를 확인해요" action={{ label: '공지 보드', to: '/desk/board' }}>
      <Body
        state={state}
        rows={3}
        isEmpty={(x) => x.notices.items.length === 0}
        empty={
          <Empty
            icon="board"
            title="새 공지가 없어요"
            hint={canWrite ? '공지를 쓰면 직원별 읽음 여부를 여기에서 확인할 수 있어요.' : '원장·실장이 공지를 올리면 여기에 보여요.'}
            to="/desk/board"
            label={canWrite ? '공지 쓰러 가기' : '공지 보드 보기'}
          />
        }
      >
        {(x) => (
          <ul className="dash-notices" aria-label="공지 목록">
            {x.notices.items.slice(0, 2).map((n) => (
              <li key={n.id}>
                <Link className="dash-notice" to={`/desk/board/${n.id}`}>
                  <span className="h">
                    {n.pinned ? <Chip tone="info">고정</Chip> : null}
                    {n.readByMe ? null : <Chip tone="warn">안 읽음</Chip>}
                    <b>{n.title}</b>
                  </span>
                  <p>{n.preview}</p>
                  <span className="meta num">
                    <span>
                      {n.author} · {formatDateShort(n.createdAt)}
                    </span>
                    <span>
                      읽음 {n.readCount} / {n.totalUsers}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Body>
    </Card>
  );
}

/** 6. AI 빠른 요청: 작은 AiPanel(빠른 요청 기능)과 이번 달 AI 사용 막대 */
export function AiQuickCard({ state }: SlotProps) {
  const d = state.data;
  const month = d ? Number(d.ai.month.slice(5)) : null;
  return (
    <Card id="dash-ai" title="AI 빠른 요청" action={d?.ai.demo ? <Chip tone="ghost">데모 응답</Chip> : undefined}>
      <AiPanel feature="quick" label="AI에게 부탁할 내용" rows={2} primary={false} runLabel="보내기" placeholder="예: 주차 2시간 무료 안내 전화 멘트 만들어줘" />
      {d ? (
        <div className="dash-meter">
          <div className="row num">
            <span>{month}월 AI 사용(예산 대비)</span>
            <span>{d.ai.monthKrw !== null && d.ai.budgetKrw !== null ? `${won(d.ai.monthKrw)} / ${won(d.ai.budgetKrw)}` : `${d.ai.pct}%`}</span>
          </div>
          <Progress value={d.ai.pct / 100} label={`${month}월 AI 사용 ${d.ai.pct}%`} />
        </div>
      ) : null}
    </Card>
  );
}

const ORDER_TONES: Record<OrderStatus, Tone> = { draft: 'ghost', ordered: 'info', received: 'ok', canceled: 'ghost' };

/** 7. 발주 진행(실장 이상만): 최근 발주서와 단계 */
export function OrdersCard({ state }: SlotProps) {
  const d = state.data;
  return (
    <Card id="dash-orders" title="발주 진행" sub={d?.orders?.open ? `진행 중 ${d.orders.open}건` : undefined} action={{ label: '발주서', to: '/inventory/orders' }}>
      <Body
        state={state}
        isEmpty={(x) => (x.orders?.items.length ?? 0) === 0}
        empty={
          <Empty
            icon="cart"
            title="진행 중인 발주가 없어요"
            hint="부족한 품목으로 발주서를 만들면 작성·발주·입고 단계가 여기에 보여요."
            to="/inventory/orders"
            label="발주서 만들기"
          />
        }
      >
        {(x) => (
          <ul className="list" aria-label="발주 진행 목록">
            {(x.orders?.items ?? []).map((o) => {
              const when =
                o.status === 'received' && o.receivedAt
                  ? `${formatDateShort(o.receivedAt)} 입고`
                  : o.status === 'ordered' && o.orderedAt
                    ? `${formatDateShort(o.orderedAt)} 발주`
                    : `예상 ${won(o.total)}`;
              return (
                <RowLink key={o.id} to={`/inventory/orders/${o.id}`}>
                  <span className="t">
                    <b>
                      {o.vendor ?? '거래처 미정'} · {o.lineCount}품목
                    </b>
                    <small className="num">
                      {o.poNo} · {when}
                    </small>
                  </span>
                  <Chip tone={ORDER_TONES[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Chip>
                </RowLink>
              );
            })}
          </ul>
        )}
      </Body>
    </Card>
  );
}

/** 8. 이번 주 일정(2칸): 월~일 7칸에 휴가·점검(근무·교육은 해당 태스크가 더함) */
export function WeekCard({ state }: SlotProps) {
  return (
    <Card id="dash-week" title="이번 주 일정" span={2} sub="휴가 · 점검 · 교육" action={{ label: '연차·휴가', to: '/hr/leave' }}>
      <Body
        state={state}
        rows={3}
        isEmpty={(x) => x.week.events.length === 0}
        empty={<Empty icon="cal" title="이번 주 일정이 없어요" hint="승인된 휴가와 점검·법정 일정이 요일별로 보여요." to="/facility/legal" label="법정 일정 보기" />}
      >
        {(x) => (
          <div className="dash-week num" role="list" aria-label="이번 주 요일별 일정">
            {weekCells(x.week, x.today.date).map((c) => (
              <div key={c.date} role="listitem" className={c.today ? 'today' : undefined} aria-current={c.today ? 'date' : undefined}>
                <b>{c.label}</b>
                {c.events.length === 0 ? <span className="none">일정 없음</span> : null}
                {c.events.map((e, i) => (
                  <Link key={i} className={`ev ${e.tone ?? ''}`} to={e.link} title={e.title}>
                    {e.title}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </Body>
    </Card>
  );
}

/** 9. 최근 입출고(누르면 품목 상세) */
export function MovesCard({ state }: SlotProps) {
  return (
    <Card id="dash-moves" title="최근 입출고" action={{ label: '기록 전체', to: '/inventory/moves' }}>
      <Body
        state={state}
        isEmpty={(x) => x.recentMoves.length === 0}
        empty={
          <Empty
            icon="box"
            title="최근 입출고 기록이 없어요"
            hint="위의 출고 기록 버튼이나 재고 화면에서 입고·출고를 기록하면 여기에 보여요."
            to="/inventory"
            label="재고 현황 보기"
          />
        }
      >
        {(x) => (
          <ul className="list num" aria-label="최근 입출고 목록">
            {x.recentMoves.map((m) => {
              const l = moveLine(m);
              return (
                <RowLink key={m.id} to={`/inventory/items/${m.itemId}`}>
                  <Chip tone={l.tone}>{l.chip}</Chip>
                  <span className="t">
                    <b>{l.title}</b>
                    <small>
                      {formatDateTime(m.movedAt)}
                      {m.userName ? ` · ${m.userName}` : ''}
                      {m.type === 'in' && m.unitPrice !== null ? ` · ${won(m.unitPrice * m.qty)}` : ''}
                    </small>
                  </span>
                </RowLink>
              );
            })}
          </ul>
        )}
      </Body>
    </Card>
  );
}

/** 10. 이번 달 지출(원장·실장만). [연결 지점] phase-04-task-04 지출 기록이 생기면 합계·6개월 추이를 그린다 */
export function ExpenseCard({ state }: SlotProps) {
  return (
    <Card id="dash-expense" title="이번 달 지출" sub="원장·실장만" action={{ label: '월간 요약', to: '/finance/monthly' }}>
      <Body
        state={state}
        rows={2}
        isEmpty={(x) => !x.expenseMonth?.ready || x.expenseMonth.total === 0}
        empty={<Empty icon="won" title="이번 달 지출 기록이 없어요" hint="지출을 기록하면 이번 달 합계와 6개월 추이가 보여요." to="/finance/expenses" label="지출 기록하기" />}
      >
        {(x) => (
          <div className="dash-meter">
            <div className="row num">
              <span>이번 달 누적</span>
              <b>{won(x.expenseMonth?.total ?? 0)}</b>
            </div>
          </div>
        )}
      </Body>
    </Card>
  );
}

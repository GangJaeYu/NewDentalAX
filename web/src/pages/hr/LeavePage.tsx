// 이 파일이 하는 일: "연차·휴가" 화면(/hr/leave, FR-080). 모든 직원이 본인 휴가를 신청·취소하고, 올해 부여·사용·잔여 일수를 본다(AC3).
// 실장 이상에게는 "승인 대기" 목록이 보이고, 승인·반려(사유 필수)할 수 있다. 같은 날 휴가 인원이 정해진 수를 넘으면 목록과 승인 대화상자에 경고가 보인다(AC4, 승인은 됨).
// 실장 이상은 직원별 연차 현황과 전체 신청 기록을 보고, 원장(admin)은 부여 일수·하루 최대 휴가 인원을 정한다. 대화상자는 LeaveDialogs.tsx에 있다.
// 서버 권한: 승인은 leave.approve(주소별 권한 표), 부여 일수는 leave.allowance.edit. 화면은 같은 표(shared/roles.ts)로 버튼을 숨긴다.
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip, Kpi, KpiRow, type Tone } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { JOB_TYPE_LABELS, type JobType } from '../../../../shared/enums.ts';
import {
  formatLeaveDays,
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  periodLabel,
  type LeaveAllowanceRow,
  type LeaveAllowanceTable,
  type LeaveDecision,
  type LeaveRequestItem,
  type LeaveStatus,
} from '../../../../shared/schemas/leave.ts';
import { AllowanceDialog, LeaveDecideDialog, LeaveRequestDialog, LeaveWarnings, messageOf } from './LeaveDialogs.tsx';
import './leave.css';

/** 데이터 key 앞부분(저장하면 'hr:leave'로 모두 다시 불러온다) */
const KEY = 'hr:leave';

/** 상태 칩 색 */
export const STATUS_TONE: Record<LeaveStatus, Tone> = { pending: 'warn', approved: 'ok', rejected: 'danger', canceled: 'ghost' };

/** 잔여 일수 색: 0 미만 위험, 2일 이하 주의 */
export function remainingTone(n: number): 'danger' | 'warn' | undefined {
  if (n < 0) return 'danger';
  if (n <= 2) return 'warn';
  return undefined;
}

type HistoryFilter = 'all' | LeaveStatus;

/** 요약 숫자 칸에 쓸 일수 숫자(단위 없이): 14.5 → '14.5' */
function dayNum(n: number): string {
  return formatLeaveDays(n).slice(0, -1);
}

/** 처리 결과 글자(누가 언제, 반려 사유) */
function decisionText(r: LeaveRequestItem): string {
  if (r.status === 'pending') return '처리 전';
  if (r.status === 'canceled') return '본인이 취소함';
  const who = r.decidedBy ? `${r.decidedBy.name} · ${formatDateTime(r.decidedAt)}` : formatDateTime(r.decidedAt);
  return r.status === 'rejected' && r.rejectReason ? `${who} · 사유: ${r.rejectReason}` : who;
}

/** 연차·휴가 화면 */
export default function LeavePage() {
  const { info } = useSession();
  const me = info?.user ?? null;
  const approver = can(me?.role, 'leave.approve');
  const isAdmin = can(me?.role, 'leave.allowance.edit');
  const toast = useToast();

  const mine = useApi<LeaveRequestItem[]>(`${KEY}:mine`, () => api.get('/api/leave?mine=1'));
  const table = useApi<LeaveAllowanceTable>(`${KEY}:allowances`, () => api.get('/api/leave/allowances'));
  const all = useApi<LeaveRequestItem[]>(approver ? `${KEY}:all` : null, () => api.get('/api/leave'));

  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState<{ item: LeaveRequestItem; mode: 'approve' | 'reject' } | null>(null);
  const [canceling, setCanceling] = useState<LeaveRequestItem | null>(null);
  const [editingAllowance, setEditingAllowance] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>('all');

  const myRow = table.data?.rows.find((r) => r.userId === me?.id) ?? null;
  const pending = useMemo(() => (all.data ?? []).filter((r) => r.status === 'pending'), [all.data]);
  const history = useMemo(() => (all.data ? all.data.filter((r) => filter === 'all' || r.status === filter) : undefined), [all.data, filter]);
  const year = table.data?.year;

  const summary = myRow
    ? `${myRow.year}년 내 연차 잔여 ${formatLeaveDays(myRow.remaining)}${approver && all.data ? ` · 승인 대기 ${pending.length}건` : ''}`
    : '불러오는 중이에요';

  const cancel = async () => {
    if (!canceling) return;
    try {
      await api.post(`/api/leave/${canceling.id}/cancel`);
      toast.show('신청을 취소했어요.');
    } catch (err) {
      toast.error(messageOf(err, '취소하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setCanceling(null);
      invalidate(KEY);
    }
  };

  const decided = (result: LeaveDecision) => {
    const name = result.request.user.name;
    setDeciding(null);
    invalidate(KEY);
    if (result.request.status === 'approved') {
      toast.show(result.warnings.length ? `${name} 님 휴가를 승인했어요. 경고 ${result.warnings.length}건을 확인해 주세요.` : `${name} 님 휴가를 승인했어요.`);
    } else {
      toast.show(`${name} 님 휴가를 반려했어요. 사유가 알림으로 전해졌어요.`);
    }
  };

  const typeCol: Column<LeaveRequestItem> = { key: 'type', header: '종류', render: (r) => LEAVE_TYPE_LABELS[r.type], sortValue: (r) => r.type };
  const periodCol: Column<LeaveRequestItem> = { key: 'period', header: '기간', render: (r) => <span className="num">{periodLabel(r.startOn, r.endOn)}</span>, sortValue: (r) => r.startOn };
  const daysCol: Column<LeaveRequestItem> = { key: 'days', header: '일수', align: 'right', render: (r) => <span className="num">{formatLeaveDays(r.days)}</span>, sortValue: (r) => r.days };
  const statusCol: Column<LeaveRequestItem> = { key: 'status', header: '상태', render: (r) => <Chip tone={STATUS_TONE[r.status]}>{LEAVE_STATUS_LABELS[r.status]}</Chip>, sortValue: (r) => r.status };
  const decisionCol: Column<LeaveRequestItem> = { key: 'decision', header: '처리', render: (r) => <span className="leave-note">{decisionText(r)}</span> };
  const reasonCol: Column<LeaveRequestItem> = { key: 'reason', header: '사유', render: (r) => <span className="leave-note">{r.reason || '-'}</span> };

  const myColumns: Column<LeaveRequestItem>[] = [
    typeCol,
    periodCol,
    daysCol,
    statusCol,
    reasonCol,
    decisionCol,
    {
      key: 'act',
      header: '취소',
      render: (r) =>
        r.status === 'pending' ? (
          <Button size="sm" variant="ghost" aria-label={`${periodLabel(r.startOn, r.endOn)} ${LEAVE_TYPE_LABELS[r.type]} 신청 취소`} onClick={() => setCanceling(r)}>
            취소
          </Button>
        ) : (
          <span className="muted">-</span>
        ),
    },
  ];

  const historyColumns: Column<LeaveRequestItem>[] = [
    { key: 'name', header: '이름', render: (r) => r.user.name, sortValue: (r) => r.user.name },
    typeCol,
    periodCol,
    daysCol,
    statusCol,
    decisionCol,
  ];

  const staffColumns: Column<LeaveAllowanceRow>[] = [
    { key: 'name', header: '이름', render: (r) => <b>{r.name}</b>, sortValue: (r) => r.name },
    { key: 'job', header: '직무', render: (r) => JOB_TYPE_LABELS[r.jobType as JobType] ?? '기타' },
    { key: 'allowance', header: '부여', align: 'right', render: (r) => <span className="num">{formatLeaveDays(r.allowance)}{r.isDefault ? <small className="muted"> 기본</small> : null}</span>, sortValue: (r) => r.allowance },
    { key: 'used', header: '사용', align: 'right', render: (r) => <span className="num">{formatLeaveDays(r.used)}</span>, sortValue: (r) => r.used },
    { key: 'pending', header: '대기', align: 'right', render: (r) => <span className="num">{formatLeaveDays(r.pending)}</span>, sortValue: (r) => r.pending },
    {
      key: 'remaining',
      header: '잔여',
      align: 'right',
      render: (r) => {
        const tone = remainingTone(r.remaining);
        return tone ? <Chip tone={tone}>{`${formatLeaveDays(r.remaining)}${tone === 'danger' ? ' 초과' : ' 남음'}`}</Chip> : <b className="num">{formatLeaveDays(r.remaining)}</b>;
      },
      sortValue: (r) => r.remaining,
    },
    { key: 'other', header: '병가·기타', align: 'right', render: (r) => <span className="num">{formatLeaveDays(r.otherUsed)}</span>, sortValue: (r) => r.otherUsed },
  ];

  const headerActions = (
    <>
      {isAdmin ? (
        <Button icon="people" onClick={() => setEditingAllowance(true)} disabled={!table.data}>
          부여 일수 설정
        </Button>
      ) : null}
      <Button variant="primary" icon="plus" onClick={() => setRequesting(true)}>
        휴가 신청
      </Button>
    </>
  );

  return (
    <>
      <PageHeader title="연차·휴가" summary={summary} actions={headerActions} />

      {table.error && !table.data ? (
        <Card padded>
          <ErrorState message={table.error.message} onRetry={table.reload} />
        </Card>
      ) : (
        <KpiRow label="내 연차 요약">
          <Kpi label={year ? `${year}년 부여` : '부여'} value={myRow ? dayNum(myRow.allowance) : null} unit="일" hint={myRow?.isDefault ? '기본 일수' : myRow ? '원장님이 정한 일수' : undefined} />
          <Kpi label="사용" value={myRow ? dayNum(myRow.used) : null} unit="일" hint="승인된 연차·반차" />
          <Kpi label="승인 대기" value={myRow ? dayNum(myRow.pending) : null} unit="일" hint="아직 결정 전" />
          <Kpi label="잔여" value={myRow ? dayNum(myRow.remaining) : null} unit="일" tone={myRow ? remainingTone(myRow.remaining) : undefined} hint="부여 − 사용" />
          {myRow && myRow.otherUsed > 0 ? <Kpi label="병가·기타" value={dayNum(myRow.otherUsed)} unit="일" hint="잔여에서 빠지지 않음" /> : null}
        </KpiRow>
      )}

      <div className="leave-stack">
        {approver ? (
          <Card title="승인 대기" sub={all.data ? `${pending.length}건` : undefined} id="leave-pending-title">
            {all.error && !all.data ? (
              <div className="leave-pad">
                <ErrorState message={all.error.message} onRetry={all.reload} />
              </div>
            ) : !all.data ? (
              <div className="leave-pad">
                <Skeleton rows={3} label="승인 대기 불러오는 중" />
              </div>
            ) : pending.length === 0 ? (
              <EmptyState icon="check" title="승인을 기다리는 휴가가 없어요" description="직원이 휴가를 신청하면 여기와 알림에 보여요." />
            ) : (
              <ul className="leave-pending" aria-labelledby="leave-pending-title">
                {pending.map((r) => {
                  const own = r.user.id === me?.id;
                  const canDecide = !own || me?.role === 'admin';
                  return (
                    <li key={r.id} data-testid="leave-pending-item">
                      <div className="who">
                        <b>{r.user.name}</b>
                        <Chip tone="info">{LEAVE_TYPE_LABELS[r.type]}</Chip>
                        {r.warnings.length ? <Chip tone="warn">{`경고 ${r.warnings.length}건`}</Chip> : null}
                      </div>
                      <div className="when num">
                        {periodLabel(r.startOn, r.endOn)} · {formatLeaveDays(r.days)}
                        <small> · 신청 {formatDateTime(r.createdAt)}</small>
                      </div>
                      {r.reason ? <p className="why">사유: {r.reason}</p> : null}
                      <LeaveWarnings warnings={r.warnings} title="승인하면 이런 점이 있어요" />
                      <div className="acts">
                        {canDecide ? (
                          <>
                            <Button size="sm" icon="check" onClick={() => setDeciding({ item: r, mode: 'approve' })} aria-label={`${r.user.name} ${periodLabel(r.startOn, r.endOn)} 승인`}>
                              승인
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeciding({ item: r, mode: 'reject' })} aria-label={`${r.user.name} ${periodLabel(r.startOn, r.endOn)} 반려`}>
                              반려
                            </Button>
                          </>
                        ) : (
                          <span className="muted">본인 신청은 다른 관리자가 결정해요</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ) : null}

        <Card title="내 신청" sub={mine.data ? `${mine.data.length}건` : undefined}>
          <DataTable
            caption="내 휴가 신청"
            columns={myColumns}
            rows={mine.data}
            rowKey={(r) => r.id}
            loading={mine.loading}
            error={mine.error}
            onRetry={mine.reload}
            empty={
              <EmptyState
                icon="cal"
                title="아직 신청한 휴가가 없어요"
                description="연차·반차·병가를 신청하면 실장님께 알림이 가요."
                action={
                  <Button icon="plus" onClick={() => setRequesting(true)}>
                    첫 휴가 신청하기
                  </Button>
                }
              />
            }
          />
        </Card>

        {approver ? (
          <Card title={year ? `${year}년 직원별 연차` : '직원별 연차'} sub={table.data ? `${table.data.rows.length}명 · 기본 ${formatLeaveDays(table.data.defaultAllowance)}` : undefined}>
            <DataTable
              caption="직원별 부여·사용·잔여 일수"
              columns={staffColumns}
              rows={table.data?.rows}
              rowKey={(r) => r.userId}
              loading={table.loading}
              error={table.error}
              onRetry={table.reload}
              empty={<EmptyState icon="people" title="직원이 없어요" description="사용자·권한 화면에서 직원 계정을 먼저 만들어 주세요." />}
            />
          </Card>
        ) : null}

        {approver ? (
          <Card title="전체 신청 기록" sub={history ? `${history.length}건` : undefined}>
            <Toolbar label="신청 기록 도구">
              <Segmented<HistoryFilter>
                label="상태로 거르기"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: '전체' },
                  { value: 'pending', label: '승인 대기' },
                  { value: 'approved', label: '승인' },
                  { value: 'rejected', label: '반려' },
                  { value: 'canceled', label: '취소' },
                ]}
              />
            </Toolbar>
            <DataTable
              caption="전체 휴가 신청 기록"
              columns={historyColumns}
              rows={history}
              rowKey={(r) => r.id}
              loading={all.loading}
              error={all.error}
              onRetry={all.reload}
              empty={<EmptyState icon="inbox" title={filter === 'all' ? '아직 신청 기록이 없어요' : `${LEAVE_STATUS_LABELS[filter]} 기록이 없어요`} description="직원이 휴가를 신청하면 여기에 쌓여요." />}
            />
          </Card>
        ) : null}
      </div>

      {requesting ? (
        <LeaveRequestDialog
          remaining={myRow?.remaining ?? null}
          onClose={() => setRequesting(false)}
          onSaved={(item) => {
            setRequesting(false);
            invalidate(KEY);
            toast.show(`${periodLabel(item.startOn, item.endOn)} ${LEAVE_TYPE_LABELS[item.type]} 신청을 보냈어요. 실장님께 알림이 갔어요.`);
          }}
        />
      ) : null}
      {deciding ? <LeaveDecideDialog item={deciding.item} mode={deciding.mode} onClose={() => setDeciding(null)} onDone={decided} /> : null}
      <ConfirmDialog
        open={!!canceling}
        onClose={() => setCanceling(null)}
        onConfirm={cancel}
        title="휴가 신청 취소"
        message={canceling ? `${periodLabel(canceling.startOn, canceling.endOn)} ${LEAVE_TYPE_LABELS[canceling.type]} 신청을 취소할까요?` : ''}
        confirmLabel="신청 취소"
        danger
      />
      {editingAllowance && table.data ? (
        <AllowanceDialog
          table={table.data}
          onClose={() => setEditingAllowance(false)}
          onSaved={() => {
            setEditingAllowance(false);
            invalidate(KEY);
            invalidate('hr:leave:settings');
            toast.show('부여 일수와 연차 설정을 저장했어요.');
          }}
        />
      ) : null}
    </>
  );
}

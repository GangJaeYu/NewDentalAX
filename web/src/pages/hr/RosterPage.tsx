// 이 파일이 하는 일: "근무표" 화면(/hr/roster, FR-081). 직원 × 날짜 표를 주간(월~일)·월간(최대 6주)으로 보여 주고, 날짜별 근무 인원 합계를 맨 아래 줄에 둔다.
// 실장 이상은 칸을 눌러 근무 유형을 고르고(1~2번 클릭, AC1), "지난주 복사"로 지난주 칸을 이번 주에 붙여 넣으며(휴가는 복사 안 됨, AC2), 근무 유형을 관리한다.
// 승인된 휴가는 칸에 "연차"처럼 덧씌워 보이고 하루 종일 휴가는 인원 합계에서 빠진다(AC3). 직원은 조회·인쇄만 한다(편집 버튼 없음, 서버도 403, AC4).
// 보는 기간은 주소(?view=week|month&date=YYYY-MM-DD)에 남겨 새로 고쳐도 유지된다. 날짜를 주지 않으면 서버 기준 오늘이 든 주를 연다.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api } from '../../lib/api.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { JOB_TYPE_LABELS } from '../../../../shared/enums.ts';
import { isRealDate } from '../../../../shared/schemas/leave.ts';
import {
  rosterDateLabel,
  rosterPeriodLabel,
  shiftDate,
  weekdayKo,
  weekStart,
  type CopyWeekResult,
  type RosterCell,
  type RosterView,
  type ShiftType,
} from '../../../../shared/schemas/roster.ts';
import { CellPickDialog, ShiftTypesDialog, rosterError } from './RosterDialogs.tsx';
import { ROSTER_KEY, cellParts, fetchRoster, leaveTone, moveAnchor, shiftChipClass, shiftTitle, shortDate, withRo, type RosterMode } from './rosterLib.ts';
import './roster.css';

const MODES: ReadonlyArray<{ value: RosterMode; label: string }> = [
  { value: 'week', label: '주간' },
  { value: 'month', label: '월간' },
];

/** 칸 내용(버튼이든 글자든 같은 모양) */
function CellBody({ cell, types }: { cell: RosterCell | undefined; types: ReadonlyMap<number, ShiftType> }) {
  const p = cellParts(cell, types);
  if (!p.shift && !p.leave) return <span className="blank">-</span>;
  return (
    <>
      {p.leave?.fullDay ? null : p.shift ? <span className={shiftChipClass(p.shift.colorToken)}>{p.shift.label}</span> : null}
      {p.leave ? <Chip tone={leaveTone(p.leave.fullDay)}>{p.leave.label}</Chip> : null}
    </>
  );
}

/** 근무표 */
export default function RosterPage() {
  const { info } = useSession();
  const editor = can(info?.user?.role, 'roster.edit');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const mode: RosterMode = params.get('view') === 'month' ? 'month' : 'week';
  const dateParam = params.get('date');
  const anchor = dateParam && isRealDate(dateParam) ? dateParam : null;

  const state = useApi<RosterView>(`${ROSTER_KEY}:${mode}:${anchor ?? 'now'}`, () => fetchRoster(mode, anchor));
  const v = state.data;

  const [picking, setPicking] = useState<{ userId: number; name: string; date: string; cell: RosterCell | undefined } | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [copying, setCopying] = useState(false);

  const types = useMemo(() => new Map((v?.shiftTypes ?? []).map((t) => [t.id, t])), [v?.shiftTypes]);
  const today = v?.today ?? null;
  const viewAnchor = anchor ?? today;
  // 지난주 복사는 지금 보는 주(주간) 또는 오늘이 든 주(월간)에 붙여 넣는다
  const copyTarget = v ? (mode === 'week' ? v.from : weekStart(viewAnchor ?? v.from)) : null;
  const copySource = copyTarget ? shiftDate(copyTarget, -7) : null;
  const todayTotal = today && v ? v.totals[today] : undefined;

  const go = (next: { view?: RosterMode; date?: string | null }) => {
    const p = new URLSearchParams(params);
    const view = next.view ?? mode;
    if (view === 'month') p.set('view', 'month');
    else p.delete('view');
    const date = next.date === undefined ? anchor : next.date;
    if (date) p.set('date', date);
    else p.delete('date');
    setParams(p);
  };

  const copyWeek = async () => {
    if (!copyTarget || !copySource) return;
    try {
      const r = await api.post<CopyWeekResult>('/api/roster/copy-week', { fromWeekStart: copySource, toWeekStart: copyTarget });
      toast.show(r.copied > 0 ? `지난주 근무 ${r.copied}칸을 ${rosterPeriodLabel(copyTarget, shiftDate(copyTarget, 6))}에 복사했어요.` : '지난주에 적힌 근무가 없어서 이번 주를 비웠어요.');
    } catch (err) {
      toast.error(rosterError(err, '복사하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setCopying(false);
      invalidate(ROSTER_KEY);
    }
  };

  const summary = v
    ? `${rosterPeriodLabel(v.from, v.to)}${todayTotal !== undefined ? ` · 오늘 근무 ${todayTotal}명` : ''}${editor ? '' : ' · 조회만 할 수 있어요'}`
    : '불러오는 중이에요';

  const printHref = v ? `/print/roster?from=${v.from}&to=${v.to}` : '/print/roster';

  return (
    <>
      <PageHeader
        title="근무표"
        summary={summary}
        actions={
          <>
            <Button icon="print" to={printHref}>
              인쇄
            </Button>
            {editor ? (
              <Button icon="gear" onClick={() => setTypesOpen(true)} disabled={!v}>
                근무 유형
              </Button>
            ) : null}
            {editor ? (
              <Button variant="primary" icon="copy" onClick={() => setCopying(true)} disabled={!v}>
                지난주 복사
              </Button>
            ) : null}
          </>
        }
      />

      <Card span="full" className="roster-card">
        <Toolbar label="근무표 기간">
          <div className="roster-bar">
            <Segmented label="보기" value={mode} options={MODES} onChange={(m) => go({ view: m })} />
            <Button size="sm" aria-label={mode === 'week' ? '이전 주' : '이전 달'} disabled={!viewAnchor} onClick={() => viewAnchor && go({ date: moveAnchor(mode, viewAnchor, -1) })}>
              ‹ 이전
            </Button>
            <Button size="sm" disabled={!today || (!anchor && !!today)} onClick={() => go({ date: null })}>
              오늘
            </Button>
            <Button size="sm" aria-label={mode === 'week' ? '다음 주' : '다음 달'} disabled={!viewAnchor} onClick={() => viewAnchor && go({ date: moveAnchor(mode, viewAnchor, 1) })}>
              다음 ›
            </Button>
            {v ? (
              <span className="period num" aria-live="polite">
                {mode === 'month' && viewAnchor ? `${Number(viewAnchor.slice(0, 4))}년 ${Number(viewAnchor.slice(5, 7))}월` : rosterPeriodLabel(v.from, v.to)}
              </span>
            ) : null}
          </div>
          <span className="grow" />
          {v ? (
            <div className="roster-legend" aria-label="근무 유형 안내">
              {v.shiftTypes
                .filter((t) => t.active)
                .map((t) => (
                  <span key={t.id} className={shiftChipClass(t.colorToken)} title={shiftTitle(t)}>
                    {shiftTitle(t)}
                  </span>
                ))}
            </div>
          ) : null}
        </Toolbar>

        {state.error && !v ? (
          <ErrorState message={state.error.message} onRetry={state.reload} />
        ) : !v ? (
          <div className="roster-pad">
            <Skeleton rows={6} label="근무표 불러오는 중" />
          </div>
        ) : v.users.length === 0 ? (
          <EmptyState icon="people" title="근무표에 넣을 직원이 없어요" description="관리 메뉴에서 직원을 먼저 등록해 주세요." action={<Button to="/admin/users">직원 관리</Button>} />
        ) : (
          <>
            {editor && v.days.every((d) => Object.values(d.cells).every((c) => c.shiftTypeId === null)) ? (
              <p className="form-note roster-hint" data-testid="roster-empty-hint">
                이 기간에는 아직 근무가 없어요. 칸을 눌러 근무 유형을 고르거나 "지난주 복사"를 눌러 보세요.
              </p>
            ) : null}
            <div className="tablewrap" role="region" aria-label="근무표 표" tabIndex={0}>
              <table className={`roster-table${mode === 'month' ? ' month' : ''}`}>
                <caption className="sr-only">
                  {rosterPeriodLabel(v.from, v.to)} 근무표. 직원 {v.users.length}명, 맨 아래 줄은 날짜별 근무 인원이에요.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="who">
                      직원
                    </th>
                    {v.days.map((d, i) => (
                      <th
                        key={d.date}
                        scope="col"
                        className={[d.open ? '' : 'closed', d.date === today ? 'today' : '', i > 0 && i % 7 === 0 ? 'weekstart' : ''].filter(Boolean).join(' ') || undefined}
                        aria-label={`${rosterDateLabel(d.date)}${d.open ? '' : ' 휴진'}${d.date === today ? ' 오늘' : ''}`}
                      >
                        <b className="num">{shortDate(d.date)}</b>
                        {weekdayKo(d.date)}
                        {d.open ? '' : ' 휴진'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {v.users.map((u) => (
                    <tr key={u.id}>
                      <th scope="row" className="who">
                        <b>{u.name}</b>
                        <small>{JOB_TYPE_LABELS[u.jobType] ?? '기타'}</small>
                      </th>
                      {v.days.map((d, i) => {
                        const cell = d.cells[String(u.id)];
                        const cls = [d.open ? '' : 'closed', d.date === today ? 'today' : '', i > 0 && i % 7 === 0 ? 'weekstart' : ''].filter(Boolean).join(' ') || undefined;
                        const text = cellParts(cell, types).text || '비어 있음';
                        return (
                          <td key={d.date} className={cls} data-date={d.date} data-user={u.id}>
                            {editor ? (
                              <button
                                type="button"
                                className="roster-cell"
                                aria-label={`${u.name} ${rosterDateLabel(d.date)} ${text}, 바꾸기`}
                                onClick={() => setPicking({ userId: u.id, name: u.name, date: d.date, cell })}
                              >
                                <CellBody cell={cell} types={types} />
                              </button>
                            ) : (
                              <span className="roster-cell">
                                <CellBody cell={cell} types={types} />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="who">
                      근무 인원
                    </th>
                    {v.days.map((d, i) => (
                      <td key={d.date} data-total={d.date} className={[d.open ? '' : 'closed', d.date === today ? 'today' : '', i > 0 && i % 7 === 0 ? 'weekstart' : ''].filter(Boolean).join(' ') || undefined}>
                        {d.total}
                        <small>명</small>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Card>

      {v ? (
        <CellPickDialog
          target={picking}
          types={v.shiftTypes}
          onClose={() => setPicking(null)}
          onSaved={(r, label) => {
            const name = picking?.name ?? '';
            setPicking(null);
            invalidate(ROSTER_KEY);
            toast.show(`${name} · ${rosterDateLabel(r.date)} 근무를 ${label === '빈칸' ? '비웠어요' : `"${label}"${withRo(label)} 저장했어요`}. 그날 근무 ${r.total}명.`);
          }}
        />
      ) : null}

      {v && typesOpen ? (
        <ShiftTypesDialog
          open
          types={v.shiftTypes}
          onClose={() => setTypesOpen(false)}
          onSaved={() => {
            setTypesOpen(false);
            invalidate(ROSTER_KEY);
            toast.show('근무 유형을 저장했어요.');
          }}
        />
      ) : null}

      <ConfirmDialog
        open={copying}
        onClose={() => setCopying(false)}
        onConfirm={copyWeek}
        title="지난주 복사"
        confirmLabel="복사하기"
        message={
          copyTarget && copySource
            ? `지난주(${rosterPeriodLabel(copySource, shiftDate(copySource, 6))}) 근무를 ${rosterPeriodLabel(copyTarget, shiftDate(copyTarget, 6))}에 그대로 붙여 넣어요. 그 주에 적어 둔 근무는 지워지고, 휴가는 복사되지 않아요.`
            : ''
        }
      />
    </>
  );
}

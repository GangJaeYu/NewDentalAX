// 이 파일이 하는 일: 대시보드 "오늘 근무" 카드의 본문(FR-081, DESIGN §4 카드 순서 4번째). GET /api/roster/today로 오늘 근무자와 근무 유형을 보여 준다.
// 근무하는 사람 → 휴가(연차 등) → 휴무 순서로 두 줄씩 나열하고, 칩에 유형 글자를 넣는다(색만으로 구분하지 않음). 비었으면 근무표로 가는 빈 상태 안내를 보여 준다.
// 카드 틀(제목·"근무표" 링크)은 DashboardPage.tsx가 그리고 이 컴포넌트는 안쪽만 그린다. phase-03-task-10(대시보드)이 이어받아 쓴다.
import { Button } from '../../components/Button.tsx';
import { Chip } from '../../components/Chip.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useApi } from '../../lib/useApi.ts';
import { JOB_TYPE_LABELS } from '../../../../shared/enums.ts';
import { rosterDateLabel, shiftTimeText, type TodayRoster } from '../../../../shared/schemas/roster.ts';
import { ROSTER_KEY, fetchToday, leaveTone, shiftChipClass } from './rosterLib.ts';
import './roster.css';

/** 대시보드 "오늘 근무" 카드 본문 */
export function RosterTodayCard() {
  const state = useApi<TodayRoster>(`${ROSTER_KEY}:today`, fetchToday);
  const t = state.data;
  if (state.error && !t) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  if (!t) return <Skeleton rows={4} label="오늘 근무 불러오는 중" />;
  if (t.items.length === 0) {
    return (
      <EmptyState
        icon="people"
        title={t.open ? '오늘 근무표가 아직 없어요' : '오늘은 휴진일이에요'}
        description={t.open ? '근무표를 만들면 오늘 근무자가 보여요.' : '근무표에 적힌 근무가 없어요.'}
        action={<Button to="/hr/roster">근무표 열기</Button>}
      />
    );
  }
  return (
    <div data-testid="roster-today">
      <p className="sr-only">
        {rosterDateLabel(t.date)} 근무 {t.working}명{t.onLeave ? `, 휴가 ${t.onLeave}명` : ''}
      </p>
      <ul className="roster-today" aria-label={`${rosterDateLabel(t.date)} 근무자`}>
        {t.items.map((w) => (
          <li key={w.userId}>
            <span className="av" aria-hidden="true">
              {w.name.trim().slice(0, 1)}
            </span>
            <span className="t">
              <b>{w.name}</b>
              <small>{JOB_TYPE_LABELS[w.jobType] ?? '기타'}</small>
            </span>
            {w.leave?.fullDay ? null : w.shift ? (
              <span className={shiftChipClass(w.shift.colorToken)} title={shiftTimeText(w.shift) || undefined}>
                {w.shift.label}
              </span>
            ) : null}
            {w.leave ? <Chip tone={leaveTone(w.leave.fullDay)}>{w.leave.label}</Chip> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

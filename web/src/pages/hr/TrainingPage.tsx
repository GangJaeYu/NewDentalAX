// 이 파일이 하는 일: "교육 이수 기록" 화면(/hr/training, FR-082). 모든 직원이 본인 교육의 최근 이수일·다음 예정일·D-day를 보고, 이수 기록(증빙 파일 선택)을 남긴다.
// 실장 이상에게는 직원별 이수 현황(기한 지남·임박·기록 필요로 거르기)과 교육 항목 관리(주기·법정 일정 연결·사용 여부)가 더 보인다.
// 다음 예정일 = 가장 최근 이수일 + 주기(서버 계산). 예정일이 30일(설정) 안이면 해당 직원과 실장 이상에게 알림이 간다. 대화상자는 trainingDialogs.tsx에 있다.
// 서버 권한: 항목 관리·다른 직원 기록은 trainings.manage. 화면은 같은 표(shared/roles.ts)로 버튼을 숨긴다.
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip, Kpi, KpiRow, type Tone } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { EmptyState } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api } from '../../lib/api.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { cycleLabel, TRAINING_STATE_LABELS, type TrainingItem, type TrainingOverview, type TrainingRecordResult, type TrainingState, type TrainingStatus } from '../../../../shared/schemas/training.ts';
import { RecordDialog, RecordsDialog, TrainingFormDialog } from './trainingDialogs.tsx';
import './training.css';

/** 데이터 key 앞부분(저장하면 'hr:training'으로 모두 다시 불러온다) */
const KEY = 'hr:training';

/** 상태 칩 색(글자와 함께 보여 색만으로 구분하지 않는다) */
export const STATE_TONE: Record<TrainingState, Tone> = { none: 'ghost', once: 'ok', overdue: 'danger', today: 'danger', soon: 'warn', ok: 'ok' };

/** 상태 칩 글자: 남은 날을 함께 */
export function stateText(s: Pick<TrainingStatus, 'state' | 'daysLeft'>): string {
  if (s.state === 'overdue' && s.daysLeft !== null) return `기한 지남 ${-s.daysLeft}일`;
  if (s.state === 'soon' && s.daysLeft !== null) return `D-${s.daysLeft}`;
  if (s.state === 'ok' && s.daysLeft !== null) return `여유 D-${s.daysLeft}`;
  return TRAINING_STATE_LABELS[s.state];
}

/** 정렬 순서: 급한 것 먼저 */
const STATE_ORDER: Record<TrainingState, number> = { overdue: 0, today: 1, soon: 2, none: 3, ok: 4, once: 5 };

/** 직원별 현황 표 한 줄 */
interface PairRow {
  key: string;
  training: TrainingItem;
  status: TrainingStatus;
}

type PairFilter = 'all' | 'attention' | 'none';

/** 상태 칩 */
function StateChip({ s }: { s: TrainingStatus }) {
  return <Chip tone={STATE_TONE[s.state]}>{stateText(s)}</Chip>;
}

/** 교육 이수 기록 화면 */
export default function TrainingPage() {
  const { info } = useSession();
  const me = info?.user ?? null;
  const manager = can(me?.role, 'trainings.manage');
  const toast = useToast();
  const overview = useApi<TrainingOverview>(`${KEY}:overview`, () => api.get('/api/trainings'));

  const [recording, setRecording] = useState<{ trainingId?: number; userId?: number } | null>(null);
  const [editing, setEditing] = useState<TrainingItem | 'new' | null>(null);
  const [viewing, setViewing] = useState<{ training: TrainingItem; user: { id: number; name: string } } | null>(null);
  const [filter, setFilter] = useState<PairFilter>('attention');

  const data = overview.data;
  const activeTrainings = useMemo(() => (data?.trainings ?? []).filter((t) => t.active), [data]);
  const myRows = useMemo<PairRow[]>(
    () =>
      activeTrainings
        .map((t) => ({ key: `${t.id}`, training: t, status: t.statuses.find((s) => s.userId === me?.id) }))
        .filter((r): r is PairRow => !!r.status),
    [activeTrainings, me?.id],
  );
  const pairs = useMemo<PairRow[]>(() => activeTrainings.flatMap((t) => t.statuses.map((s) => ({ key: `${t.id}:${s.userId}`, training: t, status: s }))), [activeTrainings]);
  const filtered = useMemo(
    () =>
      pairs
        .filter((p) => (filter === 'all' ? true : filter === 'none' ? p.status.state === 'none' : ['overdue', 'today', 'soon'].includes(p.status.state)))
        .sort((a, b) => STATE_ORDER[a.status.state] - STATE_ORDER[b.status.state] || (a.status.daysLeft ?? 9999) - (b.status.daysLeft ?? 9999)),
    [pairs, filter],
  );

  const base = manager ? pairs : myRows;
  const overdue = base.filter((p) => p.status.state === 'overdue' || p.status.state === 'today').length;
  const soon = base.filter((p) => p.status.state === 'soon').length;
  const none = base.filter((p) => p.status.state === 'none').length;
  const unit = manager ? '건' : '개';
  const summary = data
    ? manager
      ? `교육 ${activeTrainings.length}개 · 직원 ${data.people.length}명 · 기한 지남 ${overdue}건 · ${data.warnDays}일 안 ${soon}건`
      : `내 교육 ${myRows.length}개 · 기한 지남 ${overdue}개 · ${data.warnDays}일 안 ${soon}개`
    : '불러오는 중이에요';

  const saved = (r: TrainingRecordResult, name: string) => {
    setRecording(null);
    invalidate(KEY);
    const next = r.status.nextDueOn ? ` 다음 예정일은 ${r.status.nextDueOn}이에요.` : '';
    const sent = r.notified > 0 ? ' 예정일이 가까워 알림을 보냈어요.' : '';
    toast.show(`${r.record.user.name} 님 ${name} 이수를 기록했어요.${next}${sent}`);
  };

  const viewBtn = (p: PairRow) =>
    p.status.recordCount > 0 ? (
      <Button size="sm" variant="ghost" onClick={() => setViewing({ training: p.training, user: { id: p.status.userId, name: p.status.userName } })} aria-label={`${p.status.userName} ${p.training.name} 기록 ${p.status.recordCount}건 보기`}>
        기록 {p.status.recordCount}건
      </Button>
    ) : null;
  const recordBtn = (p: PairRow) => (
    <Button size="sm" icon="plus" onClick={() => setRecording({ trainingId: p.training.id, userId: p.status.userId })} aria-label={`${p.status.userName} ${p.training.name} 이수 기록`}>
      기록
    </Button>
  );

  const nameCol: Column<PairRow> = {
    key: 'training',
    header: '교육',
    render: (p) => (
      <span className="training-name">
        <b>{p.training.name}</b>
        <small>
          {cycleLabel(p.training.cycleMonths)}
          {p.training.legalTask ? ' · 법정 일정 연결' : ''}
        </small>
      </span>
    ),
    sortValue: (p) => p.training.name,
  };
  const lastCol: Column<PairRow> = { key: 'last', header: '최근 이수일', render: (p) => <span className="num">{p.status.lastCompletedOn ?? '-'}</span>, sortValue: (p) => p.status.lastCompletedOn ?? '' };
  const nextCol: Column<PairRow> = { key: 'next', header: '다음 예정일', render: (p) => <span className="num">{p.status.nextDueOn ?? '-'}</span>, sortValue: (p) => p.status.nextDueOn ?? '9999' };
  const stateCol: Column<PairRow> = { key: 'state', header: '상태', render: (p) => <StateChip s={p.status} />, sortValue: (p) => STATE_ORDER[p.status.state] * 10000 + (p.status.daysLeft ?? 0) };

  const myColumns: Column<PairRow>[] = [
    nameCol,
    lastCol,
    nextCol,
    stateCol,
    {
      key: 'act',
      header: '기록',
      render: (p) => (
        <span className="training-acts">
          {recordBtn(p)}
          {viewBtn(p)}
        </span>
      ),
    },
  ];

  const pairColumns: Column<PairRow>[] = [
    { key: 'who', header: '직원', render: (p) => p.status.userName, sortValue: (p) => p.status.userName },
    nameCol,
    lastCol,
    nextCol,
    stateCol,
    {
      key: 'act',
      header: '기록',
      render: (p) => (
        <span className="training-acts">
          {recordBtn(p)}
          {viewBtn(p)}
        </span>
      ),
    },
  ];

  const itemColumns: Column<TrainingItem>[] = [
    { key: 'name', header: '교육 이름', render: (t) => <b>{t.name}</b>, sortValue: (t) => t.name },
    { key: 'cycle', header: '주기', render: (t) => cycleLabel(t.cycleMonths), sortValue: (t) => t.cycleMonths ?? 999 },
    { key: 'legal', header: '법정 일정', render: (t) => <span className="training-note">{t.legalTask?.title ?? '연결 안 함'}</span> },
    { key: 'done', header: '이수한 직원', align: 'right', render: (t) => <span className="num">{t.statuses.filter((s) => s.recordCount > 0).length}명</span> },
    { key: 'active', header: '사용', render: (t) => (t.active ? <Chip tone="ok">사용 중</Chip> : <Chip tone="ghost">꺼 둠</Chip>), sortValue: (t) => (t.active ? 0 : 1) },
    {
      key: 'edit',
      header: '고치기',
      render: (t) => (
        <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`${t.name} 고치기`}>
          고치기
        </Button>
      ),
    },
  ];

  const recordAction = (
    <Button variant="primary" icon="plus" onClick={() => setRecording({})} disabled={!activeTrainings.length}>
      이수 기록하기
    </Button>
  );

  return (
    <>
      <PageHeader
        title="교육 이수 기록"
        summary={summary}
        actions={
          <>
            {manager ? (
              <Button icon="plus" onClick={() => setEditing('new')}>
                교육 항목 추가
              </Button>
            ) : null}
            {recordAction}
          </>
        }
      />
      <KpiRow label={manager ? '교육 이수 요약' : '내 교육 요약'}>
        <Kpi label="기한 지남" value={data ? overdue : null} unit={unit} tone={overdue ? 'danger' : undefined} />
        <Kpi label={data ? `${data.warnDays}일 안 예정` : '임박'} value={data ? soon : null} unit={unit} tone={soon ? 'warn' : undefined} />
        <Kpi label="기록 필요" value={data ? none : null} unit={unit} />
        <Kpi label="교육 항목" value={data ? activeTrainings.length : null} unit="개" />
      </KpiRow>

      <div className="training-stack">
        <Card title="내 교육" sub={data ? `다음 예정일 = 최근 이수일 + 주기 · ${data.warnDays}일 안이면 알림` : undefined}>
          <DataTable
            caption="내 교육 이수 현황"
            columns={myColumns}
            rows={overview.data ? myRows : undefined}
            rowKey={(r) => r.key}
            loading={overview.loading}
            error={overview.error}
            onRetry={overview.reload}
            empty={
              <EmptyState
                icon="cal"
                title="등록된 교육 항목이 없어요"
                description={manager ? '감염관리·개인정보 보호처럼 정해진 주기마다 받는 교육을 먼저 추가해 주세요.' : '실장님이 교육 항목을 추가하면 여기에 보여요.'}
                action={
                  manager ? (
                    <Button icon="plus" onClick={() => setEditing('new')}>
                      첫 교육 항목 추가하기
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        </Card>

        {manager ? (
          <Card title="직원별 이수 현황" sub={data ? `${filtered.length}건` : undefined}>
            <Toolbar label="이수 현황 도구">
              <Segmented<PairFilter>
                label="상태로 거르기"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'attention', label: '지남·임박' },
                  { value: 'none', label: '기록 필요' },
                  { value: 'all', label: '전체' },
                ]}
              />
            </Toolbar>
            <DataTable
              caption="직원별 교육 이수 현황"
              columns={pairColumns}
              rows={overview.data ? filtered : undefined}
              rowKey={(r) => r.key}
              loading={overview.loading}
              error={overview.error}
              onRetry={overview.reload}
              empty={
                <EmptyState
                  icon="check"
                  title={filter === 'attention' ? '기한이 지나거나 가까운 교육이 없어요' : filter === 'none' ? '기록이 필요한 직원이 없어요' : '아직 교육 항목이 없어요'}
                  description="이수를 기록하면 다음 예정일이 계산돼요."
                  action={
                    <Button icon="plus" onClick={() => setRecording({})} disabled={!activeTrainings.length}>
                      이수 기록하기
                    </Button>
                  }
                />
              }
            />
          </Card>
        ) : null}

        {manager ? (
          <Card title="교육 항목" sub={data ? `${data.trainings.length}개` : undefined}>
            <DataTable
              caption="교육 항목 목록"
              columns={itemColumns}
              rows={data?.trainings}
              rowKey={(t) => t.id}
              loading={overview.loading}
              error={overview.error}
              onRetry={overview.reload}
              empty={
                <EmptyState
                  icon="cal"
                  title="아직 교육 항목이 없어요"
                  description="교육 이름과 주기를 정하면 직원별 다음 예정일을 알려 드려요."
                  action={
                    <Button icon="plus" onClick={() => setEditing('new')}>
                      첫 교육 항목 추가하기
                    </Button>
                  }
                />
              }
            />
          </Card>
        ) : null}
      </div>

      {recording && data && me ? (
        <RecordDialog
          trainings={activeTrainings}
          people={data.people}
          manager={manager}
          meId={me.id}
          today={data.today}
          csrfToken={info?.csrfToken ?? null}
          initial={recording}
          onClose={() => setRecording(null)}
          onSaved={saved}
        />
      ) : null}
      {editing ? (
        <TrainingFormDialog
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(t) => {
            setEditing(null);
            invalidate(KEY);
            toast.show(editing === 'new' ? `"${t.name}" 교육 항목을 추가했어요.` : `"${t.name}" 교육 항목을 저장했어요.`);
          }}
        />
      ) : null}
      {viewing ? (
        <RecordsDialog
          training={viewing.training}
          user={viewing.user}
          canDelete={manager || viewing.user.id === me?.id}
          onClose={() => setViewing(null)}
          onChanged={() => invalidate(`${KEY}:overview`)}
        />
      ) : null}
    </>
  );
}

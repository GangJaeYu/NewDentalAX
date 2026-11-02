// 이 파일이 하는 일: "신규 직원 온보딩" 화면(/hr/onboarding, FR-083). 배정받은 직원은 "내 온보딩"에서, 담당 멘토는 "내가 멘토인 직원"에서 같은 체크리스트를 체크하고
// 진행률 %를 함께 본다(체크하면 바로 다시 계산된 값이 보이고, 다른 사람 화면은 다시 불러오거나 30초마다 새로 고칠 때 갱신된다).
// 실장 이상은 AI(기능 onboarding)로 직무별 초안을 만들어 고친 뒤 템플릿으로 저장하고, 템플릿을 직접 만들거나 고치며, 신규 직원에게 멘토와 함께 배정한다.
// 서버 권한: 템플릿·배정은 onboarding.manage, 체크는 배정받은 본인 또는 멘토만. 부품은 onboardingParts.tsx에 있다.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AiPanel } from '../../components/AiPanel.tsx';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip, Progress } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Field, Select } from '../../components/Field.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api } from '../../lib/api.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { JOB_TYPE_LABELS, type JobType } from '../../../../shared/enums.ts';
import type { OnboardingAssignment, OnboardingTemplate } from '../../../../shared/schemas/onboarding.ts';
import type { UserRow } from '../../../../shared/schemas/admin.ts';
import { AssignDialog, AssignmentCard, cleanDraftItems, DraftEditor, JOB_OPTIONS, messageOf, TemplateDialog } from './onboardingParts.tsx';
import './training.css';

/** 데이터 key 앞부분 */
const KEY = 'hr:onboarding';
/** 다른 사람이 체크한 것을 보려고 다시 불러오는 간격 */
const REFRESH_MS = 30_000;

/** 진행 카드 묶음(없으면 빈 상태) */
function CardList({ items, empty, onChanged }: { items: OnboardingAssignment[]; empty: ReactNode; onChanged: (a: OnboardingAssignment) => void }) {
  if (!items.length) return <>{empty}</>;
  return (
    <div className="onb-cards">
      {items.map((a) => (
        <AssignmentCard key={a.id} a={a} onChanged={onChanged} />
      ))}
    </div>
  );
}

/** 신규 직원 온보딩 화면 */
export default function OnboardingPage() {
  const { info } = useSession();
  const me = info?.user ?? null;
  const manager = can(me?.role, 'onboarding.manage');
  const toast = useToast();

  const assignments = useApi<OnboardingAssignment[]>(`${KEY}:assignments`, () => api.get('/api/onboarding/assignments'));
  const templates = useApi<OnboardingTemplate[]>(manager ? `${KEY}:templates` : null, () => api.get('/api/onboarding/templates'));
  const people = useApi<{ data: UserRow[] }>(manager ? `${KEY}:people` : null, () => api.page<UserRow>('/api/users?status=active&pageSize=200'));

  const [local, setLocal] = useState<{ base: OnboardingAssignment[] | undefined; map: Record<number, OnboardingAssignment> }>({ base: undefined, map: {} });
  const [jobType, setJobType] = useState<JobType>('hygienist');
  const [editing, setEditing] = useState<OnboardingTemplate | 'new' | null>(null);
  const [assigning, setAssigning] = useState<{ templateId?: number } | null>(null);
  const [removing, setRemoving] = useState<OnboardingAssignment | null>(null);

  // 다른 사람(직원·멘토)이 체크한 것을 보려고 주기적으로 다시 불러온다
  const reload = assignments.reload;
  useEffect(() => {
    const t = setInterval(() => reload(), REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  // 체크 직후 받은 값(local)은 같은 서버 목록을 보고 있을 때만 쓴다. 서버에서 새로 받으면 버린다
  const list = useMemo(() => {
    const map = local.base === assignments.data ? local.map : {};
    return (assignments.data ?? []).map((a) => map[a.id] ?? a);
  }, [assignments.data, local]);
  const mine = list.filter((a) => a.relation === 'self');
  const mentoring = list.filter((a) => a.relation === 'mentor');
  const changed = (a: OnboardingAssignment) =>
    setLocal((cur) => ({ base: assignments.data, map: { ...(cur.base === assignments.data ? cur.map : {}), [a.id]: a } }));

  const summary = assignments.data
    ? manager
      ? `진행 중인 온보딩 ${list.filter((a) => a.percent < 100).length}건 · 템플릿 ${templates.data?.filter((t) => t.active).length ?? 0}개`
      : mine.length || mentoring.length
        ? `내 온보딩 ${mine.length}건 · 내가 멘토인 직원 ${mentoring.length}명`
        : '배정된 온보딩이 없어요'
    : '불러오는 중이에요';

  const remove = async () => {
    if (!removing) return;
    try {
      await api.del(`/api/onboarding/assignments/${removing.id}`);
      toast.show(`${removing.user.name} 님 온보딩 배정을 지웠어요.`);
    } catch (err) {
      toast.error(messageOf(err, '지우지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setRemoving(null);
      invalidate(KEY);
    }
  };

  const allColumns: Column<OnboardingAssignment>[] = [
    { key: 'who', header: '신규 직원', render: (a) => `${a.user.name} · ${JOB_TYPE_LABELS[a.user.jobType]}`, sortValue: (a) => a.user.name },
    { key: 'mentor', header: '멘토', render: (a) => a.mentor.name, sortValue: (a) => a.mentor.name },
    { key: 'title', header: '체크리스트', render: (a) => <span className="training-note">{a.title}</span>, sortValue: (a) => a.title },
    { key: 'start', header: '시작일', render: (a) => <span className="num">{a.startedOn}</span>, sortValue: (a) => a.startedOn },
    {
      key: 'pct',
      header: '진행률',
      render: (a) => (
        <span className="onb-pct" style={{ minWidth: 150 }}>
          <Progress value={a.percent / 100} label={`${a.user.name} 님 진행률`} />
          <b className="num" style={{ fontSize: 13, minWidth: 40 }}>
            {a.percent}%
          </b>
        </span>
      ),
      sortValue: (a) => a.percent,
    },
    {
      key: 'del',
      header: '지우기',
      render: (a) => (
        <Button size="sm" variant="ghost" onClick={() => setRemoving(a)} aria-label={`${a.user.name} 님 온보딩 배정 지우기`}>
          지우기
        </Button>
      ),
    },
  ];

  const tplColumns: Column<OnboardingTemplate>[] = [
    {
      key: 'title',
      header: '템플릿',
      render: (t) => (
        <span className="training-name">
          <b>{t.title}</b>
          <small>
            항목 {t.items.length}개{t.source === 'ai' ? ' · AI 초안' : ''}
          </small>
        </span>
      ),
      sortValue: (t) => t.title,
    },
    { key: 'job', header: '직무', render: (t) => JOB_TYPE_LABELS[t.jobType], sortValue: (t) => t.jobType },
    { key: 'used', header: '배정', align: 'right', render: (t) => <span className="num">{t.assignedCount}명</span>, sortValue: (t) => t.assignedCount },
    { key: 'active', header: '사용', render: (t) => (t.active ? <Chip tone="ok">사용 중</Chip> : <Chip tone="ghost">꺼 둠</Chip>), sortValue: (t) => (t.active ? 0 : 1) },
    {
      key: 'act',
      header: '할 일',
      render: (t) => (
        <span className="training-acts">
          <Button size="sm" icon="people" disabled={!t.active} onClick={() => setAssigning({ templateId: t.id })} aria-label={`${t.title} 배정`}>
            배정
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`${t.title} 고치기`}>
            고치기
          </Button>
        </span>
      ),
    },
  ];

  const loadingCards = assignments.loading && !assignments.data ? <Skeleton rows={3} /> : null;
  const errorCards = assignments.error && !assignments.data ? <ErrorState message={assignments.error.message} onRetry={assignments.reload} /> : null;
  const activeTemplates = templates.data?.filter((t) => t.active) ?? [];
  const peopleList = (people.data?.data ?? []).map((u) => ({ id: u.id, name: u.name, jobType: u.jobType }));

  return (
    <>
      <PageHeader
        title="신규 직원 온보딩"
        summary={summary}
        actions={
          manager ? (
            <Button variant="primary" icon="people" disabled={!activeTemplates.length || !peopleList.length} onClick={() => setAssigning({})}>
              온보딩 배정하기
            </Button>
          ) : null
        }
      />
      <div className="training-stack">
        {!manager || mine.length ? (
          <Card id="onb-mine" title="내 온보딩" sub="항목을 끝내면 체크해 주세요. 멘토도 같은 진행률을 봐요.">
            {loadingCards}
            {errorCards}
            {assignments.data ? (
              <CardList
                items={mine}
                onChanged={changed}
                empty={<EmptyState icon="check" title="배정된 온보딩이 없어요" description="실장님이 체크리스트를 배정하면 여기에서 하나씩 체크할 수 있어요." />}
              />
            ) : null}
          </Card>
        ) : null}

        {mentoring.length || (!manager && assignments.data && !mine.length) ? (
          <Card id="onb-mentor" title="내가 멘토인 직원" sub="신규 직원과 같은 체크리스트예요. 함께 확인한 항목을 체크해 주세요.">
            <CardList items={mentoring} onChanged={changed} empty={<EmptyState icon="people" title="맡은 신규 직원이 없어요" description="멘토로 지정되면 여기에 보여요." />} />
          </Card>
        ) : null}

        {manager ? (
          <Card title="전체 온보딩 배정" sub={assignments.data ? `${list.length}건` : undefined}>
            <DataTable
              caption="전체 온보딩 배정과 진행률"
              columns={allColumns}
              rows={assignments.data ? list : undefined}
              rowKey={(a) => a.id}
              loading={assignments.loading}
              error={assignments.error}
              onRetry={assignments.reload}
              empty={
                <EmptyState
                  icon="people"
                  title="아직 배정한 온보딩이 없어요"
                  description="템플릿을 고른 뒤 신규 직원과 멘토를 정해 배정해 주세요."
                  action={
                    <Button icon="people" disabled={!activeTemplates.length} onClick={() => setAssigning({})}>
                      첫 온보딩 배정하기
                    </Button>
                  }
                />
              }
            />
          </Card>
        ) : null}

        {manager ? (
          <div className="onb-cols">
            <Card title="AI로 체크리스트 초안 만들기" sub="직무를 고르면 첫 주~한 달 동안 익힐 항목 초안을 만들어 드려요. 고친 뒤 템플릿으로 저장하세요.">
              <div className="training-pad training-form">
                <Field label="직무" required>
                  <Select value={jobType} onChange={(e) => setJobType(e.target.value as JobType)} options={JOB_OPTIONS} />
                </Field>
                <AiPanel
                  feature="onboarding"
                  label="추가 요청(선택)"
                  rows={2}
                  placeholder="예: 우리 병원은 디지털 엑스레이를 써요. 첫 주는 참관 위주로 해 주세요."
                  allowEmpty
                  primary={false}
                  runLabel="초안 만들기"
                  buildInput={(notes) => ({ jobType: JOB_TYPE_LABELS[jobType], ...(notes.trim() ? { notes: notes.trim() } : {}) })}
                  renderResult={(r) => {
                    const items = cleanDraftItems(r.extra);
                    if (!items.length) return <p className="muted">AI 응답을 이해하지 못했습니다. 다시 시도해 주세요.</p>;
                    return <DraftEditor key={r.requestId} initial={items} jobType={jobType} onSaved={() => invalidate(`${KEY}:templates`)} />;
                  }}
                />
              </div>
            </Card>
            <Card
              title="온보딩 템플릿"
              sub={templates.data ? `${templates.data.length}개` : undefined}
              action={
                <Button size="sm" icon="plus" onClick={() => setEditing('new')}>
                  직접 만들기
                </Button>
              }
            >
              <DataTable
                caption="직무별 온보딩 템플릿"
                columns={tplColumns}
                rows={templates.data}
                rowKey={(t) => t.id}
                loading={templates.loading}
                error={templates.error}
                onRetry={templates.reload}
                empty={
                  <EmptyState
                    icon="doc"
                    title="아직 템플릿이 없어요"
                    description="AI 초안을 저장하거나 직접 만들어 주세요."
                    action={
                      <Button icon="plus" onClick={() => setEditing('new')}>
                        첫 템플릿 만들기
                      </Button>
                    }
                  />
                }
              />
            </Card>
          </div>
        ) : null}
      </div>

      {editing ? (
        <TemplateDialog
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(t) => {
            setEditing(null);
            invalidate(`${KEY}:templates`);
            toast.show(`"${t.title}" 템플릿을 저장했어요.`);
          }}
        />
      ) : null}
      {assigning && templates.data ? (
        <AssignDialog
          templates={templates.data}
          people={peopleList}
          initialTemplateId={assigning.templateId}
          onClose={() => setAssigning(null)}
          onSaved={(a) => {
            setAssigning(null);
            invalidate(KEY);
            toast.show(`${a.user.name} 님에게 "${a.title}"을(를) 배정했어요. 멘토는 ${a.mentor.name} 님이에요.`);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="온보딩 배정 지우기"
        message={removing ? `${removing.user.name} 님의 "${removing.title}" 배정과 체크 기록을 지울까요?` : ''}
        confirmLabel="지우기"
        danger
      />
    </>
  );
}

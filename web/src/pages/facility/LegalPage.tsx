// 이 파일이 하는 일: "법정 의무 일정" 화면(/facility/legal, FR-100). 기본 템플릿 22개(TRD TD-022)와 직접 추가한 항목을 근거·출처 링크·확인 상태 칩과 함께 보여 준다.
// 항목을 누르면 오른쪽 서랍에 자세한 설명·수행 이력이 열리고, 실장 이상은 수행 기록(수행일)을 남겨 다음 예정일·D-day를 바로 본다.
// 관리자는 주기·확인 상태·적용 여부("해당 없음")를 고치고 항목을 추가한다(템플릿에서 가져와 장비별 항목 만들기). 꺼진 항목은 대시보드·알림에서 빠진다.
// 화면 위에는 "법령은 바뀔 수 있습니다(확인일 2026-11-02)" 고지를 늘 보여 준다. 보는 범위·분류는 주소(?view=&cat=)에 남긴다.
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip, Kpi, KpiRow, type Tone } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Checkbox, DateInput, Field, NumberInput, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import {
  LEGAL_APPLICABILITIES,
  LEGAL_APPLICABILITY_LABELS,
  LEGAL_CATEGORIES,
  LEGAL_CATEGORY_LABELS,
  LEGAL_NOTICE,
  LEGAL_VERIFY_HINTS,
  LEGAL_VERIFY_LABELS,
  LEGAL_VERIFY_STATUSES,
  type LegalApplicability,
  type LegalCategory,
  type LegalDueState,
  type LegalTask,
  type LegalTaskList,
  type LegalTaskLog,
  type LegalVerifyStatus,
} from '../../../../shared/schemas/legal.ts';
import './legal.css';

const KEY = 'facility:legal';

/** 보는 범위 */
type View = 'all' | 'due' | 'first' | 'off';
const VIEWS: ReadonlyArray<{ value: View; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'due', label: '다가오는 일정' },
  { value: 'first', label: '수행일 필요' },
  { value: 'off', label: '해당 없음' },
];
const DUE_STATES: ReadonlySet<LegalDueState> = new Set(['overdue', 'today', 'soon', 'upcoming']);

/** 확인 상태 칩 색 */
export const VERIFY_TONES: Record<LegalVerifyStatus, Tone> = { verified: 'ok', recommended: 'info', needs_check: 'warn' };

/** 일정 상태 칩(글자·색). 색만으로 구분하지 않게 늘 글자를 붙인다 */
export function dueChip(t: Pick<LegalTask, 'dueState' | 'daysLeft' | 'verifyStatus'>): { text: string; tone: Tone } {
  const n = t.daysLeft ?? 0;
  switch (t.dueState) {
    case 'off':
      return { text: '해당 없음', tone: 'ghost' };
    case 'no_cycle':
      return t.verifyStatus === 'needs_check' ? { text: '주기 확인 필요', tone: 'warn' } : { text: '안내 항목', tone: 'ghost' };
    case 'first_needed':
      return { text: '최초 수행일 입력 필요', tone: 'warn' };
    case 'overdue':
      return { text: `기한 지남 ${-n}일`, tone: 'danger' };
    case 'today':
      return { text: '오늘 기한', tone: 'danger' };
    case 'soon':
      return { text: `D-${n}`, tone: 'warn' };
    case 'upcoming':
      return { text: `D-${n}`, tone: 'info' };
    default:
      return { text: `D-${n}`, tone: 'ok' };
  }
}

/** 급한 순서: 기한 지남 → 오늘 → 7일 안 → 알림 일수 안 → 수행일 필요 → 여유 → 안내 → 해당 없음 */
const RANK: Record<LegalDueState, number> = { overdue: 0, today: 1, soon: 2, upcoming: 3, first_needed: 4, ok: 5, no_cycle: 6, off: 7 };

/** 목록을 급한 순서로 정렬한다(같은 상태면 남은 날 → 원래 순서) */
export function sortByUrgency(items: readonly LegalTask[]): LegalTask[] {
  return [...items].sort((a, b) => RANK[a.dueState] - RANK[b.dueState] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.id - b.id);
}

/** 보는 범위·분류로 거른다 */
export function filterTasks(items: readonly LegalTask[], view: View, cat: LegalCategory | ''): LegalTask[] {
  return items.filter((t) => {
    if (cat && t.category !== cat) return false;
    if (view === 'due') return DUE_STATES.has(t.dueState);
    if (view === 'first') return t.dueState === 'first_needed';
    if (view === 'off') return t.dueState === 'off';
    return true;
  });
}

/** 오류를 화면 문구로 */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 출처 링크(새 창). 표의 행 누르기와 겹치지 않게 클릭 전달을 막는다 */
function SourceLink({ task }: { task: LegalTask }) {
  if (!task.sourceUrl) return <span className="lg-muted">출처 없음</span>;
  return (
    <a
      className="lg-src"
      href={task.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`법령 보기: ${task.title} 근거 법령(새 창)`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      법령 보기
    </a>
  );
}

/** 휴대폰에서 칸 이름을 앞에 붙인다(넓은 화면에서는 숨김) */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="lg-m" aria-hidden="true">
        {label}
      </span>
      <span className="lg-v">{children}</span>
    </>
  );
}

/** 법정 의무 일정 화면 */
export default function LegalPage() {
  const { info } = useSession();
  const role = info?.user?.role;
  const canEdit = can(role, 'legal.edit');
  const canDone = can(role, 'legal.done');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const viewParam = params.get('view');
  const view: View = VIEWS.some((v) => v.value === viewParam) ? (viewParam as View) : 'all';
  const catParam = params.get('cat') ?? '';
  const cat = (LEGAL_CATEGORIES as readonly string[]).includes(catParam) ? (catParam as LegalCategory) : '';
  const state = useApi<LegalTaskList>(KEY, () => api.get('/api/legal-tasks'));
  const list = state.data;
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const setFilter = (next: { view?: View; cat?: LegalCategory | '' }) => {
    const p: Record<string, string> = {};
    const v = next.view ?? view;
    const c = next.cat ?? cat;
    if (v !== 'all') p.view = v;
    if (c) p.cat = c;
    setParams(p, { replace: true });
  };

  const items = useMemo(() => (list ? sortByUrgency(filterTasks(list.items, view, cat)) : undefined), [list, view, cat]);
  const counts = useMemo(() => {
    const all = list?.items ?? [];
    return {
      total: all.length,
      overdue: all.filter((t) => t.dueState === 'overdue' || t.dueState === 'today').length,
      due: all.filter((t) => t.dueState === 'soon' || t.dueState === 'upcoming').length,
      first: all.filter((t) => t.dueState === 'first_needed').length,
      off: all.filter((t) => t.dueState === 'off').length,
    };
  }, [list]);
  const opened = list?.items.find((t) => t.id === openId) ?? null;

  const columns: ReadonlyArray<Column<LegalTask>> = [
    {
      key: 'title',
      header: '항목',
      sortValue: (t) => t.title,
      render: (t) => (
        <span className="lg-title">
          <b>{t.title}</b>
          <small>
            {LEGAL_CATEGORY_LABELS[t.category]} · {t.appliesText || LEGAL_APPLICABILITY_LABELS[t.applicability]}
          </small>
        </span>
      ),
    },
    { key: 'cycle', header: '주기', render: (t) => <Cell label="주기">{t.cycleText}</Cell> },
    {
      key: 'verify',
      header: '확인 상태',
      sortValue: (t) => LEGAL_VERIFY_STATUSES.indexOf(t.verifyStatus),
      render: (t) => (
        <Cell label="확인 상태">
          <Chip tone={VERIFY_TONES[t.verifyStatus]} title={LEGAL_VERIFY_HINTS[t.verifyStatus]}>
            {LEGAL_VERIFY_LABELS[t.verifyStatus]}
          </Chip>
        </Cell>
      ),
    },
    {
      key: 'due',
      header: '다음 예정일',
      sortValue: (t) => (t.dueState === 'off' ? null : t.nextDueOn),
      render: (t) => {
        const c = dueChip(t);
        return (
          <Cell label="다음 예정일">
            <span className="lg-duecell">
              <span className="lg-due">
                {t.nextDueOn ? <span className="num">{t.nextDueOn}</span> : null}
                <Chip tone={c.tone}>{c.text}</Chip>
              </span>
              <small className="num">최근 수행 {t.lastDoneOn ?? '없음'}</small>
            </span>
          </Cell>
        );
      },
    },
    {
      key: 'basis',
      header: '근거·출처',
      render: (t) => (
        <Cell label="근거">
          <span className="lg-basis">
            <span>{t.basis || '-'}</span>
            <SourceLink task={t} />
          </span>
        </Cell>
      ),
    },
  ];

  const summary = list ? `전체 ${counts.total}개 · 기한 지남·오늘 ${counts.overdue}개 · ${list.warnDays}일 안 ${counts.due}개` : '불러오는 중이에요';

  return (
    <>
      <PageHeader
        title="법정 의무 일정"
        summary={summary}
        actions={
          canEdit ? (
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)} disabled={!list}>
              항목 추가
            </Button>
          ) : undefined
        }
      />
      <p className="form-note lg-notice" role="note" data-testid="legal-notice">
        <Icon name="alert" size="md" />
        <span>{LEGAL_NOTICE}</span>
      </p>
      <KpiRow label="법정 일정 요약">
        <Kpi label="기한 지남·오늘" value={list ? counts.overdue : null} unit="개" tone={counts.overdue ? 'danger' : undefined} hint="바로 처리해 주세요" />
        <Kpi label={`${list?.warnDays ?? 30}일 안 예정`} value={list ? counts.due : null} unit="개" tone={counts.due ? 'warn' : undefined} hint="알림이 가는 항목" />
        <Kpi label="최초 수행일 필요" value={list ? counts.first : null} unit="개" hint="수행일을 적어 주세요" />
        <Kpi label="해당 없음" value={list ? counts.off : null} unit="개" hint="대시보드·알림에서 빠져요" />
      </KpiRow>
      <Card className="lg-card">
        <Toolbar label="법정 일정 도구">
          <Segmented<View> label="보는 범위" value={view} onChange={(v) => setFilter({ view: v })} options={VIEWS} />
          <span className="grow" />
          <select className="input lg-cat" aria-label="분류" value={cat} onChange={(e) => setFilter({ cat: e.target.value as LegalCategory | '' })}>
            <option value="">모든 분류</option>
            {LEGAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {LEGAL_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Toolbar>
        <div className="lg-table" data-testid="legal-table">
          <DataTable<LegalTask>
            caption="법정 의무 일정 목록"
            columns={columns}
            rows={items}
            rowKey={(t) => t.id}
            rowLabel={(t) => t.title}
            loading={state.loading}
            error={state.error}
            onRetry={state.reload}
            onRowClick={(t) => setOpenId(t.id)}
            empty={
              <div style={{ padding: 'var(--pad)' }}>
                <EmptyState
                  icon="shield"
                  title={view === 'all' && !cat ? '법정 일정이 없어요' : '조건에 맞는 일정이 없어요'}
                  description={view === 'all' && !cat ? '기본 템플릿을 불러오지 못했어요. 화면을 새로 고쳐 주세요.' : '보는 범위나 분류를 바꿔 보세요.'}
                  action={
                    view !== 'all' || cat ? (
                      <Button onClick={() => setFilter({ view: 'all', cat: '' })}>전체 보기</Button>
                    ) : canEdit ? (
                      <Button icon="plus" onClick={() => setAdding(true)}>
                        첫 항목 추가
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            }
          />
        </div>
      </Card>

      {opened ? (
        <TaskDrawer
          key={opened.id}
          task={opened}
          today={list?.today ?? ''}
          canEdit={canEdit}
          canDone={canDone}
          onClose={() => setOpenId(null)}
          onChanged={(msg) => {
            invalidate(KEY);
            toast.show(msg);
          }}
        />
      ) : null}
      {adding && list ? (
        <AddDialog
          templates={list.items.filter((t) => t.templateKey)}
          today={list.today}
          onClose={() => setAdding(false)}
          onSaved={(t) => {
            setAdding(false);
            invalidate(KEY);
            toast.show(`"${t.title}" 항목을 추가했어요.`);
            setOpenId(t.id);
          }}
        />
      ) : null}
    </>
  );
}

/** 자세히 보기·수행 기록·설정 수정 서랍 */
function TaskDrawer({
  task,
  today,
  canEdit,
  canDone,
  onClose,
  onChanged,
}: {
  task: LegalTask;
  today: string;
  canEdit: boolean;
  canDone: boolean;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const logs = useApi<LegalTaskLog[]>(`${KEY}:logs:${task.id}:${task.lastDoneOn ?? ''}`, () => api.get(`/api/legal-tasks/${task.id}/logs`));
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const chip = dueChip(task);

  const toggle = async () => {
    setToggling(true);
    setToggleError(null);
    try {
      await api.patch(`/api/legal-tasks/${task.id}`, { enabled: !task.enabled });
      onChanged(task.enabled ? `"${task.title}"을(를) 해당 없음으로 껐어요. 대시보드·알림에서 빠져요.` : `"${task.title}"을(를) 다시 켰어요.`);
    } catch (err) {
      setToggleError(messageOf(err, '바꾸지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setToggling(false);
    }
  };

  return (
    <Dialog open kind="drawer" onClose={onClose} title={editing ? `${task.title} 설정 수정` : task.title}>
      {editing ? (
        <TaskForm
          initial={task}
          submitLabel="저장"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await api.patch(`/api/legal-tasks/${task.id}`, body);
            setEditing(false);
            onChanged(`"${body.title ?? task.title}" 설정을 저장했어요. 다음 예정일을 다시 계산했어요.`);
          }}
        />
      ) : (
        <div className="lg-drawer" data-testid="legal-drawer">
          <div className="lg-chips">
            <Chip tone={VERIFY_TONES[task.verifyStatus]} title={LEGAL_VERIFY_HINTS[task.verifyStatus]}>
              {LEGAL_VERIFY_LABELS[task.verifyStatus]}
            </Chip>
            <Chip>{LEGAL_CATEGORY_LABELS[task.category]}</Chip>
            <Chip>{LEGAL_APPLICABILITY_LABELS[task.applicability]}</Chip>
            <Chip tone={chip.tone}>{chip.text}</Chip>
          </div>
          <dl className="lg-dl">
            <dt>다음 예정일</dt>
            <dd data-testid="legal-next-due">
              {task.nextDueOn ? (
                <>
                  <b className="num">{task.nextDueOn}</b> <span>({chip.text})</span>
                </>
              ) : (
                chip.text
              )}
            </dd>
            <dt>최근 수행일</dt>
            <dd className="num">{task.lastDoneOn ?? '아직 없음'}</dd>
            <dt>주기</dt>
            <dd>{task.cycleText}</dd>
            <dt>적용 조건</dt>
            <dd>{task.appliesText ?? LEGAL_APPLICABILITY_LABELS[task.applicability]}</dd>
            <dt>근거</dt>
            <dd>{task.basis || '-'}</dd>
            <dt>출처</dt>
            <dd>
              <SourceLink task={task} />
            </dd>
            <dt>법령 확인일</dt>
            <dd className="num">{task.checkedOn ?? '확인 전'}</dd>
            {task.note ? (
              <>
                <dt>메모</dt>
                <dd>{task.note}</dd>
              </>
            ) : null}
          </dl>
          {task.guidance ? (
            <p className="form-note">
              <Icon name="shield" size="md" />
              <span>{task.guidance}</span>
            </p>
          ) : null}

          {canDone && task.enabled ? <DoneForm task={task} today={today} onSaved={onChanged} /> : null}
          {!task.enabled ? (
            <p className="form-note lg-off" role="status">
              <Icon name="lock" size="md" />
              <span>"해당 없음"으로 끈 항목이에요. 대시보드와 알림에 나오지 않아요.</span>
            </p>
          ) : null}

          {canEdit ? (
            <section className="lg-sec" aria-label="관리자 설정">
              <h3>관리자 설정</h3>
              {toggleError ? (
                <div className="form-error" role="alert">
                  <Icon name="alert" size="md" />
                  {toggleError}
                </div>
              ) : null}
              <div className="lg-actions">
                <Button icon="gear" onClick={() => setEditing(true)}>
                  주기·상태 수정
                </Button>
                <Button onClick={() => void toggle()} loading={toggling}>
                  {task.enabled ? '해당 없음으로 끄기' : '다시 켜기'}
                </Button>
              </div>
            </section>
          ) : null}

          <section className="lg-sec" aria-label="수행 이력">
            <h3>수행 이력</h3>
            {logs.error && !logs.data ? (
              <ErrorState message={logs.error.message} onRetry={logs.reload} />
            ) : !logs.data ? (
              <Skeleton rows={2} label="수행 이력 불러오는 중" />
            ) : logs.data.length === 0 ? (
              <EmptyState icon="cal" title="수행 기록이 없어요" description={canDone ? '위에서 수행일을 적으면 다음 예정일이 계산돼요.' : '실장님이 수행일을 기록하면 여기에 쌓여요.'} />
            ) : (
              <ul className="lg-logs" data-testid="legal-logs">
                {logs.data.slice(0, 20).map((l) => (
                  <li key={l.id}>
                    <b className="num">{l.doneOn}</b>
                    <span>{l.note ?? ''}</span>
                    <small>
                      {l.user?.name ?? '-'} · {formatDateTime(l.createdAt)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

/** 수행 기록 남기기(실장 이상) */
function DoneForm({ task, today, onSaved }: { task: LegalTask; today: string; onSaved: (msg: string) => void }) {
  const [doneOn, setDoneOn] = useState(today);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(doneOn)) {
      setErrors({ doneOn: '수행일을 골라 주세요.' });
      return;
    }
    if (today && doneOn > today) {
      setErrors({ doneOn: '오늘이나 지난 날짜를 골라 주세요.' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const t = await api.post<LegalTask>(`/api/legal-tasks/${task.id}/done`, { doneOn, note: note.trim() || null });
      setNote('');
      onSaved(t.nextDueOn ? `수행 기록을 남겼어요. 다음 예정일은 ${t.nextDueOn}이에요.` : '수행 기록을 남겼어요.');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '기록하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="lg-sec lg-done" onSubmit={submit} noValidate aria-label="수행 기록 남기기">
      <h3>수행 기록 남기기</h3>
      {formError ? (
        <div className="form-error" role="alert">
          <Icon name="alert" size="md" />
          {formError}
        </div>
      ) : null}
      <div className="lg-done-row">
        <Field label="수행일" required error={errors.doneOn}>
          <DateInput className="input" value={doneOn} max={today || undefined} onChange={(e) => setDoneOn(e.target.value)} />
        </Field>
        <Field label="메모" help="예: 검사기관 합격, 교육 이수자 5명" error={errors.note}>
          <TextInput className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="lg-actions">
        <Button type="submit" variant="primary" icon="check" loading={busy}>
          기록 저장
        </Button>
      </div>
    </form>
  );
}

/** 추가·수정 입력 값 */
interface TaskBody {
  title?: string;
  category?: LegalCategory;
  cycleMonths?: number | null;
  cycleDays?: number | null;
  cycleText?: string | null;
  basis?: string;
  sourceUrl?: string | null;
  verifyStatus?: LegalVerifyStatus;
  applicability?: LegalApplicability;
  appliesText?: string | null;
  guidance?: string | null;
  note?: string | null;
  enabled?: boolean;
  lastDoneOn?: string | null;
}

/** 글자 칸 값 → 숫자(빈칸이면 null) */
function numOrNull(v: string): number | null {
  const t = v.trim();
  return t === '' ? null : Number(t);
}

type Draft = {
  title: string;
  category: LegalCategory;
  cycleMonths: string;
  cycleDays: string;
  cycleText: string;
  basis: string;
  sourceUrl: string;
  verifyStatus: LegalVerifyStatus;
  applicability: LegalApplicability;
  appliesText: string;
  guidance: string;
  note: string;
  enabled: boolean;
};

/** 항목 → 입력 초안 */
function draftOf(t: Partial<LegalTask> | null): Draft {
  return {
    title: t?.title ?? '',
    category: t?.category ?? 'other',
    cycleMonths: t?.cycleMonths ? String(t.cycleMonths) : '',
    cycleDays: t?.cycleDays ? String(t.cycleDays) : '',
    cycleText: t?.cycleText && t.cycleText !== '—' && !/마다$/.test(t.cycleText) ? t.cycleText : '',
    basis: t?.basis ?? '',
    sourceUrl: t?.sourceUrl ?? '',
    verifyStatus: t?.verifyStatus ?? 'needs_check',
    applicability: t?.applicability ?? 'always',
    appliesText: t?.appliesText ?? '',
    guidance: t?.guidance ?? '',
    note: t?.note ?? '',
    enabled: t?.enabled ?? true,
  };
}

/** 추가·수정 공용 입력 양식. initial이 있으면 수정, 없으면 추가 */
function TaskForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  extra,
  formId = 'legal-task-form',
  startDraft,
}: {
  initial: LegalTask | null;
  submitLabel: string;
  onSubmit: (body: TaskBody) => Promise<void>;
  onCancel: () => void;
  extra?: { today: string };
  formId?: string;
  /** 처음 채울 값(템플릿에서 가져오기). 바뀌면 key를 바꿔 양식을 새로 그린다 */
  startDraft?: Draft | null;
}) {
  const [d, setD] = useState<Draft>(() => startDraft ?? draftOf(initial));
  const [lastDoneOn, setLastDoneOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!d.title.trim()) errs.title = '항목 이름을 적어 주세요.';
    const months = numOrNull(d.cycleMonths);
    const days = numOrNull(d.cycleDays);
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) errs.cycleMonths = '주기(개월)는 1~120 사이로 적어 주세요.';
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) errs.cycleDays = '주기(일)는 1~3650 사이로 적어 주세요.';
    if (extra && lastDoneOn && lastDoneOn > extra.today) errs.lastDoneOn = '오늘이나 지난 날짜를 골라 주세요.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const body: TaskBody = {
      title: d.title.trim(),
      category: d.category,
      cycleMonths: months,
      cycleDays: days,
      cycleText: d.cycleText.trim() || null,
      basis: d.basis.trim(),
      sourceUrl: d.sourceUrl.trim() || null,
      verifyStatus: d.verifyStatus,
      applicability: d.applicability,
      appliesText: d.appliesText.trim() || null,
      guidance: d.guidance.trim() || null,
      note: d.note.trim() || null,
    };
    if (initial) body.enabled = d.enabled;
    if (extra && lastDoneOn) body.lastDoneOn = lastDoneOn;
    setBusy(true);
    try {
      await onSubmit(body);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form id={formId} className="lg-form" onSubmit={submit} noValidate aria-label={initial ? '법정 일정 설정 수정' : '법정 일정 추가'}>
      {formError ? (
        <div className="form-error" role="alert">
          <Icon name="alert" size="md" />
          {formError}
        </div>
      ) : null}
      <Field label="항목 이름" required error={errors.title}>
        <TextInput className="input" value={d.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <div className="lg-grid2">
        <Field label="분류" error={errors.category}>
          <Select className="input" value={d.category} onChange={(e) => set({ category: e.target.value as LegalCategory })} options={LEGAL_CATEGORIES.map((c) => ({ value: c, label: LEGAL_CATEGORY_LABELS[c] }))} />
        </Field>
        <Field label="확인 상태" error={errors.verifyStatus} help={LEGAL_VERIFY_HINTS[d.verifyStatus]}>
          <Select className="input" value={d.verifyStatus} onChange={(e) => set({ verifyStatus: e.target.value as LegalVerifyStatus })} options={LEGAL_VERIFY_STATUSES.map((s) => ({ value: s, label: LEGAL_VERIFY_LABELS[s] }))} />
        </Field>
        <Field label="주기(개월)" error={errors.cycleMonths} help="예: 3년이면 36, 1년이면 12">
          <NumberInput className="input" inputMode="numeric" min={1} max={120} value={d.cycleMonths} onChange={(e) => set({ cycleMonths: e.target.value })} />
        </Field>
        <Field label="주기(일)" error={errors.cycleDays} help="예: 주 1회면 7. 비우면 개월만 써요">
          <NumberInput className="input" inputMode="numeric" min={1} max={3650} value={d.cycleDays} onChange={(e) => set({ cycleDays: e.target.value })} />
        </Field>
      </div>
      <Field label="주기 설명" error={errors.cycleText} help="비우면 숫자로 보여 줘요(예: 3년마다)">
        <TextInput className="input" value={d.cycleText} maxLength={100} onChange={(e) => set({ cycleText: e.target.value })} />
      </Field>
      <div className="lg-grid2">
        <Field label="적용 조건" error={errors.applicability}>
          <Select className="input" value={d.applicability} onChange={(e) => set({ applicability: e.target.value as LegalApplicability })} options={LEGAL_APPLICABILITIES.map((a) => ({ value: a, label: LEGAL_APPLICABILITY_LABELS[a] }))} />
        </Field>
        <Field label="적용 조건 설명" error={errors.appliesText}>
          <TextInput className="input" value={d.appliesText} maxLength={100} onChange={(e) => set({ appliesText: e.target.value })} />
        </Field>
      </div>
      <Field label="근거" error={errors.basis} help="예: 진단용 방사선 규칙 제4조">
        <TextInput className="input" value={d.basis} maxLength={200} onChange={(e) => set({ basis: e.target.value })} />
      </Field>
      <Field label="출처 주소" error={errors.sourceUrl} help="https://로 시작하는 주소(국가법령정보센터 등)">
        <TextInput className="input" type="url" inputMode="url" value={d.sourceUrl} maxLength={500} onChange={(e) => set({ sourceUrl: e.target.value })} />
      </Field>
      <Field label="메모" error={errors.note}>
        <TextArea className="input" rows={2} value={d.note} maxLength={500} onChange={(e) => set({ note: e.target.value })} />
      </Field>
      {extra ? (
        <Field label="최근 수행일(선택)" error={errors.lastDoneOn} help="알고 있으면 적어 주세요. 다음 예정일이 바로 계산돼요">
          <DateInput className="input" value={lastDoneOn} max={extra.today} onChange={(e) => setLastDoneOn(e.target.value)} />
        </Field>
      ) : null}
      {initial ? <Checkbox checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} label="우리 치과에 해당돼요" hint='끄면 "해당 없음"이 되어 대시보드·알림에서 빠져요.' /> : null}
      <div className="lg-actions">
        <Button onClick={onCancel}>취소</Button>
        <Button type="submit" variant="primary" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** 항목 추가 대화상자(관리자). 템플릿을 골라 내용을 채운 뒤 장비별 항목 등으로 고쳐 만든다 */
function AddDialog({ templates, today, onClose, onSaved }: { templates: LegalTask[]; today: string; onClose: () => void; onSaved: (t: LegalTask) => void }) {
  const [tplId, setTplId] = useState('');
  const [override, setOverride] = useState<Draft | null>(null);

  const pick = (id: string) => {
    setTplId(id);
    const t = templates.find((x) => String(x.id) === id);
    if (t) setOverride({ ...draftOf(t), note: '', guidance: '' });
  };

  return (
    <Dialog open wide onClose={onClose} title="법정 일정 추가">
      <div className="lg-form">
        <Field label="템플릿에서 가져오기(선택)" help="고르면 주기·근거·출처가 채워져요. 장비별 정기검사는 이름만 바꿔 저장하세요">
          <Select className="input" value={tplId} onChange={(e) => pick(e.target.value)}>
            <option value="">직접 입력</option>
            {templates.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.title}
              </option>
            ))}
          </Select>
        </Field>
        <TaskForm
          key={tplId || 'blank'}
          initial={null}
          startDraft={override}
          submitLabel="추가"
          extra={{ today }}
          formId="legal-add-form"
          onCancel={onClose}
          onSubmit={async (body) => {
            const t = await api.post<LegalTask>('/api/legal-tasks', body);
            onSaved(t);
          }}
        />
      </div>
    </Dialog>
  );
}

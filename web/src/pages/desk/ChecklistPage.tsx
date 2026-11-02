// 이 파일이 하는 일: "오픈·마감 체크리스트" 화면(/desk/checklist, FR-041). 오늘 항목을 체크하면 체크한 사람과 시각이 바로 보인다(AC2).
// "오늘"은 서버 시계로 정해지므로 날짜가 바뀌면 새로 시작하고, 지난 날짜(?date=)는 체크 상자가 잠긴 채 조회만 된다.
// 실장 이상은 "항목 편집"으로 항목을 더하고, 순서를 올리고 내리고, 담당 직무를 정해 저장한다(AC1). 저장한 순서는 새로 고쳐도 그대로다.
// 보는 종류(오픈·마감)와 날짜는 주소(?kind=&date=)에 남기고, 인쇄 화면(/print/checklist/:kind/:date)으로 갈 수 있다.
import { useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip, Progress } from '../../components/Chip.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { formatDateLong, formatDateTime } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { JOB_TYPE_LABELS, JOB_TYPES, type JobType } from '../../../../shared/enums.ts';
import { CHECKLIST_KIND_LABELS, type ChecklistDay, type ChecklistItemState, type ChecklistKind } from '../../../../shared/schemas/desk.ts';
import './checklist.css';

const KEY = 'desk:checklist';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD'에 n일을 더한다 */
export function shiftDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 담당 직무 이름(없으면 '모두') */
export function roleHintLabel(hint: JobType | null): string {
  return hint ? JOB_TYPE_LABELS[hint] : '모두';
}

/** 오류를 화면 문구로 */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 오픈·마감 체크리스트 화면 */
export default function ChecklistPage() {
  const { info } = useSession();
  const canEdit = can(info?.user?.role, 'checklist.edit');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const kind: ChecklistKind = params.get('kind') === 'close' ? 'close' : 'open';
  const dateParam = params.get('date');
  const date = dateParam && DATE_RE.test(dateParam) ? dateParam : null;
  const key = `${KEY}:${kind}:${date ?? 'today'}`;
  const state = useApi<ChecklistDay>(key, () => api.get(`/api/checklists/${kind}${date ? `?date=${date}` : ''}`));
  const day = state.data;
  const [pending, setPending] = useState<number | null>(null);
  // 누른 즉시 체크 상자가 바뀌어 보이게, 서버 응답 전까지 "이 데이터에 대한 임시 값"을 둔다(새 데이터가 오면 저절로 무시된다)
  const [optimistic, setOptimistic] = useState<{ base: ChecklistDay; id: number; checked: boolean } | null>(null);
  const shownChecked = (item: ChecklistItemState) => (optimistic && optimistic.base === day && optimistic.id === item.id ? optimistic.checked : item.checked);
  const [editing, setEditing] = useState(false);

  /** 주소의 종류·날짜를 바꾼다(오늘이면 날짜를 지운다) */
  const go = (next: { kind?: ChecklistKind; date?: string | null }) => {
    const k = next.kind ?? kind;
    const d = next.date === undefined ? date : next.date;
    const p: Record<string, string> = {};
    if (k !== 'open') p.kind = k;
    if (d && d !== day?.today) p.date = d;
    setParams(p, { replace: true });
  };

  const toggle = async (item: ChecklistItemState, checked: boolean) => {
    setPending(item.id);
    if (day) setOptimistic({ base: day, id: item.id, checked });
    try {
      await api.post<ChecklistDay>('/api/checklists/check', { itemId: item.id, checked });
      invalidate(KEY);
    } catch (err) {
      toast.error(messageOf(err, '체크를 저장하지 못했어요. 다시 시도해 주세요.'));
      setOptimistic(null);
      if (err instanceof ApiError && err.status === 404) invalidate(KEY);
    } finally {
      setPending(null);
    }
  };

  const viewing = day?.date ?? date;
  const summary = day ? `${formatDateLong(day.date)} · ${CHECKLIST_KIND_LABELS[day.kind]} ${day.done}/${day.total} 완료` : '불러오는 중이에요';
  const headerActions = (
    <>
      <Button icon="print" to={viewing ? `/print/checklist/${kind}/${viewing}` : undefined} disabled={!viewing}>
        인쇄
      </Button>
      {canEdit ? (
        <Button icon="list" onClick={() => setEditing(true)} disabled={!day}>
          항목 편집
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader title="오픈·마감 체크리스트" summary={summary} actions={headerActions} />
      <Card>
        <Toolbar label="체크리스트 도구">
          <Segmented<ChecklistKind>
            label="체크리스트 종류"
            value={kind}
            onChange={(k) => go({ kind: k })}
            options={[
              { value: 'open', label: '오픈' },
              { value: 'close', label: '마감' },
            ]}
          />
          <span className="grow" />
          <div className="ck-date" role="group" aria-label="날짜 고르기">
            <Button size="sm" disabled={!viewing} onClick={() => viewing && go({ date: shiftDate(viewing, -1) })}>
              전날
            </Button>
            <input
              type="date"
              className="input"
              aria-label="볼 날짜"
              value={viewing ?? ''}
              max={day?.today}
              onChange={(e) => {
                const v = e.target.value;
                if (DATE_RE.test(v) && (!day || v <= day.today)) go({ date: v });
              }}
            />
            <Button size="sm" disabled={!day || day.date >= day.today} onClick={() => viewing && go({ date: shiftDate(viewing, 1) })}>
              다음 날
            </Button>
            {day && day.readOnly ? (
              <Button size="sm" variant="ghost" onClick={() => go({ date: null })}>
                오늘로
              </Button>
            ) : null}
          </div>
        </Toolbar>
        {state.error && !day ? (
          <div style={{ padding: 'var(--pad)' }}>
            <ErrorState message={state.error.message} onRetry={state.reload} />
          </div>
        ) : !day ? (
          <div style={{ padding: 'var(--pad)' }}>
            <Skeleton rows={6} label="체크리스트 불러오는 중" />
          </div>
        ) : (
          <>
            {day.readOnly ? (
              <p className="form-note ck-note" role="status">
                <Icon name="lock" size="md" />
                지난 날짜({formatDateLong(day.date)}) 기록이에요. 조회만 할 수 있어요.
              </p>
            ) : null}
            {day.total > 0 ? (
              <div className="ck-progress">
                <span className="label">
                  <span>{day.readOnly ? '그날 진행' : '오늘 진행'}</span>
                  <b className="num">
                    {day.done}/{day.total} 완료
                  </b>
                </span>
                <Progress value={day.total ? day.done / day.total : 0} label={`${CHECKLIST_KIND_LABELS[day.kind]} 체크리스트 진행`} />
              </div>
            ) : null}
            {day.items.length === 0 ? (
              <div style={{ padding: 'var(--pad)' }}>
                <EmptyState
                  icon="check"
                  title={day.readOnly ? '이날 기록이 없어요' : `${CHECKLIST_KIND_LABELS[day.kind]} 체크리스트 항목이 없어요`}
                  description={canEdit ? '항목을 더하면 직원들이 매일 체크할 수 있어요.' : '실장님이 항목을 만들면 여기에서 체크할 수 있어요.'}
                  action={
                    canEdit && !day.readOnly ? (
                      <Button icon="plus" onClick={() => setEditing(true)}>
                        첫 항목 더하기
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <ul className="ck-list" aria-label={`${CHECKLIST_KIND_LABELS[day.kind]} 체크리스트 항목`}>
                {day.items.map((item) => (
                  <li key={item.id} className={item.checked ? 'done' : undefined} data-testid="checklist-item">
                    <label className="checkline">
                      <input
                        type="checkbox"
                        checked={shownChecked(item)}
                        disabled={day.readOnly || !item.active || pending === item.id}
                        onChange={(e) => void toggle(item, e.target.checked)}
                      />
                      <span>{item.text}</span>
                    </label>
                    <Chip>{roleHintLabel(item.roleHint)}</Chip>
                    {!item.active ? <Chip tone="ghost">지금은 안 쓰는 항목</Chip> : null}
                    <span className="by" data-testid="checked-by">
                      {item.checked ? (
                        <>
                          <b>{item.checkedBy?.name ?? '-'}</b>
                          <span className="num">{formatDateTime(item.checkedAt)}</span>
                        </>
                      ) : (
                        <span>{day.readOnly ? '체크 안 함' : '아직 안 함'}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      {editing && day ? (
        <EditItemsDialog
          kind={kind}
          items={day.items.filter((i) => i.active)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            invalidate(KEY);
            toast.show(`${CHECKLIST_KIND_LABELS[kind]} 체크리스트 항목을 저장했어요.`);
          }}
        />
      ) : null}
    </>
  );
}

/** 편집 중인 항목 한 줄(새 항목은 id 없음) */
interface DraftItem {
  key: string;
  id?: number;
  text: string;
  roleHint: JobType | '';
}

let draftSeq = 0;

/** 항목 편집 대화상자: 더하기·지우기·순서 올리기/내리기·담당 직무 */
function EditItemsDialog({ kind, items, onClose, onSaved }: { kind: ChecklistKind; items: ChecklistItemState[]; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<DraftItem[]>(() => items.map((i) => ({ key: `i${i.id}`, id: i.id, text: i.text, roleHint: i.roleHint ?? '' })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const label = CHECKLIST_KIND_LABELS[kind];

  const move = (index: number, dir: -1 | 1) => {
    setRows((r) => {
      const next = [...r];
      const target = index + dir;
      if (target < 0 || target >= next.length) return r;
      [next[index], next[target]] = [next[target] as DraftItem, next[index] as DraftItem];
      return next;
    });
  };
  const add = () => {
    draftSeq += 1;
    setRows((r) => [...r, { key: `n${draftSeq}`, text: '', roleHint: '' }]);
    setTimeout(() => listRef.current?.querySelector<HTMLInputElement>('li:last-child input')?.focus(), 0);
  };
  const update = (index: number, patch: Partial<DraftItem>) => setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    rows.forEach((r, i) => {
      if (!r.text.trim()) errs[`items.${i}.text`] = '항목 내용을 적어 주세요.';
    });
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) {
      setTimeout(() => listRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    setBusy(true);
    try {
      await api.put(`/api/checklists/${kind}/items`, { items: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), text: r.text.trim(), roleHint: r.roleHint || null })) });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`${label} 체크리스트 항목 편집`}
      footer={
        <>
          <Button icon="plus" onClick={add}>
            항목 더하기
          </Button>
          <span style={{ flex: 1 }} />
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form="checklist-items-form" variant="primary" loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form id="checklist-items-form" onSubmit={submit} noValidate aria-label={`${label} 체크리스트 항목 편집`} style={{ display: 'grid', gap: 12 }}>
        {formError ? (
          <div className="form-error" role="alert">
            <Icon name="alert" size="md" />
            {formError}
          </div>
        ) : null}
        <p className="form-note">
          <Icon name="list" size="md" />
          위에서부터 보이는 순서대로 저장돼요. 지운 항목의 지난 체크 기록은 그대로 남아요.
        </p>
        {rows.length === 0 ? (
          <EmptyState icon="check" title="항목이 없어요" description="아래 '항목 더하기'로 첫 항목을 만들어 보세요." />
        ) : (
          <ol className="ck-edit" ref={listRef} aria-label="편집할 항목">
            {rows.map((r, i) => {
              const err = errors[`items.${i}.text`];
              const errId = `ck-edit-err-${r.key}`;
              return (
                <li key={r.key} data-testid="checklist-edit-row">
                  <span className="no num">{i + 1}</span>
                  <span style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                    <input
                      className="input"
                      aria-label={`${i + 1}번 항목 내용`}
                      value={r.text}
                      maxLength={100}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                      onChange={(e) => update(i, { text: e.target.value })}
                    />
                    {err ? (
                      <span className="field">
                        <span className="err" id={errId}>
                          {err}
                        </span>
                      </span>
                    ) : null}
                  </span>
                  <select className="input" aria-label={`${i + 1}번 항목 담당`} value={r.roleHint} onChange={(e) => update(i, { roleHint: e.target.value as JobType | '' })}>
                    <option value="">모두</option>
                    {JOB_TYPES.map((j) => (
                      <option key={j} value={j}>
                        {JOB_TYPE_LABELS[j]}
                      </option>
                    ))}
                  </select>
                  <span className="moves">
                    <Button size="sm" aria-label={`${i + 1}번 항목 위로`} disabled={i === 0} onClick={() => move(i, -1)}>
                      위로
                    </Button>
                    <Button size="sm" aria-label={`${i + 1}번 항목 아래로`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                      아래로
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`${i + 1}번 항목 지우기`} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
                      지우기
                    </Button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </form>
    </Dialog>
  );
}

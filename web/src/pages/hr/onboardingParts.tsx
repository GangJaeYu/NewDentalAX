// 이 파일이 하는 일: 신규 직원 온보딩 화면(OnboardingPage, FR-083)의 부품들. 진행 카드(진행률 막대·항목 체크), AI 초안 편집기(고쳐서 템플릿으로 저장),
// 템플릿 직접 만들기·고치기 대화상자, 배정 대화상자(신규 직원·멘토·템플릿·시작일)가 있다. 서버 입력 오류는 칸 아래, 그 밖의 오류는 위쪽 상자에 쉬운 문구로 보인다.
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Chip, Progress } from '../../components/Chip.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Checkbox, DateInput, Field, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { JOB_TYPE_LABELS, JOB_TYPES, type JobType } from '../../../../shared/enums.ts';
import { ONBOARDING_ITEM_MAX, ONBOARDING_MAX_ITEMS, type OnboardingAssignment, type OnboardingTemplate } from '../../../../shared/schemas/onboarding.ts';

/** 오류를 화면 문구로 */
export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 오류 칸이 있으면 첫 칸으로 포커스를 옮긴다 */
function focusInvalid(form: HTMLFormElement | null) {
  setTimeout(() => form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
}

/** 대화상자 위쪽 오류 상자 */
function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="form-error" role="alert">
      <Icon name="alert" size="md" />
      {text}
    </div>
  );
}

/** 직무 고르기 선택지 */
export const JOB_OPTIONS = JOB_TYPES.map((j) => ({ value: j, label: JOB_TYPE_LABELS[j] }));

/** AI 응답 항목에서 "[데모 응답]" 표시를 뺀다 */
export function cleanDraftItems(extra: unknown): string[] {
  const list = (extra as { items?: unknown } | null | undefined)?.items;
  if (!Array.isArray(list)) return [];
  return list.filter((s): s is string => typeof s === 'string').map((s) => s.replace('[데모 응답]', '').trim()).filter(Boolean);
}

/** 진행 카드 하나: 제목·대상·멘토·진행률, 항목 체크(본인·멘토만) */
export function AssignmentCard({ a, onChanged }: { a: OnboardingAssignment; onChanged: (next: OnboardingAssignment) => void }) {
  const toast = useToast();
  // 서버 응답을 기다리는 동안 누른 대로 먼저 보여 준다(실패하면 되돌린다)
  const [pending, setPending] = useState<Record<number, boolean>>({});

  const toggle = async (index: number, done: boolean) => {
    setPending((cur) => ({ ...cur, [index]: done }));
    try {
      const next = await api.post<OnboardingAssignment>(`/api/onboarding/assignments/${a.id}/items/${index}`, { done });
      onChanged(next);
    } catch (err) {
      toast.error(messageOf(err, '체크하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setPending((cur) => {
        const next = { ...cur };
        delete next[index];
        return next;
      });
    }
  };

  const who = a.relation === 'self' ? '내 온보딩' : `${a.user.name} 님`;
  return (
    <article className="onb-card" aria-label={`${a.user.name} 님 온보딩: ${a.title}`} data-testid="onb-card">
      <header>
        <div>
          <h3>{a.title}</h3>
          <small>
            {who} · {JOB_TYPE_LABELS[a.user.jobType]} · 멘토 {a.mentor.name} · 시작 <span className="num">{a.startedOn}</span>
          </small>
        </div>
        {a.percent === 100 ? <Chip tone="ok">모두 끝냄</Chip> : a.relation === 'mentor' ? <Chip tone="info">내가 멘토</Chip> : null}
      </header>
      <div className="onb-pct">
        <Progress value={a.percent / 100} label={`${a.user.name} 님 온보딩 진행률`} />
        <b className="num" data-testid="onb-percent">
          {a.percent}%
        </b>
      </div>
      <small className="muted">
        {a.total}개 중 {a.done}개 끝냄
      </small>
      <ul className="onb-items" aria-label="체크리스트 항목">
        {a.items.map((it) => (
          <li key={it.index}>
            {a.canCheck ? (
              <>
                <Checkbox label={it.text} checked={pending[it.index] ?? !!it.doneAt} disabled={it.index in pending} onChange={(e) => void toggle(it.index, e.target.checked)} />
                {it.doneAt ? (
                  <span className="by">
                    {it.doneBy?.name ?? '-'} · {formatDateTime(it.doneAt)}
                  </span>
                ) : null}
              </>
            ) : (
              <span className={it.doneAt ? 'static done' : 'static'}>
                <span className="mark">{it.doneAt ? '완료' : '남음'}</span>
                <span>{it.text}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

/** AI 초안 편집기: 항목을 고치고 직무·이름을 정해 템플릿으로 저장한다 */
export function DraftEditor({ initial, jobType, onSaved }: { initial: string[]; jobType: JobType; onSaved: (t: OnboardingTemplate) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<string[]>(initial);
  const [title, setTitle] = useState(`${JOB_TYPE_LABELS[jobType]} 온보딩 체크리스트`);
  const [job, setJob] = useState<JobType>(jobType);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const list = items.map((s) => s.trim()).filter(Boolean);
    if (!title.trim()) return setError('템플릿 이름을 적어 주세요.');
    if (!list.length) return setError('항목을 하나 이상 남겨 주세요.');
    setError(null);
    setBusy(true);
    try {
      const t = await api.post<OnboardingTemplate>('/api/onboarding/templates', { jobType: job, title: title.trim(), items: list, source: 'ai' });
      setSaved(true);
      toast.show(`"${t.title}" 템플릿을 저장했어요. 이제 신규 직원에게 배정할 수 있어요.`);
      onSaved(t);
    } catch (err) {
      setError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="onb-draft">
      <ol className="onb-draft" aria-label="AI 초안 항목">
        {items.map((it, i) => (
          <li key={i}>
            <span className="num">{i + 1}</span>
            <TextInput
              className="input"
              aria-label={`항목 ${i + 1}`}
              value={it}
              maxLength={ONBOARDING_ITEM_MAX}
              onChange={(e) => {
                const v = e.target.value;
                setItems((cur) => cur.map((x, k) => (k === i ? v : x)));
                setSaved(false);
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => setItems((cur) => cur.filter((_, k) => k !== i))} aria-label={`항목 ${i + 1} 빼기`}>
              빼기
            </Button>
          </li>
        ))}
      </ol>
      <div className="onb-save">
        <Button size="sm" icon="plus" disabled={items.length >= ONBOARDING_MAX_ITEMS} onClick={() => setItems((cur) => [...cur, ''])}>
          항목 더하기
        </Button>
        <div className="row2">
          <Field label="템플릿 이름" required>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
          </Field>
          <Field label="직무" required>
            <Select value={job} onChange={(e) => setJob(e.target.value as JobType)} options={JOB_OPTIONS} />
          </Field>
        </div>
        {error ? <FormError text={error} /> : null}
        <div className="acts">
          <Button icon={saved ? 'check' : 'plus'} loading={busy} disabled={saved} onClick={() => void save()}>
            {saved ? '템플릿으로 저장했어요' : '템플릿으로 저장'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 템플릿 직접 만들기·고치기(항목은 한 줄에 하나) */
export function TemplateDialog({ item, onClose, onSaved }: { item: OnboardingTemplate | null; onClose: () => void; onSaved: (t: OnboardingTemplate) => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [job, setJob] = useState<JobType>(item?.jobType ?? 'hygienist');
  const [text, setText] = useState(item ? item.items.join('\n') : '');
  const [active, setActive] = useState(item?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const items = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = '템플릿 이름을 적어 주세요.';
    if (!items.length) errs.items = '항목을 한 줄에 하나씩 적어 주세요.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return focusInvalid(formRef.current);
    setBusy(true);
    try {
      const body = { title: title.trim(), jobType: job, items };
      const t = item ? await api.patch<OnboardingTemplate>(`/api/onboarding/templates/${item.id}`, { ...body, active }) : await api.post<OnboardingTemplate>('/api/onboarding/templates', body);
      onSaved(t);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
      focusInvalid(formRef.current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? '템플릿 고치기' : '템플릿 직접 만들기'}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form="onb-template-form" variant="primary" loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form id="onb-template-form" ref={formRef} className="training-form" onSubmit={submit} noValidate aria-label="온보딩 템플릿">
        <FormError text={formError} />
        <div className="row2">
          <Field label="템플릿 이름" required error={errors.title}>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="예: 데스크 첫 주 체크리스트" />
          </Field>
          <Field label="직무" required error={errors.jobType}>
            <Select value={job} onChange={(e) => setJob(e.target.value as JobType)} options={JOB_OPTIONS} />
          </Field>
        </div>
        <Field label="항목" required error={errors.items} help={item?.assignedCount ? '이미 배정된 체크리스트는 바뀌지 않아요. 새로 배정할 때부터 쓰여요.' : '한 줄에 항목 하나씩 적어 주세요.'}>
          <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={8} />
        </Field>
        {item ? <Checkbox label="사용 중" hint="끄면 새로 배정할 때 고를 수 없어요." checked={active} onChange={(e) => setActive(e.target.checked)} /> : null}
      </form>
    </Dialog>
  );
}

/** 배정 대화상자 */
export function AssignDialog({
  templates,
  people,
  initialTemplateId,
  onClose,
  onSaved,
}: {
  templates: readonly OnboardingTemplate[];
  people: ReadonlyArray<{ id: number; name: string; jobType: JobType }>;
  initialTemplateId?: number;
  onClose: () => void;
  onSaved: (a: OnboardingAssignment) => void;
}) {
  const usable = templates.filter((t) => t.active);
  const [templateId, setTemplateId] = useState(String(initialTemplateId ?? usable[0]?.id ?? ''));
  const [userId, setUserId] = useState('');
  const [mentorId, setMentorId] = useState('');
  const [startedOn, setStartedOn] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const tpl = usable.find((t) => String(t.id) === templateId);
  const personOptions = [{ value: '', label: '골라 주세요' }, ...people.map((p) => ({ value: String(p.id), label: `${p.name} · ${JOB_TYPE_LABELS[p.jobType]}` }))];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!templateId) errs.templateId = '템플릿을 골라 주세요.';
    if (!userId) errs.userId = '신규 직원을 골라 주세요.';
    if (!mentorId) errs.mentorId = '담당 멘토를 골라 주세요.';
    else if (mentorId === userId) errs.mentorId = '신규 직원과 멘토는 다른 사람이어야 해요.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return focusInvalid(formRef.current);
    setBusy(true);
    try {
      const a = await api.post<OnboardingAssignment>('/api/onboarding/assignments', { templateId: Number(templateId), userId: Number(userId), mentorId: Number(mentorId), ...(startedOn ? { startedOn } : {}) });
      onSaved(a);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '배정하지 못했어요. 다시 시도해 주세요.'));
      focusInvalid(formRef.current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="온보딩 배정"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form="onb-assign-form" variant="primary" loading={busy}>
            배정하기
          </Button>
        </>
      }
    >
      <form id="onb-assign-form" ref={formRef} className="training-form" onSubmit={submit} noValidate aria-label="온보딩 배정">
        <FormError text={formError} />
        <Field label="템플릿" required error={errors.templateId} help={tpl ? `${JOB_TYPE_LABELS[tpl.jobType]} · 항목 ${tpl.items.length}개` : undefined}>
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} options={usable.map((t) => ({ value: String(t.id), label: t.title }))} />
        </Field>
        <div className="row2">
          <Field label="신규 직원" required error={errors.userId}>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} options={personOptions} />
          </Field>
          <Field label="담당 멘토" required error={errors.mentorId} help="신규 직원과 함께 진행률을 봐요.">
            <Select value={mentorId} onChange={(e) => setMentorId(e.target.value)} options={personOptions} />
          </Field>
        </div>
        <Field label="시작일" error={errors.startedOn} help="비워 두면 오늘부터 시작해요.">
          <DateInput value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

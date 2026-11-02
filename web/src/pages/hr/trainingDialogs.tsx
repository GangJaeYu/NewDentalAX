// 이 파일이 하는 일: 교육 이수 기록 화면(TrainingPage, FR-082)의 대화상자들. 이수 기록하기(이수일·메모·증빙 파일), 교육 항목 추가·고치기(주기·법정 일정 연결),
// 한 직원의 이수 기록 보기(증빙 파일 내려받기·잘못 넣은 기록 지우기)가 있다. 증빙 파일이 있으면 multipart로, 없으면 JSON으로 보낸다.
// 서버가 돌려준 입력 오류(fields)는 칸 아래에, 그 밖의 오류는 대화상자 위쪽에 쉬운 문구로 보여 준다.
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Chip } from '../../components/Chip.tsx';
import { ConfirmDialog, Dialog } from '../../components/Dialog.tsx';
import { Checkbox, DateInput, Field, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { FileDrop } from '../../components/FileDrop.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiError, toApiError } from '../../lib/api.ts';
import { formatBytes } from '../../lib/image.ts';
import { useApi } from '../../lib/useApi.ts';
import { CSRF_HEADER } from '../../../../shared/schemas/auth.ts';
import type { LegalTaskList } from '../../../../shared/schemas/legal.ts';
import { cycleLabel, TRAINING_CYCLE_CHOICES, type TrainingItem, type TrainingRecordItem, type TrainingRecordResult } from '../../../../shared/schemas/training.ts';

/** 증빙 파일 규칙(서버 files.ts purpose training과 같게: PDF·JPG·PNG, 20MB) */
export const PROOF_RULE = { accept: ['.pdf', '.jpg', '.jpeg', '.png'], maxBytes: 20 * 1024 * 1024 } as const;

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

/** 증빙 파일과 함께 이수 기록을 보낸다(multipart). 서버의 415·413 오류도 한국어 문구 그대로 ApiError로 던진다 */
async function uploadRecord(csrfToken: string | null, trainingId: number, file: File, fields: Record<string, string>): Promise<TrainingRecordResult> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.set('file', file, file.name);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api/trainings/${trainingId}/records`, { method: 'POST', credentials: 'same-origin', headers, body: fd });
  } catch {
    throw toApiError(0, { error: { code: 'NETWORK', message: '서버에 연결할 수 없어요. 원내 와이파이에 연결되어 있는지 확인해 주세요.' } });
  }
  const body = (await res.json().catch(() => null)) as { data?: TrainingRecordResult } | null;
  if (!res.ok || !body?.data) throw toApiError(res.status, body);
  return body.data;
}

interface RecordDialogProps {
  trainings: readonly TrainingItem[];
  people: ReadonlyArray<{ id: number; name: string }>;
  /** 다른 직원 것도 기록할 수 있는지(실장 이상) */
  manager: boolean;
  meId: number;
  today: string;
  csrfToken: string | null;
  initial?: { trainingId?: number; userId?: number };
  onClose: () => void;
  onSaved: (r: TrainingRecordResult, trainingName: string) => void;
}

/** 이수 기록하기 대화상자 */
export function RecordDialog({ trainings, people, manager, meId, today, csrfToken, initial, onClose, onSaved }: RecordDialogProps) {
  const [trainingId, setTrainingId] = useState(String(initial?.trainingId ?? trainings[0]?.id ?? ''));
  const [userId, setUserId] = useState(String(initial?.userId ?? meId));
  const [completedOn, setCompletedOn] = useState(today);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const training = trainings.find((t) => String(t.id) === trainingId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!training) errs.trainingId = '교육을 골라 주세요.';
    if (!completedOn) errs.completedOn = '이수일을 골라 주세요.';
    else if (completedOn > today) errs.completedOn = '오늘이나 그 전 날짜로 골라 주세요.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length || !training) {
      focusInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      const fields: Record<string, string> = { completedOn, note: note.trim() };
      if (manager && Number(userId) !== meId) fields.userId = userId;
      const saved = file
        ? await uploadRecord(csrfToken, training.id, file, fields)
        : await api.post<TrainingRecordResult>(`/api/trainings/${training.id}/records`, { ...fields, ...(fields.userId ? { userId: Number(fields.userId) } : {}) });
      onSaved(saved, training.name);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '기록하지 못했어요. 다시 시도해 주세요.'));
      focusInvalid(formRef.current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="이수 기록하기"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form="training-record-form" variant="primary" loading={busy}>
            기록하기
          </Button>
        </>
      }
    >
      <form id="training-record-form" ref={formRef} className="training-form" onSubmit={submit} noValidate aria-label="이수 기록">
        <FormError text={formError} />
        <Field label="교육" required error={errors.trainingId}>
          <Select value={trainingId} onChange={(e) => setTrainingId(e.target.value)} options={trainings.map((t) => ({ value: String(t.id), label: `${t.name} · ${cycleLabel(t.cycleMonths)}` }))} />
        </Field>
        {manager ? (
          <Field label="직원" required error={errors.userId}>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} options={people.map((p) => ({ value: String(p.id), label: p.id === meId ? `${p.name}(나)` : p.name }))} />
          </Field>
        ) : null}
        <Field label="이수일" required error={errors.completedOn} help={training?.cycleMonths ? `다음 예정일은 이수일 + ${cycleLabel(training.cycleMonths).replace('마다', '')}로 계산해요.` : '한 번만 받는 교육이에요.'}>
          <DateInput value={completedOn} max={today} onChange={(e) => setCompletedOn(e.target.value)} />
        </Field>
        <Field label="메모(선택)" error={errors.note} help="예: 보건소 온라인 교육, 원내 집합 교육">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
        </Field>
        <div className="training-file">
          <span className="training-file-label">증빙 파일(선택)</span>
          {file ? (
            <div className="training-file-picked" data-testid="training-file-picked">
              <Icon name="doc" size="md" />
              <span className="name">{file.name}</span>
              <span className="muted num">{formatBytes(file.size)}</span>
              <Button size="sm" variant="ghost" onClick={() => setFile(null)} aria-label={`${file.name} 빼기`}>
                빼기
              </Button>
            </div>
          ) : (
            <FileDrop label="이수증 파일을 끌어다 놓거나 눌러서 고르세요" accept={PROOF_RULE.accept} maxBytes={PROOF_RULE.maxBytes} onFiles={(f) => setFile(f[0] ?? null)} />
          )}
          {errors.file ? <p className="training-file-err" role="alert">{errors.file}</p> : null}
        </div>
      </form>
    </Dialog>
  );
}

interface TrainingFormDialogProps {
  /** 고칠 항목(없으면 새로 만들기) */
  item: TrainingItem | null;
  onClose: () => void;
  onSaved: (t: TrainingItem) => void;
}

/** 교육 항목 추가·고치기 대화상자. 법정 의무 일정(/api/legal-tasks) 중 하나와 이을 수 있다(선택) */
export function TrainingFormDialog({ item, onClose, onSaved }: TrainingFormDialogProps) {
  const [name, setName] = useState(item?.name ?? '');
  const [cycle, setCycle] = useState(item ? String(item.cycleMonths ?? '') : '12');
  const [description, setDescription] = useState(item?.description ?? '');
  const [legalTaskId, setLegalTaskId] = useState(item?.legalTask ? String(item.legalTask.id) : '');
  const [active, setActive] = useState(item?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const legal = useApi<LegalTaskList>('hr:training:legal', () => api.get('/api/legal-tasks'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: '교육 이름을 적어 주세요.' });
      focusInvalid(formRef.current);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    const body = { name: name.trim(), cycleMonths: cycle ? Number(cycle) : null, description: description.trim(), legalTaskId: legalTaskId ? Number(legalTaskId) : null };
    try {
      const saved = item ? await api.patch<TrainingItem>(`/api/trainings/${item.id}`, { ...body, active }) : await api.post<TrainingItem>('/api/trainings', body);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
      focusInvalid(formRef.current);
    } finally {
      setBusy(false);
    }
  };

  const legalOptions = [{ value: '', label: '연결하지 않음' }, ...(legal.data?.items ?? []).map((t) => ({ value: String(t.id), label: t.title }))];
  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? '교육 항목 고치기' : '교육 항목 추가'}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form="training-item-form" variant="primary" loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form id="training-item-form" ref={formRef} className="training-form" onSubmit={submit} noValidate aria-label="교육 항목">
        <FormError text={formError} />
        <Field label="교육 이름" required error={errors.name}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="예: 감염관리 교육" />
        </Field>
        <Field label="주기" error={errors.cycleMonths} help="정해진 주기마다 다시 받아야 하는 교육이면 주기를 고르세요.">
          <Select value={cycle} onChange={(e) => setCycle(e.target.value)} options={TRAINING_CYCLE_CHOICES.map((c) => ({ value: c === null ? '' : String(c), label: cycleLabel(c) }))} />
        </Field>
        <Field label="법정 의무 일정 연결(선택)" error={errors.legalTaskId} help={legal.error ? '법정 일정 목록을 불러오지 못했어요.' : '시설·법정 화면의 일정과 함께 볼 수 있어요.'}>
          <Select value={legalTaskId} onChange={(e) => setLegalTaskId(e.target.value)} options={legalOptions} />
        </Field>
        <Field label="설명(선택)" error={errors.description}>
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
        </Field>
        {item ? <Checkbox label="사용 중" hint="끄면 직원 화면에서 빠지고 새 기록을 받지 않아요. 지난 기록은 남아요." checked={active} onChange={(e) => setActive(e.target.checked)} /> : null}
      </form>
    </Dialog>
  );
}

/** 한 직원의 이 교육 이수 기록(최근 것부터). 증빙 파일 내려받기와 지우기 */
export function RecordsDialog({ training, user, canDelete, onClose, onChanged }: { training: TrainingItem; user: { id: number; name: string }; canDelete: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const key = `hr:training:records:${training.id}:${user.id}`;
  const records = useApi<TrainingRecordItem[]>(key, () => api.get(`/api/trainings/${training.id}/records?userId=${user.id}`));
  const [removing, setRemoving] = useState<TrainingRecordItem | null>(null);

  const remove = async () => {
    if (!removing) return;
    try {
      await api.del(`/api/trainings/records/${removing.id}`);
      toast.show(`${removing.completedOn} 이수 기록을 지웠어요.`);
      records.reload();
      onChanged();
    } catch (err) {
      toast.error(messageOf(err, '지우지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`${user.name} · ${training.name} 이수 기록`} footer={<Button onClick={onClose}>닫기</Button>}>
      {records.loading && !records.data ? <Skeleton rows={3} /> : null}
      {records.error && !records.data ? <ErrorState message={records.error.message} onRetry={records.reload} /> : null}
      {records.data && records.data.length === 0 ? <EmptyState icon="inbox" title="아직 이수 기록이 없어요" description="이수 기록하기 버튼으로 첫 기록을 남겨 주세요." /> : null}
      {records.data && records.data.length ? (
        <ul className="training-records" aria-label="이수 기록 목록">
          {records.data.map((r, i) => (
            <li key={r.id}>
              <div className="when">
                <b className="num">{r.completedOn}</b>
                {i === 0 ? <Chip tone="info">최근</Chip> : null}
                {r.note ? <span className="muted">{r.note}</span> : null}
              </div>
              <div className="acts">
                {r.file ? (
                  <a className="btn sm" href={`/api/trainings/records/${r.id}/file`} download={r.file.name} aria-label={`${r.completedOn} 증빙 ${r.file.name} 내려받기`}>
                    <Icon name="doc" size="md" />
                    <span className="training-file-name">{r.file.name}</span>
                  </a>
                ) : (
                  <span className="muted">증빙 파일 없음</span>
                )}
                {canDelete ? (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(r)} aria-label={`${r.completedOn} 이수 기록 지우기`}>
                    지우기
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="이수 기록 지우기"
        message={removing ? `${removing.completedOn} 이수 기록을 지울까요? 다음 예정일이 다시 계산돼요.` : ''}
        confirmLabel="지우기"
        danger
      />
    </Dialog>
  );
}

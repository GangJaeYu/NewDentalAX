// 이 파일이 하는 일: 연차·휴가 화면(LeavePage, FR-080)의 대화상자들. 휴가 신청, 승인(같은 날 인원 초과 등 경고를 먼저 보여 줌), 반려(사유 필수),
// admin의 부여 일수·연차 설정 대화상자가 있다. 신청 대화상자는 병원 진료시간(/api/settings/clinic)으로 일수를 미리 계산해 보여 준다(서버와 같은 계산 함수).
// 서버가 돌려준 입력 오류(fields)는 칸 아래에, 그 밖의 오류는 대화상자 위쪽에 쉬운 문구로 보여 준다.
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { DateInput, Field, NumberInput, Select, TextArea } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ErrorState, Skeleton } from '../../components/States.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { useApi } from '../../lib/useApi.ts';
import type { ClinicSettings } from '../../../../shared/schemas/admin.ts';
import {
  countLeaveDays,
  DEDUCTING_TYPES,
  formatLeaveDays,
  isHalfDay,
  LEAVE_TYPE_LABELS,
  LEAVE_TYPES,
  periodLabel,
  shortKoreanDate,
  type LeaveAllowanceRow,
  type LeaveAllowanceTable,
  type LeaveDecision,
  type LeaveRequestItem,
  type LeaveSettings,
  type LeaveType,
} from '../../../../shared/schemas/leave.ts';

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

/** 신청 한 건 요약(누가·종류·기간·일수·사유) */
function RequestSummary({ item }: { item: LeaveRequestItem }) {
  return (
    <dl className="leave-summary">
      <dt>신청한 사람</dt>
      <dd>{item.user.name}</dd>
      <dt>종류</dt>
      <dd>{LEAVE_TYPE_LABELS[item.type]}</dd>
      <dt>기간</dt>
      <dd className="num">
        {periodLabel(item.startOn, item.endOn)} · {formatLeaveDays(item.days)}
      </dd>
      <dt>사유</dt>
      <dd>{item.reason || '적지 않음'}</dd>
    </dl>
  );
}

/** 승인하면 생길 경고 목록(같은 날 인원 초과, 잔여 부족) */
export function LeaveWarnings({ warnings, title = '승인 전에 확인해 주세요' }: { warnings: readonly string[]; title?: string }) {
  if (warnings.length === 0) return null;
  return (
    <div className="leave-warn" role="alert" data-testid="leave-warnings">
      <Icon name="alert" size="md" />
      <div>
        <b>{title}</b>
        <ul>
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface RequestForm {
  type: LeaveType;
  startOn: string;
  endOn: string;
  reason: string;
}

/** 휴가 신청 대화상자. remaining은 지금 잔여 일수(미리 보기에 씀) */
export function LeaveRequestDialog({ onClose, onSaved, remaining }: { onClose: () => void; onSaved: (item: LeaveRequestItem) => void; remaining: number | null }) {
  const [form, setForm] = useState<RequestForm>({ type: 'annual', startOn: '', endOn: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const clinic = useApi<ClinicSettings>('hr:leave:clinic', () => api.get('/api/settings/clinic'));
  const half = isHalfDay(form.type);
  const endOn = half ? form.startOn : form.endOn || form.startOn;
  const counted = clinic.data && form.startOn ? countLeaveDays(form.type, form.startOn, endOn, clinic.data.hours) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.startOn) errs.startOn = half ? '날짜를 골라 주세요.' : '시작 날짜를 골라 주세요.';
    else if (counted && 'error' in counted) errs[counted.field] = counted.error;
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) {
      focusInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      const saved = await api.post<LeaveRequestItem>('/api/leave', { type: form.type, startOn: form.startOn, endOn, ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) });
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '신청하지 못했어요. 다시 시도해 주세요.'));
      focusInvalid(formRef.current);
    } finally {
      setBusy(false);
    }
  };

  const deducts = DEDUCTING_TYPES.includes(form.type);
  return (
    <Dialog
      open
      onClose={onClose}
      title="휴가 신청"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form="leave-request-form" variant="primary" loading={busy}>
            신청하기
          </Button>
        </>
      }
    >
      <form id="leave-request-form" ref={formRef} className="leave-form" onSubmit={submit} noValidate aria-label="휴가 신청">
        <FormError text={formError} />
        <Field label="종류" required error={errors.type}>
          <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LeaveType }))} options={LEAVE_TYPES.map((t) => ({ value: t, label: LEAVE_TYPE_LABELS[t] }))} />
        </Field>
        <div className="row2">
          <Field label={half ? '날짜' : '시작 날짜'} required error={errors.startOn}>
            <DateInput value={form.startOn} onChange={(e) => setForm((f) => ({ ...f, startOn: e.target.value }))} />
          </Field>
          {half ? null : (
            <Field label="끝 날짜" error={errors.endOn} help="하루만 쉬면 비워 두세요.">
              <DateInput value={form.endOn} min={form.startOn || undefined} onChange={(e) => setForm((f) => ({ ...f, endOn: e.target.value }))} />
            </Field>
          )}
        </div>
        <Field label="사유(선택)" error={errors.reason} help="병가라도 자세한 병명은 적지 않아도 돼요.">
          <TextArea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} rows={3} maxLength={200} />
        </Field>
        {clinic.error && !clinic.data ? <p className="form-note">진료시간을 불러오지 못해 일수는 신청한 뒤에 보여요.</p> : null}
        {counted && !('error' in counted) ? (
          <p className="form-note" role="status" data-testid="leave-preview">
            <Icon name="cal" size="md" />
            <span>
              병원 진료일 기준 <b className="num">{formatLeaveDays(counted.days)}</b>이에요
              {counted.skipped.length ? ` (휴진일 ${counted.skipped.map(shortKoreanDate).join(', ')} 제외)` : ''}.
              {deducts && remaining !== null ? ` 승인되면 남는 연차는 ${formatLeaveDays(remaining - counted.days)}이에요.` : ''}
              {!deducts ? ' 병가·기타는 연차 잔여에서 빠지지 않아요.' : ''}
            </span>
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** 승인 또는 반려 대화상자. mode가 'approve'면 경고를 보여 준 뒤 승인, 'reject'면 사유를 꼭 받는다 */
export function LeaveDecideDialog({ item, mode, onClose, onDone }: { item: LeaveRequestItem; mode: 'approve' | 'reject'; onClose: () => void; onDone: (result: LeaveDecision) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const approve = mode === 'approve';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!approve && !reason.trim()) {
      setError('반려 사유를 적어 주세요.');
      focusInvalid(formRef.current);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<LeaveDecision>(`/api/leave/${item.id}/decide`, approve ? { approve: true } : { approve: false, reason: reason.trim() });
      onDone(result);
    } catch (err) {
      if (err instanceof ApiError && err.fields?.reason) setError(err.fields.reason);
      setFormError(messageOf(err, approve ? '승인하지 못했어요. 다시 시도해 주세요.' : '반려하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const formId = `leave-decide-${item.id}`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={approve ? '휴가 승인' : '휴가 반려'}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form={formId} variant={approve ? 'primary' : 'danger'} loading={busy}>
            {approve ? (item.warnings.length ? '경고를 확인했고 승인하기' : '승인하기') : '반려하기'}
          </Button>
        </>
      }
    >
      <form id={formId} ref={formRef} className="leave-form" onSubmit={submit} noValidate aria-label={approve ? '휴가 승인' : '휴가 반려'}>
        <FormError text={formError} />
        <RequestSummary item={item} />
        {approve ? (
          <>
            <LeaveWarnings warnings={item.warnings} />
            {item.warnings.length ? <p className="form-note">경고가 있어도 승인할 수 있어요. 근무 인원을 따로 맞춰 주세요.</p> : null}
          </>
        ) : (
          <Field label="반려 사유" required error={error} help="신청한 직원에게 알림으로 그대로 전해져요.">
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={200} />
          </Field>
        )}
      </form>
    </Dialog>
  );
}

/** admin: 직원별 부여 일수와 연차 설정(하루 최대 휴가 인원·기본 부여 일수)을 저장하는 대화상자 */
export function AllowanceDialog({ table, onClose, onSaved }: { table: LeaveAllowanceTable; onClose: () => void; onSaved: () => void }) {
  const settings = useApi<LeaveSettings>('hr:leave:settings', () => api.get('/api/settings/leave'));
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`${table.year}년 연차 부여 일수`}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form="leave-allowance-form" variant="primary" disabled={!settings.data}>
            저장
          </Button>
        </>
      }
    >
      {settings.error && !settings.data ? (
        <ErrorState message={settings.error.message} onRetry={settings.reload} />
      ) : !settings.data ? (
        <Skeleton rows={4} label="연차 설정 불러오는 중" />
      ) : (
        <AllowanceForm table={table} settings={settings.data} onSaved={onSaved} />
      )}
    </Dialog>
  );
}

/** 부여 일수 입력 칸 글자를 숫자로(빈칸이면 null) */
function toNumber(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 부여 일수·연차 설정 입력 양식 */
function AllowanceForm({ table, settings, onSaved }: { table: LeaveAllowanceTable; settings: LeaveSettings; onSaved: () => void }) {
  const [maxPerDay, setMaxPerDay] = useState(String(settings.maxPerDay));
  const [defaultAllowance, setDefaultAllowance] = useState(String(settings.defaultAllowance));
  const [days, setDays] = useState<Record<number, string>>(() => Object.fromEntries(table.rows.map((r) => [r.userId, String(r.allowance)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const max = toNumber(maxPerDay);
    const def = toNumber(defaultAllowance);
    if (max === null || !Number.isInteger(max) || max < 1) errs.maxPerDay = '하루 최대 휴가 인원은 1명 이상 정수로 적어 주세요.';
    if (def === null || def < 0 || !Number.isInteger(def * 2)) errs.defaultAllowance = '기본 부여 일수는 0.5일 단위로 적어 주세요.';
    const items = table.rows.map((r: LeaveAllowanceRow, i) => {
      const n = toNumber(days[r.userId] ?? '');
      if (n === null || n < 0 || !Number.isInteger(n * 2)) errs[`items.${i}.days`] = '0.5일 단위로 적어 주세요.';
      return { userId: r.userId, days: n ?? 0 };
    });
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) {
      focusInvalid(formRef.current);
      return;
    }
    try {
      await api.put('/api/settings/leave', { maxPerDay: max, defaultAllowance: def });
      await api.put('/api/leave/allowances', { year: table.year, items });
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    }
  };

  return (
    <form id="leave-allowance-form" ref={formRef} className="leave-form" onSubmit={submit} noValidate aria-label="연차 부여 일수">
      <FormError text={formError} />
      <div className="row2">
        <Field label="하루 최대 휴가 인원" required error={errors.maxPerDay} help="이 수를 넘는 날을 승인하려 하면 경고가 나와요.">
          <NumberInput value={maxPerDay} min={1} max={50} step={1} onChange={(e) => setMaxPerDay(e.target.value)} />
        </Field>
        <Field label="기본 부여 일수" required error={errors.defaultAllowance} help="새 직원 등 따로 정하지 않은 사람에게 쓰여요.">
          <NumberInput value={defaultAllowance} min={0} max={365} step={0.5} onChange={(e) => setDefaultAllowance(e.target.value)} />
        </Field>
      </div>
      <p className="form-note">
        <Icon name="people" size="md" />
        법정 연차를 자동으로 계산하지 않아요. 직원마다 올해 쓸 수 있는 일수를 0.5일 단위로 적어 주세요.
      </p>
      <ul className="list leave-allow-list" aria-label="직원별 부여 일수">
        {table.rows.map((r, i) => (
          <li key={r.userId}>
            <span className="t">
              <b>{r.name}</b>
              <small className="num">
                사용 {formatLeaveDays(r.used)} · 대기 {formatLeaveDays(r.pending)}
              </small>
            </span>
            <span className="leave-allow-input">
              <input
                className="input num"
                type="number"
                inputMode="decimal"
                min={0}
                max={365}
                step={0.5}
                aria-label={`${r.name} 부여 일수`}
                aria-invalid={errors[`items.${i}.days`] ? true : undefined}
                value={days[r.userId] ?? ''}
                onChange={(e) => setDays((d) => ({ ...d, [r.userId]: e.target.value }))}
              />
              <span aria-hidden="true">일</span>
            </span>
            {errors[`items.${i}.days`] ? <span className="err leave-allow-err">{errors[`items.${i}.days`]}</span> : null}
          </li>
        ))}
      </ul>
    </form>
  );
}

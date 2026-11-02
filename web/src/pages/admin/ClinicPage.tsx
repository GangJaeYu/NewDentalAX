// 이 파일이 하는 일: "병원 기본 정보" 화면(/admin/clinic, FR-042 AC1). 병원 이름·대표번호·요일별 진료시간(점심시간·휴진)·휴진 안내·주차·위치·교통·보험 일반 안내를 한 번 저장해 둔다.
// 저장한 값은 settings.clinic(database.md §5)에 들어가고, 전화 응대 스크립트 같은 AI 안내 문구가 이 값을 자동으로 읽는다. 새로 고쳐도 저장한 값이 그대로 보인다.
// 입력 검사는 서버와 같은 스키마(shared/schemas/admin.ts)로 미리 하고, 서버가 돌려준 항목별 이유도 그 칸 아래에 보여 준다.
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Checkbox, Field, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { clinicSchema, WEEKDAY_LABELS, WEEKDAYS, type ClinicSettings, type Weekday } from '../../../../shared/schemas/admin.ts';

const KEY = 'admin:clinic';

/** 화면에서 편집하는 하루(휴진·점심을 꺼도 적어 둔 시각은 남겨 둔다) */
interface DayForm {
  closed: boolean;
  open: string;
  close: string;
  hasLunch: boolean;
  lunchStart: string;
  lunchEnd: string;
}

type Form = Omit<ClinicSettings, 'hours'> & { hours: Record<Weekday, DayForm> };

/** 저장값 → 화면 입력 상태 */
function toForm(c: ClinicSettings): Form {
  const hours = {} as Record<Weekday, DayForm>;
  for (const d of WEEKDAYS) {
    const h = c.hours[d];
    hours[d] = {
      closed: !h,
      open: h?.open ?? '09:30',
      close: h?.close ?? '18:30',
      hasLunch: !!h?.lunch,
      lunchStart: h?.lunch?.start ?? '13:00',
      lunchEnd: h?.lunch?.end ?? '14:00',
    };
  }
  return { ...c, hours };
}

/** 화면 입력 상태 → 저장할 값 */
function fromForm(f: Form): unknown {
  const hours: Record<string, unknown> = {};
  for (const d of WEEKDAYS) {
    const h = f.hours[d];
    hours[d] = h.closed ? null : { open: h.open, close: h.close, lunch: h.hasLunch ? { start: h.lunchStart, end: h.lunchEnd } : null };
  }
  return { name: f.name, phone: f.phone, holidayNote: f.holidayNote, parking: f.parking, location: f.location, insuranceNote: f.insuranceNote, hours };
}

/** 병원 기본 정보 화면 */
export default function ClinicPage() {
  const state = useApi<ClinicSettings>(KEY, () => api.get('/api/settings/clinic'));
  return (
    <>
      <PageHeader title="병원 기본 정보" summary="한 번 저장해 두면 전화 응대 스크립트 같은 AI 안내 문구에 자동으로 들어가요." />
      {state.data ? (
        <ClinicForm initial={state.data} />
      ) : state.error ? (
        <Card padded>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : (
        <Card padded>
          <Skeleton rows={8} label="병원 정보 불러오는 중" />
        </Card>
      )}
    </>
  );
}

/** 입력 양식(처음 불러온 값으로 시작한다) */
function ClinicForm({ initial }: { initial: ClinicSettings }) {
  const toast = useToast();
  const { refresh } = useSession();
  const [form, setForm] = useState<Form>(() => toForm(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const setText = (k: 'name' | 'phone' | 'holidayNote' | 'parking' | 'location' | 'insuranceNote') => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setDay = (d: Weekday, patch: Partial<DayForm>) => setForm((f) => ({ ...f, hours: { ...f.hours, [d]: { ...f.hours[d], ...patch } } }));

  const focusInvalid = () => setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = clinicSchema.safeParse(fromForm(form));
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const k = i.path.map(String).join('.');
        if (!errs[k]) errs[k] = i.message;
      }
      setErrors(errs);
      setFormError('입력값을 확인해 주세요. 빨간 글씨로 표시한 칸을 고쳐 주세요.');
      focusInvalid();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const saved = await api.put<ClinicSettings>('/api/settings/clinic', parsed.data);
      setForm(toForm(saved));
      invalidate(KEY);
      void refresh();
      toast.show('병원 정보를 저장했어요.');
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);
        focusInvalid();
      }
      setFormError(err instanceof Error ? err.message : '저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  /** 하루 줄의 오류(그 요일에 걸린 첫 오류) */
  const dayError = (d: Weekday): string | undefined => Object.entries(errors).find(([k]) => k.startsWith(`hours.${d}`))?.[1];

  return (
    <form ref={formRef} onSubmit={submit} noValidate aria-label="병원 기본 정보" style={{ display: 'grid', gap: 'var(--gap)' }}>
      {formError ? (
        <div className="form-error" role="alert">
          <Icon name="alert" size="md" />
          {formError}
        </div>
      ) : null}

      <Card title="기본 정보" padded>
        <div style={{ display: 'grid', gap: 12, alignItems: 'start', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
          <Field label="병원 이름" required error={errors.name}>
            <TextInput value={form.name} onChange={setText('name')} maxLength={50} autoComplete="organization" />
          </Field>
          <Field label="대표번호" error={errors.phone} help="예: 02-123-4567">
            <TextInput value={form.phone} onChange={setText('phone')} maxLength={20} inputMode="tel" autoComplete="off" />
          </Field>
        </div>
      </Card>

      <Card title="진료시간" padded>
        <p className="muted" style={{ margin: '0 0 4px' }}>
          요일마다 진료 시작·끝 시각과 점심시간을 정해요. 쉬는 요일은 휴진에 체크해요.
        </p>
        <ul className="list" aria-label="요일별 진료시간">
          {WEEKDAYS.map((d) => {
            const h = form.hours[d];
            const label = WEEKDAY_LABELS[d];
            const err = dayError(d);
            return (
              <li key={d} style={{ flexWrap: 'wrap', paddingBlock: 8, alignItems: 'center', columnGap: 16, rowGap: 6 }} data-day={d}>
                <b style={{ width: 52 }}>{label}요일</b>
                <Checkbox label="휴진" checked={h.closed} onChange={(e) => setDay(d, { closed: e.target.checked })} />
                {h.closed ? (
                  <span className="muted">쉬는 날</span>
                ) : (
                  <>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <TimeBox label={`${label}요일 진료 시작`} value={h.open} invalid={!!errors[`hours.${d}.open`]} onChange={(v) => setDay(d, { open: v })} />
                      <span aria-hidden="true">~</span>
                      <TimeBox label={`${label}요일 진료 끝`} value={h.close} invalid={!!errors[`hours.${d}.close`]} onChange={(v) => setDay(d, { close: v })} />
                    </span>
                    <Checkbox label="점심시간" checked={h.hasLunch} onChange={(e) => setDay(d, { hasLunch: e.target.checked })} />
                    {h.hasLunch ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <TimeBox label={`${label}요일 점심 시작`} value={h.lunchStart} invalid={!!errors[`hours.${d}.lunch.start`]} onChange={(v) => setDay(d, { lunchStart: v })} />
                        <span aria-hidden="true">~</span>
                        <TimeBox label={`${label}요일 점심 끝`} value={h.lunchEnd} invalid={!!errors[`hours.${d}.lunch.end`]} onChange={(v) => setDay(d, { lunchEnd: v })} />
                      </span>
                    ) : null}
                  </>
                )}
                {err ? (
                  <span className="field" style={{ flexBasis: '100%' }}>
                    <span className="err" role="alert">
                      <Icon name="alert" size="sm" />
                      {label}요일: {err}
                    </span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="안내 문구" padded>
        <div style={{ display: 'grid', gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            전화·문자 안내에 그대로 쓰여요. 환자 개인정보는 적지 마세요.
          </p>
          <Field label="휴진 안내" error={errors.holidayNote} help="예: 일요일·공휴일 휴진, 매달 마지막 주 수요일 휴진">
            <TextInput value={form.holidayNote} onChange={setText('holidayNote')} maxLength={300} />
          </Field>
          <Field label="주차 안내" error={errors.parking}>
            <TextArea value={form.parking} onChange={setText('parking')} maxLength={500} rows={2} />
          </Field>
          <Field label="위치·교통 안내" error={errors.location}>
            <TextArea value={form.location} onChange={setText('location')} maxLength={500} rows={2} />
          </Field>
          <Field label="보험 일반 안내" error={errors.insuranceNote} help="건강보험 적용 범위 같은 일반 안내만 적어요.">
            <TextArea value={form.insuranceNote} onChange={setText('insuranceNote')} maxLength={1000} rows={3} />
          </Field>
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button type="submit" variant="primary" icon="check" loading={busy}>
          저장
        </Button>
      </div>
    </form>
  );
}

/** 시각 입력칸(24시간 HH:MM) */
function TimeBox({ label, value, invalid, onChange }: { label: string; value: string; invalid: boolean; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      className="input"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      step={300}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: 'auto', minWidth: 112 }}
    />
  );
}

// 이 파일이 하는 일: 근무표 화면(/hr/roster)의 "AI 배정 제안" 대화상자(FR-131, phase-06-task-02). 실장 이상만 연다(서버도 roster.edit로 막는다).
// 1) 조건: 하루 최소 인원과 직무별 최소 인원을 고른다. AI에는 직원 이름 대신 S1, S2 같은 번호와 직무·휴가일만 간다는 안내를 보여 준다.
// 2) 미리보기: 서버가 휴가일·최소 인원을 다시 검사해 고친 한 주 근무표를 보여 주고, 고친 내용·채우지 못한 부족·바뀌는 칸 수·데모 여부·비용을 함께 보여 준다.
// 3) 적용/취소: "적용하기"를 눌러야 근무표가 바뀐다. 취소하거나 닫으면 근무표는 그대로다.
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { Chip } from '../../components/Chip.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Field, NumberInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { aiErrorHelp, costText, fetchAiStatus } from '../../lib/ai.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { JOB_TYPE_LABELS, type JobType } from '../../../../shared/enums.ts';
import { rosterDateLabel, rosterPeriodLabel, shiftDate, weekdayKo, type RosterView, type ShiftType } from '../../../../shared/schemas/roster.ts';
import { rosterSuggestSchema, type RosterApplyResult, type RosterSuggestion } from '../../../../shared/schemas/roster-suggest.ts';
import { cellParts, leaveTone, shiftChipClass, shortDate } from './rosterLib.ts';

/** 조건에 보여 줄 직무(기타는 빼고) */
const JOBS: readonly JobType[] = ['hygienist', 'assistant', 'desk', 'doctor'];

interface Props {
  open: boolean;
  /** 제안받을 주의 월요일 */
  weekStart: string;
  /** 지금 화면의 근무표(바뀌는 칸 표시용, 없으면 표시하지 않음) */
  current: RosterView | null;
  onClose: () => void;
  onApplied: (r: RosterApplyResult) => void;
}

interface Form {
  minStaff: string;
  jobs: Record<string, string>;
}

const START_FORM: Form = { minStaff: '3', jobs: { hygienist: '1', assistant: '0', desk: '1', doctor: '0' } };

/** 입력 글 → 숫자(비우면 0, 숫자가 아니면 NaN이라 검사에서 걸린다) */
function toCount(v: string): number {
  return v.trim() === '' ? 0 : Number(v);
}

/** 미리보기 표 칸 */
function PreviewCell({ view, date, userId, types, changed }: { view: RosterView; date: string; userId: number; types: ReadonlyMap<number, ShiftType>; changed: boolean }) {
  const cell = view.days.find((d) => d.date === date)?.cells[String(userId)];
  const p = cellParts(cell, types);
  return (
    <span className={`roster-cell${changed ? ' rs-changed' : ''}`}>
      {!p.shift && !p.leave ? <span className="blank">-</span> : null}
      {p.leave?.fullDay ? null : p.shift ? <span className={shiftChipClass(p.shift.colorToken)}>{p.shift.label}</span> : null}
      {p.leave ? <Chip tone={leaveTone(p.leave.fullDay)}>{p.leave.label}</Chip> : null}
      {changed ? <span className="sr-only">(바뀜)</span> : null}
    </span>
  );
}

/** AI 배정 제안 대화상자 */
export function RosterSuggestDialog({ open, weekStart, current, onClose, onApplied }: Props) {
  const { info } = useSession();
  const isAdmin = info?.user?.role === 'admin';
  const status = useApi('ai:status', fetchAiStatus);
  const feat = status.data?.features.find((f) => f.id === 'roster_suggest');
  const [form, setForm] = useState<Form>(START_FORM);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [result, setResult] = useState<RosterSuggestion | null>(null);
  const period = rosterPeriodLabel(weekStart, shiftDate(weekStart, 6));
  // 제안이 오면 미리보기로 포커스를 옮긴다(화면 읽기·키보드 사용자가 결과부터 듣게). 대화상자 제목이 가려지지 않게 스크롤은 하지 않는다
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result) previewRef.current?.focus({ preventScroll: true });
  }, [result]);

  const close = () => {
    setResult(null);
    setError(null);
    setFields({});
    onClose();
  };

  const suggest = async () => {
    const payload = {
      weekStart,
      minStaff: toCount(form.minStaff),
      minByJob: Object.fromEntries(JOBS.map((j) => [j, toCount(form.jobs[j] ?? '')]).filter(([, n]) => n !== 0)),
    };
    const parsed = rosterSuggestSchema.safeParse(payload);
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[i.path.join('.')] ??= i.message;
      setFields(f);
      return;
    }
    setFields({});
    setBusy(true);
    setError(null);
    try {
      setResult(await api.post<RosterSuggestion>('/api/roster/suggest', parsed.data));
      invalidate('ai:status');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setError(err instanceof ApiError ? { code: err.code, message: err.message } : { code: 'ERROR', message: '제안을 받지 못했어요. 다시 시도해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    setApplying(true);
    setError(null);
    try {
      const r = await api.post<RosterApplyResult>('/api/roster/apply', { weekStart: result.weekStart, cells: result.cells });
      setResult(null);
      onApplied(r);
    } catch (err) {
      setError(err instanceof ApiError ? { code: err.code, message: err.message } : { code: 'ERROR', message: '적용하지 못했어요. 다시 시도해 주세요.' });
    } finally {
      setApplying(false);
    }
  };

  const off = feat && !feat.allowed;
  const help = error ? aiErrorHelp(error.code, isAdmin) : null;
  const types = new Map((result?.view.shiftTypes ?? []).map((t) => [t.id, t]));
  const isChanged = (date: string, userId: number) => {
    if (!current || !result) return false;
    const now = current.days.find((d) => d.date === date)?.cells[String(userId)]?.shiftTypeId ?? null;
    const next = result.view.days.find((d) => d.date === date)?.cells[String(userId)]?.shiftTypeId ?? null;
    return current.days.some((d) => d.date === date) && now !== next;
  };

  const footer = result ? (
    <>
      <Button key="cancel-preview" onClick={close} disabled={applying}>
        취소
      </Button>
      <Button key="back" onClick={() => setResult(null)} disabled={applying}>
        조건 바꾸기
      </Button>
      <Button key="apply" variant="primary" loading={applying} onClick={() => void apply()}>
        적용하기
      </Button>
    </>
  ) : (
    <>
      <Button key="cancel" onClick={close}>
        취소
      </Button>
      <Button key="suggest" variant="primary" icon="spark" loading={busy} disabled={!!off} onClick={() => void suggest()}>
        제안 받기
      </Button>
    </>
  );

  return (
    <Dialog open={open} onClose={close} title={`AI 배정 제안 · ${period}`} wide footer={footer}>
      {error ? (
        <div className="form-error" role="alert">
          <Icon name="alert" size="md" />
          <span>
            {error.message} {help}
          </span>
        </div>
      ) : null}

      {!result ? (
        <div className="rs-form">
          {off ? (
            <div className="ai-off" role="status">
              <Icon name="lock" size="md" />
              <span>관리자가 이 AI 기능을 꺼 두었습니다. {aiErrorHelp('AI_DISABLED', isAdmin)}</span>
            </div>
          ) : null}
          <p className="muted">
            조건에 맞게 이 주 근무를 AI가 먼저 짜 줘요. AI에는 직원 이름 대신 <b>S1, S2 같은 번호</b>와 직무·휴가일만 보내요. 승인된 휴가일에는 근무를 넣지 않고, 최소 인원이 모자라면 서버가 채우거나 알려 드려요.
          </p>
          <div className="rs-fields">
            <Field label="하루 최소 인원" help="진료하는 날마다 근무하는 사람 수" error={fields.minStaff ?? null}>
              <NumberInput min={0} max={30} step={1} value={form.minStaff} onChange={(e) => setForm({ ...form, minStaff: e.target.value })} />
            </Field>
            {JOBS.map((j) => (
              <Field key={j} label={`${JOB_TYPE_LABELS[j]} 최소`} error={fields[`minByJob.${j}`] ?? null}>
                <NumberInput min={0} max={20} step={1} value={form.jobs[j] ?? ''} onChange={(e) => setForm({ ...form, jobs: { ...form.jobs, [j]: e.target.value } })} />
              </Field>
            ))}
          </div>
          <p className="muted rs-note">제안은 미리보기로만 보여 드려요. "적용하기"를 눌러야 근무표가 바뀌어요.</p>
        </div>
      ) : (
        <div className="rs-preview" data-testid="roster-suggest-preview" ref={previewRef} tabIndex={-1} role="region" aria-label="제안 미리보기">
          <div className="rs-meta">
            {result.ai.demo ? <Chip tone="ghost">데모 응답</Chip> : <Chip tone="ok">AI 응답</Chip>}
            <span className="muted num">{costText(result.ai.costKrw, result.ai.demo)}</span>
            <Chip tone="info">바뀌는 칸 {result.changed}개</Chip>
            <span className="muted">
              하루 최소 {result.rules.minStaff}명
              {JOBS.filter((j) => (result.rules.minByJob[j] ?? 0) > 0)
                .map((j) => ` · ${JOB_TYPE_LABELS[j]} ${result.rules.minByJob[j]}명`)
                .join('')}
            </span>
          </div>
          {result.warnings.length ? (
            <div className="rs-box warn" role="status" data-testid="roster-suggest-warnings">
              <b>
                <Icon name="alert" size="sm" /> 채우지 못한 자리
              </b>
              <ul>
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.fixes.length ? (
            <details className="rs-box" data-testid="roster-suggest-fixes">
              <summary>규칙에 맞게 고친 내용 {result.fixes.length}건</summary>
              <ul>
                {result.fixes.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {result.ai.note ? <p className="muted rs-note">AI 설명: {result.ai.note}</p> : null}
          <div className="tablewrap" role="region" aria-label="제안 근무표 미리보기" tabIndex={0}>
            <table className="roster-table rs-table">
              <caption className="sr-only">{period} 제안 근무표 미리보기. 맨 아래 줄은 날짜별 근무 인원이에요.</caption>
              <thead>
                <tr>
                  <th scope="col" className="who">
                    직원
                  </th>
                  {result.view.days.map((d) => (
                    <th key={d.date} scope="col" className={d.open ? undefined : 'closed'} aria-label={`${rosterDateLabel(d.date)}${d.open ? '' : ' 휴진'}`}>
                      <b className="num">{shortDate(d.date)}</b>
                      {weekdayKo(d.date)}
                      {d.open ? '' : ' 휴진'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.view.users.map((u) => (
                  <tr key={u.id}>
                    <th scope="row" className="who">
                      <b>{u.name}</b>
                      <small>{JOB_TYPE_LABELS[u.jobType] ?? '기타'}</small>
                    </th>
                    {result.view.days.map((d) => (
                      <td key={d.date} className={d.open ? undefined : 'closed'} data-suggest-user={u.id} data-date={d.date}>
                        <PreviewCell view={result.view} date={d.date} userId={u.id} types={types} changed={isChanged(d.date, u.id)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="who">
                    근무 인원
                  </th>
                  {result.view.days.map((d) => (
                    <td key={d.date} data-suggest-total={d.date} className={d.open ? undefined : 'closed'}>
                      {d.total}
                      <small>명</small>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted rs-note">
            {current ? '테두리가 있는 칸은 지금 근무표와 달라지는 칸이에요. ' : ''}
            AI 제안은 참고용이에요. 적용하기 전에 한 번 더 확인해 주세요.
          </p>
        </div>
      )}
    </Dialog>
  );
}

// 이 파일이 하는 일: "멸균기 점검 기록" 화면(/facility/sterilizer, FR-102). 멸균기별 일일·주간 기록(B&D·BI·CI·사이클, 온도·압력·시간, 판정)을 남기고 기간별로 본다.
// 입력 양식에는 환자 관련 칸이 없다(칸 이름은 shared STERILIZER_INPUT_FIELDS만 씀, 담당자는 로그인한 사람). "불합격"을 저장하면 실장 이상에게 바로 알림이 가고,
// 조치 내용을 기록하기 전까지 화면 위 빨간 경고 띠에 남는다(대시보드도 같은 목록을 씀). 기간·멸균기 조건으로 CSV 내려받기와 인쇄(/print/sterilizer)를 한다.
// 조건은 주소(?from=&to=&equipmentId=)에 남기고, 알림에서 온 ?focus=<기록 번호>는 그 기록의 조치 입력 창을 연다.
import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip, Kpi, KpiRow } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { DateInput, Field, NumberInput, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import {
  cycleParamsText,
  STERILIZER_RESULT_LABELS,
  STERILIZER_RESULTS,
  STERILIZER_TEST_HINTS,
  STERILIZER_TEST_LABELS,
  STERILIZER_TEST_TYPES,
  type SterilizerInputField,
  type SterilizerLog,
  type SterilizerLogList,
  type SterilizerOption,
  type SterilizerResult,
  type SterilizerTestType,
} from '../../../../shared/schemas/equipment.ts';
import { isDateText, numOrNull, rangeQuery, STERILIZER_KEY, sterilizerResultChip } from './equipmentLib.ts';
import './equipment.css';

/** 오류를 화면 문구로 */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 입력 칸 name 속성(서버 입력 칸 이름과 같게 둔다) */
const N: Record<SterilizerInputField, SterilizerInputField> = {
  equipmentId: 'equipmentId',
  date: 'date',
  testType: 'testType',
  cycleNo: 'cycleNo',
  tempC: 'tempC',
  pressureKpa: 'pressureKpa',
  minutes: 'minutes',
  result: 'result',
  actionTaken: 'actionTaken',
};

/** 검사 종류별 기본 온도·압력·시간(자주 쓰는 134℃ 사이클 값) */
const PRESETS: Record<SterilizerTestType, { tempC: string; pressureKpa: string; minutes: string }> = {
  bd: { tempC: '134', pressureKpa: '216', minutes: '3.5' },
  bi: { tempC: '134', pressureKpa: '216', minutes: '4' },
  ci: { tempC: '', pressureKpa: '', minutes: '' },
  cycle: { tempC: '134', pressureKpa: '216', minutes: '4' },
};

/** 멸균기 점검 기록 화면 */
export default function SterilizerPage() {
  const { info } = useSession();
  const canManageEquipment = can(info?.user?.role, 'equipment.manage');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const fromP = params.get('from');
  const toP = params.get('to');
  const eqP = Number(params.get('equipmentId'));
  const focusP = Number(params.get('focus'));
  const query = `${isDateText(fromP) ? `from=${fromP}&` : ''}${isDateText(toP) ? `to=${toP}&` : ''}${Number.isInteger(eqP) && eqP > 0 ? `equipmentId=${eqP}` : ''}`;
  const state = useApi<SterilizerLogList>(`${STERILIZER_KEY}:${query}`, () => api.get(`/api/sterilizer-logs?${query}`));
  const list = state.data;
  const [actionId, setActionId] = useState<number | null>(Number.isInteger(focusP) && focusP > 0 ? focusP : null);

  const setRange = (next: { from?: string; to?: string; equipmentId?: number | null }) => {
    const p: Record<string, string> = {};
    const from = next.from ?? list?.from ?? '';
    const to = next.to ?? list?.to ?? '';
    const eq = next.equipmentId === undefined ? (list?.equipmentId ?? null) : next.equipmentId;
    if (isDateText(from)) p.from = from;
    if (isDateText(to)) p.to = to;
    if (eq) p.equipmentId = String(eq);
    setParams(p, { replace: true });
  };

  const refresh = (msg: string) => {
    invalidate(STERILIZER_KEY);
    toast.show(msg);
  };

  const counts = useMemo(() => {
    const items = list?.items ?? [];
    return { total: items.length, fail: items.filter((l) => l.result === 'fail').length, bi: items.filter((l) => l.testType === 'bi').length };
  }, [list]);
  const actionLog = list ? ([...list.openFailures, ...list.items].find((l) => l.id === actionId) ?? null) : null;
  const activeSterilizers = list?.sterilizers.filter((s) => s.active) ?? [];

  const columns: ReadonlyArray<Column<SterilizerLog>> = [
    { key: 'date', header: '날짜', sortValue: (l) => `${l.date}-${String(l.id).padStart(8, '0')}`, render: (l) => <span className="num">{l.date}</span> },
    { key: 'eq', header: '멸균기', sortValue: (l) => l.equipmentName, render: (l) => l.equipmentName },
    { key: 'type', header: '검사', sortValue: (l) => l.testType, render: (l) => STERILIZER_TEST_LABELS[l.testType] },
    { key: 'cycle', header: '사이클', render: (l) => <span className="num">{l.cycleNo ?? '—'}</span> },
    { key: 'params', header: '온도·압력·시간', render: (l) => <span className="num">{cycleParamsText(l)}</span> },
    {
      key: 'result',
      header: '판정',
      sortValue: (l) => l.result,
      render: (l) => {
        const c = sterilizerResultChip(l);
        return <Chip tone={c.tone}>{c.text}</Chip>;
      },
    },
    { key: 'user', header: '담당자', render: (l) => l.user?.name ?? '—' },
    {
      key: 'action',
      header: '조치',
      render: (l) =>
        l.result === 'pass' ? (
          '—'
        ) : l.actionAt ? (
          <span>{l.actionTaken}</span>
        ) : (
          <Button size="sm" onClick={() => setActionId(l.id)}>
            조치 기록
          </Button>
        ),
    },
  ];

  const csvHref = list ? `/api/sterilizer-logs/export${rangeQuery(list)}` : undefined;
  const printTo = list ? `/print/sterilizer${rangeQuery(list)}` : '/print/sterilizer';

  return (
    <>
      <PageHeader
        title="멸균기 점검 기록"
        summary={list ? `${list.from} ~ ${list.to} · 기록 ${counts.total}건 · 불합격 ${counts.fail}건` : '불러오는 중이에요'}
        actions={
          <>
            {csvHref ? (
              <a className="btn" href={csvHref} download data-testid="sterilizer-csv">
                <Icon name="doc" />
                CSV 내려받기
              </a>
            ) : null}
            <Button icon="print" to={printTo}>
              기간 인쇄
            </Button>
          </>
        }
      />

      {list && list.openFailures.length ? <FailureAlert logs={list.openFailures} onAction={setActionId} /> : null}

      <KpiRow label="멸균 기록 요약">
        <Kpi label="기간 기록" value={list ? counts.total : null} unit="건" hint={list ? `${list.from} ~ ${list.to}` : undefined} />
        <Kpi label="조치 전 불합격" value={list ? list.openFailures.length : null} unit="건" tone={list?.openFailures.length ? 'danger' : undefined} hint="조치를 적으면 사라져요" />
        <Kpi label="기간 불합격" value={list ? counts.fail : null} unit="건" tone={counts.fail ? 'warn' : undefined} hint="조치한 것 포함" />
        <Kpi label="BI 검사" value={list ? counts.bi : null} unit="회" hint="보통 주 1회 이상" />
      </KpiRow>

      {state.error && !list ? (
        <Card>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : !list ? (
        <Card>
          <Skeleton rows={6} label="멸균 기록 불러오는 중" />
        </Card>
      ) : activeSterilizers.length === 0 ? (
        <Card>
          <EmptyState
            icon="shield"
            title="등록한 멸균기가 없어요"
            description={canManageEquipment ? '장비 화면에서 종류를 "멸균기"로 골라 등록하면 기록을 남길 수 있어요.' : '실장님이 장비 화면에서 멸균기를 등록하면 기록을 남길 수 있어요.'}
            action={canManageEquipment ? <Button icon="plus" to="/facility/equipment">멸균기 등록하러 가기</Button> : undefined}
          />
        </Card>
      ) : (
        <Card title="멸균 기록 입력" sub="담당자는 자동 기록, 환자 정보는 적지 않아요.">
          <RecordForm sterilizers={activeSterilizers} today={list.today} defaultEq={list.equipmentId} onSaved={refresh} />
        </Card>
      )}

      <Card className="eq-card" title="기간별 기록">
        <Toolbar label="멸균 기록 조회 조건">
          <select
            className="input eq-filter"
            aria-label="멸균기"
            value={list?.equipmentId ?? ''}
            onChange={(e) => setRange({ equipmentId: e.target.value ? Number(e.target.value) : null })}
            disabled={!list}
          >
            <option value="">모든 멸균기</option>
            {(list?.sterilizers ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? '' : ' (사용 중지)'}
              </option>
            ))}
          </select>
          <span className="grow" />
          <span className="eq-range">
            <input className="input eq-date" type="date" aria-label="시작일" value={list?.from ?? ''} max={list?.to} onChange={(e) => isDateText(e.target.value) && setRange({ from: e.target.value })} disabled={!list} />
            <span aria-hidden="true">~</span>
            <input className="input eq-date" type="date" aria-label="끝일" value={list?.to ?? ''} min={list?.from} onChange={(e) => isDateText(e.target.value) && setRange({ to: e.target.value })} disabled={!list} />
          </span>
        </Toolbar>
        <div className="eq-table" data-testid="sterilizer-table">
          <DataTable<SterilizerLog>
            caption="멸균 기록 목록"
            columns={columns}
            rows={list ? [...list.items].reverse() : undefined}
            rowKey={(l) => l.id}
            loading={state.loading}
            error={state.error}
            onRetry={state.reload}
            empty={
              <div style={{ padding: 'var(--pad)' }}>
                <EmptyState icon="cal" title="이 기간에 기록이 없어요" description="위 양식에서 첫 기록을 남기거나 기간을 바꿔 보세요." action={list ? <Button onClick={() => setParams({}, { replace: true })}>최근 30일 보기</Button> : undefined} />
              </div>
            }
          />
        </div>
      </Card>

      {actionLog && actionLog.result === 'fail' && !actionLog.actionAt ? (
        <ActionDialog
          log={actionLog}
          onClose={() => {
            setActionId(null);
            if (params.has('focus')) {
              const p = new URLSearchParams(params);
              p.delete('focus');
              setParams(p, { replace: true });
            }
          }}
          onSaved={() => {
            setActionId(null);
            refresh('조치 내용을 기록했어요. 경고에서 빠졌어요.');
          }}
        />
      ) : null}
    </>
  );
}

/** 조치 전 불합격 경고 띠 */
function FailureAlert({ logs, onAction }: { logs: SterilizerLog[]; onAction: (id: number) => void }) {
  return (
    <section className="st-alert" aria-label="조치 전 불합격" data-testid="sterilizer-alert">
      <div className="st-alert-head">
        <Icon name="alert" size="md" />
        <span>조치하지 않은 멸균 불합격이 {logs.length}건 있어요. 기구를 다시 멸균하고 조치 내용을 적어 주세요.</span>
      </div>
      <ul>
        {logs.map((l) => (
          <li key={l.id}>
            <span>
              <b className="num">{l.date}</b> {l.equipmentName} · {STERILIZER_TEST_LABELS[l.testType]}
              {l.cycleNo ? ` · 사이클 ${l.cycleNo}` : ''} · 기록 {l.user?.name ?? '-'}
            </span>
            <Button size="sm" variant="danger" onClick={() => onAction(l.id)}>
              조치 기록
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 조치 내용 입력 창 */
function ActionDialog({ log, onClose, onSaved }: { log: SterilizerLog; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('어떻게 조치했는지 적어 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/sterilizer-logs/${log.id}/action`, { actionTaken: text.trim() });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError && err.fields?.actionTaken ? err.fields.actionTaken : messageOf(err, '기록하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="불합격 조치 기록">
      <form className="eq-form" onSubmit={submit} noValidate aria-label="불합격 조치 기록">
        <p className="form-note">
          <Icon name="alert" size="md" />
          <span>
            {log.date} {log.equipmentName} · {STERILIZER_TEST_LABELS[log.testType]}
            {log.cycleNo ? ` · 사이클 ${log.cycleNo}` : ''} 불합격
          </span>
        </p>
        <Field label="조치 내용" required error={error} help="예: 같은 날 멸균한 기구 전부 재멸균, 업체 점검 요청, BI 재검사 합격">
          <TextArea className="input" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className="eq-actions">
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" variant="primary" loading={busy}>
            조치 저장
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** 멸균 기록 입력 양식(환자 관련 칸 없음) */
function RecordForm({ sterilizers, today, defaultEq, onSaved }: { sterilizers: SterilizerOption[]; today: string; defaultEq: number | null; onSaved: (msg: string) => void }) {
  const firstEq = sterilizers.find((s) => s.id === defaultEq)?.id ?? sterilizers[0]?.id ?? 0;
  const [equipmentId, setEquipmentId] = useState(String(firstEq));
  const [date, setDate] = useState(today);
  const [testType, setTestType] = useState<SterilizerTestType>('bd');
  const [cycleNo, setCycleNo] = useState('');
  const [tempC, setTempC] = useState(PRESETS.bd.tempC);
  const [pressureKpa, setPressureKpa] = useState(PRESETS.bd.pressureKpa);
  const [minutes, setMinutes] = useState(PRESETS.bd.minutes);
  const [result, setResult] = useState<SterilizerResult>('pass');
  const [actionTaken, setActionTaken] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickType = (t: SterilizerTestType) => {
    setTestType(t);
    setTempC(PRESETS[t].tempC);
    setPressureKpa(PRESETS[t].pressureKpa);
    setMinutes(PRESETS[t].minutes);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errs.date = '날짜를 골라 주세요.';
    else if (date > today) errs.date = '오늘이나 지난 날짜를 골라 주세요.';
    const t = numOrNull(tempC);
    const p = numOrNull(pressureKpa);
    const m = numOrNull(minutes);
    if (t !== null && (Number.isNaN(t) || t < 0 || t > 200)) errs.tempC = '온도는 0~200℃ 사이로 적어 주세요.';
    if (p !== null && (Number.isNaN(p) || p < -110 || p > 400)) errs.pressureKpa = '압력은 -110~400kPa 사이로 적어 주세요.';
    if (m !== null && (Number.isNaN(m) || m < 0 || m > 600)) errs.minutes = '시간은 0~600분 사이로 적어 주세요.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body: Record<SterilizerInputField, string | number | null> = {
        equipmentId: Number(equipmentId),
        date,
        testType,
        cycleNo: cycleNo.trim() || null,
        tempC: t,
        pressureKpa: p,
        minutes: m,
        result,
        actionTaken: result === 'fail' ? actionTaken.trim() || null : null,
      };
      const r = await api.post<SterilizerLog>('/api/sterilizer-logs', body);
      setCycleNo('');
      setActionTaken('');
      setResult('pass');
      onSaved(r.result === 'fail' ? (r.actionAt ? '불합격과 조치 내용을 기록했어요. 실장님께 알림을 보냈어요.' : '불합격을 기록했어요. 실장님께 알림을 보냈어요. 조치 내용을 꼭 적어 주세요.') : '멸균 기록을 남겼어요.');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '기록하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="eq-form st-form" onSubmit={submit} noValidate aria-label="멸균 기록 입력" data-testid="sterilizer-form">
      {formError ? (
        <div className="form-error" role="alert">
          <Icon name="alert" size="md" />
          {formError}
        </div>
      ) : null}
      <Segmented<SterilizerTestType> label="검사 종류" value={testType} onChange={pickType} options={STERILIZER_TEST_TYPES.map((v) => ({ value: v, label: STERILIZER_TEST_LABELS[v] }))} />
      <p className="eq-sub">{STERILIZER_TEST_HINTS[testType]}</p>
      <div className="eq-grid4">
        <Field label="멸균기" required error={errors.equipmentId}>
          <Select className="input" name={N.equipmentId} value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} options={sterilizers.map((s) => ({ value: String(s.id), label: s.name }))} />
        </Field>
        <Field label="날짜" required error={errors.date}>
          <DateInput className="input" name={N.date} value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="사이클 번호" error={errors.cycleNo}>
          <TextInput className="input num" name={N.cycleNo} value={cycleNo} maxLength={30} onChange={(e) => setCycleNo(e.target.value)} />
        </Field>
        <Field label="온도(℃)" error={errors.tempC}>
          <NumberInput className="input" name={N.tempC} step="0.1" value={tempC} onChange={(e) => setTempC(e.target.value)} />
        </Field>
        <Field label="압력(kPa)" error={errors.pressureKpa}>
          <NumberInput className="input" name={N.pressureKpa} step="1" value={pressureKpa} onChange={(e) => setPressureKpa(e.target.value)} />
        </Field>
        <Field label="시간(분)" error={errors.minutes}>
          <NumberInput className="input" name={N.minutes} step="0.5" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
      </div>
      <fieldset className="st-fieldset">
        <legend>
          판정
          <span className="req" aria-hidden="true">
            *
          </span>
        </legend>
        <div className="st-result">
          {STERILIZER_RESULTS.map((r) => (
            <label key={r} className={`st-radio ${r}`}>
              <input type="radio" name={N.result} value={r} checked={result === r} onChange={() => setResult(r)} />
              {STERILIZER_RESULT_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      {result === 'fail' ? (
        <Field label="조치 내용(알면 바로 적기)" error={errors.actionTaken} help="비워 두면 조치 전으로 남고, 실장님께 알림이 가요">
          <TextArea className="input" name={N.actionTaken} rows={2} maxLength={500} value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} />
        </Field>
      ) : null}
      <div className="eq-actions">
        <Button type="submit" variant="primary" icon="check" loading={busy}>
          기록 저장
        </Button>
      </div>
    </form>
  );
}

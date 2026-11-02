// 이 파일이 하는 일: "장비 점검·유지보수" 화면(/facility/equipment, FR-101). 장비 목록을 다음 점검일·D-day 칩과 함께 급한 순서로 보여 준다.
// 장비를 누르면 오른쪽 서랍에 정보·연결된 법정 일정·점검/수리 이력이 열리고, 누구나 이력(일자·내용·비용·업체·첨부)을 남긴다.
// 실장 이상은 장비를 등록·수정·사용 중지한다. 다음 점검일 = 마지막 점검일(없으면 설치일) + 점검 주기(개월). 장비 대장은 /print/equipment/:id로 인쇄한다.
// 보는 범위·종류는 주소(?view=&kind=)에, 알림에서 열 장비는 ?open=<번호>로 받는다.
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
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
import { api, ApiError, toApiError } from '../../lib/api.ts';
import { formatDateTime, formatWon } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { CSRF_HEADER } from '../../../../shared/schemas/auth.ts';
import {
  EQUIPMENT_KIND_LABELS,
  EQUIPMENT_KINDS,
  EQUIPMENT_LOG_KIND_LABELS,
  EQUIPMENT_LOG_KINDS,
  type Equipment,
  type EquipmentDetail,
  type EquipmentKind,
  type EquipmentList,
  type EquipmentLog,
  type EquipmentLogKind,
} from '../../../../shared/schemas/equipment.ts';
import { EQUIPMENT_KEY, equipmentDueChip, numOrNull, sortEquipment, wonText } from './equipmentLib.ts';
import './equipment.css';

/** 보는 범위 */
type View = 'active' | 'due' | 'off' | 'all';
const VIEWS: ReadonlyArray<{ value: View; label: string }> = [
  { value: 'active', label: '사용 중' },
  { value: 'due', label: '점검 임박' },
  { value: 'off', label: '사용 중지' },
  { value: 'all', label: '전체' },
];
const DUE = new Set(['overdue', 'today', 'soon', 'upcoming']);

/** 첨부로 올릴 수 있는 파일(서버 files.ts의 equipment와 같음) */
const ACCEPT = '.pdf,.jpg,.jpeg,.png';
const MAX_BYTES = 20 * 1024 * 1024;

/** 보는 범위·종류로 거른다 */
export function filterEquipment(items: readonly Equipment[], view: View, kind: EquipmentKind | ''): Equipment[] {
  return items.filter((e) => {
    if (kind && e.kind !== kind) return false;
    if (view === 'active') return e.active;
    if (view === 'due') return e.active && DUE.has(e.dueState);
    if (view === 'off') return !e.active;
    return true;
  });
}

/** 오류를 화면 문구로 */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 휴대폰에서 칸 이름을 앞에 붙인다(넓은 화면에서는 숨김) */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="eq-m" aria-hidden="true">
        {label}
      </span>
      <span className="eq-v">{children}</span>
    </>
  );
}

/** 장비 점검·유지보수 화면 */
export default function EquipmentPage() {
  const { info } = useSession();
  const canManage = can(info?.user?.role, 'equipment.manage');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const viewParam = params.get('view');
  const view: View = VIEWS.some((v) => v.value === viewParam) ? (viewParam as View) : 'active';
  const kindParam = params.get('kind') ?? '';
  const kind = (EQUIPMENT_KINDS as readonly string[]).includes(kindParam) ? (kindParam as EquipmentKind) : '';
  const openParam = Number(params.get('open'));
  const state = useApi<EquipmentList>(EQUIPMENT_KEY, () => api.get('/api/equipment'));
  const list = state.data;
  const [openId, setOpenId] = useState<number | null>(Number.isInteger(openParam) && openParam > 0 ? openParam : null);
  const [adding, setAdding] = useState(false);

  const setFilter = (next: { view?: View; kind?: EquipmentKind | '' }) => {
    const p: Record<string, string> = {};
    const v = next.view ?? view;
    const k = next.kind ?? kind;
    if (v !== 'active') p.view = v;
    if (k) p.kind = k;
    setParams(p, { replace: true });
  };
  const close = () => {
    setOpenId(null);
    if (params.has('open')) {
      const p = new URLSearchParams(params);
      p.delete('open');
      setParams(p, { replace: true });
    }
  };

  const items = useMemo(() => (list ? sortEquipment(filterEquipment(list.items, view, kind)) : undefined), [list, view, kind]);
  const counts = useMemo(() => {
    const act = (list?.items ?? []).filter((e) => e.active);
    return {
      active: act.length,
      overdue: act.filter((e) => e.dueState === 'overdue' || e.dueState === 'today').length,
      due: act.filter((e) => e.dueState === 'soon' || e.dueState === 'upcoming').length,
      repair: act.reduce((s, e) => s + e.repairCostTotal, 0),
    };
  }, [list]);
  const opened = list?.items.find((e) => e.id === openId) ?? null;

  const columns: ReadonlyArray<Column<Equipment>> = [
    {
      key: 'name',
      header: '장비',
      sortValue: (e) => e.name,
      render: (e) => (
        <span className="eq-title">
          <b>{e.name}</b>
          <small>
            {EQUIPMENT_KIND_LABELS[e.kind]}
            {e.vendorName ? ` · ${e.vendorName}` : ''}
          </small>
        </span>
      ),
    },
    { key: 'cycle', header: '점검 주기', render: (e) => <Cell label="점검 주기">{e.inspectCycleMonths ? `${e.inspectCycleMonths}개월마다` : '없음'}</Cell> },
    {
      key: 'last',
      header: '마지막 점검',
      sortValue: (e) => e.lastInspectionOn,
      render: (e) => (
        <Cell label="마지막 점검">
          <span className="num">{e.lastInspectionOn ?? '기록 없음'}</span>
        </Cell>
      ),
    },
    {
      key: 'next',
      header: '다음 점검',
      sortValue: (e) => (e.active ? e.nextInspectionOn : null),
      render: (e) => {
        const c = equipmentDueChip(e);
        return (
          <Cell label="다음 점검">
            <span className="eq-duecell">
              <span className="eq-due">
                {e.nextInspectionOn && e.active ? <span className="num">{e.nextInspectionOn}</span> : null}
                <Chip tone={c.tone}>{c.text}</Chip>
              </span>
              {e.dueBase === 'installed' ? <small className="eq-sub">설치일 기준</small> : null}
            </span>
          </Cell>
        );
      },
    },
    {
      key: 'repair',
      header: '최근 수리',
      sortValue: (e) => e.lastRepairOn,
      render: (e) => (
        <Cell label="최근 수리">
          <span className="num">{e.lastRepairOn ?? '—'}</span>
        </Cell>
      ),
    },
  ];

  const summary = list ? `사용 중 ${counts.active}대 · 점검 지남·오늘 ${counts.overdue}대 · ${list.warnDays}일 안 ${counts.due}대` : '불러오는 중이에요';

  return (
    <>
      <PageHeader
        title="장비 점검·유지보수"
        summary={summary}
        actions={
          canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              장비 등록
            </Button>
          ) : undefined
        }
      />
      <KpiRow label="장비 점검 요약">
        <Kpi label="사용 중 장비" value={list ? counts.active : null} unit="대" hint="사용 중지 장비 제외" />
        <Kpi label="점검 지남·오늘" value={list ? counts.overdue : null} unit="대" tone={counts.overdue ? 'danger' : undefined} hint="바로 점검해 주세요" />
        <Kpi label={`${list?.warnDays ?? 30}일 안 점검`} value={list ? counts.due : null} unit="대" tone={counts.due ? 'warn' : undefined} hint="알림이 가는 장비" />
        <Kpi label="수리비 합계" value={list ? formatWon(counts.repair) : null} hint="기록한 수리 이력 기준" />
      </KpiRow>
      <Card className="eq-card">
        <Toolbar label="장비 목록 도구">
          <Segmented<View> label="보는 범위" value={view} onChange={(v) => setFilter({ view: v })} options={VIEWS} />
          <span className="grow" />
          <select className="input eq-filter" aria-label="장비 종류" value={kind} onChange={(e) => setFilter({ kind: e.target.value as EquipmentKind | '' })}>
            <option value="">모든 종류</option>
            {EQUIPMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {EQUIPMENT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Toolbar>
        <div className="eq-table" data-testid="equipment-table">
          <DataTable<Equipment>
            caption="장비 목록"
            columns={columns}
            rows={items}
            rowKey={(e) => e.id}
            rowLabel={(e) => e.name}
            loading={state.loading}
            error={state.error}
            onRetry={state.reload}
            onRowClick={(e) => setOpenId(e.id)}
            empty={
              <div style={{ padding: 'var(--pad)' }}>
                <EmptyState
                  icon="tool"
                  title={view === 'active' && !kind ? '등록한 장비가 없어요' : '조건에 맞는 장비가 없어요'}
                  description={view === 'active' && !kind ? (canManage ? '장비를 등록하면 다음 점검일을 알려 드려요.' : '실장님이 장비를 등록하면 여기에 보여요.') : '보는 범위나 종류를 바꿔 보세요.'}
                  action={
                    view !== 'active' || kind ? (
                      <Button onClick={() => setFilter({ view: 'all', kind: '' })}>전체 보기</Button>
                    ) : canManage ? (
                      <Button icon="plus" onClick={() => setAdding(true)}>
                        첫 장비 등록
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
        <EquipmentDrawer
          key={opened.id}
          eq={opened}
          today={list?.today ?? ''}
          canManage={canManage}
          csrfToken={info?.csrfToken ?? null}
          onClose={close}
          onChanged={(msg) => {
            invalidate(EQUIPMENT_KEY);
            toast.show(msg);
          }}
        />
      ) : null}
      {adding ? (
        <Dialog open wide onClose={() => setAdding(false)} title="장비 등록">
          <EquipmentForm
            initial={null}
            today={list?.today ?? ''}
            submitLabel="등록"
            onCancel={() => setAdding(false)}
            onSubmit={async (body) => {
              const e = await api.post<Equipment>('/api/equipment', body);
              setAdding(false);
              invalidate(EQUIPMENT_KEY);
              toast.show(`"${e.name}" 장비를 등록했어요.`);
              setOpenId(e.id);
            }}
          />
        </Dialog>
      ) : null}
    </>
  );
}

/** 장비 자세히 보기·이력 남기기·수정 서랍 */
function EquipmentDrawer({
  eq,
  today,
  canManage,
  csrfToken,
  onClose,
  onChanged,
}: {
  eq: Equipment;
  today: string;
  canManage: boolean;
  csrfToken: string | null;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const detail = useApi<EquipmentDetail>(`${EQUIPMENT_KEY}:detail:${eq.id}:${eq.updatedAt}:${eq.logCount}:${eq.lastInspectionOn ?? ''}`, () => api.get(`/api/equipment/${eq.id}`));
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const chip = equipmentDueChip(eq);

  const toggle = async () => {
    setToggling(true);
    setToggleError(null);
    try {
      await api.patch(`/api/equipment/${eq.id}`, { active: !eq.active });
      onChanged(eq.active ? `"${eq.name}"을(를) 사용 중지했어요. 점검 알림이 가지 않아요.` : `"${eq.name}"을(를) 다시 사용해요.`);
    } catch (err) {
      setToggleError(messageOf(err, '바꾸지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setToggling(false);
    }
  };

  return (
    <Dialog open kind="drawer" onClose={onClose} title={editing ? `${eq.name} 정보 수정` : eq.name}>
      {editing ? (
        <EquipmentForm
          initial={eq}
          today={today}
          submitLabel="저장"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await api.patch(`/api/equipment/${eq.id}`, body);
            setEditing(false);
            onChanged(`"${body.name ?? eq.name}" 정보를 저장했어요. 다음 점검일을 다시 계산했어요.`);
          }}
        />
      ) : (
        <div className="eq-drawer" data-testid="equipment-drawer">
          <div className="eq-chips">
            <Chip>{EQUIPMENT_KIND_LABELS[eq.kind]}</Chip>
            <Chip tone={chip.tone}>{chip.text}</Chip>
          </div>
          <dl className="eq-dl">
            <dt>다음 점검</dt>
            <dd data-testid="equipment-next-due">
              {eq.nextInspectionOn && eq.active ? (
                <>
                  <b className="num">{eq.nextInspectionOn}</b> <span>({chip.text})</span>
                </>
              ) : (
                chip.text
              )}
            </dd>
            <dt>마지막 점검</dt>
            <dd className="num">{eq.lastInspectionOn ?? (eq.dueBase === 'installed' ? '기록 없음(설치일 기준으로 계산)' : '기록 없음')}</dd>
            <dt>점검 주기</dt>
            <dd>{eq.inspectCycleMonths ? `${eq.inspectCycleMonths}개월마다` : '정기 점검 없음'}</dd>
            <dt>설치일</dt>
            <dd className="num">{eq.installedOn ?? '—'}</dd>
            <dt>업체</dt>
            <dd>{eq.vendorName ?? '—'}</dd>
            <dt>수리비 합계</dt>
            <dd className="num">{formatWon(eq.repairCostTotal)}</dd>
            {eq.memo ? (
              <>
                <dt>메모</dt>
                <dd>{eq.memo}</dd>
              </>
            ) : null}
          </dl>
          <div className="eq-actions">
            <Button icon="print" to={`/print/equipment/${eq.id}`}>
              장비 대장 인쇄
            </Button>
          </div>

          {detail.data && detail.data.legalTasks.length ? (
            <section className="eq-sec" aria-label="연결된 법정 일정">
              <h3>연결된 법정 일정</h3>
              <ul className="eq-legal" data-testid="equipment-legal">
                {detail.data.legalTasks.map((t) => (
                  <li key={t.id}>
                    <Link to="/facility/legal">{t.title}</Link>
                    <span className="num">다음 예정일 {t.nextDueOn ?? '수행일 입력 필요'}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {eq.active ? <LogForm eq={eq} today={today} csrfToken={csrfToken} onSaved={onChanged} /> : null}

          {canManage ? (
            <section className="eq-sec" aria-label="장비 관리">
              <h3>장비 관리</h3>
              {toggleError ? (
                <div className="form-error" role="alert">
                  <Icon name="alert" size="md" />
                  {toggleError}
                </div>
              ) : null}
              <div className="eq-actions">
                <Button icon="gear" onClick={() => setEditing(true)}>
                  정보 수정
                </Button>
                <Button onClick={() => void toggle()} loading={toggling}>
                  {eq.active ? '사용 중지' : '다시 사용'}
                </Button>
              </div>
            </section>
          ) : null}

          <section className="eq-sec" aria-label="점검·수리 이력">
            <h3>점검·수리 이력</h3>
            {detail.error && !detail.data ? (
              <ErrorState message={detail.error.message} onRetry={detail.reload} />
            ) : !detail.data ? (
              <Skeleton rows={2} label="이력 불러오는 중" />
            ) : detail.data.logs.length === 0 ? (
              <EmptyState icon="tool" title="점검·수리 이력이 없어요" description="위에서 점검이나 수리를 기록하면 여기에 쌓여요." />
            ) : (
              <ul className="eq-logs" data-testid="equipment-logs">
                {detail.data.logs.map((l) => (
                  <LogItem key={l.id} log={l} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

/** 이력 한 줄 */
function LogItem({ log }: { log: EquipmentLog }) {
  return (
    <li>
      <b className="num">{log.date}</b>
      <span className="eq-logbody">
        <span>
          <Chip tone={log.kind === 'repair' ? 'warn' : 'info'}>{EQUIPMENT_LOG_KIND_LABELS[log.kind]}</Chip> {log.content}
        </span>
        <small>
          {[log.cost !== null ? wonText(log.cost) : null, log.vendorName, log.user?.name, formatDateTime(log.createdAt)].filter(Boolean).join(' · ')}
        </small>
        {log.file ? (
          <a href={`/api/files/${log.file.id}`} download>
            첨부: {log.file.name}
          </a>
        ) : null}
      </span>
    </li>
  );
}

/** 이력 저장(첨부가 있으면 multipart, 없으면 JSON) */
async function saveLog(csrfToken: string | null, id: number, body: Record<string, string | number | null>, file: File | null): Promise<EquipmentLog> {
  if (!file) return api.post<EquipmentLog>(`/api/equipment/${id}/logs`, body);
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) if (v !== null) fd.set(k, String(v));
  fd.set('file', file, file.name);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api/equipment/${id}/logs`, { method: 'POST', credentials: 'same-origin', headers, body: fd });
  } catch {
    throw toApiError(0, { error: { code: 'NETWORK', message: '서버에 연결할 수 없어요. 원내 와이파이에 연결되어 있는지 확인해 주세요.' } });
  }
  const json = (await res.json().catch(() => null)) as { data?: EquipmentLog } | null;
  if (!res.ok || !json?.data) throw toApiError(res.status, json);
  return json.data;
}

/** 점검·수리 기록 남기기(모든 직원) */
function LogForm({ eq, today, csrfToken, onSaved }: { eq: Equipment; today: string; csrfToken: string | null; onSaved: (msg: string) => void }) {
  const [kind, setKind] = useState<EquipmentLogKind>('inspection');
  const [date, setDate] = useState(today);
  const [content, setContent] = useState('');
  const [cost, setCost] = useState('');
  const [vendor, setVendor] = useState(eq.vendorName ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errs.date = '일자를 골라 주세요.';
    else if (today && date > today) errs.date = '오늘이나 지난 날짜를 골라 주세요.';
    if (!content.trim()) errs.content = '무엇을 했는지 적어 주세요.';
    const costNum = numOrNull(cost);
    if (costNum !== null && (!Number.isInteger(costNum) || costNum < 0)) errs.cost = '비용은 0 이상 숫자로 적어 주세요.';
    if (file && file.size > MAX_BYTES) errs.file = '파일이 너무 커요. 20MB 이하로 올려 주세요.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await saveLog(csrfToken, eq.id, { date, kind, content: content.trim(), cost: costNum, vendorName: vendor.trim() || null }, file);
      setContent('');
      setCost('');
      setFile(null);
      setFileKey((k) => k + 1);
      onSaved(`${EQUIPMENT_LOG_KIND_LABELS[kind]} 기록을 남겼어요.`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '기록하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="eq-sec eq-form" onSubmit={submit} noValidate aria-label="점검·수리 기록 남기기">
      <h3>점검·수리 기록 남기기</h3>
      {formError ? (
        <div className="form-error" role="alert">
          <Icon name="alert" size="md" />
          {formError}
        </div>
      ) : null}
      <Segmented<EquipmentLogKind> label="기록 종류" value={kind} onChange={setKind} options={EQUIPMENT_LOG_KINDS.map((k) => ({ value: k, label: EQUIPMENT_LOG_KIND_LABELS[k] }))} />
      <div className="eq-grid2">
        <Field label="일자" required error={errors.date}>
          <DateInput className="input" value={date} max={today || undefined} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="비용(원)" error={errors.cost} help="모르면 비워 두세요">
          <NumberInput className="input num" inputMode="numeric" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
      </div>
      <Field label="내용" required error={errors.content} help={kind === 'inspection' ? '예: 정기 점검, 필터 교체' : '예: 급수 펌프 교체'}>
        <TextInput className="input" value={content} maxLength={500} onChange={(e) => setContent(e.target.value)} />
      </Field>
      <div className="eq-grid2">
        <Field label="업체" error={errors.vendorName}>
          <TextInput className="input" value={vendor} maxLength={60} onChange={(e) => setVendor(e.target.value)} />
        </Field>
        <Field label="첨부(선택)" error={errors.file} help="점검표·견적서(PDF·JPG·PNG, 20MB 이하)">
          <TextInput key={fileKey} className="input" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
      <div className="eq-actions">
        <Button type="submit" icon="check" loading={busy}>
          기록 저장
        </Button>
      </div>
    </form>
  );
}

/** 등록·수정 입력 값 */
interface EquipmentBody {
  name?: string;
  kind?: EquipmentKind;
  installedOn?: string | null;
  vendorName?: string | null;
  inspectCycleMonths?: number | null;
  memo?: string | null;
}

/** 장비 등록·수정 양식. initial이 있으면 수정 */
function EquipmentForm({
  initial,
  today,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Equipment | null;
  today: string;
  submitLabel: string;
  onSubmit: (body: EquipmentBody) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<EquipmentKind>(initial?.kind ?? 'other');
  const [installedOn, setInstalledOn] = useState(initial?.installedOn ?? '');
  const [vendor, setVendor] = useState(initial?.vendorName ?? '');
  const [cycle, setCycle] = useState(initial?.inspectCycleMonths ? String(initial.inspectCycleMonths) : '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = '장비 이름을 적어 주세요.';
    const months = numOrNull(cycle);
    if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) errs.inspectCycleMonths = '점검 주기(개월)는 1~120 사이로 적어 주세요.';
    if (installedOn && today && installedOn > today) errs.installedOn = '오늘이나 지난 날짜를 골라 주세요.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), kind, installedOn: installedOn || null, vendorName: vendor.trim() || null, inspectCycleMonths: months, memo: memo.trim() || null });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="eq-form" onSubmit={submit} noValidate aria-label={initial ? '장비 정보 수정' : '장비 등록'}>
      {formError ? (
        <div className="form-error" role="alert">
          <Icon name="alert" size="md" />
          {formError}
        </div>
      ) : null}
      <div className="eq-grid2">
        <Field label="장비 이름" required error={errors.name} help="예: 오토클레이브 1호기">
          <TextInput className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="종류" error={errors.kind}>
          <Select className="input" value={kind} onChange={(e) => setKind(e.target.value as EquipmentKind)} options={EQUIPMENT_KINDS.map((k) => ({ value: k, label: EQUIPMENT_KIND_LABELS[k] }))} />
        </Field>
        <Field label="설치일" error={errors.installedOn} help="점검 기록이 없으면 이 날로 다음 점검일을 계산해요">
          <DateInput className="input" value={installedOn} max={today || undefined} onChange={(e) => setInstalledOn(e.target.value)} />
        </Field>
        <Field label="점검 주기(개월)" error={errors.inspectCycleMonths} help="예: 6개월마다면 6. 비우면 정기 점검 없음">
          <NumberInput className="input" inputMode="numeric" min={1} max={120} value={cycle} onChange={(e) => setCycle(e.target.value)} />
        </Field>
      </div>
      <Field label="업체" error={errors.vendorName} help="점검·수리를 맡는 업체">
        <TextInput className="input" value={vendor} maxLength={60} onChange={(e) => setVendor(e.target.value)} />
      </Field>
      <Field label="메모" error={errors.memo}>
        <TextArea className="input" rows={2} value={memo} maxLength={500} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <div className="eq-actions">
        <Button onClick={onCancel}>취소</Button>
        <Button type="submit" variant="primary" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

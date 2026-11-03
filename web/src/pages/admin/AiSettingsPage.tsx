// 이 파일이 하는 일: "AI 설정·예산" 화면(/admin/ai, 원장·관리자 전용, FR-030~036·FR-038).
// 공급자·월 예산·경고 비율·환율 저장, 공급자별 API 키 입력·삭제·연결 확인(키는 끝 4자리만 보임, FR-031), 기능별 켜기·등급·허용 역할,
// 모델 이름·단가 표 편집(그 뒤 호출부터 새 단가로 비용 계산, FR-036 AC2), AI 시험해 보기(AiPanel), 서비스 이용 고지를 한 화면에 둔다.
// 서버 API: GET/PUT /api/ai/settings, POST /api/ai/test, GET/PUT /api/ai/models(backend.md §3.10).
import { useState, type ReactNode } from 'react';
import { AI_FEATURE_IDS, AI_PROVIDER_LABELS, AI_PROVIDERS, AI_TIER_LABELS, AI_TIERS, REAL_PROVIDERS, type AiProvider, type AiTier, type RealProvider } from '../../../../shared/ai-features.ts';
import { ROLE_LABELS, type Role } from '../../../../shared/roles.ts';
import { AiPanel } from '../../components/AiPanel.tsx';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { Field, NumberInput, PasswordInput, Select } from '../../components/Field.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiError } from '../../lib/api.ts';
import type { AiFeatureSetting, AiModelView, AiSettingsView } from '../../lib/ai.ts';
import { formatNumber } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import '../../components/AiPanel.css';

/** 설정 불러오기 */
const fetchSettings = () => api.get<AiSettingsView>('/api/ai/settings');
/** 모델 표 불러오기 */
const fetchModels = () => api.get<{ models: AiModelView[]; fxKrwPerUsd: number }>('/api/ai/models');

/** 입력 칸 글을 숫자로(비었거나 숫자가 아니면 null) */
function toNum(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 오류에서 항목별 문구를 꺼낸다 */
function fieldsOf(e: unknown): Record<string, string> {
  return e instanceof ApiError && e.fields ? e.fields : {};
}

/** 공급자·월 예산·경고 비율·환율 */
function GeneralForm({ s }: { s: AiSettingsView }) {
  const toast = useToast();
  const [provider, setProvider] = useState<AiProvider>(s.provider);
  const [budget, setBudget] = useState(String(s.monthlyBudgetKrw));
  const [warn, setWarn] = useState(String(s.warnPct));
  const [fx, setFx] = useState(String(s.fxKrwPerUsd));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const keyMissing = provider !== 'demo' && !s.keys[provider].saved;

  const save = async () => {
    const e: Record<string, string> = {};
    const b = toNum(budget);
    const w = toNum(warn);
    const f = toNum(fx);
    if (b === null || b < 0 || !Number.isInteger(b)) e.monthlyBudgetKrw = '월 예산은 0 이상의 원 단위 숫자로 적어 주세요.';
    if (w === null || w < 1 || w > 100 || !Number.isInteger(w)) e.warnPct = '경고 비율은 1~100 사이로 적어 주세요.';
    if (f === null || f < 100 || f > 10000) e.fxKrwPerUsd = '환율은 1달러에 100~10,000원 사이로 적어 주세요.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await api.put('/api/ai/settings', { provider, monthlyBudgetKrw: b, warnPct: w, fxKrwPerUsd: f });
      toast.show('AI 설정을 저장했어요');
      invalidate('ai:');
    } catch (err) {
      setErrors(fieldsOf(err));
      toast.error(err instanceof Error ? err.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ai-panel">
      <Field label="AI 공급자" help={keyMissing ? '이 공급자의 키가 아직 없어요. 키를 저장하기 전까지는 데모 모드로 동작해요.' : '키가 없으면 데모 모드(예시 응답, 비용 0원)로 동작해요.'}>
        <Select value={provider} onChange={(e) => setProvider(e.target.value as AiProvider)} options={AI_PROVIDERS.map((p) => ({ value: p, label: AI_PROVIDER_LABELS[p] }))} />
      </Field>
      <div className="form-grid">
        <Field label="월 예산(원)" error={errors.monthlyBudgetKrw} help="이번 달 누적이 예산에 닿으면 새 AI 요청이 막혀요.">
          <NumberInput value={budget} min={0} step={1000} onChange={(e) => setBudget(e.target.value)} />
        </Field>
        <Field label="경고 비율(%)" error={errors.warnPct} help="이 비율을 넘으면 관리자에게 알림이 가요.">
          <NumberInput value={warn} min={1} max={100} onChange={(e) => setWarn(e.target.value)} />
        </Field>
        <Field label="환율(1달러당 원)" error={errors.fxKrwPerUsd} help="비용(원) = 달러 비용 × 환율">
          <NumberInput value={fx} min={100} max={10000} onChange={(e) => setFx(e.target.value)} />
        </Field>
      </div>
      <div className="form-actions">
        <span className="grow" />
        <Button variant="primary" icon="check" loading={saving} onClick={save}>
          설정 저장
        </Button>
      </div>
    </div>
  );
}

/** 공급자 하나의 키 입력·삭제·연결 확인 */
function KeyRow({ provider, state, current }: { provider: RealProvider; state: { saved: boolean; maskedKey: string | null }; current: boolean }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const name = AI_PROVIDER_LABELS[provider];

  const saveKey = async () => {
    if (!value.trim()) {
      setError('API 키를 붙여 넣어 주세요.');
      return;
    }
    setBusy('save');
    setError(null);
    try {
      await api.put('/api/ai/settings', { keys: { [provider]: value.trim() } });
      setValue('');
      setTest(null);
      toast.show(`${name} 키를 저장했어요`);
      invalidate('ai:');
    } catch (e) {
      setError(fieldsOf(e)[`keys.${provider}`] ?? (e instanceof Error ? e.message : '저장하지 못했어요.'));
    } finally {
      setBusy(null);
    }
  };

  const removeKey = async () => {
    await api.put('/api/ai/settings', { keys: { [provider]: null } });
    setConfirm(false);
    setTest(null);
    toast.show(`${name} 키를 지웠어요`);
    invalidate('ai:');
  };

  const runTest = async () => {
    setBusy('test');
    try {
      setTest(await api.post<{ ok: boolean; message: string }>('/api/ai/test', { provider }));
    } catch (e) {
      setTest({ ok: false, message: e instanceof Error ? e.message : '연결을 확인하지 못했어요.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="keyrow" data-testid={`key-${provider}`}>
      <div className="keyhead">
        <b>{name}</b>
        {state.saved ? <Chip tone="ok">키 저장됨</Chip> : <Chip tone="ghost">키 없음</Chip>}
        {current ? <Chip tone="info">사용 중</Chip> : null}
        {state.maskedKey ? (
          <span className="masked" data-testid={`masked-${provider}`} title="저장된 키는 끝 4자리만 보여요">
            {state.maskedKey}
          </span>
        ) : null}
      </div>
      <div className="keyform">
        <Field label={`${name} API 키`} error={error}>
          <PasswordInput value={value} autoComplete="new-password" spellCheck={false} placeholder="새 키 붙여 넣기" onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button icon="key" loading={busy === 'save'} onClick={saveKey}>
          키 저장
        </Button>
        {state.saved ? (
          <>
            <Button icon="wifi" loading={busy === 'test'} onClick={runTest}>
              연결 확인
            </Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              키 삭제
            </Button>
          </>
        ) : null}
      </div>
      <span className="keynote">{state.saved ? '새 키를 넣고 저장하면 바꿔요. 저장한 키는 다시 볼 수 없어요.' : '공급자 화면에서 복사한 키를 붙여 넣으세요.'}</span>
      {test ? (
        <div className={test.ok ? 'ai-note' : 'pii'} role="status">
          <span>{test.message}</span>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={removeKey}
        title={`${name} 키 삭제`}
        message={`저장된 ${name} 키를 지울까요? 이 공급자를 쓰고 있었다면 데모 모드로 바뀝니다.`}
        confirmLabel="삭제"
        danger
      />
    </div>
  );
}

/** 기능별 켜기·등급·허용 역할 */
function FeaturesForm({ features }: { features: AiFeatureSetting[] }) {
  const toast = useToast();
  const [rows, setRows] = useState(features);
  const [saving, setSaving] = useState(false);
  const patch = (id: string, p: Partial<AiFeatureSetting>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const save = async () => {
    setSaving(true);
    try {
      const body = Object.fromEntries(rows.map((r) => [r.id, { enabled: r.enabled, roles: r.roles, tier: r.tier }]));
      await api.put('/api/ai/settings', { features: body });
      toast.show('기능별 설정을 저장했어요');
      invalidate('ai:');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<AiFeatureSetting>[] = [
    { key: 'label', header: '기능', render: (r) => <b>{r.label}</b> },
    {
      key: 'enabled',
      header: '사용',
      render: (r) => (
        <label className="inline">
          <input type="checkbox" checked={r.enabled} onChange={(e) => patch(r.id, { enabled: e.target.checked })} aria-label={`${r.label} 사용`} />
          {r.enabled ? '켜짐' : '꺼짐'}
        </label>
      ),
    },
    {
      key: 'tier',
      header: '기본 등급',
      render: (r) => (
        <select className="cell" value={r.tier} onChange={(e) => patch(r.id, { tier: e.target.value as AiTier })} aria-label={`${r.label} 등급`}>
          {AI_TIERS.map((t) => (
            <option key={t} value={t}>
              {AI_TIER_LABELS[t]}
              {t === r.defaultTier ? '(기본)' : ''}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'roles',
      header: '쓸 수 있는 사람',
      render: (r) => (
        <span className="roles">
          {r.defaultRoles.map((role: Role) => (
            <label key={role}>
              <input
                type="checkbox"
                checked={r.roles.includes(role)}
                onChange={(e) => patch(r.id, { roles: e.target.checked ? [...r.roles, role] : r.roles.filter((x) => x !== role) })}
                aria-label={`${r.label} ${ROLE_LABELS[role]}`}
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </span>
      ),
    },
    { key: 'userTier', header: '등급 고르기', render: (r) => (r.userTier ? <Chip tone="info">사용자가 고름</Chip> : <Chip tone="ghost">고정</Chip>) },
  ];

  return (
    <>
      <DataTable caption="기능별 AI 사용 설정" columns={columns} rows={rows} rowKey={(r) => r.id} empty={<EmptyState title="AI 기능이 없어요" />} />
      <div className="form-actions under">
        <span className="note">
          끈 기능은 화면에서 안내가 나오고 서버에서도 거절돼요. 권한 표에 없는 역할은 늘릴 수 없어요.
        </span>
        <span className="grow" />
        <Button icon="check" loading={saving} onClick={save}>
          기능 설정 저장
        </Button>
      </div>
    </>
  );
}

/** 모델 한 줄의 입력 상태 */
interface ModelDraft {
  modelId: string;
  input: string;
  output: string;
  checkedOn: string;
}

/** 모델·단가 표 편집 */
function ModelsForm({ models, fx }: { models: AiModelView[]; fx: number }) {
  const toast = useToast();
  const active = models.filter((m) => m.active);
  const keyOf = (m: Pick<AiModelView, 'provider' | 'tier'>) => `${m.provider}:${m.tier}`;
  const initial = () => Object.fromEntries(active.map((m) => [keyOf(m), { modelId: m.modelId, input: String(m.inputUsdPerM), output: String(m.outputUsdPerM), checkedOn: m.checkedOn ?? '' }]));
  const [drafts, setDrafts] = useState<Record<string, ModelDraft>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: string, p: Partial<ModelDraft>) => setDrafts((d) => ({ ...d, [k]: { ...(d[k] as ModelDraft), ...p } }));

  const save = async () => {
    const changed: Record<string, unknown>[] = [];
    for (const m of active) {
      const d = drafts[keyOf(m)];
      if (!d) continue;
      const input = toNum(d.input);
      const output = toNum(d.output);
      const label = `${AI_PROVIDER_LABELS[m.provider]} ${AI_TIER_LABELS[m.tier]}`;
      if (!d.modelId.trim()) return setError(`${label}: 모델 이름을 적어 주세요.`);
      if (input === null || input < 0 || output === null || output < 0) return setError(`${label}: 단가는 0 이상의 숫자로 적어 주세요.`);
      const row: Record<string, unknown> = { provider: m.provider, tier: m.tier };
      if (d.modelId.trim() !== m.modelId) row.modelId = d.modelId.trim();
      if (input !== m.inputUsdPerM) row.inputUsdPerM = input;
      if (output !== m.outputUsdPerM) row.outputUsdPerM = output;
      if ((d.checkedOn || null) !== m.checkedOn) row.checkedOn = d.checkedOn || null;
      if (Object.keys(row).length > 2) changed.push(row);
    }
    setError(null);
    if (changed.length === 0) {
      toast.show('바뀐 내용이 없어요');
      return;
    }
    setSaving(true);
    try {
      await api.put('/api/ai/models', { models: changed });
      toast.show(`모델·단가 ${changed.length}줄을 저장했어요. 다음 호출부터 새 단가로 계산해요`);
      invalidate('ai:');
    } catch (e) {
      const f = fieldsOf(e);
      setError(Object.values(f)[0] ?? (e instanceof Error ? e.message : '저장하지 못했어요.'));
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<AiModelView>[] = [
    { key: 'provider', header: '공급자', render: (m) => AI_PROVIDER_LABELS[m.provider] },
    { key: 'tier', header: '등급', render: (m) => <Chip tone="info">{AI_TIER_LABELS[m.tier]}</Chip> },
    {
      key: 'modelId',
      header: '모델 이름',
      render: (m) => (
        <input className="cell model" value={drafts[keyOf(m)]?.modelId ?? ''} onChange={(e) => set(keyOf(m), { modelId: e.target.value })} aria-label={`${AI_PROVIDER_LABELS[m.provider]} ${AI_TIER_LABELS[m.tier]} 모델 이름`} spellCheck={false} />
      ),
    },
    {
      key: 'input',
      header: '입력 단가($/100만 토큰)',
      align: 'right',
      render: (m) => (
        <input className="cell num" inputMode="decimal" value={drafts[keyOf(m)]?.input ?? ''} onChange={(e) => set(keyOf(m), { input: e.target.value })} aria-label={`${AI_PROVIDER_LABELS[m.provider]} ${AI_TIER_LABELS[m.tier]} 입력 단가`} />
      ),
    },
    {
      key: 'output',
      header: '출력 단가($/100만 토큰)',
      align: 'right',
      render: (m) => (
        <input className="cell num" inputMode="decimal" value={drafts[keyOf(m)]?.output ?? ''} onChange={(e) => set(keyOf(m), { output: e.target.value })} aria-label={`${AI_PROVIDER_LABELS[m.provider]} ${AI_TIER_LABELS[m.tier]} 출력 단가`} />
      ),
    },
    {
      key: 'checkedOn',
      header: '확인 날짜',
      render: (m) => (
        <input className="cell" type="date" value={drafts[keyOf(m)]?.checkedOn ?? ''} onChange={(e) => set(keyOf(m), { checkedOn: e.target.value })} aria-label={`${AI_PROVIDER_LABELS[m.provider]} ${AI_TIER_LABELS[m.tier]} 확인 날짜`} />
      ),
    },
    {
      key: 'source',
      header: '출처',
      render: (m) =>
        m.sourceUrl ? (
          <a href={m.sourceUrl} target="_blank" rel="noreferrer noopener">
            가격 페이지
          </a>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <>
      <DataTable caption="모델·단가 표" columns={columns} rows={active} rowKey={(m) => m.id} empty={<EmptyState title="등록된 모델이 없어요" />} />
      {error ? (
        <div className="form-error under" role="alert">
          {error}
        </div>
      ) : null}
      <div className="form-actions under">
        <span className="note num">
          비용(원) = (입력 토큰 × 입력 단가 + 출력 토큰 × 출력 단가) ÷ 100만 × 환율 {formatNumber(fx)}원
        </span>
        <span className="grow" />
        <Button icon="check" loading={saving} onClick={save}>
          단가 저장
        </Button>
      </div>
    </>
  );
}

/** AI 설정·예산 */
export default function AiSettingsPage() {
  const settings = useApi('ai:settings', fetchSettings);
  const models = useApi('ai:models', fetchModels);
  const s = settings.data;

  const loadingOr = (node: (v: AiSettingsView) => ReactNode) => {
    if (settings.error && !s) return <ErrorState message={settings.error.message} onRetry={settings.reload} />;
    if (!s) return <Skeleton rows={4} />;
    return node(s);
  };

  // 저장 뒤 서버 값이 바뀌면 입력 상태를 새 값으로 다시 만든다(key)
  const sKey = s ? JSON.stringify([s.provider, s.monthlyBudgetKrw, s.warnPct, s.fxKrwPerUsd]) : '';
  const fKey = s ? JSON.stringify(s.features) : '';
  const mKey = models.data ? JSON.stringify(models.data.models) : '';

  const summary = s
    ? s.demo
      ? '지금은 데모 모드예요(예시 응답, 비용 0원). 공급자를 고르고 키를 저장하면 실제 AI로 바뀝니다.'
      : `${AI_PROVIDER_LABELS[s.effectiveProvider]}로 동작 중 · 월 예산 ${formatNumber(s.monthlyBudgetKrw)}원`
    : 'AI 공급자·키·예산·모델 단가를 관리해요.';

  return (
    <>
      <PageHeader
        title="AI 설정·예산"
        summary={summary}
        actions={
          <Button to="/admin/ai-usage" icon="won">
            사용량 보기
          </Button>
        }
      />
      <div className="ai-admin-grid">
        <Card title="공급자·예산" id="ai-general" sub={s ? (s.demo ? '데모 모드' : AI_PROVIDER_LABELS[s.effectiveProvider]) : undefined}>
          {loadingOr((v) => (
            <GeneralForm key={sKey} s={v} />
          ))}
        </Card>
        <Card title="API 키" id="ai-keys" sub="화면에는 끝 4자리만 보여요">
          {loadingOr((v) => (
            <div>
              {REAL_PROVIDERS.map((p) => (
                <KeyRow key={`${p}:${v.keys[p].maskedKey ?? ''}`} provider={p} state={v.keys[p]} current={v.effectiveProvider === p} />
              ))}
            </div>
          ))}
        </Card>
        <Card title="기능별 사용" id="ai-features" className="wide" sub={`${AI_FEATURE_IDS.length}개 기능`}>
          {loadingOr((v) => (
            <FeaturesForm key={fKey} features={v.features} />
          ))}
        </Card>
        <Card title="모델·단가" id="ai-models" className="wide" sub="백만 토큰당 달러">
          {models.error && !models.data ? (
            <ErrorState message={models.error.message} onRetry={models.reload} />
          ) : !models.data ? (
            <Skeleton rows={5} />
          ) : (
            <ModelsForm key={mKey} models={models.data.models} fx={models.data.fxKrwPerUsd} />
          )}
        </Card>
        <Card title="AI 시험해 보기" id="ai-try" sub="빠른 요청 기능으로 실행해요">
          <AiPanel feature="quick" label="시험 요청" rows={3} primary={false} placeholder="예: 주차 2시간 무료 안내 전화 멘트 만들어줘" />
        </Card>
        <Card title="서비스 이용 고지" id="ai-terms">
          <ul className="terms">
            <li>AI 기능은 고른 공급자(Anthropic·OpenAI·Google)의 서버로 글을 보냅니다. 환자 개인정보는 입력하지 마세요.</li>
            <li>보내기 전에 서버가 전화번호·주민등록번호·카드번호 등을 검사해 가리거나 막습니다.</li>
            <li>AI 초안은 참고용이며 법률 자문을 대신하지 않습니다. 의료광고·법률 판단은 전문가 확인이 필요합니다.</li>
            <li>비용은 공급자 단가와 환율로 계산한 추정치이며 실제 청구액과 다를 수 있습니다.</li>
            <li>API 키는 이 서버 PC에 암호화해 저장하며, 화면·기록 어디에도 원문이 나오지 않습니다.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

// 이 파일이 하는 일: "의료광고 문구 점검" 화면(/docs/adcheck, FR-120). 홍보 글·답글을 붙여 넣고 "점검하기"를 누르면 규칙 사전으로 위험 표현을 찾고(1차),
// 원하면 AI가 한 번 더 살펴본다(2차). 결과는 하이라이트·이유·바꿀 말과 "법률 자문이 아니며…" 고지로 보인다(AdCheckResult).
// 아래 "점검 규칙 사전"은 모두가 볼 수 있고, admin은 규칙을 추가·고치기·끄기·지우기 할 수 있다(FR-120 AC3, 저장하면 다음 점검부터 적용).
// 화면의 주 행동(채워진 청록)은 "점검하기" 하나다.
import { useState } from 'react';
import { AdCheckResult } from '../../components/AdCheckResult.tsx';
import { checkAdText, fetchAdRules, ruleToInput, saveAdRules } from '../../components/adcheck.ts';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { ConfirmDialog, Dialog } from '../../components/Dialog.tsx';
import { Checkbox, Field, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { PrivacyGuard, PrivacyWarning } from '../../components/PrivacyGuard.tsx';
import { EmptyState } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { ApiError } from '../../lib/api.ts';
import { fetchAiStatus } from '../../lib/ai.ts';
import { formatNumber } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { can } from '../../../../shared/roles.ts';
import {
  AD_MATCH_TYPE_LABELS,
  AD_MATCH_TYPES,
  AD_RULE_CATEGORIES,
  AD_RULE_CATEGORY_LABELS,
  AD_SEVERITIES,
  AD_SEVERITY_LABELS,
  ADCHECK_MAX_TEXT,
  type AdcheckResponse,
  type AdMatchType,
  type AdRule,
  type AdRuleCategory,
  type AdSeverity,
} from '../../../../shared/schemas/adcheck.ts';
import './adcheck.css';

/** 규칙 고치기 창에서 다루는 값 */
interface RuleDraft {
  id?: number;
  ruleKey: string | null;
  pattern: string;
  matchType: AdMatchType;
  category: AdRuleCategory;
  severity: AdSeverity;
  reason: string;
  suggestion: string;
  active: boolean;
}

const EMPTY_DRAFT: RuleDraft = { ruleKey: null, pattern: '', matchType: 'word', category: 'superlative', severity: 'high', reason: '', suggestion: '', active: true };
const CATEGORY_OPTIONS = AD_RULE_CATEGORIES.map((c) => ({ value: c, label: AD_RULE_CATEGORY_LABELS[c] }));
const SEVERITY_OPTIONS = AD_SEVERITIES.map((s) => ({ value: s, label: AD_SEVERITY_LABELS[s] }));
const MATCH_OPTIONS = AD_MATCH_TYPES.map((m) => ({ value: m, label: AD_MATCH_TYPE_LABELS[m] }));

/** 의료광고 문구 점검 */
export default function AdcheckPage() {
  const toast = useToast();
  const { info } = useSession();
  const role = info?.user?.role;
  const canEdit = can(role, 'adrules.edit');
  const status = useApi('ai:status', fetchAiStatus);
  const aiAllowed = status.data?.features.find((f) => f.id === 'adcheck')?.allowed ?? true;
  const rules = useApi('adrules:list', fetchAdRules);

  const [text, setText] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [textError, setTextError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<AdcheckResponse | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<AdRule | null>(null);

  /** 점검 */
  const run = async () => {
    if (!text.trim()) {
      setTextError('점검할 글을 적어 주세요.');
      return;
    }
    setTextError(null);
    setCheckError(null);
    setChecking(true);
    try {
      setResult(await checkAdText(text, useAi && aiAllowed));
    } catch (e) {
      if (e instanceof ApiError && e.fields?.text) setTextError(e.fields.text);
      else setCheckError(e instanceof ApiError ? e.message : '점검하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setChecking(false);
      invalidate('ai:');
    }
  };

  /** 규칙 목록 전체를 저장한다. index: 고친 규칙의 위치(오류 문구를 창에 붙이기 위해) */
  const persist = async (next: Array<ReturnType<typeof ruleToInput> | Omit<RuleDraft, 'ruleKey'>>, index: number | null, done: string) => {
    setSaving(true);
    setDraftErrors({});
    try {
      await saveAdRules(next.map(({ id, pattern, matchType, category, severity, reason, suggestion, active }) => ({ ...(id ? { id } : {}), pattern, matchType, category, severity, reason, suggestion, active })));
      invalidate('adrules:');
      toast.show(done);
      return true;
    } catch (e) {
      const fields = e instanceof ApiError ? (e.fields ?? {}) : {};
      const mine: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        const m = /^rules\.(\d+)\.(\w+)$/.exec(k);
        if (m && Number(m[1]) === index && m[2]) mine[m[2]] = v;
      }
      if (Object.keys(mine).length) setDraftErrors(mine);
      else toast.error(Object.values(fields)[0] ?? (e instanceof ApiError ? e.message : '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** 창의 규칙을 저장 */
  const saveDraft = async () => {
    if (!draft) return;
    const errs: Record<string, string> = {};
    if (!draft.pattern.trim()) errs.pattern = '찾을 말을 적어 주세요.';
    if (!draft.reason.trim()) errs.reason = '이유를 적어 주세요.';
    if (!draft.suggestion.trim()) errs.suggestion = '바꿀 말을 적어 주세요.';
    if (Object.keys(errs).length) {
      setDraftErrors(errs);
      return;
    }
    const list = (rules.data ?? []).map(ruleToInput);
    const value = { ...draft, pattern: draft.pattern.trim(), reason: draft.reason.trim(), suggestion: draft.suggestion.trim() };
    const at = draft.id ? list.findIndex((r) => r.id === draft.id) : list.length;
    const next = draft.id ? list.map((r) => (r.id === draft.id ? value : r)) : [...list, value];
    if (await persist(next, at, draft.id ? '규칙을 고쳤어요. 다음 점검부터 적용돼요.' : '규칙을 추가했어요. 다음 점검부터 적용돼요.')) setDraft(null);
  };

  /** 켜기·끄기 */
  const toggle = (rule: AdRule) => {
    const list = (rules.data ?? []).map(ruleToInput).map((r) => (r.id === rule.id ? { ...r, active: !rule.active } : r));
    void persist(list, null, rule.active ? `"${rule.pattern}" 규칙을 껐어요.` : `"${rule.pattern}" 규칙을 켰어요.`);
  };

  /** 지우기(추가한 규칙만) */
  const remove = async () => {
    if (!removing) return;
    const list = (rules.data ?? []).filter((r) => r.id !== removing.id).map(ruleToInput);
    if (await persist(list, null, '규칙을 지웠어요.')) setRemoving(null);
  };

  const columns: Column<AdRule>[] = [
    {
      key: 'pattern',
      header: '찾을 말',
      render: (r) => (
        <span className="adc-rule-pattern">
          <code>{r.pattern}</code>
          <small>{AD_MATCH_TYPE_LABELS[r.matchType]}</small>
        </span>
      ),
      sortValue: (r) => r.pattern,
    },
    { key: 'category', header: '분류', render: (r) => AD_RULE_CATEGORY_LABELS[r.category], sortValue: (r) => AD_RULE_CATEGORY_LABELS[r.category] },
    { key: 'severity', header: '위험도', render: (r) => <Chip tone={r.severity === 'high' ? 'danger' : 'warn'}>{AD_SEVERITY_LABELS[r.severity]}</Chip>, sortValue: (r) => r.severity },
    { key: 'reason', header: '이유', render: (r) => <span className="adc-rule-text">{r.reason}</span> },
    { key: 'suggestion', header: '바꿀 말', render: (r) => <span className="adc-rule-text">{r.suggestion}</span> },
    {
      key: 'active',
      header: '상태',
      render: (r) => (
        <span className="adc-rule-state">
          <Chip tone={r.active ? 'ok' : 'ghost'}>{r.active ? '켜짐' : '꺼짐'}</Chip>
          {r.ruleKey ? <Chip tone="ghost">기본</Chip> : <Chip tone="info">추가</Chip>}
        </span>
      ),
      sortValue: (r) => (r.active ? 0 : 1),
    },
  ];
  if (canEdit) {
    columns.push({
      key: 'actions',
      header: '관리',
      render: (r) => (
        <span className="adc-rule-actions">
          <Button
            size="sm"
            onClick={() => {
              setDraftErrors({});
              setDraft({ id: r.id, ruleKey: r.ruleKey, pattern: r.pattern, matchType: r.matchType, category: r.category, severity: r.severity, reason: r.reason, suggestion: r.suggestion, active: r.active });
            }}
            aria-label={`${r.pattern} 규칙 고치기`}
          >
            고치기
          </Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => toggle(r)} aria-label={`${r.pattern} 규칙 ${r.active ? '끄기' : '켜기'}`}>
            {r.active ? '끄기' : '켜기'}
          </Button>
          {r.ruleKey ? null : (
            <Button size="sm" variant="ghost" onClick={() => setRemoving(r)} aria-label={`${r.pattern} 규칙 지우기`}>
              지우기
            </Button>
          )}
        </span>
      ),
    });
  }

  const total = rules.data?.length ?? 0;
  const on = rules.data?.filter((r) => r.active).length ?? 0;
  const openAdd = () => {
    setDraftErrors({});
    setDraft({ ...EMPTY_DRAFT });
  };

  return (
    <>
      <PageHeader
        title="의료광고 문구 점검"
        summary="홍보 글이나 리뷰 답글을 붙여 넣으면 규칙 사전으로 위험 표현을 먼저 찾고, AI가 한 번 더 살펴봐요."
        actions={
          <Button icon="spark" to="/docs/promo">
            홍보 글 만들기
          </Button>
        }
      />
      <div className="adc-cols">
        <Card title="글 붙여 넣기" id="adcheck-input">
          <div className="adc-form">
            <PrivacyGuard />
            <Field label="점검할 글" error={textError} help={`${formatNumber(text.length)} / ${formatNumber(ADCHECK_MAX_TEXT)}자`}>
              <TextArea rows={9} value={text} maxLength={ADCHECK_MAX_TEXT} placeholder="예: 국내 최고 임플란트, 100% 성공, 지금 50% 할인" onChange={(e) => setText(e.target.value)} disabled={checking} />
            </Field>
            <PrivacyWarning text={text} />
            <Checkbox
              label="AI 2차 점검도 함께 하기"
              hint={aiAllowed ? '규칙이 놓친 표현을 AI가 한 번 더 찾아요.' : '관리자가 AI 점검을 꺼 두어 규칙 점검만 해요.'}
              checked={useAi && aiAllowed}
              disabled={!aiAllowed || checking}
              onChange={(e) => setUseAi(e.target.checked)}
            />
            <div className="adc-actions">
              <span className="grow" />
              <Button variant="primary" icon="shield" loading={checking} onClick={() => void run()}>
                {checking ? '점검하는 중' : '점검하기'}
              </Button>
            </div>
          </div>
        </Card>

        <Card title="점검 결과" id="adcheck-output">
          {checkError ? (
            <div className="adc-alert" role="alert">
              <b>{checkError}</b>
              <Button size="sm" icon="refresh" onClick={() => void run()}>
                다시 점검
              </Button>
            </div>
          ) : result ? (
            <AdCheckResult result={result} title="1차 규칙 점검" />
          ) : (
            <p className="adc-muted">왼쪽에 글을 넣고 "점검하기"를 누르면 위험 표현이 여기에 표시돼요.</p>
          )}
        </Card>
      </div>

      <Card
        title="점검 규칙 사전"
        id="adcheck-rules"
        sub={rules.data ? `규칙 ${formatNumber(total)}개 · 켜짐 ${formatNumber(on)}개` : undefined}
        action={
          canEdit ? (
            <Button size="sm" icon="plus" onClick={openAdd}>
              규칙 추가
            </Button>
          ) : undefined
        }
      >
        {canEdit ? null : <p className="adc-muted adc-rule-note">규칙은 관리자가 추가·수정할 수 있어요.</p>}
        <DataTable
          caption="점검 규칙 사전"
          columns={columns}
          rows={rules.data}
          rowKey={(r) => r.id}
          loading={rules.loading}
          error={rules.error ?? null}
          onRetry={rules.reload}
          empty={
            <EmptyState
              title="규칙이 없어요"
              description="위험 표현과 이유, 바꿀 말을 넣어 두면 다음 점검부터 찾아 드려요."
              action={
                canEdit ? (
                  <Button size="sm" icon="plus" onClick={openAdd}>
                    첫 규칙 추가
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </Card>

      <Dialog
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? '규칙 고치기' : '규칙 추가'}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>취소</Button>
            <Button variant="primary" icon="check" loading={saving} onClick={() => void saveDraft()}>
              저장
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="adc-form">
            <div className="adc-form-row">
              <Field label="찾을 말" error={draftErrors.pattern} required help={draft.matchType === 'regex' ? '정규식으로 적어요. 예: 기적(의|같은)\\s*치료' : '이 글자가 들어 있으면 찾아요.'}>
                <TextInput value={draft.pattern} maxLength={200} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} />
              </Field>
              <Field label="찾는 방식" error={draftErrors.matchType}>
                <Select value={draft.matchType} options={MATCH_OPTIONS} onChange={(e) => setDraft({ ...draft, matchType: e.target.value as AdMatchType })} />
              </Field>
            </div>
            <div className="adc-form-row">
              <Field label="분류" error={draftErrors.category}>
                <Select value={draft.category} options={CATEGORY_OPTIONS} onChange={(e) => setDraft({ ...draft, category: e.target.value as AdRuleCategory })} />
              </Field>
              <Field label="위험도" error={draftErrors.severity}>
                <Select value={draft.severity} options={SEVERITY_OPTIONS} onChange={(e) => setDraft({ ...draft, severity: e.target.value as AdSeverity })} />
              </Field>
            </div>
            <Field label="이유" error={draftErrors.reason} required>
              <TextArea rows={3} value={draft.reason} maxLength={300} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
            </Field>
            <Field label="바꿀 말" error={draftErrors.suggestion} required>
              <TextArea rows={3} value={draft.suggestion} maxLength={300} onChange={(e) => setDraft({ ...draft, suggestion: e.target.value })} />
            </Field>
            <Checkbox label="이 규칙 쓰기" hint="끄면 점검에서 빠져요." checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="규칙 지우기"
        message={removing ? `"${removing.pattern}" 규칙을 지울까요? 다음 점검부터 이 표현을 찾지 않아요.` : ''}
        confirmLabel="지우기"
        danger
      />
    </>
  );
}

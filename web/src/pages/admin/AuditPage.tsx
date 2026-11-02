// 이 파일이 하는 일: "활동 기록" 화면(/admin/audit, FR-005). 로그인·직원 계정 변경·설정 변경·AI 사용 같은 기록을 기간·사용자·행동으로 걸러 보고, CSV(엑셀용 UTF-8 BOM)로 내려받는다.
// 기록은 고치거나 지울 수 없어서 이 화면에도 그런 버튼이 없다(FR-005 AC3). 관리자만 들어올 수 있다(서버도 403으로 막는다).
// 최근 기록부터 한 쪽에 50줄씩 보여 주고, "이전·다음"으로 넘긴다(api.get은 data 배열만 돌려주므로, 50줄이 꽉 차면 다음 쪽이 있다고 본다).
import { useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { DateInput, Field, Select } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState } from '../../components/States.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { api } from '../../lib/api.ts';
import { formatDateTime, formatNumber } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { AUDIT_ACTION_GROUPS, type AuditEntry, type UserRow } from '../../../../shared/schemas/admin.ts';

const PAGE_SIZE = 50;

interface Filters {
  from: string;
  to: string;
  userId: string;
  action: string;
}
const NO_FILTER: Filters = { from: '', to: '', userId: '', action: '' };

/** 조건 → 쿼리 문자열(빈 값은 뺀다) */
function queryOf(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** 세부 내용을 한 줄 글로 줄인다(예: "역할: staff → manager") */
function summarize(detail: Record<string, unknown> | null): string {
  if (!detail) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(detail)) {
    if (k === 'changes' && v && typeof v === 'object') {
      for (const [ck, cv] of Object.entries(v as Record<string, { from?: unknown; to?: unknown }>)) parts.push(`${ck}: ${String(cv?.from ?? '없음')} → ${String(cv?.to ?? '없음')}`);
    } else if (v !== null && v !== undefined && v !== '') {
      parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    }
  }
  const s = parts.join(', ');
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/** 행동 칩 색: 실패·잠금·비활성화는 경고 */
function actionTone(action: string): 'danger' | 'warn' | 'ghost' | 'info' {
  if (/locked|blocked/.test(action)) return 'danger';
  if (/failed|deactivate|reset_password/.test(action)) return 'warn';
  if (action.startsWith('settings.') || action.startsWith('user.')) return 'info';
  return 'ghost';
}

/** 활동 기록 화면 */
export default function AuditPage() {
  const [filters, setFilters] = useState<Filters>(NO_FILTER);
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<AuditEntry | null>(null);
  const qs = queryOf(filters, { page: String(page), pageSize: String(PAGE_SIZE) });
  const state = useApi<AuditEntry[]>(`admin:audit${qs}`, () => api.get(`/api/audit${qs}`));
  const users = useApi<UserRow[]>('admin:users', () => api.get('/api/users?status=all'));
  const badRange = !!filters.from && !!filters.to && filters.from > filters.to;

  const set = (k: keyof Filters) => (e: { target: { value: string } }) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };
  const shown = state.data?.length ?? 0;
  const hasNext = shown === PAGE_SIZE;
  const firstNo = (page - 1) * PAGE_SIZE + 1;
  const filtered = Object.values(filters).some(Boolean);

  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: '시각', render: (e) => <span className="num">{formatDateTime(e.at)}</span> },
    {
      key: 'user',
      header: '사용자',
      render: (e) =>
        e.username ? (
          <span>
            {e.userName ? <b>{e.userName}</b> : null} <span className="muted">{e.username}</span>
          </span>
        ) : (
          <span className="muted">로그인 전</span>
        ),
    },
    { key: 'action', header: '행동', render: (e) => <Chip tone={actionTone(e.action)}>{e.actionLabel}</Chip> },
    { key: 'target', header: '대상', render: (e) => (e.targetType ? `${e.targetType}${e.targetId ? ` #${e.targetId}` : ''}` : '—') },
    {
      key: 'detail',
      header: '세부 내용',
      render: (e) => (
        <span className="muted" style={{ display: 'inline-block', maxWidth: 360, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
          {summarize(e.detail) || '—'}
        </span>
      ),
    },
    { key: 'ip', header: 'IP', render: (e) => <span className="num">{e.ip ?? '—'}</span> },
  ];

  const userOptions = [{ value: '', label: '모든 사용자' }, ...(users.data ?? []).map((u) => ({ value: String(u.id), label: `${u.name} (${u.username})${u.active ? '' : ' · 사용 중지'}` }))];
  const csvHref = `/api/audit${queryOf(filters, { format: 'csv' })}`;

  return (
    <>
      <PageHeader
        title="활동 기록"
        summary="누가 언제 무엇을 했는지 남은 기록이에요. 기록은 고치거나 지울 수 없어요."
        actions={
          badRange ? (
            <Button variant="primary" icon="doc" disabled>
              CSV 내려받기
            </Button>
          ) : (
            <a className="btn primary" href={csvHref} download>
              <Icon name="doc" />
              CSV 내려받기
            </a>
          )
        }
      />
      <Card>
        <Toolbar label="활동 기록 조건">
          <Field label="시작 날짜">
            <DateInput value={filters.from} onChange={set('from')} max={filters.to || undefined} />
          </Field>
          <Field label="끝 날짜" error={badRange ? '끝 날짜는 시작 날짜와 같거나 뒤여야 해요.' : undefined}>
            <DateInput value={filters.to} onChange={set('to')} min={filters.from || undefined} />
          </Field>
          <Field label="사용자">
            <Select value={filters.userId} onChange={set('userId')} options={userOptions} />
          </Field>
          <Field label="행동">
            <Select value={filters.action} onChange={set('action')} options={[{ value: '', label: '모든 행동' }, ...AUDIT_ACTION_GROUPS]} />
          </Field>
          {filtered ? (
            <Button
              variant="ghost"
              icon="refresh"
              onClick={() => {
                setFilters(NO_FILTER);
                setPage(1);
              }}
            >
              조건 지우기
            </Button>
          ) : null}
        </Toolbar>
        {badRange ? (
          <EmptyState icon="alert" title="날짜 범위를 확인해 주세요" description="끝 날짜를 시작 날짜와 같거나 뒤로 정해 주세요." />
        ) : (
          <DataTable<AuditEntry>
            caption="활동 기록"
            columns={columns}
            rows={state.data}
            rowKey={(e) => e.id}
            rowLabel={(e) => `${formatDateTime(e.at)} ${e.actionLabel}`}
            onRowClick={setOpened}
            loading={state.loading}
            error={state.error}
            onRetry={state.reload}
            empty={
              <EmptyState
                icon="inbox"
                title={filtered ? '조건에 맞는 기록이 없어요' : '아직 남은 기록이 없어요'}
                description={filtered ? '기간이나 사용자 조건을 바꿔 보세요.' : '로그인하거나 설정을 바꾸면 여기에 기록이 남아요.'}
                action={
                  filtered ? (
                    <Button onClick={() => setFilters(NO_FILTER)} icon="refresh">
                      조건 지우기
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
        {!badRange && state.data && (page > 1 || hasNext) ? (
          <div className="toolbar" role="group" style={{ borderBottom: 0, borderTop: '1px solid var(--line)' }} aria-label="쪽 넘기기">
            <span className="muted" aria-live="polite">
              {page}쪽 · {shown > 0 ? `${formatNumber(firstNo)}~${formatNumber(firstNo + shown - 1)}번째 기록` : '이 쪽에는 기록이 없어요'}
            </span>
            <span className="grow" />
            <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              이전
            </Button>
            <Button size="sm" onClick={() => setPage((p) => p + 1)} disabled={!hasNext}>
              다음
            </Button>
          </div>
        ) : null}
      </Card>
      <AuditDetailDialog entry={opened} onClose={() => setOpened(null)} />
    </>
  );
}

/** 기록 한 줄 자세히 보기(읽기만 한다) */
function AuditDetailDialog({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const rows: Array<[string, string]> = entry
    ? [
        ['시각', formatDateTime(entry.at)],
        ['사용자', entry.username ? `${entry.userName ?? ''} (${entry.username})`.trim() : '로그인 전'],
        ['행동', `${entry.actionLabel} · ${entry.action}`],
        ['대상', entry.targetType ? `${entry.targetType}${entry.targetId ? ` #${entry.targetId}` : ''}` : '—'],
        ['IP', entry.ip ?? '—'],
      ]
    : [];
  return (
    <Dialog
      open={!!entry}
      onClose={onClose}
      title="기록 자세히"
      footer={
        <Button variant="primary" onClick={onClose}>
          닫기
        </Button>
      }
    >
      {entry ? (
        <>
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0 }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt className="muted">{k}</dt>
                <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="field">
            <span className="label">세부 내용</span>
            <pre style={{ margin: 0, padding: 12, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>
              {entry.detail ? JSON.stringify(entry.detail, null, 2) : '없음'}
            </pre>
          </div>
          <p className="form-note">
            <Icon name="lock" size="md" />
            활동 기록은 고치거나 지울 수 없어요.
          </p>
        </>
      ) : null}
    </Dialog>
  );
}

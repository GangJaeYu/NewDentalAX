// 이 파일이 하는 일: "입출고 기록" 화면(/inventory/moves, FR-051). 입고·출고·조정 기록을 최근 것부터 보여 주고, 종류·기간·품목 이름으로 거른다.
// 모든 역할이 출고(빠른 입력 2단계)와 입고(수량·단가·거래처·유효기간·로트)를 기록하고, 실장 이상은 실사 차이를 사유와 함께 조정한다.
// 현재고는 이 기록을 모두 더한 값이라 기록과 항상 맞는다(FR-051 AC3). 줄을 누르면 그 품목 상세로 간다.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { DateInput } from '../../components/Field.tsx';
import { EmptyState } from '../../components/States.tsx';
import { SearchInput, Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api } from '../../lib/api.ts';
import { formatDate, formatDateTime, formatWon } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { MOVE_TYPE_LABELS, type MoveRow, type MoveType } from '../../../../shared/schemas/inventory.ts';
import { INV_KEY, MoveDialog, Pager, qty } from './inventory-ui.tsx';
import { QuickOutDialog } from './QuickOutDialog.tsx';

type TypeFilter = 'all' | MoveType;
const PAGE_SIZE = 50;
const MOVE_TONE: Record<MoveType, 'info' | 'ghost' | 'warn'> = { in: 'info', out: 'ghost', adjust: 'warn' };

/** 수량을 부호와 함께: 출고 −3, 입고 +5, 조정은 그대로 */
function signed(m: MoveRow): string {
  const n = m.type === 'out' ? -m.qty : m.qty;
  return `${n > 0 ? '+' : '−'}${qty(Math.abs(n), m.unit)}`;
}

/** 입출고 기록 */
export default function MovesPage() {
  const navigate = useNavigate();
  const { info } = useSession();
  const canAdjust = can(info?.user?.role, 'inventory.adjust');
  const [type, setType] = useState<TypeFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<'out' | 'in' | 'adjust' | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (type !== 'all') p.set('type', type);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [type, from, to, q, page]);
  const state = useApi<{ data: MoveRow[]; total: number }>(`${INV_KEY}:moves?${query}`, () => api.page<MoveRow>(`/api/inventory/moves?${query}`));

  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const columns: Column<MoveRow>[] = [
    { key: 'movedAt', header: '일시', sortValue: (m) => m.movedAt, render: (m) => <span className="num">{formatDateTime(m.movedAt)}</span> },
    { key: 'item', header: '품목', sortValue: (m) => m.itemName, render: (m) => <b>{m.itemName}</b> },
    { key: 'type', header: '구분', sortValue: (m) => m.type, render: (m) => <Chip tone={MOVE_TONE[m.type]}>{MOVE_TYPE_LABELS[m.type]}</Chip> },
    { key: 'qty', header: '수량', align: 'right', sortValue: (m) => (m.type === 'out' ? -m.qty : m.qty), render: (m) => signed(m) },
    { key: 'price', header: '단가', align: 'right', sortValue: (m) => m.unitPrice, render: (m) => (m.unitPrice !== null ? formatWon(m.unitPrice) : <span className="muted">—</span>) },
    { key: 'vendor', header: '거래처', render: (m) => m.vendor ?? <span className="muted">—</span> },
    {
      key: 'lot',
      header: '로트·유효기간',
      render: (m) => (m.lot || m.expiryOn ? <span className="num">{[m.lot, m.expiryOn ? formatDate(m.expiryOn) : null].filter(Boolean).join(' · ')}</span> : <span className="muted">—</span>),
    },
    { key: 'reason', header: '사유·메모', render: (m) => m.reason ?? <span className="muted">—</span> },
    { key: 'user', header: '기록한 사람', render: (m) => m.userName ?? <span className="muted">—</span> },
  ];

  const filtered = type !== 'all' || !!from || !!to || !!q.trim();
  return (
    <>
      <PageHeader
        title="입출고 기록"
        summary="출고는 품목 찾기 → 수량 → 저장 두 단계예요. 입고는 단가·거래처·유효기간·로트까지 적어요."
        actions={
          <>
            <Button icon="plus" onClick={() => setDialog('in')}>
              입고 기록
            </Button>
            {canAdjust ? <Button onClick={() => setDialog('adjust')}>재고 조정</Button> : null}
            <Button variant="primary" icon="box" onClick={() => setDialog('out')}>
              출고 기록
            </Button>
          </>
        }
      />
      <Card>
        <Toolbar label="입출고 기록 도구">
          <Segmented<TypeFilter>
            label="구분"
            value={type}
            onChange={reset(setType)}
            options={[
              { value: 'all', label: '전체' },
              { value: 'out', label: '출고' },
              { value: 'in', label: '입고' },
              { value: 'adjust', label: '조정' },
            ]}
          />
          <DateInput className="input" aria-label="시작 날짜" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} style={{ width: 'auto' }} />
          <span className="muted" aria-hidden="true">
            ~
          </span>
          <DateInput className="input" aria-label="끝 날짜" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} style={{ width: 'auto' }} />
          <span className="grow" />
          <SearchInput label="품목 이름으로 찾기" placeholder="품목 찾기" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        </Toolbar>
        <DataTable<MoveRow>
          caption="입출고 기록"
          columns={columns}
          rows={state.data?.data}
          rowKey={(m) => m.id}
          rowLabel={(m) => `${m.itemName} ${MOVE_TYPE_LABELS[m.type]}`}
          loading={state.loading}
          error={state.error}
          onRetry={state.reload}
          onRowClick={(m) => navigate(`/inventory/items/${m.itemId}`)}
          empty={
            filtered ? (
              <EmptyState icon="search" title="조건에 맞는 기록이 없어요" description="구분·기간·품목 조건을 바꿔 보세요." />
            ) : (
              <EmptyState
                icon="box"
                title="아직 입출고 기록이 없어요"
                description="물건이 들어오면 입고를, 쓰면 출고를 기록해 주세요. 현재고가 자동으로 계산돼요."
                action={
                  <Button icon="plus" onClick={() => setDialog('in')}>
                    첫 입고 기록
                  </Button>
                }
              />
            )
          }
        />
        {state.data ? <Pager page={page} pageSize={PAGE_SIZE} total={state.data.total} onPage={setPage} /> : null}
      </Card>

      <QuickOutDialog open={dialog === 'out'} onClose={() => setDialog(null)} />
      <MoveDialog open={dialog === 'in' || dialog === 'adjust'} type={dialog === 'adjust' ? 'adjust' : 'in'} canAdjust={canAdjust} onClose={() => setDialog(null)} />
    </>
  );
}

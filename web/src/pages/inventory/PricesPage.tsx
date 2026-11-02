// 이 파일이 하는 일: "단가 변동" 화면(/inventory/prices, FR-055). 입고할 때마다 남은 품목·거래처별 단가를 최근 것부터 보여 주고,
// 같은 품목의 직전 입고 단가 대비 변동률을 함께 적는다. 정해 둔 비율(기본 5%)보다 많이 오르면 ▲ 칩으로 표시하고, "오른 것만"으로 거를 수 있다.
// 줄을 누르면 품목 상세(단가 추이 그래프·표)로 간다.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { EmptyState } from '../../components/States.tsx';
import { SearchInput, Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api } from '../../lib/api.ts';
import { formatDate, formatWon } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { formatPriceChange, type PriceRow } from '../../../../shared/schemas/inventory.ts';
import { INV_KEY, Pager, PriceUpChip } from './inventory-ui.tsx';

type UpFilter = 'all' | 'up';
const PAGE_SIZE = 50;

/** 단가 변동 */
export default function PricesPage() {
  const navigate = useNavigate();
  const [up, setUp] = useState<UpFilter>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (up === 'up') p.set('up', '1');
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [up, q, page]);
  const state = useApi<{ data: PriceRow[]; total: number; alertPct: number }>(`${INV_KEY}:prices?${query}`, () => api.page<PriceRow, { alertPct: number }>(`/api/prices?${query}`));
  const alertPct = state.data?.alertPct ?? 5;

  const columns: Column<PriceRow>[] = [
    { key: 'movedAt', header: '입고일', sortValue: (p) => p.movedAt, render: (p) => <span className="num">{formatDate(p.movedAt)}</span> },
    { key: 'item', header: '품목', sortValue: (p) => p.itemName, render: (p) => <b>{p.itemName}</b> },
    { key: 'vendor', header: '거래처', sortValue: (p) => p.vendor, render: (p) => p.vendor ?? <span className="muted">—</span> },
    { key: 'unitPrice', header: '단가', align: 'right', sortValue: (p) => p.unitPrice, render: (p) => formatWon(p.unitPrice) },
    { key: 'prevPrice', header: '직전 단가', align: 'right', sortValue: (p) => p.prevPrice, render: (p) => (p.prevPrice !== null ? formatWon(p.prevPrice) : <span className="muted">—</span>) },
    {
      key: 'change',
      header: '변동',
      align: 'right',
      sortValue: (p) => p.changePct,
      render: (p) => (p.changePct === null ? <span className="muted">첫 입고</span> : p.up ? <PriceUpChip pct={p.changePct} /> : <span className="num muted">{formatPriceChange(p.changePct)}</span>),
    },
  ];

  return (
    <>
      <PageHeader title="단가 변동" summary={`입고할 때 적은 단가를 모아 보여 줘요. 직전 입고보다 ${alertPct}% 넘게 오르면 ▲로 표시해요.`} />
      <Card>
        <Toolbar label="단가 기록 도구">
          <Segmented<UpFilter>
            label="보기"
            value={up}
            onChange={(v) => {
              setUp(v);
              setPage(1);
            }}
            options={[
              { value: 'all', label: '전체' },
              { value: 'up', label: '많이 오른 것만' },
            ]}
          />
          <span className="grow" />
          <SearchInput
            label="품목 이름으로 찾기"
            placeholder="품목 찾기"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </Toolbar>
        <DataTable<PriceRow>
          caption="단가 기록"
          columns={columns}
          rows={state.data?.data}
          rowKey={(p) => p.moveId}
          rowLabel={(p) => `${p.itemName} ${formatDate(p.movedAt)}`}
          loading={state.loading}
          error={state.error}
          onRetry={state.reload}
          onRowClick={(p) => navigate(`/inventory/items/${p.itemId}`)}
          empty={
            up === 'up' || q.trim() ? (
              <EmptyState icon="search" title={up === 'up' ? '많이 오른 단가가 없어요' : '조건에 맞는 단가 기록이 없어요'} description="조건을 바꿔 보세요." />
            ) : (
              <EmptyState icon="won" title="아직 단가 기록이 없어요" description="입고할 때 단가를 적으면 여기에 쌓여요." action={<Button to="/inventory/moves">입출고 기록으로 가기</Button>} />
            )
          }
        />
        {state.data ? <Pager page={page} pageSize={PAGE_SIZE} total={state.data.total} onPage={setPage} /> : null}
      </Card>
    </>
  );
}

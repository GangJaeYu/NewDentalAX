// 이 파일이 하는 일: "재고 현황" 화면(/inventory, FR-050·052·055). 품목 목록을 검색하고, 상태(부족·곧 부족·유효기간 임박·만료)·분류로 거르고 정렬한다.
// 현재고는 적정 대비 막대로, 상태는 글자 칩으로, 단가가 많이 오른 품목은 ▲ 칩으로 보여 준다. 줄을 누르면 품목 상세로 간다.
// 모든 역할이 출고를 기록하고(빠른 입력 2단계), 실장 이상은 품목을 추가한다. 기본 목록은 사용 중 품목만이고 "사용 안 함"은 따로 본다.
// 목록 위 "바코드로 출고" 칸(BarcodeOut, FR-130)에 스캐너로 찍거나 사진을 올리면 그 품목의 출고 창이 수량 1로 열린다.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { MiniBar } from '../../components/Charts.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { Select } from '../../components/Field.tsx';
import { EmptyState } from '../../components/States.tsx';
import { SearchInput, Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api } from '../../lib/api.ts';
import { formatDate, formatNumber, formatWon } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import type { ItemPage, ItemRow } from '../../../../shared/schemas/inventory.ts';
import { INV_KEY, ItemFormDialog, Pager, PriceUpChip, qty, StatusChip } from './inventory-ui.tsx';
import { QuickOutDialog } from './QuickOutDialog.tsx';
import { BarcodeOut } from './BarcodeOut.tsx';

type StatusFilter = 'all' | 'warning' | 'low' | 'soon_low' | 'expiring' | 'expired';
type ActiveFilter = 'active' | 'inactive';
const PAGE_SIZE = 100;

/** 재고 현황 */
export default function InventoryPage() {
  const navigate = useNavigate();
  const { info } = useSession();
  const role = info?.user?.role;
  const canManage = can(role, 'items.manage');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [active, setActive] = useState<ActiveFilter>('active');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [outOpen, setOutOpen] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ status, active, page: String(page), pageSize: String(PAGE_SIZE) });
    if (category) p.set('category', category);
    if (q.trim()) p.set('q', q.trim());
    return p.toString();
  }, [status, active, category, q, page]);
  const state = useApi<ItemPage>(`${INV_KEY}:items?${query}`, () => api.page<ItemRow, Omit<ItemPage, 'data' | 'total'>>(`/api/items?${query}`));
  const data = state.data;
  const counts = data?.counts;
  const categories = data?.categories ?? [];
  // 분류 목록이 비어 있는 순간(첫 로딩)에도 고른 값은 남겨 둔다
  const categoryOptions = [{ value: '', label: '모든 분류' }, ...[...new Set([...categories, ...(category ? [category] : [])])].map((c) => ({ value: c, label: c }))];

  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const columns: Column<ItemRow>[] = [
    {
      key: 'name',
      header: '품목',
      sortValue: (r) => r.name,
      render: (r) => (
        <span style={{ display: 'grid' }}>
          <b>{r.name}</b>
          {r.location ? <small className="muted">{r.location}</small> : null}
        </span>
      ),
    },
    { key: 'category', header: '분류', sortValue: (r) => r.category },
    {
      key: 'stock',
      header: '현재고',
      align: 'right',
      sortValue: (r) => r.stock,
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          <span className="num">{qty(r.stock, r.unit)}</span>
          {r.par > 0 ? (
            <MiniBar value={r.stock / (r.par * 1.5)} tone={r.status === 'low' ? 'danger' : r.status === 'soon_low' ? 'warn' : undefined} label={`${r.name} 적정 대비 재고`} />
          ) : null}
        </span>
      ),
    },
    { key: 'par', header: '적정', align: 'right', sortValue: (r) => r.par, render: (r) => (r.par > 0 ? formatNumber(r.par, 2) : '—') },
    {
      key: 'expiry',
      header: '유효기간',
      sortValue: (r) => r.nearestExpiry,
      render: (r) => (r.nearestExpiry ? <span className="num">{formatDate(r.nearestExpiry)}</span> : <span className="muted">—</span>),
    },
    { key: 'vendor', header: '거래처', sortValue: (r) => r.vendor, render: (r) => r.vendor ?? <span className="muted">—</span> },
    {
      key: 'lastPrice',
      header: '최근 단가',
      align: 'right',
      sortValue: (r) => r.lastPrice,
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
          {r.lastPrice !== null ? formatWon(r.lastPrice) : <span className="muted">—</span>}
          <PriceUpChip pct={r.priceUpPct} />
        </span>
      ),
    },
    {
      key: 'status',
      header: '상태',
      sortValue: (r) => ['expired', 'low', 'expiring', 'soon_low', 'ok'].indexOf(r.status),
      render: (r) => (r.active ? <StatusChip row={r} /> : <span className="chip ghost">사용 안 함</span>),
    },
  ];

  const total = counts?.all;
  const summary =
    counts && active === 'active'
      ? `품목 ${formatNumber(counts.all)}개 · 부족 ${counts.low} · 곧 부족 ${counts.soon_low} · 유효기간 임박 ${counts.expiring} · 만료 ${counts.expired}`
      : '현재고는 입고·출고 기록을 더해 계산해요.';
  const filtered = status !== 'all' || !!category || !!q.trim() || active !== 'active';

  return (
    <>
      <PageHeader
        title="재고 현황"
        summary={summary}
        actions={
          <>
            <Button to="/inventory/moves" icon="list">
              입출고 기록
            </Button>
            {canManage ? (
              <>
                {/* CSV 가져오기·내보내기 진입(03-03 변경 요청, 조정자 연결) */}
                <Button to="/inventory/import" icon="doc">
                  CSV 가져오기·내보내기
                </Button>
                <Button icon="plus" onClick={() => setAdding(true)}>
                  품목 추가
                </Button>
              </>
            ) : null}
            <Button variant="primary" icon="box" onClick={() => setOutOpen(true)}>
              출고 기록
            </Button>
          </>
        }
      />
      <BarcodeOut />
      <Card>
        <Toolbar label="품목 목록 도구">
          <Segmented<StatusFilter>
            label="상태"
            value={status}
            onChange={reset(setStatus)}
            options={[
              { value: 'all', label: `전체 ${total ?? ''}`.trim() },
              { value: 'low', label: `부족 ${counts?.low ?? ''}`.trim() },
              { value: 'soon_low', label: `곧 부족 ${counts?.soon_low ?? ''}`.trim() },
              { value: 'expiring', label: `유효기간 임박 ${counts?.expiring ?? ''}`.trim() },
              { value: 'expired', label: `만료 ${counts?.expired ?? ''}`.trim() },
            ]}
          />
          <Select aria-label="분류" value={category} onChange={(e) => reset(setCategory)(e.target.value)} options={categoryOptions} className="input" style={{ width: "auto", minWidth: 120, height: 34 }} />
          <Segmented<ActiveFilter>
            label="사용 여부"
            value={active}
            onChange={reset(setActive)}
            options={[
              { value: 'active', label: '사용 중' },
              { value: 'inactive', label: '사용 안 함' },
            ]}
          />
          <span className="grow" />
          <SearchInput label="품목 찾기" placeholder="이름·분류·위치·바코드 찾기" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        </Toolbar>
        <DataTable<ItemRow>
          caption="품목 목록"
          columns={columns}
          rows={data?.data}
          rowKey={(r) => r.id}
          rowLabel={(r) => r.name}
          loading={state.loading}
          error={state.error}
          onRetry={state.reload}
          onRowClick={(r) => navigate(`/inventory/items/${r.id}`)}
          empty={
            filtered ? (
              <EmptyState icon="search" title="조건에 맞는 품목이 없어요" description="검색어나 상태·분류 조건을 바꿔 보세요." />
            ) : (
              <EmptyState
                icon="box"
                title="아직 등록한 품목이 없어요"
                description={canManage ? '자주 쓰는 소모품부터 등록해 보세요. 적정 재고를 정하면 부족할 때 알려 드려요.' : '실장 이상이 품목을 등록하면 여기에 보여요.'}
                action={
                  canManage ? (
                    <Button icon="plus" onClick={() => setAdding(true)}>
                      첫 품목 추가
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        />
        {data ? <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} /> : null}
      </Card>

      <ItemFormDialog open={adding} onClose={() => setAdding(false)} categories={categories} onSaved={(r) => navigate(`/inventory/items/${r.item.id}`)} />
      <QuickOutDialog open={outOpen} onClose={() => setOutOpen(false)} />
    </>
  );
}

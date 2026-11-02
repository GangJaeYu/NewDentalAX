// 이 파일이 하는 일: "발주서" 화면(/inventory/orders, FR-054). 실장 이상이 발주서 목록을 상태별(진행 중·작성 중·발주함·입고 완료·취소)로 본다.
// "발주서 만들기"를 누르면 부족·곧 부족 품목이 기본 거래처별로 묶인 초안이 생기고(권장 수량 = 올림(적정 × 1.5 − 현재고)), 1건이면 바로 그 발주서로 간다.
// 행을 누르면 발주서 상세(수정·발주함·입고 처리·인쇄)로 간다. 접근 권한은 routes.tsx와 서버(orders.manage)가 막는다.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { EmptyState } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api } from '../../lib/api.ts';
import { formatDate, formatWon } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { ORDER_STATUS_LABELS, type OrderDraftResult, type OrderPage, type OrderRow, type OrderStatus } from '../../../../shared/schemas/orders.ts';
import { messageOf, Pager, qty, refreshInventory } from './inventory-ui.tsx';
import { draftMessage, ORDER_KEY, ORDER_TONE } from './ordersLib.ts';
import './orders.css';

type Filter = 'open' | OrderStatus | 'all';
const PAGE_SIZE = 50;

/** 발주서 목록 */
export default function OrdersPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('open');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const state = useApi<OrderPage>(`${ORDER_KEY}:list:${filter}:${page}`, () =>
    api.page<OrderRow, Pick<OrderPage, 'counts'>>(`/api/orders?status=${filter}&page=${page}&pageSize=${PAGE_SIZE}`),
  );
  const c = state.data?.counts;
  const open = (c?.draft ?? 0) + (c?.ordered ?? 0);

  const makeDrafts = async () => {
    setBusy(true);
    try {
      const r = await api.post<OrderDraftResult>('/api/orders/draft');
      refreshInventory();
      toast.show(draftMessage(r));
      if (r.orders.length === 1 && r.orders[0]) navigate(`/inventory/orders/${r.orders[0].id}`);
      else if (r.orders.length > 1) {
        setFilter('open');
        setPage(1);
      }
    } catch (err) {
      toast.error(messageOf(err, '발주서를 만들지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<OrderRow>[] = [
    { key: 'poNo', header: '발주 번호', sortValue: (o) => o.poNo, render: (o) => <b className="num">{o.poNo}</b> },
    { key: 'vendor', header: '거래처', sortValue: (o) => o.vendor, render: (o) => o.vendor ?? <span className="muted">거래처 미정</span> },
    { key: 'status', header: '상태', sortValue: (o) => o.status, render: (o) => <Chip tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Chip> },
    { key: 'lineCount', header: '품목', align: 'right', sortValue: (o) => o.lineCount, render: (o) => `${o.lineCount}개` },
    { key: 'totalQty', header: '수량 합계', align: 'right', render: (o) => qty(o.totalQty) },
    {
      key: 'total',
      header: '합계 금액',
      align: 'right',
      sortValue: (o) => o.total,
      render: (o) => (
        <span className="num">
          {formatWon(o.total)}
          {o.missingPrice ? <span className="muted"> (단가 빈 줄 있음)</span> : null}
        </span>
      ),
    },
    { key: 'createdAt', header: '만든 날', sortValue: (o) => o.createdAt, render: (o) => <span className="num">{formatDate(o.createdAt)}</span> },
    {
      key: 'step',
      header: '진행',
      render: (o) => (
        <span className="num muted">
          {o.status === 'received' && o.receivedAt
            ? `${formatDate(o.receivedAt)} 입고`
            : o.status === 'ordered' && o.orderedAt
              ? `${formatDate(o.orderedAt)} 발주`
              : o.status === 'canceled' && o.canceledAt
                ? `${formatDate(o.canceledAt)} 취소`
                : '발주 전'}
        </span>
      ),
    },
  ];

  const change = (f: Filter) => {
    setFilter(f);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="발주서"
        summary="부족한 품목을 거래처별 발주서로 묶고, 발주 → 입고까지 기록해요."
        actions={
          <Button variant="primary" icon="cart" loading={busy} onClick={makeDrafts}>
            발주서 만들기
          </Button>
        }
      />
      <Card>
        <Toolbar label="발주서 목록 도구">
          <Segmented<Filter>
            label="상태"
            value={filter}
            onChange={change}
            options={[
              { value: 'open', label: `진행 중 ${open}` },
              { value: 'draft', label: `작성 중 ${c?.draft ?? 0}` },
              { value: 'ordered', label: `발주함 ${c?.ordered ?? 0}` },
              { value: 'received', label: `입고 완료 ${c?.received ?? 0}` },
              { value: 'canceled', label: `취소 ${c?.canceled ?? 0}` },
              { value: 'all', label: '전체' },
            ]}
          />
        </Toolbar>
        <DataTable<OrderRow>
          caption="발주서 목록"
          columns={columns}
          rows={state.data?.data}
          rowKey={(o) => o.id}
          rowLabel={(o) => `${o.poNo} ${o.vendor ?? '거래처 미정'}`}
          loading={state.loading}
          error={state.error}
          onRetry={state.reload}
          onRowClick={(o) => navigate(`/inventory/orders/${o.id}`)}
          empty={
            filter === 'open' || filter === 'all' ? (
              <EmptyState
                icon="cart"
                title={filter === 'open' ? '진행 중인 발주서가 없어요' : '아직 만든 발주서가 없어요'}
                description="부족하거나 곧 부족한 품목이 있으면 “발주서 만들기”로 거래처별 초안을 만들 수 있어요."
                action={
                  <Button icon="cart" loading={busy} onClick={makeDrafts}>
                    발주서 만들기
                  </Button>
                }
              />
            ) : (
              <EmptyState icon="search" title={`"${ORDER_STATUS_LABELS[filter]}" 발주서가 없어요`} description="다른 상태를 골라 보세요." />
            )
          }
        />
        {state.data ? <Pager page={page} pageSize={PAGE_SIZE} total={state.data.total} onPage={setPage} /> : null}
      </Card>
    </>
  );
}

// 이 파일이 하는 일: "품목 상세" 화면(/inventory/items/:id, FR-050·052·055). 현재고·적정·상태·가장 빠른 유효기간·최근 단가를 숫자 타일로,
// 유효기간 로트별 남은 수량(FEFO), 단가 추이(작은 그래프 + 표, ▲ 인상 표시), 최근 입출고 기록을 카드로 보여 준다.
// 모두 출고·입고를 기록하고, 실장 이상은 재고 조정·수정·삭제를 한다. 기록이 있는 품목은 삭제하면 "사용 안 함"으로 바뀌고 다시 사용으로 돌릴 수 있다.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, CardGrid, PageHeader } from '../../components/Card.tsx';
import { Chip, Kpi, KpiRow } from '../../components/Chip.tsx';
import { Sparkline } from '../../components/Charts.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api } from '../../lib/api.ts';
import { formatDate, formatDateTime, formatNumber, formatWon } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { formatPriceChange, MOVE_TYPE_LABELS, STOCK_STATUS_LABELS, type ItemDeleteResult, type ItemDetail, type ItemSaveResult, type LotRemain, type MoveRow, type MoveType, type PriceRow } from '../../../../shared/schemas/inventory.ts';
import { ddayText, INV_KEY, ItemFormDialog, messageOf, MoveDialog, PriceUpChip, qty, refreshInventory, StatusChip, STATUS_TONE } from './inventory-ui.tsx';
import { QuickOutDialog } from './QuickOutDialog.tsx';

/** 입출고 종류 칩 색 */
const MOVE_TONE: Record<MoveType, 'info' | 'ghost' | 'warn'> = { in: 'info', out: 'ghost', adjust: 'warn' };

/** 품목 상세 */
export default function ItemDetailPage() {
  const { id } = useParams();
  const itemId = Number(id);
  const valid = Number.isInteger(itemId) && itemId > 0;
  const navigate = useNavigate();
  const toast = useToast();
  const { info } = useSession();
  const role = info?.user?.role;
  const canManage = can(role, 'items.manage');
  const canAdjust = can(role, 'inventory.adjust');
  const state = useApi<ItemDetail>(valid ? `${INV_KEY}:item:${itemId}` : null, () => api.get(`/api/items/${itemId}`));
  const [dialog, setDialog] = useState<'out' | 'in' | 'adjust' | 'edit' | 'delete' | null>(null);

  if (!valid) return <ErrorState title="품목을 찾을 수 없어요" message="주소가 올바른지 확인해 주세요." />;
  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  const d = state.data;
  if (!d) return <Skeleton rows={8} label="품목 불러오는 중" />;

  const remove = async () => {
    try {
      const r = await api.del<ItemDeleteResult>(`/api/items/${d.id}`);
      refreshInventory();
      setDialog(null);
      if (r.deleted) {
        toast.show(`${d.name}을(를) 지웠어요.`);
        navigate('/inventory');
      } else {
        toast.show(`입출고 기록이 있어 ${d.name}을(를) "사용 안 함"으로 바꿨어요. 기록은 그대로 남아요.`);
      }
    } catch (err) {
      setDialog(null);
      toast.error(messageOf(err, '지우지 못했어요. 다시 시도해 주세요.'));
    }
  };
  const reactivate = async () => {
    try {
      await api.patch<ItemSaveResult>(`/api/items/${d.id}`, { active: true });
      refreshInventory();
      toast.show(`${d.name}을(를) 다시 사용해요.`);
    } catch (err) {
      toast.error(messageOf(err, '바꾸지 못했어요. 다시 시도해 주세요.'));
    }
  };

  const lotColumns: Column<LotRemain>[] = [
    { key: 'expiryOn', header: '유효기간', render: (l) => (l.expiryOn ? <span className="num">{formatDate(l.expiryOn)}</span> : <span className="muted">없음</span>) },
    {
      key: 'dday',
      header: '남은 날',
      render: (l) => (l.dday === null ? <span className="muted">—</span> : <Chip tone={l.dday < 0 ? 'danger' : l.dday <= 30 ? 'warn' : 'ghost'}>{l.dday < 0 ? `만료 ${ddayText(l.dday)}` : ddayText(l.dday)}</Chip>),
    },
    { key: 'lot', header: '로트', render: (l) => l.lot ?? <span className="muted">—</span> },
    { key: 'remaining', header: '남은 수량', align: 'right', render: (l) => qty(l.remaining, d.unit) },
    { key: 'qty', header: '들어온 수량', align: 'right', render: (l) => qty(l.qty, d.unit) },
  ];
  const priceColumns: Column<PriceRow>[] = [
    { key: 'movedAt', header: '입고일', render: (p) => <span className="num">{formatDate(p.movedAt)}</span> },
    { key: 'vendor', header: '거래처', render: (p) => p.vendor ?? <span className="muted">—</span> },
    { key: 'unitPrice', header: '단가', align: 'right', render: (p) => formatWon(p.unitPrice) },
    {
      key: 'change',
      header: '직전 대비',
      align: 'right',
      render: (p) => (p.changePct === null ? <span className="muted">—</span> : p.up ? <PriceUpChip pct={p.changePct} /> : <span className="num muted">{formatPriceChange(p.changePct)}</span>),
    },
  ];
  const moveColumns: Column<MoveRow>[] = [
    { key: 'movedAt', header: '일시', render: (m) => <span className="num">{formatDateTime(m.movedAt)}</span> },
    { key: 'type', header: '구분', render: (m) => <Chip tone={MOVE_TONE[m.type]}>{MOVE_TYPE_LABELS[m.type]}</Chip> },
    { key: 'qty', header: '수량', align: 'right', render: (m) => (m.type === 'out' ? `−${qty(m.qty)}` : m.qty > 0 ? `+${qty(m.qty)}` : `−${qty(-m.qty)}`) },
    { key: 'detail', header: '내용', render: (m) => [m.unitPrice !== null ? formatWon(m.unitPrice) : null, m.vendor, m.lot, m.reason].filter(Boolean).join(' · ') || <span className="muted">—</span> },
    { key: 'user', header: '기록한 사람', render: (m) => m.userName ?? <span className="muted">—</span> },
  ];

  // 단가 추이 그래프: 오래된 것부터 최근 12번
  const trend = d.prices.slice(-12).map((p) => p.unitPrice);

  return (
    <>
      <PageHeader
        title={d.name}
        summary={`${d.category} · 단위 ${d.unit}${d.location ? ` · ${d.location}` : ''}${d.defaultVendor ? ` · 기본 거래처 ${d.defaultVendor.name}` : ''}`}
        actions={
          d.active ? (
            <>
              <Button icon="plus" onClick={() => setDialog('in')}>
                입고
              </Button>
              {canAdjust ? <Button onClick={() => setDialog('adjust')}>재고 조정</Button> : null}
              {canManage ? <Button onClick={() => setDialog('edit')}>수정</Button> : null}
              {canManage ? (
                <Button variant="danger" onClick={() => setDialog('delete')}>
                  삭제
                </Button>
              ) : null}
              <Button variant="primary" icon="box" onClick={() => setDialog('out')}>
                출고 기록
              </Button>
            </>
          ) : canManage ? (
            <Button variant="primary" onClick={() => void reactivate()}>
              다시 사용
            </Button>
          ) : null
        }
      />
      {!d.active ? (
        <p className="form-note" role="status" style={{ marginBottom: 16 }}>
          &quot;사용 안 함&quot;으로 바꾼 품목이에요. 목록 기본 화면에 나오지 않고, 입출고를 기록할 수 없어요. 지난 기록은 그대로 볼 수 있어요.
        </p>
      ) : null}

      <KpiRow label="품목 요약">
        <Kpi label="현재고" value={formatNumber(d.stock, 2)} unit={d.unit} tone={d.status === 'low' ? 'danger' : d.status === 'soon_low' ? 'warn' : undefined} hint={d.par > 0 ? `적정 ${formatNumber(d.par, 2)}${d.unit}` : '적정 재고 없음'} />
        <Kpi label="상태" value={d.active ? STOCK_STATUS_LABELS[d.status] : '사용 안 함'} tone={d.active && STATUS_TONE[d.status] !== 'ok' ? (STATUS_TONE[d.status] as 'danger' | 'warn') : undefined} hint={d.active ? <StatusChip row={d} /> : undefined} />
        <Kpi
          label="가장 빠른 유효기간"
          value={d.trackExpiry ? (d.nearestExpiry ? formatDate(d.nearestExpiry) : null) : '관리 안 함'}
          hint={d.dday !== null ? ddayText(d.dday) : d.trackExpiry ? '남은 로트가 없어요' : '유효기간을 관리하지 않는 품목이에요'}
          tone={d.dday !== null && d.dday < 0 ? 'danger' : d.dday !== null && d.dday <= 30 ? 'warn' : undefined}
        />
        <Kpi label="입출고 기록" value={formatNumber(d.moveCount)} unit="건" hint={d.recentMoves[0] ? `최근 ${formatDateTime(d.recentMoves[0].movedAt)}` : '아직 기록이 없어요'} />
        <Kpi label="기본 거래처" value={d.defaultVendor?.name ?? null} hint={d.defaultVendor ? '입고할 때 먼저 골라져요' : '정하지 않았어요'} />
        <Kpi label="최근 단가" value={d.lastPrice !== null ? formatNumber(d.lastPrice) : null} unit="원" hint={d.priceChangePct !== null ? `직전 대비 ${formatPriceChange(d.priceChangePct)}` : '비교할 단가가 없어요'} tone={d.priceUpPct !== null ? 'danger' : undefined} />
      </KpiRow>

      <CardGrid>
        <Card title="단가 추이" sub={d.prices.length ? `${d.prices.length}건` : undefined} span="full" id="item-prices" action={{ label: '단가 변동 전체', to: '/inventory/prices' }}>
          {d.prices.length ? (
            <>
              {trend.length > 1 ? (
                <div style={{ padding: '4px var(--pad) 8px', maxWidth: 360 }}>
                  <Sparkline values={trend} label={`${d.name} 입고 단가 추이(원)`} height={64} />
                </div>
              ) : null}
              <DataTable<PriceRow> caption={`${d.name} 단가 기록`} columns={priceColumns} rows={[...d.prices].reverse()} rowKey={(p) => p.moveId} empty={null} />
            </>
          ) : (
            <EmptyState icon="won" title="단가 기록이 없어요" description="입고할 때 단가를 적으면 여기에 추이가 쌓여요." action={d.active ? <Button icon="plus" onClick={() => setDialog('in')}>입고 기록</Button> : undefined} />
          )}
        </Card>
        <Card title="유효기간 로트" sub={d.trackExpiry ? `${d.lots.length}개` : undefined} span="full" id="item-lots">
          {!d.trackExpiry ? (
            <EmptyState icon="cal" title="유효기간을 관리하지 않는 품목이에요" description={canManage ? '수정에서 "유효기간 관리"를 켜면 로트별로 남은 수량을 보여 드려요.' : '실장 이상이 유효기간 관리를 켤 수 있어요.'} />
          ) : (
            <DataTable<LotRemain>
              caption={`${d.name} 로트별 남은 수량`}
              columns={lotColumns}
              rows={d.lots}
              rowKey={(l) => l.moveId}
              empty={<EmptyState icon="cal" title="남은 로트가 없어요" description="유효기간과 함께 입고를 기록하면 여기에 보여요." action={d.active ? <Button icon="plus" onClick={() => setDialog('in')}>입고 기록</Button> : undefined} />}
            />
          )}
        </Card>
        <Card title="최근 입출고" sub={d.moveCount ? `전체 ${formatNumber(d.moveCount)}건` : undefined} span="full" id="item-moves" action={{ label: '입출고 기록 전체', to: '/inventory/moves' }}>
          <DataTable<MoveRow>
            caption={`${d.name} 최근 입출고`}
            columns={moveColumns}
            rows={d.recentMoves}
            rowKey={(m) => m.id}
            empty={<EmptyState icon="box" title="아직 입출고 기록이 없어요" description="입고를 기록하면 현재고가 생겨요." action={d.active ? <Button icon="plus" onClick={() => setDialog('in')}>첫 입고 기록</Button> : undefined} />}
          />
        </Card>
      </CardGrid>

      <QuickOutDialog open={dialog === 'out'} item={d} onClose={() => setDialog(null)} />
      <MoveDialog open={dialog === 'in' || dialog === 'adjust'} type={dialog === 'adjust' ? 'adjust' : 'in'} item={d} canAdjust={canAdjust} onClose={() => setDialog(null)} />
      <ItemFormDialog open={dialog === 'edit'} item={d} categories={[]} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={dialog === 'delete'}
        onClose={() => setDialog(null)}
        onConfirm={remove}
        title="품목을 삭제할까요?"
        message={
          d.moveCount > 0
            ? `${d.name}에는 입출고 기록이 ${formatNumber(d.moveCount)}건 있어서 지우지 않고 "사용 안 함"으로 바꿔요. 기록은 그대로 남고, 나중에 다시 사용할 수 있어요.`
            : `${d.name}에는 입출고 기록이 없어서 바로 지워져요.`
        }
        confirmLabel={d.moveCount > 0 ? '사용 안 함으로 바꾸기' : '삭제'}
        danger
      />
    </>
  );
}

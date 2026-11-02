// 이 파일이 하는 일: "발주서 상세" 화면(/inventory/orders/:id, FR-054). 발주서의 상태·품목 수·합계·거래처를 숫자 타일로 보여 주고,
// 작성 중이면 품목 수량을 고치고 품목을 넣거나 빼며 거래처·메모를 바꾼 뒤 "발주함"으로 확정한다(확정하면 더는 고칠 수 없다).
// 발주함 상태면 "입고 처리"로 실제 들어온 수량·단가·로트·유효기간을 적어 한 번에 재고 입고 기록으로 넘긴다(상태 → 입고 완료).
// 어느 상태에서나 A4 인쇄 화면(/print/order/:id)을 열 수 있다. 입고 처리 때 "지출로도 기록"을 켜면 입고 합계가 재료비 지출 1건으로 남는다(지출 권한이 있는 사람만 보임, phase-04-task-04).
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { Button, IconButton } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip, Kpi, KpiRow } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { ConfirmDialog, Dialog } from '../../components/Dialog.tsx';
import { Checkbox, DateInput, Field, NumberInput, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { formatDate, formatDateTime, formatWon } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { PAY_METHOD_LABELS, PAY_METHODS, type ExpenseRow, type PayMethod } from '../../../../shared/schemas/finance.ts';
import { ORDER_STATUS_LABELS, suggestedQty, type OrderDetail, type OrderLine } from '../../../../shared/schemas/orders.ts';
import type { ItemRow } from '../../../../shared/schemas/inventory.ts';
import { ItemPicker, messageOf, qty, refreshInventory, useVendors } from './inventory-ui.tsx';
import { editTotals, fetchOrder, ORDER_KEY, ORDER_TONE, parseNum, patchLines, qtyError, receiveBody, toEditLines, type EditLine, type ReceiveLine } from './ordersLib.ts';
import './orders.css';

/** 편집 줄 + 화면 참고용 재고·적정 */
type DraftLine = EditLine & { stock: number; par: number };

/** 발주서 상세 */
export default function OrderDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id > 0;
  const toast = useToast();
  const state = useApi<OrderDetail>(valid ? `${ORDER_KEY}:detail:${id}` : null, () => fetchOrder(id));
  const [dialog, setDialog] = useState<'receive' | 'cancel' | null>(null);
  /** 저장할 때마다 바꿔 편집 칸을 서버 값으로 새로 시작한다 */
  const [version, setVersion] = useState(0);

  if (!valid || (state.error instanceof ApiError && state.error.status === 404)) {
    return (
      <EmptyState
        icon="cart"
        title="찾는 발주서가 없어요"
        description="지워졌거나 주소가 바뀌었을 수 있어요."
        action={<Button to="/inventory/orders">발주서 목록으로</Button>}
      />
    );
  }
  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  const d = state.data;
  if (!d) return <Skeleton rows={8} label="발주서 불러오는 중" />;

  const cancel = async () => {
    try {
      await api.post<OrderDetail>(`/api/orders/${d.id}/cancel`);
      refreshInventory();
      setDialog(null);
      toast.show(`${d.poNo} 발주서를 취소했어요.`);
    } catch (err) {
      setDialog(null);
      toast.error(messageOf(err, '취소하지 못했어요. 다시 시도해 주세요.'));
    }
  };

  const stepText =
    d.status === 'received' && d.receivedAt
      ? `${formatDateTime(d.receivedAt)}에 입고 처리했어요.`
      : d.status === 'ordered' && d.orderedAt
        ? `${formatDateTime(d.orderedAt)}에 발주했어요. 물건이 오면 "입고 처리"를 눌러 주세요.`
        : d.status === 'canceled' && d.canceledAt
          ? `${formatDateTime(d.canceledAt)}에 취소했어요.`
          : '작성 중이에요. 수량을 확인하고 저장한 뒤 "발주함"을 눌러 주세요.';

  return (
    <>
      <PageHeader
        title={`발주서 ${d.poNo}`}
        summary={stepText}
        actions={
          <>
            <Button to="/inventory/orders" variant="ghost">
              목록
            </Button>
            {d.status === 'draft' || d.status === 'ordered' ? (
              <Button variant="ghost" onClick={() => setDialog('cancel')}>
                발주서 취소
              </Button>
            ) : null}
            <Button icon="print" to={`/print/order/${d.id}`}>
              인쇄 미리보기
            </Button>
            {d.status === 'ordered' ? (
              <Button variant="primary" icon="box" onClick={() => setDialog('receive')}>
                입고 처리
              </Button>
            ) : null}
          </>
        }
      />
      <KpiRow label="발주서 요약">
        <Kpi label="상태" value={<Chip tone={ORDER_TONE[d.status]}>{ORDER_STATUS_LABELS[d.status]}</Chip>} hint={`만든 날 ${formatDate(d.createdAt)}`} />
        <Kpi label="품목" value={d.lineCount} unit="개" hint={`수량 합계 ${qty(d.totalQty)}`} />
        <Kpi label="합계 금액" value={formatWon(d.total)} hint={d.missingPrice ? '단가가 빈 품목은 빠졌어요' : d.status === 'draft' ? '최근 입고 단가 기준' : '발주서 단가 기준'} tone={d.missingPrice ? 'warn' : undefined} />
        <Kpi label="거래처" value={d.vendor ?? '미정'} hint={d.vendorInfo?.orderMethod ?? (d.vendor ? '주문 방법 미입력' : '발주 전에 거래처를 골라 주세요')} tone={d.vendor ? undefined : 'warn'} />
      </KpiRow>
      {d.status === 'draft' ? (
        <DraftEditor key={`${d.id}:${version}`} order={d} onSaved={() => setVersion((v) => v + 1)} />
      ) : (
        <LinesCard order={d} />
      )}
      {d.vendorInfo ? <VendorCard order={d} /> : null}
      {dialog === 'receive' ? <ReceiveDialog order={d} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        onConfirm={cancel}
        title="발주서를 취소할까요?"
        message={`${d.poNo} 발주서를 취소해요. 취소한 발주서는 다시 쓸 수 없고, 담긴 품목은 다음 "발주서 만들기" 때 다시 담겨요.`}
        confirmLabel="발주서 취소"
        danger
      />
    </>
  );
}

/** 읽기 전용 품목 표(발주함·입고 완료·취소) */
function LinesCard({ order: d }: { order: OrderDetail }) {
  const columns: Column<OrderLine>[] = [
    { key: 'itemName', header: '품목', sortValue: (l) => l.itemName, render: (l) => <b>{l.itemName}</b> },
    { key: 'category', header: '분류', sortValue: (l) => l.category },
    { key: 'qty', header: '발주 수량', align: 'right', sortValue: (l) => l.qty, render: (l) => qty(l.qty, l.unit) },
    { key: 'unitPrice', header: '단가', align: 'right', render: (l) => (l.unitPrice === null ? <span className="muted">—</span> : <span className="num">{formatWon(l.unitPrice)}</span>) },
    { key: 'amount', header: '금액', align: 'right', sortValue: (l) => l.amount, render: (l) => (l.amount === null ? <span className="muted">—</span> : <span className="num">{formatWon(l.amount)}</span>) },
    ...(d.status === 'received' ? [{ key: 'receivedQty', header: '입고 수량', align: 'right' as const, render: (l: OrderLine) => qty(l.receivedQty, l.unit) }] : []),
    { key: 'stock', header: '지금 재고', align: 'right', render: (l) => qty(l.stock, l.unit) },
  ];
  return (
    <Card title="발주 품목" sub={`${d.lineCount}개 · ${formatWon(d.total)}`} span="full">
      {d.note ? (
        <p className="po-note">
          <b>메모</b> {d.note}
        </p>
      ) : null}
      <DataTable<OrderLine>
        caption="발주 품목"
        columns={columns}
        rows={d.lines}
        rowKey={(l) => l.id}
        empty={<EmptyState icon="box" title="담긴 품목이 없어요" description="이 발주서에는 품목이 없어요." />}
      />
    </Card>
  );
}

/** 작성 중 발주서 편집: 수량·품목·거래처·메모를 고치고 저장하거나, 저장과 함께 "발주함"으로 확정한다 */
function DraftEditor({ order: d, onSaved }: { order: OrderDetail; onSaved: () => void }) {
  const toast = useToast();
  const vendors = useVendors();
  const [lines, setLines] = useState<DraftLine[]>(() => toEditLines(d).map((l, i) => ({ ...l, stock: d.lines[i]?.stock ?? 0, par: d.lines[i]?.par ?? 0 })));
  const [vendorId, setVendorId] = useState(d.vendorId ? String(d.vendorId) : '');
  const [note, setNote] = useState(d.note ?? '');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const totals = editTotals(lines);
  const errors = lines.map((l) => qtyError(l.qty));
  const hasError = errors.some(Boolean) || lines.length === 0;

  const setQty = (itemId: number, v: string) => setLines((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, qty: v } : l)));
  const remove = (itemId: number) => setLines((ls) => ls.filter((l) => l.itemId !== itemId));
  const add = (r: ItemRow) => {
    setAdding(false);
    if (lines.some((l) => l.itemId === r.id)) {
      toast.show(`${r.name}은(는) 이미 발주서에 있어요. 수량을 고쳐 주세요.`);
      return;
    }
    const q = suggestedQty(r.par, r.stock) || 1;
    setLines((ls) => [...ls, { itemId: r.id, itemName: r.name, unit: r.unit, qty: String(q), unitPrice: r.lastPrice, stock: r.stock, par: r.par }]);
  };

  /** 지금 편집 내용을 저장한다(성공하면 true) */
  const save = async (): Promise<boolean> => {
    setShowErrors(true);
    setFormError(null);
    if (hasError) {
      setFormError(lines.length === 0 ? '품목을 한 개 이상 넣어 주세요.' : '빨간 글씨로 표시한 수량을 고쳐 주세요.');
      return false;
    }
    try {
      await api.patch<OrderDetail>(`/api/orders/${d.id}`, { lines: patchLines(lines), vendorId: vendorId ? Number(vendorId) : null, note: note.trim() || null });
      return true;
    } catch (err) {
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
      return false;
    }
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (await save()) {
        refreshInventory();
        toast.show('발주서를 저장했어요.');
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  };

  const askPlace = () => {
    setShowErrors(true);
    if (hasError) {
      setFormError(lines.length === 0 ? '품목을 한 개 이상 넣어 주세요.' : '빨간 글씨로 표시한 수량을 고쳐 주세요.');
      return;
    }
    if (!vendorId) {
      setFormError('거래처를 골라 주세요. 거래처가 정해져야 발주할 수 있어요.');
      return;
    }
    setFormError(null);
    setConfirm(true);
  };

  const place = async () => {
    if (!(await save())) {
      setConfirm(false);
      return;
    }
    try {
      await api.post<OrderDetail>(`/api/orders/${d.id}/order`);
      refreshInventory();
      setConfirm(false);
      toast.show(`${d.poNo} 발주서를 "발주함"으로 바꿨어요. 이제 수량은 고칠 수 없어요.`);
      onSaved();
    } catch (err) {
      setConfirm(false);
      setFormError(messageOf(err, '발주하지 못했어요. 다시 시도해 주세요.'));
    }
  };

  const columns: Column<DraftLine>[] = [
    {
      key: 'itemName',
      header: '품목',
      render: (l) => (
        <span className="po-item">
          <b>{l.itemName}</b>
          <small className="muted num">
            현재 {qty(l.stock, l.unit)} · 적정 {qty(l.par, l.unit)}
          </small>
        </span>
      ),
    },
    {
      key: 'qty',
      header: '발주 수량',
      render: (l) => {
        const err = showErrors ? errors[lines.indexOf(l)] : null;
        return (
          <span className="po-qty">
            <NumberInput className="input num" aria-label={`${l.itemName} 발주 수량`} value={l.qty} onChange={(e) => setQty(l.itemId, e.target.value)} min={0} step="any" aria-invalid={err ? true : undefined} />
            <span className="muted">{l.unit}</span>
            {err ? (
              <span className="err">
                <Icon name="alert" size="sm" />
                {err}
              </span>
            ) : null}
          </span>
        );
      },
    },
    { key: 'unitPrice', header: '최근 단가', align: 'right', render: (l) => (l.unitPrice === null ? <span className="muted">—</span> : <span className="num">{formatWon(l.unitPrice)}</span>) },
    {
      key: 'amount',
      header: '금액',
      align: 'right',
      render: (l) => {
        const n = parseNum(l.qty);
        return l.unitPrice === null || n === null ? <span className="muted">—</span> : <span className="num">{formatWon(Math.round(n * l.unitPrice))}</span>;
      },
    },
    { key: 'remove', header: '빼기', render: (l) => <IconButton icon="close" label={`${l.itemName} 빼기`} onClick={() => remove(l.itemId)} /> },
  ];

  return (
    <Card title="발주 품목 고치기" sub={`${lines.length}개 · ${formatWon(totals.amount)}`} span="full">
      <form className="po-form" onSubmit={onSave} noValidate aria-label="발주서 고치기">
        {formError ? (
          <div className="form-error" role="alert">
            <Icon name="alert" size="md" />
            {formError}
          </div>
        ) : null}
        <div className="po-fields">
          <Field label="거래처" help={vendorId ? undefined : '거래처를 고른 뒤 발주할 수 있어요.'}>
            <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">(거래처 미정)</option>
              {(vendors.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="메모" help="거래처에 전할 말이나 배송 요청(인쇄물에 들어가요).">
            <TextArea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
          </Field>
        </div>
        <DataTable<DraftLine>
          caption="발주 품목 고치기"
          columns={columns}
          rows={lines}
          rowKey={(l) => l.itemId}
          empty={<EmptyState icon="box" title="담긴 품목이 없어요" description="“품목 넣기”로 주문할 품목을 넣어 주세요." />}
        />
        <div className="po-foot">
          <Button icon="plus" onClick={() => setAdding(true)}>
            품목 넣기
          </Button>
          <span className="grow" />
          <span className="num po-sum">
            수량 {qty(totals.qty)} · 합계 <b>{formatWon(totals.amount)}</b>
            {totals.missingPrice ? <span className="muted"> (단가 빈 품목 제외)</span> : null}
          </span>
          <Button type="submit" loading={busy}>
            저장
          </Button>
          <Button variant="primary" icon="check" onClick={askPlace}>
            발주함
          </Button>
        </div>
      </form>
      <Dialog open={adding} onClose={() => setAdding(false)} title="품목 넣기" footer={<Button onClick={() => setAdding(false)}>닫기</Button>}>
        {adding ? <ItemPicker onPick={add} autoFocus label="넣을 품목 찾기" /> : null}
      </Dialog>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={place}
        title="발주함으로 바꿀까요?"
        message={`지금 내용(품목 ${lines.length}개, 합계 ${formatWon(totals.amount)})을 저장하고 "발주함"으로 바꿔요. 발주한 뒤에는 수량을 고칠 수 없어요.`}
        confirmLabel="발주함"
      />
    </Card>
  );
}

/** 거래처 정보 카드(주문할 때 참고) */
function VendorCard({ order: d }: { order: OrderDetail }) {
  const v = d.vendorInfo;
  if (!v) return null;
  return (
    <Card title="거래처 정보" sub={v.name} span="full">
      <dl className="po-vendor">
        <div>
          <dt>담당자</dt>
          <dd>{v.contactName ?? '—'}</dd>
        </div>
        <div>
          <dt>업무용 연락처</dt>
          <dd className="num">{v.phone ?? '—'}</dd>
        </div>
        <div>
          <dt>이메일</dt>
          <dd>{v.email ?? '—'}</dd>
        </div>
        <div>
          <dt>주문 방법</dt>
          <dd>{v.orderMethod ?? '—'}</dd>
        </div>
      </dl>
    </Card>
  );
}

/** 입고 처리 대화상자: 품목마다 실제로 들어온 수량(기본 = 발주 수량)·단가·로트·유효기간을 적는다 */
function ReceiveDialog({ order: d, onClose }: { order: OrderDetail; onClose: () => void }) {
  const toast = useToast();
  const [lines, setLines] = useState<ReceiveLine[]>(() => d.lines.map((l) => ({ itemId: l.itemId, qty: String(l.qty), unitPrice: l.unitPrice === null ? '' : String(l.unitPrice), lot: '', expiryOn: '' })));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (i: number, k: keyof ReceiveLine, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const { info } = useSession();
  const canExpense = can(info?.user?.role, 'expenses.manage');
  const [alsoExpense, setAlsoExpense] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('transfer');
  // 지출 금액 미리 보기: 들어온 수량 × 단가 합계(서버도 같은 방법으로 계산한다)
  const expenseTotal = Math.round(lines.reduce((sum, l) => sum + Math.max(0, parseNum(l.qty) ?? 0) * Math.max(0, parseNum(l.unitPrice) ?? 0), 0));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    lines.forEach((l, i) => {
      const n = parseNum(l.qty);
      if (n === null || n < 0) errs[`lines.${i}.qty`] = '수량을 0 이상 숫자로 적어 주세요(안 온 품목은 0).';
      const p = l.unitPrice.trim() ? parseNum(l.unitPrice) : 0;
      if (p === null || p < 0) errs[`lines.${i}.unitPrice`] = '단가는 0원 이상 숫자로 적어 주세요.';
    });
    setFields(errs);
    if (Object.keys(errs).length) {
      setFormError('빨간 글씨로 표시한 칸을 고쳐 주세요.');
      return;
    }
    if (!lines.some((l) => (parseNum(l.qty) ?? 0) > 0)) {
      setFormError('들어온 수량을 한 품목 이상 적어 주세요.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const r = await api.post<OrderDetail & { expense?: ExpenseRow | null }>(`/api/orders/${d.id}/receive`, { lines: receiveBody(lines), ...(alsoExpense ? { alsoExpense: { payMethod } } : {}) });
      refreshInventory();
      if (r.expense) invalidate('finance');
      const added = `입고 처리했어요. 품목 ${r.lines.filter((l) => l.receivedQty > 0).length}개가 재고에 더해졌어요.`;
      toast.show(r.expense ? `${added} 지출 ${formatWon(r.expense.amount)}(${r.expense.category})도 기록했어요.` : added);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(messageOf(err, '입고 처리하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="입고 처리"
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button type="submit" form="po-receive-form" variant="primary" loading={busy}>
            입고 기록 저장
          </Button>
        </>
      }
    >
      <form id="po-receive-form" className="po-receive" onSubmit={submit} noValidate aria-label="입고 처리">
        <p className="muted">실제로 들어온 수량을 적어 주세요. 안 온 품목은 0으로 두면 기록하지 않아요. 저장하면 재고 입고 기록으로 한꺼번에 들어가요.</p>
        {formError ? (
          <div className="form-error" role="alert">
            <Icon name="alert" size="md" />
            {formError}
          </div>
        ) : null}
        {d.lines.map((l, i) => {
          const r = lines[i];
          if (!r) return null;
          return (
            <fieldset key={l.itemId} className="po-receive-line">
              <legend>
                <b>{l.itemName}</b> <span className="muted num">발주 {qty(l.qty, l.unit)}</span>
              </legend>
              <div className="po-receive-grid">
                <Field label={`들어온 수량(${l.unit})`} error={fields[`lines.${i}.qty`]}>
                  <NumberInput value={r.qty} onChange={(e) => set(i, 'qty', e.target.value)} min={0} step="any" />
                </Field>
                <Field label="단가(원)" error={fields[`lines.${i}.unitPrice`]} help={l.unitPrice === null ? '비워 두면 단가 없이 기록해요.' : `발주서 단가 ${formatWon(l.unitPrice)}`}>
                  <NumberInput value={r.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} min={0} step="any" />
                </Field>
                <Field label="유효기간" error={fields[`lines.${i}.expiryOn`]} help={l.trackExpiry ? '유효기간 관리 품목이에요.' : undefined}>
                  <DateInput value={r.expiryOn} onChange={(e) => set(i, 'expiryOn', e.target.value)} />
                </Field>
                <Field label="로트 번호" error={fields[`lines.${i}.lot`]}>
                  <TextInput value={r.lot} onChange={(e) => set(i, 'lot', e.target.value)} maxLength={40} autoComplete="off" />
                </Field>
              </div>
            </fieldset>
          );
        })}
        {canExpense ? (
          <fieldset className="po-receive-line">
            <legend>
              <b>지출</b>
            </legend>
            <Checkbox
              label="지출로도 기록"
              hint={`입고 합계 ${formatWon(expenseTotal)}을(를) 재료비 지출 1건으로 남겨요(거래처: ${d.vendor ?? '없음'}).`}
              checked={alsoExpense}
              onChange={(e) => setAlsoExpense(e.target.checked)}
            />
            {alsoExpense ? (
              <Field label="결제 수단" error={fields['alsoExpense.payMethod'] ?? fields.alsoExpense}>
                <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PayMethod)}>
                  {PAY_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAY_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </fieldset>
        ) : null}
      </form>
    </Dialog>
  );
}

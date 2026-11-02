// 이 파일이 하는 일: 재고 화면들(현황·상세·입출고·거래처·단가)이 함께 쓰는 작은 부품과 대화상자를 둔다.
// 상태 칩(부족·곧 부족·임박 D-n·만료·정상, 글자 포함), 단가 변동 칩(▲6%), 수량 글자, 품목 찾기 목록,
// 입고·출고·조정 기록 대화상자(MoveDialog), 품목 등록·수정 대화상자(ItemFormDialog)가 있다. 저장하면 'inventory'로 시작하는 화면 데이터를 다시 불러온다.
// 재고보다 많이 출고하면 서버가 409(needsConfirm)를 돌려주고, 확인 대화상자에서 "그래도 출고"를 눌러야만 저장된다(FR-051 AC4).
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '../../components/Button.tsx';
import { Chip, type Tone } from '../../components/Chip.tsx';
import { ConfirmDialog, Dialog } from '../../components/Dialog.tsx';
import { Checkbox, DateInput, Field, NumberInput, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { SearchInput, Segmented } from '../../components/Toolbar.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { formatNumber, formatWon } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import {
  formatPriceChange,
  MOVE_TYPE_LABELS,
  STOCK_STATUS_LABELS,
  type ItemPage,
  type ItemRow,
  type ItemSaveResult,
  type MoveResult,
  type MoveType,
  type StockStatus,
  type VendorRow,
} from '../../../../shared/schemas/inventory.ts';

/** 재고 화면 데이터 key의 공통 앞부분(저장 뒤 invalidate에 쓴다) */
export const INV_KEY = 'inventory';

/** 상태별 칩 색 */
export const STATUS_TONE: Record<StockStatus, Tone> = { expired: 'danger', low: 'danger', expiring: 'warn', soon_low: 'warn', ok: 'ok' };

/** 수량 글자: 2.5 → "2.5", 1200 → "1,200" */
export function qty(n: number | null | undefined, unit = ''): string {
  if (n === null || n === undefined) return '-';
  return `${formatNumber(n, 2)}${unit}`;
}

/** 남은 날 글자: 12 → "D-12", 0 → "D-day", -3 → "D+3" */
export function ddayText(n: number): string {
  if (n === 0) return 'D-day';
  return n > 0 ? `D-${n}` : `D+${-n}`;
}

/** 품목 상태 칩. 유효기간 임박이면 "임박 D-12"처럼 남은 날을 함께 쓴다 */
export function StatusChip({ row }: { row: Pick<ItemRow, 'status' | 'dday'> }) {
  const label = row.status === 'expiring' && row.dday !== null ? `임박 ${ddayText(row.dday)}` : STOCK_STATUS_LABELS[row.status];
  return <Chip tone={STATUS_TONE[row.status]}>{label}</Chip>;
}

/** 단가 변동 칩(정해 둔 비율보다 오른 경우만): "▲6%" */
export function PriceUpChip({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  return (
    <Chip tone="danger" title="직전 입고 단가보다 많이 올랐어요">
      {formatPriceChange(pct)}
    </Chip>
  );
}

/** 오류를 화면 문구로 */
export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 저장 뒤 재고 화면 데이터를 모두 다시 불러온다(대시보드 카드 포함) */
export function refreshInventory(): void {
  invalidate(INV_KEY);
  invalidate('dashboard');
}

/** 숫자 입력값 → 숫자(비었거나 숫자가 아니면 null) */
export function toNum(v: string): number | null {
  const t = v.trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 품목 찾기: 검색어를 넣으면 사용 중 품목을 이름순으로 보여 주고, 누르면 고른다 */
export function ItemPicker({ onPick, autoFocus, label = '품목 찾기' }: { onPick: (item: ItemRow) => void; autoFocus?: boolean; label?: string }) {
  const [q, setQ] = useState('');
  const [word, setWord] = useState('');
  const listId = useId();
  useEffect(() => {
    const t = setTimeout(() => setWord(q.trim()), 150);
    return () => clearTimeout(t);
  }, [q]);
  const key = `${INV_KEY}:pick:${word}`;
  const state = useApi<ItemPage>(key, () => api.page<ItemRow, Omit<ItemPage, 'data' | 'total'>>(`/api/items?sort=name&pageSize=8&q=${encodeURIComponent(word)}`));
  const rows = state.data?.data;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <SearchInput label={label} placeholder="품목 이름·분류·위치로 찾기" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} aria-controls={listId} />
      <ul id={listId} aria-label="찾은 품목" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {state.error && !rows ? <li className="muted">{messageOf(state.error, '품목을 불러오지 못했어요.')}</li> : null}
        {!rows && !state.error ? <li className="muted">불러오는 중…</li> : null}
        {rows && rows.length === 0 ? <li className="muted">찾는 품목이 없어요. 검색어를 바꿔 보세요.</li> : null}
        {rows?.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="btn ghost block"
              style={{ justifyContent: 'space-between', height: 'auto', minHeight: 40, padding: '6px 10px', textAlign: 'left' }}
              onClick={() => onPick(r)}
            >
              <span style={{ display: 'grid' }}>
                <b>{r.name}</b>
                <small className="muted num">
                  {r.category} · 현재 {qty(r.stock, r.unit)}
                </small>
              </span>
              <StatusChip row={r} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 거래처 목록(고르기용) */
export function useVendors(active: 'active' | 'all' = 'active') {
  return useApi<VendorRow[]>(`${INV_KEY}:vendors:${active}`, () => api.get(`/api/vendors?active=${active}`));
}

/**
 * 출고를 저장한다. 재고보다 많으면 서버가 409 needsConfirm을 주므로 그때 확인을 받고(onNeedConfirm) force로 다시 보낸다.
 * 돌려준 값: 저장 결과, 또는 확인이 필요하면 'confirm'
 */
export async function saveMove(body: Record<string, unknown>): Promise<MoveResult | 'confirm'> {
  try {
    return await api.post<MoveResult>('/api/inventory/moves', body);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.details?.needsConfirm === true) return 'confirm';
    throw err;
  }
}

/** 재고보다 많이 출고할 때 확인 대화상자 */
export function OverStockConfirm({ open, item, amount, onClose, onConfirm }: { open: boolean; item: Pick<ItemRow, 'name' | 'stock' | 'unit'> | null; amount: number; onClose: () => void; onConfirm: () => Promise<void> }) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="재고보다 많이 출고할까요?"
      message={
        item ? (
          <p>
            <b>{item.name}</b>의 지금 재고는 <b className="num">{qty(item.stock, item.unit)}</b>인데 <b className="num">{qty(amount, item.unit)}</b>를 출고하려고 해요. 수량이 맞으면
            &quot;그래도 출고&quot;를 눌러 주세요. 재고가 0보다 적게 표시되니 나중에 재고 조정으로 맞춰 주세요.
          </p>
        ) : null
      }
      confirmLabel="그래도 출고"
      danger
    />
  );
}

interface MoveDialogProps {
  open: boolean;
  onClose: () => void;
  /** 처음 고를 종류 */
  type: MoveType;
  /** 미리 고른 품목(상세 화면에서 열 때) */
  item?: ItemRow | null;
  /** 조정을 고를 수 있는지(실장 이상) */
  canAdjust: boolean;
  onSaved?: (r: MoveResult) => void;
}

/** 입고·출고·조정 기록 대화상자. 입고는 단가·거래처·로트·유효기간까지 받는다. 열 때마다 빈 칸으로 새로 시작한다 */
export function MoveDialog(props: MoveDialogProps) {
  return props.open ? <MoveDialogBody {...props} /> : null;
}

function MoveDialogBody({ onClose, type: initialType, item: initialItem = null, canAdjust, onSaved }: MoveDialogProps) {
  const toast = useToast();
  const vendors = useVendors();
  const [type, setType] = useState<MoveType>(initialType);
  const [item, setItem] = useState<ItemRow | null>(initialItem);
  const [form, setForm] = useState({
    qty: '',
    unitPrice: initialItem?.lastPrice != null ? String(initialItem.lastPrice) : '',
    vendorId: initialItem?.vendorId ? String(initialItem.vendorId) : '',
    lot: '',
    expiryOn: '',
    reason: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const pick = (r: ItemRow) => {
    setItem(r);
    setForm((f) => ({ ...f, unitPrice: r.lastPrice != null ? String(r.lastPrice) : '', vendorId: r.vendorId ? String(r.vendorId) : '' }));
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const price = toNum(form.unitPrice);
  const pricePct = item?.lastPrice && price !== null && type === 'in' ? Math.round(((price - item.lastPrice) / item.lastPrice) * 10000) / 100 : null;

  const body = (force: boolean) => {
    const n = toNum(form.qty) ?? 0;
    return {
      itemId: item?.id,
      type,
      qty: n,
      ...(type === 'in'
        ? { unitPrice: price, vendorId: form.vendorId ? Number(form.vendorId) : null, lot: form.lot || null, expiryOn: form.expiryOn || null }
        : {}),
      reason: form.reason || null,
      ...(force ? { force: true } : {}),
    };
  };

  const send = async (force: boolean) => {
    setFormError(null);
    setBusy(true);
    try {
      const r = await saveMove(body(force));
      if (r === 'confirm') {
        setConfirm(true);
        return;
      }
      refreshInventory();
      toast.show(`${r.move.itemName} ${MOVE_TYPE_LABELS[r.move.type]} ${qty(Math.abs(r.move.qty), r.move.unit)}을(를) 기록했어요. 현재 ${qty(r.item.stock, r.item.unit)}`);
      setConfirm(false);
      onSaved?.(r);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '기록하지 못했어요. 다시 시도해 주세요.'));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const n = toNum(form.qty);
    if (!item) errs.itemId = '품목을 골라 주세요.';
    if (n === null) errs.qty = '수량을 숫자로 적어 주세요.';
    else if (type !== 'adjust' && n <= 0) errs.qty = '수량은 0보다 크게 적어 주세요.';
    else if (type === 'adjust' && n === 0) errs.qty = '조정 수량은 0이 아니어야 해요(늘리면 +, 줄이면 −).';
    if (type === 'adjust' && !form.reason.trim()) errs.reason = '재고 조정은 사유를 꼭 적어 주세요.';
    if (type === 'in' && form.unitPrice.trim() && (price === null || price < 0)) errs.unitPrice = '단가는 0원 이상 숫자로 적어 주세요.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    await send(false);
  };

  const typeOptions = (['out', 'in', ...(canAdjust ? (['adjust'] as const) : [])] as MoveType[]).map((v) => ({ value: v, label: MOVE_TYPE_LABELS[v] }));
  const title = type === 'in' ? '입고 기록' : type === 'out' ? '출고 기록' : '재고 조정';

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={title}
        footer={
          <>
            <Button onClick={onClose}>취소</Button>
            <Button type="submit" form="inv-move-form" variant="primary" loading={busy} disabled={!item}>
              저장
            </Button>
          </>
        }
      >
        <form id="inv-move-form" ref={formRef} onSubmit={submit} noValidate aria-label={title} style={{ display: 'grid', gap: 12 }}>
          {formError ? (
            <div className="form-error" role="alert">
              <Icon name="alert" size="md" />
              {formError}
            </div>
          ) : null}
          <Segmented<MoveType> label="기록 종류" value={type} options={typeOptions} onChange={setType} />
          {item ? (
            <div className="form-note" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <b>{item.name}</b> · 현재 <b className="num">{qty(item.stock, item.unit)}</b> · 적정 <span className="num">{qty(item.par, item.unit)}</span>
              </span>
              {initialItem ? null : (
                <Button size="sm" variant="ghost" onClick={() => setItem(null)}>
                  다른 품목
                </Button>
              )}
            </div>
          ) : (
            <>
              <ItemPicker onPick={pick} autoFocus />
              {errors.itemId ? (
                <span className="err" role="alert">
                  <Icon name="alert" size="sm" />
                  {errors.itemId}
                </span>
              ) : null}
            </>
          )}
          {item ? (
            <>
              <Field
                label={type === 'adjust' ? '조정 수량(늘리면 +, 줄이면 −)' : `수량(${item.unit})`}
                required
                error={errors.qty}
                help={type === 'adjust' ? '실사한 수량과 화면 수량의 차이를 적어요. 예: 2개 모자라면 -2' : undefined}
              >
                <NumberInput value={form.qty} onChange={set('qty')} step="any" autoFocus />
              </Field>
              {type === 'in' ? (
                <>
                  <Field
                    label="단가(원)"
                    error={errors.unitPrice}
                    help={
                      pricePct !== null && pricePct !== 0 ? (
                        <span className="num">
                          직전 단가 {formatWon(item.lastPrice)} 대비 {formatPriceChange(pricePct)}
                          {pricePct > 5 ? ' — 많이 올랐어요' : ''}
                        </span>
                      ) : item.lastPrice != null ? (
                        <span className="num">직전 단가 {formatWon(item.lastPrice)}</span>
                      ) : undefined
                    }
                  >
                    <NumberInput value={form.unitPrice} onChange={set('unitPrice')} step="any" min={0} />
                  </Field>
                  <Field label="거래처" error={errors.vendorId}>
                    <Select value={form.vendorId} onChange={set('vendorId')}>
                      <option value="">(선택 안 함)</option>
                      {(vendors.data ?? []).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="유효기간" error={errors.expiryOn} help={item.trackExpiry ? '유효기간을 관리하는 품목이에요. 포장에 적힌 날짜를 넣어 주세요.' : '관리하지 않는 품목이면 비워 두어도 돼요.'}>
                    <DateInput value={form.expiryOn} onChange={set('expiryOn')} />
                  </Field>
                  <Field label="로트 번호" error={errors.lot}>
                    <TextInput value={form.lot} onChange={set('lot')} maxLength={40} autoComplete="off" />
                  </Field>
                </>
              ) : null}
              <Field label={type === 'adjust' ? '사유' : '메모'} required={type === 'adjust'} error={errors.reason}>
                <TextInput value={form.reason} onChange={set('reason')} maxLength={200} autoComplete="off" placeholder={type === 'adjust' ? '예: 월말 실사 차이' : '선택'} />
              </Field>
            </>
          ) : null}
        </form>
      </Dialog>
      <OverStockConfirm open={confirm} item={item} amount={toNum(form.qty) ?? 0} onClose={() => setConfirm(false)} onConfirm={() => send(true)} />
    </>
  );
}

interface ItemFormProps {
  open: boolean;
  onClose: () => void;
  /** 고칠 품목(없으면 새로 등록) */
  item?: ItemRow | null;
  /** 이미 있는 분류(입력 도움말 목록) */
  categories: readonly string[];
  onSaved?: (r: ItemSaveResult) => void;
}

/** 품목 등록·수정 대화상자(실장 이상). 같은 이름이 있으면 저장 전에 경고를 보여 준다. 열 때마다 새로 시작한다 */
export function ItemFormDialog(props: ItemFormProps) {
  return props.open ? <ItemFormBody {...props} /> : null;
}

function ItemFormBody({ onClose, item = null, categories, onSaved }: ItemFormProps) {
  const toast = useToast();
  const vendors = useVendors();
  const [form, setForm] = useState(() =>
    item
      ? { name: item.name, category: item.category, unit: item.unit, par: String(item.par), trackExpiry: item.trackExpiry, vendorId: item.vendorId ? String(item.vendorId) : '', location: item.location ?? '', memo: item.memo ?? '' }
      : { name: '', category: '', unit: '', par: '', trackExpiry: false, vendorId: '', location: '', memo: '' },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 같은 이름 확인 결과: 어떤 이름으로 찾았는지와 찾은 품목 이름 */
  const [dup, setDup] = useState<{ word: string; name: string | null }>({ word: '', name: null });
  const formRef = useRef<HTMLFormElement>(null);
  const listId = useId();

  // 같은 이름이 있는지 미리 알려 준다(대소문자·앞뒤 공백 무시). 입력이 멈춘 뒤 250ms에 찾는다
  const nameWord = form.name.trim();
  const sameAsSelf = !!item && item.name.trim().toLowerCase() === nameWord.toLowerCase();
  useEffect(() => {
    if (!nameWord || sameAsSelf) return;
    let alive = true;
    const t = setTimeout(() => {
      api
        .page<ItemRow>(`/api/items?active=all&pageSize=20&q=${encodeURIComponent(nameWord)}`)
        .then((r) => {
          if (!alive) return;
          const same = r.data.find((x) => x.id !== item?.id && x.name.trim().toLowerCase() === nameWord.toLowerCase());
          setDup({ word: nameWord, name: same ? same.name : null });
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [nameWord, sameAsSelf, item]);
  const dupName = !sameAsSelf && dup.word === nameWord ? dup.name : null;

  const set = (k: Exclude<keyof typeof form, 'trackExpiry'>) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const par = toNum(form.par);
    if (!form.name.trim()) errs.name = '품목 이름을 적어 주세요.';
    if (!form.category.trim()) errs.category = '분류를 적어 주세요.';
    if (!form.unit.trim()) errs.unit = '단위를 적어 주세요(예: 박스, 팩).';
    if (par === null || par < 0) errs.par = '적정 재고는 0 이상 숫자로 적어 주세요.';
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) {
      setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    const payload = {
      name: form.name.trim(),
      category: form.category.trim(),
      unit: form.unit.trim(),
      par: par ?? 0,
      trackExpiry: form.trackExpiry,
      vendorId: form.vendorId ? Number(form.vendorId) : null,
      location: form.location.trim() || null,
      memo: form.memo.trim() || null,
    };
    setBusy(true);
    try {
      const r = item ? await api.patch<ItemSaveResult>(`/api/items/${item.id}`, payload) : await api.post<ItemSaveResult>('/api/items', payload);
      refreshInventory();
      toast.show(r.warnings.length ? `${r.item.name}을(를) 저장했어요. ${r.warnings[0]}` : `${r.item.name}을(를) 저장했어요.`);
      onSaved?.(r);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const title = item ? '품목 수정' : '품목 추가';
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form="inv-item-form" variant="primary" loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form id="inv-item-form" ref={formRef} onSubmit={submit} noValidate aria-label={title} style={{ display: 'grid', gap: 12 }}>
        {formError ? (
          <div className="form-error" role="alert">
            <Icon name="alert" size="md" />
            {formError}
          </div>
        ) : null}
        <Field label="품목 이름" required error={errors.name}>
          <TextInput value={form.name} onChange={set('name')} maxLength={80} autoComplete="off" />
        </Field>
        {dupName ? (
          <p className="form-note" role="status">
            <Icon name="alert" size="md" />
            같은 이름의 품목({dupName})이 이미 있어요. 같은 물건이면 기존 품목을 써 주세요. 그래도 저장할 수는 있어요.
          </p>
        ) : null}
        <Row>
          <Field label="분류" required error={errors.category} help="예: 소모품, 재료, 약품">
            <TextInput value={form.category} onChange={set('category')} maxLength={30} list={listId} autoComplete="off" />
          </Field>
          <Field label="단위" required error={errors.unit} help="예: 박스, 팩, 개">
            <TextInput value={form.unit} onChange={set('unit')} maxLength={10} autoComplete="off" />
          </Field>
        </Row>
        <datalist id={listId}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Row>
          <Field label="적정 재고" required error={errors.par} help="이보다 적으면 '부족', 1.2배까지는 '곧 부족'으로 보여요.">
            <NumberInput value={form.par} onChange={set('par')} min={0} step="any" />
          </Field>
          <Field label="기본 거래처" error={errors.vendorId}>
            <Select value={form.vendorId} onChange={set('vendorId')}>
              <option value="">(선택 안 함)</option>
              {(vendors.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
        </Row>
        <Checkbox label="유효기간 관리" hint="켜면 입고할 때 유효기간을 받고, 임박·만료를 알려 드려요." checked={form.trackExpiry} onChange={(e) => setForm((f) => ({ ...f, trackExpiry: e.target.checked }))} />
        <Field label="보관 위치" error={errors.location}>
          <TextInput value={form.location} onChange={set('location')} maxLength={40} autoComplete="off" placeholder="예: 소모품실 A-1" />
        </Field>
        <Field label="메모" error={errors.memo}>
          <TextArea value={form.memo} onChange={set('memo')} maxLength={300} rows={2} />
        </Field>
      </form>
    </Dialog>
  );
}

/** 입력란 두 개를 넓은 화면에서 나란히, 좁은 화면에서는 위아래로 */
function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>{children}</div>;
}

/** 쪽 넘기기(이전·다음). 전체가 한 쪽이면 그리지 않는다 */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const info = useMemo(() => `${formatNumber(total)}건 중 ${formatNumber((page - 1) * pageSize + 1)}~${formatNumber(Math.min(total, page * pageSize))}`, [page, pageSize, total]);
  if (total <= pageSize) return null;
  return (
    <nav aria-label="쪽 넘기기" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', padding: '10px var(--pad)', flexWrap: 'wrap' }}>
      <span className="muted num" style={{ fontSize: 13 }}>
        {info}
      </span>
      <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>
        이전
      </Button>
      <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= last}>
        다음
      </Button>
    </nav>
  );
}

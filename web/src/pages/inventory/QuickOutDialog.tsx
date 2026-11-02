// 이 파일이 하는 일: "출고 기록" 빠른 입력 대화상자(FR-051 AC1, frontend.md §4 빠른 입력). 품목 찾기 → 수량 입력 → 저장의 2단계다.
// 대시보드(phase-03-task-10)와 재고 화면이 함께 쓴다: import { QuickOutDialog } from '../pages/inventory/QuickOutDialog.tsx'
// 대시보드 버튼 → 품목 누르기 → 저장, 세 번 누르면 끝난다(NFR-009). 수량 0 이하는 저장하지 않고, 재고보다 많으면 확인을 받은 뒤에만 저장한다.
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Field, NumberInput, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useToast } from '../../components/Toast.tsx';
import { ApiError } from '../../lib/api.ts';
import type { ItemRow, MoveResult } from '../../../../shared/schemas/inventory.ts';
import { ItemPicker, messageOf, OverStockConfirm, qty, refreshInventory, saveMove, StatusChip, toNum } from './inventory-ui.tsx';

interface QuickOutDialogProps {
  open: boolean;
  onClose: () => void;
  /** 미리 고른 품목(있으면 바로 수량 단계) */
  item?: ItemRow | null;
  /** 저장한 뒤 부른다 */
  onSaved?: (r: MoveResult) => void;
}

/** 출고 빠른 입력. 열 때마다 품목 찾기부터 새로 시작한다 */
export function QuickOutDialog(props: QuickOutDialogProps) {
  return props.open ? <QuickOutBody {...props} /> : null;
}

function QuickOutBody({ onClose, item: preset = null, onSaved }: QuickOutDialogProps) {
  const toast = useToast();
  const [item, setItem] = useState<ItemRow | null>(preset);
  const [amount, setAmount] = useState('1');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const send = async (force: boolean) => {
    if (!item) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await saveMove({ itemId: item.id, type: 'out', qty: toNum(amount) ?? 0, reason: memo.trim() || null, ...(force ? { force: true } : {}) });
      if (r === 'confirm') {
        setConfirm(true);
        return;
      }
      refreshInventory();
      setConfirm(false);
      toast.show(`${r.item.name} ${qty(r.move.qty, r.item.unit)} 출고를 기록했어요. 남은 재고 ${qty(r.item.stock, r.item.unit)}`);
      onSaved?.(r);
      onClose();
    } catch (err) {
      setConfirm(false);
      if (err instanceof ApiError && err.fields?.qty) setError(err.fields.qty);
      setFormError(messageOf(err, '출고를 기록하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = toNum(amount);
    if (n === null || n <= 0) {
      setError('수량은 0보다 크게 적어 주세요.');
      formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
      return;
    }
    setError(null);
    await send(false);
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title="출고 기록"
        footer={
          item ? (
            <>
              <Button onClick={onClose}>취소</Button>
              <Button type="submit" form="inv-quick-out" variant="primary" loading={busy}>
                저장
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>취소</Button>
          )
        }
      >
        {item ? (
          <form id="inv-quick-out" ref={formRef} onSubmit={submit} noValidate aria-label="출고 수량" style={{ display: 'grid', gap: 12 }}>
            {formError ? (
              <div className="form-error" role="alert">
                <Icon name="alert" size="md" />
                {formError}
              </div>
            ) : null}
            <div className="form-note" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                <b>{item.name}</b> · 현재 <b className="num">{qty(item.stock, item.unit)}</b>
              </span>
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <StatusChip row={item} />
                {preset ? null : (
                  <Button size="sm" variant="ghost" onClick={() => setItem(null)}>
                    다른 품목
                  </Button>
                )}
              </span>
            </div>
            <Field label={`출고 수량(${item.unit})`} required error={error}>
              <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} min={0} step="any" autoFocus onFocus={(e) => e.target.select()} />
            </Field>
            <Field label="메모" help="선택: 어디에 썼는지 적어 두면 나중에 찾기 쉬워요.">
              <TextInput value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} autoComplete="off" />
            </Field>
          </form>
        ) : (
          <ItemPicker
            autoFocus
            label="출고할 품목 찾기"
            onPick={(r) => {
              setItem(r);
              setAmount('1');
              setError(null);
            }}
          />
        )}
      </Dialog>
      <OverStockConfirm open={confirm} item={item} amount={toNum(amount) ?? 0} onClose={() => setConfirm(false)} onConfirm={() => send(true)} />
    </>
  );
}

export default QuickOutDialog;

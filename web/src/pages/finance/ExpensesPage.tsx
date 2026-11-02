// 이 파일이 하는 일: "지출 기록" 화면(/finance/expenses, FR-110, 원장·실장 전용). 달을 골라 그 달 지출 합계·건수와 목록(날짜·분류·거래처·금액·결제 수단·메모·영수증)을 본다.
// "지출 기록"으로 새 지출을 적고(영수증 PDF·사진 첨부), 줄을 누르면 고치거나 지운다. 분류는 "분류 편집"에서 더하고 이름·순서·사용 여부를 바꾼다.
// 발주 입고에서 "지출로도 기록"한 줄은 "발주 입고" 칩이 붙는다. CSV로 내려받으면 엑셀에서 한글이 깨지지 않는다(UTF-8 BOM).
// 매출·환자와 연결되는 입력란은 없다(FR-110 AC3). 메모는 AI로 보내지 않는다.
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip, Kpi, KpiRow } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { ConfirmDialog, Dialog } from '../../components/Dialog.tsx';
import { Checkbox, DateInput, Field, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { FileDrop } from '../../components/FileDrop.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState, ErrorState } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { monthLabel, shiftMonth } from '../../lib/ai.ts';
import { formatDate, formatNumber, formatWon } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { useApi } from '../../lib/useApi.ts';
import { PAY_METHOD_LABELS, PAY_METHODS, type ExpenseCategory, type ExpenseRow, type PayMethod } from '../../../../shared/schemas/finance.ts';
import type { VendorRow } from '../../../../shared/schemas/inventory.ts';
import { useVendors } from '../inventory/inventory-ui.tsx';
import {
  csvUrl,
  fetchCategories,
  fetchExpenses,
  FINANCE_KEY,
  parseAmount,
  RECEIPT_ACCEPT,
  RECEIPT_MAX_BYTES,
  refreshFinance,
  sizeText,
  uploadReceipt,
} from './financeLib.ts';
import './finance.css';

/** 오류에서 화면에 보일 문구 */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message || fallback : fallback;
}

/** 지출 기록 */
export default function ExpensesPage() {
  // null이면 서버의 이번 달(한국 날짜)
  const [month, setMonth] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [editing, setEditing] = useState<ExpenseRow | 'new' | null>(null);
  const [editCats, setEditCats] = useState(false);
  const list = useApi(`${FINANCE_KEY}:expenses:${month ?? 'now'}:${categoryId ?? 'all'}`, () => fetchExpenses(month, categoryId));
  const cats = useApi(`${FINANCE_KEY}:categories`, fetchCategories);
  const shown = list.data?.month ?? month;

  const top = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of list.data?.data ?? []) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  }, [list.data]);
  const withFile = list.data?.data.filter((e) => e.file).length ?? 0;

  const columns: Column<ExpenseRow>[] = [
    { key: 'date', header: '날짜', sortValue: (e) => e.date, render: (e) => <span className="num">{formatDate(`${e.date}T00:00:00+09:00`)}</span> },
    {
      key: 'category',
      header: '분류',
      sortValue: (e) => e.category,
      render: (e) => (
        <span className="fin-cat">
          {e.category}
          {e.stockMoveRef?.startsWith('order:') ? <Chip tone="info">발주 입고</Chip> : null}
        </span>
      ),
    },
    { key: 'vendorName', header: '거래처', sortValue: (e) => e.vendorName, render: (e) => e.vendorName ?? <span className="muted">—</span> },
    { key: 'amount', header: '금액', align: 'right', sortValue: (e) => e.amount, render: (e) => <b className="num">{formatWon(e.amount)}</b> },
    { key: 'payMethod', header: '결제 수단', render: (e) => PAY_METHOD_LABELS[e.payMethod] },
    { key: 'memo', header: '메모', render: (e) => (e.memo ? <span className="fin-memo">{e.memo}</span> : <span className="muted">—</span>) },
    { key: 'file', header: '영수증', render: (e) => (e.file ? <Chip tone="ok">첨부</Chip> : <span className="muted">없음</span>) },
  ];

  return (
    <>
      <PageHeader
        title="지출 기록"
        summary="병원 운영 지출을 분류별로 적어 둬요. 메모와 영수증은 AI로 보내지 않아요."
        actions={
          <>
            {shown ? (
              <span className="fin-month-nav" role="group" aria-label="달 고르기">
                <Button size="sm" onClick={() => setMonth(shiftMonth(shown, -1))}>
                  이전 달
                </Button>
                <b className="num" aria-live="polite">
                  {monthLabel(shown)}
                </b>
                <Button size="sm" onClick={() => setMonth(shiftMonth(shown, 1))}>
                  다음 달
                </Button>
              </span>
            ) : null}
            <Button icon="list" onClick={() => setEditCats(true)}>
              분류 편집
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
              지출 기록
            </Button>
          </>
        }
      />
      <div className="fin-kpis">
        <KpiRow label="이 달 지출 요약">
          <Kpi label={shown ? `${monthLabel(shown)} 지출 합계` : '지출 합계'} value={list.data ? formatNumber(list.data.sum) : null} unit="원" hint={list.data ? `${formatNumber(list.data.total)}건` : undefined} />
          <Kpi label="가장 큰 분류" value={top ? top[0] : null} hint={top ? formatWon(top[1]) : '이 달 지출이 없어요'} />
          <Kpi label="영수증 첨부" value={list.data ? formatNumber(withFile) : null} unit="건" hint={list.data ? `전체 ${formatNumber(list.data.total)}건 중` : undefined} />
          <Kpi label="월간 요약" value="보기" to="/finance/monthly" hint="분류 비중·추이 그래프" />
        </KpiRow>
      </div>
      <Card>
        <Toolbar label="지출 목록 도구">
          <Field label="분류" className="fin-filter">
            <Select value={categoryId ? String(categoryId) : ''} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">모든 분류</option>
              {(cats.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? '' : ' (사용 안 함)'}
                </option>
              ))}
            </Select>
          </Field>
          <span className="grow" />
          {shown ? (
            <a className="btn sm" href={csvUrl(shown, categoryId)} download>
              <Icon name="doc" size="sm" />
              CSV 내려받기
            </a>
          ) : null}
        </Toolbar>
        <DataTable<ExpenseRow>
          caption="지출 목록"
          columns={columns}
          rows={list.data?.data}
          rowKey={(e) => e.id}
          rowLabel={(e) => `${e.date} ${e.category} ${formatWon(e.amount)}`}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(e) => setEditing(e)}
          empty={
            categoryId ? (
              <EmptyState icon="search" title="이 분류의 지출이 없어요" description="다른 분류나 다른 달을 골라 보세요." />
            ) : (
              <EmptyState
                icon="won"
                title={`${shown ? monthLabel(shown) : '이 달'}에 기록한 지출이 없어요`}
                description="임대료·재료비·공과금처럼 병원에서 쓴 돈을 적어 두면 월간 요약에서 분류별로 모아 보여 줘요."
                action={
                  <Button icon="plus" onClick={() => setEditing('new')}>
                    첫 지출 기록
                  </Button>
                }
              />
            )
          }
        />
      </Card>
      {editing ? (
        <ExpenseDialog
          key={editing === 'new' ? 'new' : editing.id}
          expense={editing === 'new' ? null : editing}
          categories={cats.data ?? []}
          defaultDate={shown ? `${shown}-01` : ''}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editCats ? <CategoryDialog categories={cats.data} error={cats.error ?? null} onRetry={cats.reload} onClose={() => setEditCats(false)} /> : null}
    </>
  );
}

/** 지출 입력 칸 */
interface ExpenseForm {
  date: string;
  categoryId: string;
  vendorName: string;
  amount: string;
  payMethod: PayMethod;
  memo: string;
}

/** 지출 기록·고치기 대화상자(영수증 첨부·떼기, 지우기 포함) */
function ExpenseDialog({ expense, categories, defaultDate, onClose }: { expense: ExpenseRow | null; categories: ExpenseCategory[]; defaultDate: string; onClose: () => void }) {
  const toast = useToast();
  const { info } = useSession();
  const vendors = useVendors('active');
  const [form, setForm] = useState<ExpenseForm>({
    date: expense?.date ?? defaultDate,
    categoryId: expense ? String(expense.categoryId) : String(categories.find((c) => c.active)?.id ?? ''),
    vendorName: expense?.vendorName ?? '',
    amount: expense ? String(expense.amount) : '',
    payMethod: expense?.payMethod ?? 'card',
    memo: expense?.memo ?? '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [current, setCurrent] = useState(expense);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const set = (k: keyof ExpenseForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const focusError = () => setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
  // 사용 안 함 분류는 이미 그 분류인 지출을 고칠 때만 보인다
  const options = categories.filter((c) => c.active || String(c.id) === form.categoryId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.date) errs.date = '날짜를 골라 주세요.';
    if (!form.categoryId) errs.categoryId = '분류를 골라 주세요.';
    const amount = parseAmount(form.amount);
    if (amount === null) errs.amount = '금액을 1원 이상 숫자로 적어 주세요.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError('빨간 글씨로 표시한 칸을 고쳐 주세요.');
      focusError();
      return;
    }
    setBusy(true);
    setFormError(null);
    const body = { date: form.date, categoryId: Number(form.categoryId), vendorName: form.vendorName.trim() || null, amount, payMethod: form.payMethod, memo: form.memo.trim() || null };
    try {
      const saved = current ? await api.patch<ExpenseRow>(`/api/expenses/${current.id}`, body) : await api.post<ExpenseRow>('/api/expenses', body);
      setCurrent(saved);
      if (file) {
        try {
          await uploadReceipt(info?.csrfToken ?? null, saved.id, file);
        } catch (err) {
          refreshFinance();
          setFile(null);
          setFormError(`지출은 저장했지만 영수증을 올리지 못했어요. ${messageOf(err, '')}`.trim());
          return;
        }
      }
      refreshFinance();
      toast.show(current ? '지출을 고쳤어요.' : `${formatWon(saved.amount)} 지출을 기록했어요.`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);
        focusError();
      }
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async () => {
    if (!current) return;
    try {
      setCurrent(await api.del<ExpenseRow>(`/api/expenses/${current.id}/file`));
      refreshFinance();
      toast.show('영수증 첨부를 뗐어요.');
    } catch (err) {
      setFormError(messageOf(err, '영수증을 떼지 못했어요. 다시 시도해 주세요.'));
    }
  };

  const remove = async () => {
    if (!current) return;
    try {
      await api.del<void>(`/api/expenses/${current.id}`);
      refreshFinance();
      toast.show('지출을 지웠어요.');
      onClose();
    } catch (err) {
      setConfirmDelete(false);
      setFormError(messageOf(err, '지우지 못했어요. 다시 시도해 주세요.'));
    }
  };

  const title = current ? '지출 고치기' : '지출 기록';
  return (
    <>
      <Dialog
        open={!confirmDelete}
        onClose={onClose}
        title={title}
        footer={
          <>
            {current ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                지우기
              </Button>
            ) : null}
            <span style={{ flex: 1 }} />
            <Button onClick={onClose}>취소</Button>
            <Button type="submit" form="fin-expense-form" variant="primary" loading={busy}>
              저장
            </Button>
          </>
        }
      >
        <form id="fin-expense-form" ref={formRef} onSubmit={submit} noValidate aria-label={title} className="fin-form">
          {formError ? (
            <div className="form-error" role="alert">
              <Icon name="alert" size="md" />
              {formError}
            </div>
          ) : null}
          {current?.stockMoveRef?.startsWith('order:') ? <p className="muted">발주 입고 때 함께 기록한 지출이에요.</p> : null}
          <div className="fin-form-row">
            <Field label="날짜" required error={errors.date}>
              <DateInput value={form.date} onChange={set('date')} />
            </Field>
            <Field label="분류" required error={errors.categoryId}>
              <Select value={form.categoryId} onChange={set('categoryId')}>
                <option value="">분류 고르기</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="fin-form-row">
            <Field label="금액(원)" required error={errors.amount}>
              <TextInput value={form.amount} onChange={set('amount')} inputMode="numeric" autoComplete="off" placeholder="예: 120000" />
            </Field>
            <Field label="결제 수단" error={errors.payMethod}>
              <Select value={form.payMethod} onChange={set('payMethod')}>
                {PAY_METHODS.map((p) => (
                  <option key={p} value={p}>
                    {PAY_METHOD_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="거래처" error={errors.vendorName} help="등록한 거래처 이름과 같으면 거래처에 연결돼요. 비워 둬도 돼요.">
            <TextInput value={form.vendorName} onChange={set('vendorName')} maxLength={60} autoComplete="off" list="fin-vendor-list" />
          </Field>
          <datalist id="fin-vendor-list">
            {(vendors.data ?? []).map((v: VendorRow) => (
              <option key={v.id} value={v.name} />
            ))}
          </datalist>
          <Field label="메모" error={errors.memo} help="환자 이름·연락처는 적지 말아 주세요.">
            <TextArea value={form.memo} onChange={set('memo')} maxLength={300} rows={2} />
          </Field>
          <div className="field">
            <span className="fin-label">영수증</span>
            {current?.file && !file ? (
              <div className="fin-file">
                <Icon name="doc" size="sm" />
                <a href={`/api/files/${current.file.id}`} download={current.file.name}>
                  {current.file.name}
                </a>
                <span className="muted num">{sizeText(current.file.size)}</span>
                <IconButton icon="close" label="영수증 첨부 떼기" onClick={() => void removeFile()} />
              </div>
            ) : null}
            {file ? (
              <div className="fin-file">
                <Icon name="doc" size="sm" />
                <span>{file.name}</span>
                <span className="muted num">{sizeText(file.size)} · 저장하면 올라가요</span>
                <IconButton icon="close" label="고른 영수증 빼기" onClick={() => setFile(null)} />
              </div>
            ) : (
              <FileDrop label={current?.file ? '바꿀 영수증을 끌어다 놓거나 눌러서 고르세요' : '영수증(PDF·JPG·PNG)을 끌어다 놓거나 눌러서 고르세요'} accept={RECEIPT_ACCEPT} maxBytes={RECEIPT_MAX_BYTES} shrinkPhotos onFiles={(fs) => setFile(fs[0] ?? null)} />
            )}
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="이 지출을 지울까요?"
        message={current ? `${current.date} ${current.category} ${formatWon(current.amount)} 지출을 지워요. 월간 요약에서도 빠져요.` : ''}
        confirmLabel="지우기"
        danger
      />
    </>
  );
}

/** 분류 편집 줄 */
interface CatLine {
  key: string;
  id?: number;
  name: string;
  active: boolean;
  used: number;
  code: string | null;
}

/** 지출 분류 편집 대화상자: 이름·순서·사용 여부 바꾸기, 새 분류 더하기, 안 쓴 분류 빼기 */
function CategoryDialog({ categories, error, onRetry, onClose }: { categories: ExpenseCategory[] | undefined; error: Error | null; onRetry: () => void; onClose: () => void }) {
  const toast = useToast();
  const [lines, setLines] = useState<CatLine[]>(() => (categories ?? []).map((c) => ({ key: `c${c.id}`, id: c.id, name: c.name, active: c.active, used: c.used, code: c.code })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const update = (i: number, patch: Partial<CatLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) =>
    setLines((ls) => {
      const j = i + d;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j] as CatLine, next[i] as CatLine];
      return next;
    });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const seen = new Set<string>();
    lines.forEach((l, i) => {
      const n = l.name.trim();
      if (!n) errs[`categories.${i}.name`] = '분류 이름을 적어 주세요.';
      else if (seen.has(n.toLowerCase())) errs[`categories.${i}.name`] = '같은 이름의 분류가 두 번 있어요.';
      seen.add(n.toLowerCase());
    });
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError('빨간 글씨로 표시한 칸을 고쳐 주세요.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.put<ExpenseCategory[]>('/api/expense-categories', { categories: lines.map((l) => ({ ...(l.id ? { id: l.id } : {}), name: l.name.trim(), active: l.active })) });
      refreshFinance();
      toast.show('지출 분류를 저장했어요.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="지출 분류 편집"
      footer={
        <>
          <Button
            icon="plus"
            onClick={() => {
              seq.current += 1;
              setLines((ls) => [...ls, { key: `n${seq.current}`, name: '', active: true, used: 0, code: null }]);
            }}
          >
            분류 더하기
          </Button>
          <span style={{ flex: 1 }} />
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" form="fin-cat-form" variant="primary" loading={busy} disabled={!categories}>
            저장
          </Button>
        </>
      }
    >
      {error && !categories ? (
        <ErrorState message={error.message} onRetry={onRetry} />
      ) : (
        <form id="fin-cat-form" onSubmit={submit} noValidate aria-label="지출 분류 편집" className="fin-form">
          <p className="muted">순서대로 목록에 보여요. 지출에 쓴 분류는 지우지 말고 "사용"을 끄면 새 지출에서 빠져요.</p>
          {formError ? (
            <div className="form-error" role="alert">
              <Icon name="alert" size="md" />
              {formError}
            </div>
          ) : null}
          <ol className="fin-cat-list">
            {lines.map((l, i) => (
              <li key={l.key}>
                <Field label={`${i + 1}번 분류 이름`} error={errors[`categories.${i}.name`]} help={l.code === 'material' ? '발주 입고 지출의 기본 분류예요.' : l.used ? `지출 ${l.used}건에 쓰였어요.` : undefined}>
                  <TextInput value={l.name} onChange={(e) => update(i, { name: e.target.value })} maxLength={20} autoComplete="off" />
                </Field>
                <Checkbox label="사용" checked={l.active} onChange={(e) => update(i, { active: e.target.checked })} />
                <span className="fin-cat-tools">
                  <IconButton icon="chev" label={`${l.name || '새 분류'} 위로`} className="fin-up" onClick={() => move(i, -1)} disabled={i === 0} />
                  <IconButton icon="chev" label={`${l.name || '새 분류'} 아래로`} className="fin-down" onClick={() => move(i, 1)} disabled={i === lines.length - 1} />
                  {!l.id || (!l.used && l.code !== 'material') ? (
                    <IconButton icon="close" label={`${l.name || '새 분류'} 빼기`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </form>
      )}
    </Dialog>
  );
}

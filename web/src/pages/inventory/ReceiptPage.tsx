// 이 파일이 하는 일: "명세서 사진으로 입고" 화면(/inventory/receipt, FR-122). 순서: 사진 고르기(브라우저가 긴 변 1600px로 줄임) → 경고 확인 체크 →
// "AI로 읽기"(POST /api/ai/receipt, multipart) → 읽은 표 확인·수정(줄마다 비슷한 기존 품목 후보를 미리 고름) → "입고 저장"(POST /api/inventory/receipt-commit).
// 실장 이상은 "지출로도 기록"을 고를 수 있다(직원에게는 보이지 않음). 이미지 미지원 모델·기능 꺼짐·예산 초과면 처음부터 비활성 안내를 보여 준다.
// AI가 읽은 글의 개인정보(카드번호 등)는 서버가 가린 채 보내 주고, 이 화면은 가렸다는 안내를 띄운다. 순수 계산은 receiptLib.ts에 있다.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { Checkbox, DateInput, Field, NumberInput, Select, TextInput } from '../../components/Field.tsx';
import { FileDrop } from '../../components/FileDrop.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiError, toApiError } from '../../lib/api.ts';
import { aiErrorHelp } from '../../lib/ai.ts';
import { formatWon } from '../../lib/format.ts';
import { formatBytes } from '../../lib/image.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { can } from '../../../../shared/roles.ts';
import { CSRF_HEADER } from '../../../../shared/schemas/auth.ts';
import { PAY_METHOD_LABELS, PAY_METHODS, type PayMethod } from '../../../../shared/schemas/finance.ts';
import type { ItemRow } from '../../../../shared/schemas/inventory.ts';
import { INV_KEY, messageOf, refreshInventory, useVendors } from './inventory-ui.tsx';
import {
  buildCommitBody,
  canSend,
  imageInfoText,
  initialLines,
  lineAmount,
  linesTotal,
  maskedNotice,
  RECEIPT_ACCEPT,
  RECEIPT_MAX_BYTES,
  RECEIPT_PICK_MAX_BYTES,
  type LineState,
  type ReceiptCommitResult,
  type ReceiptReadResult,
  type ReceiptStatus,
} from './receiptLib.ts';
import './receipt.css';

/** 사진을 multipart로 올려 AI로 읽는다(확인 체크 값 포함). 서버 오류 문구는 ApiError로 던진다 */
async function readPhoto(csrfToken: string | null, file: File): Promise<ReceiptReadResult> {
  const fd = new FormData();
  fd.set('confirmed', 'true');
  fd.set('file', file, file.name);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  let res: Response;
  try {
    res = await fetch('/api/ai/receipt', { method: 'POST', credentials: 'same-origin', headers, body: fd });
  } catch {
    throw toApiError(0, { error: { code: 'NETWORK', message: '서버에 연결할 수 없어요. 원내 와이파이에 연결되어 있는지 확인해 주세요.' } });
  }
  const body = (await res.json().catch(() => null)) as { data?: ReceiptReadResult } | null;
  if (!res.ok || !body?.data) throw toApiError(res.status, body);
  return body.data;
}

/** 고른 사진(줄인 뒤)의 가로·세로. 읽을 수 없으면 null */
async function photoSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const b = await createImageBitmap(file);
    const s = { width: b.width, height: b.height };
    b.close();
    return s;
  } catch {
    return null;
  }
}

/** 고른 사진 정보 */
interface Picked {
  file: File;
  size: { width: number; height: number } | null;
  url: string;
}

/** 사용할 수 없을 때 안내(이미지 미지원 모델·기능 꺼짐·예산 초과) */
function OffNotice({ status, isAdmin }: { status: ReceiptStatus; isAdmin: boolean }) {
  const help =
    status.state === 'no_image_model'
      ? isAdmin
        ? 'AI 설정의 모델 표에서 "사진 읽기"가 되는 모델을 표준 등급에 두면 켜져요.'
        : '원장님(관리자)께 사진을 읽을 수 있는 AI 모델 설정을 요청해 주세요.'
      : aiErrorHelp(status.state === 'budget' ? 'AI_BUDGET_EXCEEDED' : 'AI_DISABLED', isAdmin);
  return (
    <Card padded>
      <div className="rc-off" role="status" data-testid="receipt-off">
        <Icon name="lock" size="lg" />
        <div>
          <b>사진으로 입고 기능을 지금은 쓸 수 없어요</b>
          <p>{status.message}</p>
          {help ? <p className="muted">{help}</p> : null}
          <div className="rc-actions start">
            {isAdmin ? (
              <Button to="/admin/ai" icon="gear">
                AI 설정으로 가기
              </Button>
            ) : null}
            <Button to="/inventory/moves" variant="ghost" icon="list">
              입출고 직접 기록하기
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** 명세서 사진으로 입고 */
export default function ReceiptPage() {
  const { info } = useSession();
  const role = info?.user?.role;
  const isAdmin = role === 'admin';
  const canExpense = can(role, 'receipt.expense');
  const canNewItem = can(role, 'items.manage');
  const toast = useToast();
  const status = useApi<ReceiptStatus>(`${INV_KEY}:receipt-status`, () => api.get('/api/inventory/receipt-status'));
  const items = useApi<{ data: ItemRow[]; total: number }>(`${INV_KEY}:receipt-items`, () => api.page<ItemRow>('/api/items?active=active&sort=name&pageSize=200'));
  const vendors = useVendors('active');

  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ReceiptReadResult | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [vendorChoice, setVendorChoice] = useState('');
  const [date, setDate] = useState('');
  const [alsoExpense, setAlsoExpense] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('transfer');
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ReceiptCommitResult | null>(null);

  // 미리 보기 주소는 사진을 바꾸거나 화면을 떠나면 놓아준다
  useEffect(() => () => (picked ? URL.revokeObjectURL(picked.url) : undefined), [picked]);

  const ready = status.data?.state === 'ready';
  const sendable = canSend({ hasFile: !!picked, confirmed, ready, busy: reading });

  const onFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setReadError(null);
    if (f.size > RECEIPT_MAX_BYTES) {
      setPicked(null);
      setPickError('줄인 뒤에도 사진이 8MB보다 커요. 다른 사진으로 올려 주세요.');
      return;
    }
    setPickError(null);
    setPicked({ file: f, size: await photoSize(f), url: URL.createObjectURL(f) });
  };

  const read = async () => {
    if (!picked || !sendable) return;
    setReading(true);
    setReadError(null);
    try {
      const r = await readPhoto(info?.csrfToken ?? null, picked.file);
      setResult(r);
      setLines(initialLines(r));
      setVendorChoice(r.vendorCandidates[0] && r.vendorCandidates[0].score >= 0.5 ? String(r.vendorCandidates[0].vendorId) : '');
      setDate(r.draft.date && /^\d{4}-\d{2}-\d{2}$/.test(r.draft.date) ? r.draft.date : '');
      setFields({});
      setFormError(null);
      setSaved(null);
      invalidate('ai:');
    } catch (e) {
      setReadError(e instanceof ApiError ? e : new ApiError(0, 'AI_UNAVAILABLE', messageOf(e, '사진을 읽지 못했어요. 다시 시도해 주세요.')));
    } finally {
      setReading(false);
    }
  };

  /** 처음부터 다시(다른 사진) */
  const reset = () => {
    setResult(null);
    setLines([]);
    setPicked(null);
    setConfirmed(false);
    setReadError(null);
    setFields({});
    setFormError(null);
    setAlsoExpense(false);
  };

  const setLine = (i: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!result) return;
    const built = buildCommitBody({
      fileId: result.fileId,
      vendorId: vendorChoice ? Number(vendorChoice) : null,
      vendorName: vendorChoice ? null : result.draft.vendorName,
      date,
      lines,
      alsoExpense: canExpense && alsoExpense ? { payMethod } : null,
    });
    setFields(built.errors);
    setFormError(built.formError);
    if (!built.body) return;
    setSaving(true);
    try {
      const r = await api.post<ReceiptCommitResult>('/api/inventory/receipt-commit', built.body);
      refreshInventory();
      if (r.expense) invalidate('finance');
      setSaved(r);
      setResult(null);
      setLines([]);
      setPicked(null);
      setConfirmed(false);
      toast.show(r.expense ? `입고 ${r.moves}줄과 지출 ${formatWon(r.expense.amount)}을 저장했어요.` : `입고 ${r.moves}줄을 저장했어요.`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setFormError(messageOf(err, '저장하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setSaving(false);
    }
  };

  const total = useMemo(() => linesTotal(lines), [lines]);
  const notice = result ? maskedNotice(result.ai.privacy.outputFindings) : null;
  const itemList = items.data?.data ?? [];
  const vendorList = vendors.data ?? [];

  const header = (
    <PageHeader
      title="명세서 사진으로 입고"
      summary="거래명세서·영수증 사진을 올리면 AI가 거래처·품목·수량·단가를 읽어 입고 초안을 만들어요. 확인·수정한 뒤 저장해야 기록돼요."
    />
  );

  if (status.error && !status.data) {
    return (
      <>
        {header}
        <Card padded>
          <ErrorState message={status.error.message} onRetry={status.reload} />
        </Card>
      </>
    );
  }
  if (!status.data) {
    return (
      <>
        {header}
        <Card padded>
          <Skeleton rows={4} />
        </Card>
      </>
    );
  }
  if (!ready) {
    return (
      <>
        {header}
        <OffNotice status={status.data} isAdmin={isAdmin} />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="rc-stack">
        {saved ? (
          <Card padded>
            <div className="rc-done" role="status" data-testid="receipt-saved">
              <Icon name="check" size="lg" />
              <div>
                <b>입고를 저장했어요</b>
                <p>
                  입고 {saved.moves}줄{saved.createdItems ? `(새 품목 ${saved.createdItems}개 등록)` : ''}
                  {saved.expense ? `, 지출 ${formatWon(saved.expense.amount)}(${saved.expense.category}, 영수증 사진 첨부)` : ''}을 기록했어요.
                </p>
                <div className="rc-actions start">
                  <Button to="/inventory" icon="box">
                    재고 현황 보기
                  </Button>
                  {saved.expense ? (
                    <Button to="/finance/expenses" variant="ghost" icon="won">
                      지출 기록 보기
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {!result ? (
          <Card title="1. 사진 올리기" sub={status.data.demo ? <Chip tone="info">데모 모드: 예시 명세서 결과가 나와요</Chip> : undefined}>
            <div className="rc-pad">
              <div className="rc-warn" role="note" data-testid="receipt-warning">
                <Icon name="alert" size="md" />
                <span>환자 정보·카드번호가 보이면 가리고 올리세요. 사진은 AI가 읽도록 보내지고, 영수증으로 보관돼요.</span>
              </div>
              <div className="rc-pick">
                <FileDrop
                  label={picked ? '다른 사진으로 바꾸기' : '명세서 사진을 끌어다 놓거나 눌러서 고르세요'}
                  accept={RECEIPT_ACCEPT}
                  maxBytes={RECEIPT_PICK_MAX_BYTES}
                  shrinkPhotos
                  onFiles={(f) => void onFiles(f)}
                />
                {picked ? (
                  <figure className="rc-preview">
                    <img src={picked.url} alt="고른 명세서 사진 미리 보기" />
                    <figcaption className="muted num" data-testid="receipt-picked">
                      보낼 사진: {picked.size ? `${picked.size.width}×${picked.size.height}px · ` : ''}
                      {formatBytes(picked.file.size)}
                    </figcaption>
                  </figure>
                ) : null}
              </div>
              <p className="rc-hint">큰 사진은 보내기 전에 이 기기에서 긴 변 1600px로 줄여요. 줄인 사진은 8MB 이하여야 해요.</p>
              {pickError ? (
                <p className="form-error" role="alert">
                  <Icon name="alert" size="sm" />
                  {pickError}
                </p>
              ) : null}
              <Checkbox
                label="사진에 환자 정보·카드번호가 보이지 않는 것을 확인했어요"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {readError ? (
                <div className="form-error" role="alert">
                  <Icon name="alert" size="sm" />
                  <span>
                    {readError.message} {aiErrorHelp(readError.code, isAdmin) ?? ''}
                  </span>
                </div>
              ) : null}
              <div className="rc-actions">
                <Button variant="primary" icon="spark" loading={reading} disabled={!sendable} onClick={() => void read()}>
                  AI로 읽기
                </Button>
              </div>
              {!confirmed && picked ? <p className="rc-hint end">위 확인 칸에 체크해야 보낼 수 있어요.</p> : null}
            </div>
          </Card>
        ) : (
          <form onSubmit={save} noValidate aria-label="읽은 명세서 확인">
            <Card
              title="2. 읽은 내용 확인·수정"
              sub={
                <span className="rc-sub">
                  {result.ai.demo ? <Chip tone="ghost">데모 응답</Chip> : null}
                  <span className="muted num">보낸 사진 {imageInfoText(result.image)}</span>
                </span>
              }
            >
              <div className="rc-pad">
                {notice ? (
                  <div className="rc-mask" role="status" data-testid="receipt-privacy-notice">
                    <Icon name="shield" size="md" />
                    <span>{notice}</span>
                  </div>
                ) : null}
                <p className="rc-hint">AI가 읽은 값은 틀릴 수 있어요. 사진과 비교해 품목·수량·단가를 확인한 뒤 저장해 주세요. 저장하기 전에는 아무것도 기록되지 않아요.</p>
                {formError ? (
                  <div className="form-error" role="alert">
                    <Icon name="alert" size="sm" />
                    {formError}
                  </div>
                ) : null}
                <div className="rc-head">
                  <Field label="거래처" help={result.draft.vendorName ? `읽은 이름: ${result.draft.vendorName}` : '읽지 못했어요.'} error={fields.vendorId}>
                    <Select value={vendorChoice} onChange={(e) => setVendorChoice(e.target.value)}>
                      <option value="">{result.draft.vendorName ? `등록 안 된 거래처(${result.draft.vendorName})` : '거래처 없음'}</option>
                      {result.vendorCandidates.length ? (
                        <optgroup label="비슷한 거래처">
                          {result.vendorCandidates.map((v) => (
                            <option key={`c${v.vendorId}`} value={String(v.vendorId)}>
                              {v.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      <optgroup label="모든 거래처">
                        {vendorList.map((v) => (
                          <option key={v.id} value={String(v.id)}>
                            {v.name}
                          </option>
                        ))}
                      </optgroup>
                    </Select>
                  </Field>
                  <Field label="명세서 날짜" error={fields.date}>
                    <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
                  </Field>
                </div>

                <ol className="rc-lines" aria-label="읽은 품목 줄">
                  {lines.map((l, i) => {
                    const cands = result.candidates[i] ?? [];
                    const amount = lineAmount(l);
                    const skip = l.choice === 'skip';
                    return (
                      <li key={i} className={['rc-line', skip && 'skip'].filter(Boolean).join(' ')} data-testid={`receipt-line-${i}`}>
                        <div className="rc-line-top">
                          <span className="rc-read">
                            <small className="muted">읽은 품목 {i + 1}</small>
                            <b>{l.readName || '(이름 없음)'}</b>
                          </span>
                          {cands.length ? (
                            <span className="rc-cands" aria-label="비슷한 품목 후보">
                              {cands.map((c) => (
                                <Chip key={c.itemId} tone={String(c.itemId) === l.choice ? 'ok' : 'ghost'}>
                                  {c.name} {Math.round(c.score * 100)}%
                                </Chip>
                              ))}
                            </span>
                          ) : (
                            <Chip tone="warn">비슷한 품목 없음</Chip>
                          )}
                        </div>
                        <div className="rc-grid">
                          <Field label="연결할 품목" error={fields[`lines.${i}.itemId`]} className="rc-item">
                            <Select value={l.choice} onChange={(e) => setLine(i, { choice: e.target.value })}>
                              <option value="">품목을 골라 주세요</option>
                              {cands.length ? (
                                <optgroup label="비슷한 품목">
                                  {cands.map((c) => (
                                    <option key={`c${c.itemId}`} value={String(c.itemId)}>
                                      {c.name} ({c.unit})
                                    </option>
                                  ))}
                                </optgroup>
                              ) : null}
                              <optgroup label="모든 품목">
                                {itemList.map((it) => (
                                  <option key={it.id} value={String(it.id)}>
                                    {it.name} ({it.unit})
                                  </option>
                                ))}
                              </optgroup>
                              <optgroup label="그 밖에">
                                {canNewItem ? <option value="new">새 품목으로 등록</option> : null}
                                <option value="skip">이 줄은 입고하지 않음</option>
                              </optgroup>
                            </Select>
                          </Field>
                          {!skip ? (
                            <>
                              <Field label="수량" error={fields[`lines.${i}.qty`]}>
                                <NumberInput value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} min={0} step="any" />
                              </Field>
                              <Field label="단가(원)" error={fields[`lines.${i}.unitPrice`]} help={amount !== null ? `금액 ${formatWon(amount)}` : '비우면 단가 없이 기록해요.'}>
                                <NumberInput value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} min={0} step="any" />
                              </Field>
                              <Field label="유효기간" error={fields[`lines.${i}.expiryOn`]}>
                                <DateInput value={l.expiryOn} onChange={(e) => setLine(i, { expiryOn: e.target.value })} />
                              </Field>
                              <Field label="로트 번호" error={fields[`lines.${i}.lot`]}>
                                <TextInput value={l.lot} onChange={(e) => setLine(i, { lot: e.target.value })} maxLength={40} autoComplete="off" />
                              </Field>
                            </>
                          ) : null}
                        </div>
                        {l.choice === 'new' ? (
                          <div className="rc-grid rc-new">
                            <Field label="새 품목 이름" error={fields[`lines.${i}.newItem.name`]}>
                              <TextInput value={l.newName} onChange={(e) => setLine(i, { newName: e.target.value })} maxLength={80} />
                            </Field>
                            <Field label="분류" error={fields[`lines.${i}.newItem.category`]}>
                              <TextInput value={l.newCategory} onChange={(e) => setLine(i, { newCategory: e.target.value })} maxLength={30} />
                            </Field>
                            <Field label="단위" error={fields[`lines.${i}.newItem.unit`]}>
                              <TextInput value={l.newUnit} onChange={(e) => setLine(i, { newUnit: e.target.value })} maxLength={10} />
                            </Field>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>

                <div className="rc-total" aria-label="합계">
                  <span>
                    입고 합계 <b className="num" data-testid="receipt-total">{formatWon(total)}</b>
                  </span>
                  {typeof result.draft.total === 'number' ? (
                    <span className={['num', result.draft.total !== total && 'rc-diff'].filter(Boolean).join(' ')}>
                      명세서 합계 {formatWon(result.draft.total)}
                      {result.draft.total !== total ? ' — 금액이 달라요. 수량·단가를 확인해 주세요.' : ''}
                    </span>
                  ) : null}
                </div>

                {canExpense ? (
                  <fieldset className="rc-expense">
                    <legend>
                      <b>지출</b>
                    </legend>
                    <Checkbox
                      label="지출로도 기록"
                      hint={`입고 합계 ${formatWon(total)}을 재료비 지출 1건으로 남기고, 이 사진을 영수증으로 붙여요.`}
                      checked={alsoExpense}
                      onChange={(e) => setAlsoExpense(e.target.checked)}
                    />
                    {alsoExpense ? (
                      <Field label="결제 수단" error={fields['alsoExpense.payMethod'] ?? fields.alsoExpense ?? fields['alsoExpense.categoryId']}>
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

                <div className="rc-actions">
                  <Button variant="ghost" onClick={reset} disabled={saving}>
                    다른 사진 올리기
                  </Button>
                  <Button type="submit" variant="primary" icon="check" loading={saving}>
                    입고 저장
                  </Button>
                </div>
                <p className="rc-hint end">
                  저장하면 <Link to="/inventory/moves">입출고 기록</Link>에 "명세서 사진 입고"로 남아요.
                </p>
              </div>
            </Card>
          </form>
        )}
      </div>
    </>
  );
}

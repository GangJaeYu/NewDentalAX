// 이 파일이 하는 일: "발주서 인쇄" 인쇄 전용 화면(/print/order/:id, FR-054 AC2·FR-063). 셸(메뉴·상단바) 없이 A4 한 장 모양으로 열고,
// 위쪽 "인쇄하기"·"닫기" 버튼은 인쇄되지 않는다(.no-print). 종이에는 병원 정보(이름·대표번호·위치), 발주 번호·날짜, 거래처 정보,
// 품목 표(번호·품목·분류·수량·단위·단가·금액), 합계, 메모, 담당 확인 줄이 들어간다.
// 쪽마다 머리말(왼쪽 병원명, 오른쪽 발주 번호)은 @page 규칙을 CSSOM(adoptedStyleSheets)으로 붙이고(보안 정책상 인라인 style 요소 금지), 쪽 번호는 styles/print.css가 넣는다.
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { ApiError } from '../../lib/api.ts';
import { formatDate, formatNumber, formatWon } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { ORDER_STATUS_LABELS, type OrderDetail } from '../../../../shared/schemas/orders.ts';
import { fetchOrder, ORDER_KEY, orderPrintHeaderCss } from '../inventory/ordersLib.ts';
import '../inventory/orders.css';
import { PrintFrame } from './PrintStub.tsx';

/** 쪽마다 들어갈 머리말을 문서에 붙이고, 화면을 떠나면 뗀다(불러오는 중이면 붙이지 않는다) */
function usePrintHeader(clinic: string | null, poNo: string | null): void {
  useEffect(() => {
    if (!clinic || !poNo || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(orderPrintHeaderCss(clinic, poNo));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    };
  }, [clinic, poNo]);
}

/** 수량 글자(소수 둘째 자리까지) */
function qtyText(n: number): string {
  return formatNumber(n, 2);
}

/** 발주서 인쇄 */
export default function PrintOrderPage() {
  const params = useParams();
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id > 0;
  const state = useApi<OrderDetail>(valid ? `${ORDER_KEY}:print:${id}` : null, () => fetchOrder(id));
  const d = state.data;
  usePrintHeader(d?.clinic.name ?? null, d?.poNo ?? null);

  if (!valid || (state.error instanceof ApiError && state.error.status === 404)) {
    return (
      <PrintFrame title="발주서 인쇄">
        <div className="paper">
          <EmptyState icon="cart" title="찾는 발주서가 없어요" description="지워졌거나 주소가 바뀌었을 수 있어요." action={<Button to="/inventory/orders">발주서 목록으로</Button>} />
        </div>
      </PrintFrame>
    );
  }
  if (state.error && !d) {
    return (
      <PrintFrame title="발주서 인쇄">
        <ErrorState message={state.error.message} onRetry={state.reload} />
      </PrintFrame>
    );
  }
  if (!d) {
    return (
      <PrintFrame title="발주서 인쇄">
        <Skeleton rows={8} label="발주서 불러오는 중" />
      </PrintFrame>
    );
  }

  const date = d.orderedAt ?? d.createdAt;
  const v = d.vendorInfo;
  return (
    <PrintFrame title={`발주서 인쇄 — ${d.poNo}`}>
      <article className="paper po-paper" aria-label="발주서 미리보기" data-testid="print-order">
        <div className="docno num">
          <span>{d.clinic.name}</span>
          <span>
            발주 번호 {d.poNo} · {formatDate(date)}
          </span>
        </div>
        <h2 className="doctitle">발주서</h2>
        {d.status === 'draft' || d.status === 'canceled' ? <p className="po-mark">{d.status === 'draft' ? '작성 중(발주 전) 초안이에요.' : '취소한 발주서예요.'}</p> : null}
        <div className="po-parties">
          <section aria-label="받는 곳">
            <h3>받는 곳(거래처)</h3>
            <dl>
              <dt>상호</dt>
              <dd>{v?.name ?? '거래처 미정'}</dd>
              <dt>담당자</dt>
              <dd>{v?.contactName ?? '—'}</dd>
              <dt>연락처</dt>
              <dd className="num">{v?.phone ?? '—'}</dd>
              <dt>이메일</dt>
              <dd>{v?.email ?? '—'}</dd>
            </dl>
          </section>
          <section aria-label="보내는 곳">
            <h3>보내는 곳(병원)</h3>
            <dl>
              <dt>병원</dt>
              <dd>{d.clinic.name}</dd>
              <dt>대표번호</dt>
              <dd className="num">{d.clinic.phone ?? '—'}</dd>
              <dt>위치</dt>
              <dd>{d.clinic.location ?? '—'}</dd>
              <dt>상태</dt>
              <dd>
                {ORDER_STATUS_LABELS[d.status]} · {formatDate(date)}
              </dd>
            </dl>
          </section>
        </div>
        <p className="po-lead">아래와 같이 주문합니다.</p>
        <div className="tablewrap" role="region" aria-label="발주 품목 표" tabIndex={0}>
          <table className="po-table">
            <caption className="sr-only">발주 품목 {d.lineCount}개</caption>
            <thead>
              <tr>
                <th scope="col">번호</th>
                <th scope="col">품목</th>
                <th scope="col">분류</th>
                <th scope="col">수량</th>
                <th scope="col">단위</th>
                <th scope="col">단가(원)</th>
                <th scope="col">금액(원)</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="n num">{i + 1}</td>
                  <td>{l.itemName}</td>
                  <td>{l.category}</td>
                  <td className="r num">{qtyText(l.qty)}</td>
                  <td className="c">{l.unit}</td>
                  <td className="r num">{l.unitPrice === null ? '—' : formatNumber(l.unitPrice)}</td>
                  <td className="r num">{l.amount === null ? '—' : formatNumber(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  합계
                </th>
                <td className="r num">{qtyText(d.totalQty)}</td>
                <td />
                <td />
                <td className="r num">
                  <b>{formatWon(d.total)}</b>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {d.missingPrice ? <p className="po-small">단가가 비어 있는 품목은 합계에서 빠졌어요. 거래처 견적으로 확인해 주세요.</p> : null}
        {d.note ? (
          <p className="po-small">
            <b>요청 사항</b> {d.note}
          </p>
        ) : null}
        <p className="sign">
          {d.clinic.name} 담당 ______________ (서명)
        </p>
      </article>
    </PrintFrame>
  );
}

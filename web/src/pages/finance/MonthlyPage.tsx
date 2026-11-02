// 이 파일이 하는 일: "월간 요약" 화면(/finance/monthly, FR-111, 원장·실장 전용). 달을 골라 지출 합계·건수, 전월·전년 같은 달 대비,
// 분류별 비중(도넛 + 표), 거래처별 상위 5곳, 최근 12개월 재료비 추이(막대 그래프)를 본다. 지출이 없는 달은 빈 상태 안내를 보인다.
// "AI 이번 달 요약"을 누르면 서버가 집계 숫자(합계·분류별·거래처별 합계 등)만 AI로 보내 변동 원인 후보와 절약 제안을 받는다(FR-111 AC2).
// 개별 지출의 메모·영수증은 보내지 않고, 보낸 숫자는 "보낸 숫자 보기"에서 확인할 수 있다. 관리자가 기능을 끄면 안내만 보인다.
import { useState } from 'react';
import { AI_DISCLAIMER } from '../../components/AiPanel.tsx';
import { Button } from '../../components/Button.tsx';
import { Card, CardGrid, PageHeader } from '../../components/Card.tsx';
import { BarChart, DonutChart } from '../../components/Charts.tsx';
import { Chip, Kpi, KpiRow } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { ApiError } from '../../lib/api.ts';
import { aiErrorHelp, costText, fetchAiStatus, monthLabel, shiftMonth } from '../../lib/ai.ts';
import { formatNumber, formatPercent, formatWon } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate, useApi } from '../../lib/useApi.ts';
import type { MonthlyAiResult, MonthlySummary } from '../../../../shared/schemas/finance.ts';
import { compareText, fetchMonthly, FINANCE_KEY, runMonthlySummary, shortMonth } from './financeLib.ts';
import '../../components/AiPanel.css';
import './finance.css';

type CatRow = MonthlySummary['byCategory'][number];
type VendorRow = MonthlySummary['topVendors'][number];

/** 월간 요약 */
export default function MonthlyPage() {
  // null이면 서버의 이번 달(한국 날짜)
  const [month, setMonth] = useState<string | null>(null);
  const state = useApi(`${FINANCE_KEY}:monthly:${month ?? 'now'}`, () => fetchMonthly(month));
  const s = state.data;

  return (
    <>
      <PageHeader
        title="월간 요약"
        summary={s ? `${monthLabel(s.month)} 지출을 분류·거래처별로 모아 봐요.` : '달마다 지출을 분류·거래처별로 모아 봐요.'}
        actions={
          <>
            {s ? (
              <span className="fin-month-nav" role="group" aria-label="달 고르기">
                <Button size="sm" onClick={() => setMonth(shiftMonth(s.month, -1))}>
                  이전 달
                </Button>
                <b className="num" aria-live="polite">
                  {monthLabel(s.month)}
                </b>
                <Button size="sm" onClick={() => setMonth(shiftMonth(s.month, 1))}>
                  다음 달
                </Button>
              </span>
            ) : null}
            <Button to="/finance/expenses" icon="won">
              지출 기록
            </Button>
          </>
        }
      />
      {state.error && !s ? <ErrorState message={state.error.message} onRetry={state.reload} /> : !s ? <Skeleton rows={6} label="월간 요약 불러오는 중" /> : <MonthlyBody key={s.month} s={s} />}
    </>
  );
}

/** 한 달 요약 본문 */
function MonthlyBody({ s }: { s: MonthlySummary }) {
  if (s.count === 0) {
    return (
      <Card title="지출 요약" id="fin-empty">
        <EmptyState
          icon="won"
          title={`${monthLabel(s.month)}에는 지출 기록이 없어요`}
          description="지출을 기록하면 합계·분류별 비중·거래처별 상위·재료비 추이를 여기서 볼 수 있어요."
          action={
            <Button to="/finance/expenses" icon="plus" size="sm">
              지출 기록하러 가기
            </Button>
          }
        />
      </Card>
    );
  }
  const prev = compareText(s.prevMonth, '지난달');
  const year = compareText(s.prevYear, '전년 같은 달');
  const material = s.materialTrend12.at(-1)?.amount ?? 0;

  const catCols: Column<CatRow>[] = [
    { key: 'name', header: '분류', render: (c) => <b>{c.name}</b>, sortValue: (c) => c.name },
    { key: 'amount', header: '합계', align: 'right', render: (c) => formatWon(c.amount), sortValue: (c) => c.amount },
    { key: 'ratio', header: '비중', align: 'right', render: (c) => formatPercent(c.ratio, 1), sortValue: (c) => c.ratio },
    { key: 'count', header: '건수', align: 'right', render: (c) => `${formatNumber(c.count)}건`, sortValue: (c) => c.count },
  ];
  const vendorCols: Column<VendorRow>[] = [
    {
      key: 'name',
      header: '거래처',
      render: (v) => (
        <span className="fin-rank">
          <span className="muted num">{s.topVendors.indexOf(v) + 1}위</span> <b>{v.name}</b>
        </span>
      ),
    },
    { key: 'amount', header: '합계', align: 'right', render: (v) => formatWon(v.amount) },
    { key: 'count', header: '건수', align: 'right', render: (v) => `${formatNumber(v.count)}건` },
  ];

  return (
    <>
      <div className="fin-kpis">
        <KpiRow label="이 달 지출 요약 숫자">
          <Kpi label={`${monthLabel(s.month)} 지출 합계`} value={formatNumber(s.total)} unit="원" hint={`${formatNumber(s.count)}건`} />
          <Kpi label="지난달 대비" value={s.prevMonth.diffRatio === null ? null : `${s.prevMonth.diff > 0 ? '+' : ''}${formatNumber(s.prevMonth.diff)}`} unit="원" hint={prev.text} tone={prev.tone === 'up' ? 'warn' : undefined} />
          <Kpi label="전년 같은 달 대비" value={s.prevYear.diffRatio === null ? null : `${s.prevYear.diff > 0 ? '+' : ''}${formatNumber(s.prevYear.diff)}`} unit="원" hint={year.text} tone={year.tone === 'up' ? 'warn' : undefined} />
          <Kpi label="이 달 재료비" value={formatNumber(material)} unit="원" hint={s.total ? `합계의 ${formatPercent(material / s.total)}` : undefined} />
        </KpiRow>
      </div>
      <CardGrid label="월간 요약 상세">
        <Card title="분류별 비중" id="fin-cat" span={2} sub={`${s.byCategory.length}개 분류`}>
          <div className="fin-split">
            <DonutChart label="분류별 지출 비중" data={s.byCategory.map((c) => ({ label: c.name, value: c.amount }))} />
            <DataTable caption="분류별 지출" columns={catCols} rows={s.byCategory} rowKey={(c) => c.categoryId} empty={<EmptyState title="분류별 지출이 없어요" />} />
          </div>
        </Card>
        <Card title="거래처별 상위" id="fin-vendor" sub="거래처를 적은 지출만">
          <DataTable
            caption="거래처별 지출 상위 5곳"
            columns={vendorCols}
            rows={s.topVendors}
            rowKey={(v) => v.name}
            empty={<EmptyState icon="cart" title="거래처를 적은 지출이 없어요" description="지출을 기록할 때 거래처를 적으면 여기에 모여요." />}
          />
        </Card>
        <Card title="재료비 추이" id="fin-trend" span={2} sub="최근 12개월" className="fin-trend">
          <BarChart label="최근 12개월 재료비" unit="원" data={s.materialTrend12.map((t) => ({ label: shortMonth(t.month), value: t.amount }))} />
          <p className="muted fin-note">
            {monthLabel(s.materialTrend12[0]?.month ?? s.month)} ~ {monthLabel(s.month)} · 가장 많은 달 {formatWon(Math.max(...s.materialTrend12.map((t) => t.amount)))}
          </p>
        </Card>
        <Card title="AI 이번 달 요약" id="fin-ai">
          <MonthlyAi month={s.month} />
        </Card>
      </CardGrid>
    </>
  );
}

/** AI 월간 요약: 버튼 → 결과 글(데모 표시·비용·개인정보 안내·참고용 고지), 오류는 쉬운 문구 + 다음에 할 일 */
function MonthlyAi({ month }: { month: string }) {
  const status = useApi('ai:status', fetchAiStatus);
  const { info } = useSession();
  const isAdmin = info?.user?.role === 'admin';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MonthlyAiResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const feat = status.data?.features.find((f) => f.id === 'monthly_summary');

  if (feat && !feat.allowed) {
    return (
      <div className="ai-panel">
        <div className="ai-off" role="status">
          <Icon name="lock" size="md" />
          <span>관리자가 이 AI 기능을 꺼 두었습니다. {aiErrorHelp('AI_DISABLED', isAdmin)}</span>
        </div>
      </div>
    );
  }

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await runMonthlySummary(month));
      invalidate('ai:status');
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? { code: err.code, message: err.message } : { code: 'ERROR', message: 'AI 요약을 받지 못했어요. 다시 시도해 주세요.' });
    } finally {
      setBusy(false);
    }
  };
  const help = error ? aiErrorHelp(error.code, isAdmin) : null;

  return (
    <div className="fin-ai">
      <p className="muted">합계·분류별·거래처별 합계 같은 집계 숫자만 AI로 보내요. 지출 메모와 영수증은 보내지 않아요.</p>
      <div>
        <Button variant="primary" icon="spark" loading={busy} onClick={() => void run()}>
          {result ? '다시 요약' : 'AI 이번 달 요약'}
        </Button>
      </div>
      {error ? (
        <div className="form-error" role="alert">
          <Icon name="alert" size="md" />
          <span>
            {error.message} {help}
          </span>
        </div>
      ) : null}
      {result ? (
        <div className="fin-ai-result" data-testid="monthly-ai-result">
          <div className="fin-ai-meta">
            {result.demo ? <Chip tone="ghost">데모 응답</Chip> : <Chip tone="ok">AI 응답</Chip>}
            <span className="muted num">{costText(result.costKrw, result.demo)}</span>
          </div>
          <p className="fin-ai-text" tabIndex={0} aria-label="AI 요약 결과">
            {result.text}
          </p>
          {result.privacyNotice ? <p className="muted">{result.privacyNotice}</p> : null}
          <details className="fin-sent">
            <summary>보낸 숫자 보기({Object.keys(result.sent).length}개)</summary>
            <ul>
              {Object.entries(result.sent).map(([k, v]) => (
                <li key={k}>
                  <span>{k}</span> <b className="num">{formatNumber(v, 1)}</b>
                </li>
              ))}
            </ul>
          </details>
          <p className="muted fin-note">{AI_DISCLAIMER}</p>
        </div>
      ) : null}
    </div>
  );
}

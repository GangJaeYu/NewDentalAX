// 이 파일이 하는 일: "AI 사용량·비용" 화면(/admin/ai-usage, 원장·관리자 전용, FR-034 AC3·FR-035 AC1).
// 달을 골라 이번 달 비용·예산 대비 %·호출 수 요약, 예산 막대(경고 비율 넘으면 주의 안내), 기능별·사용자별·일별 사용량, 최근 기록 50건을 보여 준다.
// 기록이 없으면 빈 상태(안내 + AI 설정으로 가는 버튼)를 보인다. 서버 API: GET /api/ai/usage?month=YYYY-MM(backend.md §3.10).
import { useState } from 'react';
import { AI_PROVIDER_LABELS, type AiProvider } from '../../../../shared/ai-features.ts';
import { PII_LABELS, type PiiType } from '../../../../shared/privacy-rules.ts';
import { Button } from '../../components/Button.tsx';
import { Card, CardGrid, PageHeader } from '../../components/Card.tsx';
import { BarChart } from '../../components/Charts.tsx';
import { Chip, Kpi, KpiRow, Progress } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { api } from '../../lib/api.ts';
import { budgetTone, featureLabel, formatSmallWon, monthLabel, shiftMonth, type AiUsageReport } from '../../lib/ai.ts';
import { formatDateTime, formatNumber, formatWon } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import '../../components/AiPanel.css';

type Row<K extends keyof AiUsageReport> = AiUsageReport[K] extends Array<infer R> ? R : never;

/** 공급자 이름(demo 포함) */
function providerName(p: string): string {
  return (AI_PROVIDER_LABELS as Record<string, string | undefined>)[p as AiProvider] ?? p;
}

/** 개인정보 처리 요약("전화번호 1건") */
function privacyText(p: Record<string, number> | null): string {
  if (!p) return '-';
  return Object.entries(p)
    .map(([t, n]) => `${PII_LABELS[t as PiiType] ?? t} ${n}건`)
    .join(', ');
}

/** 상태 칩 */
function StatusChip({ status, demo }: { status: string; demo: boolean }) {
  if (status === 'ok') return demo ? <Chip tone="ghost">데모</Chip> : <Chip tone="ok">성공</Chip>;
  if (status === 'blocked') return <Chip tone="warn">막힘</Chip>;
  return <Chip tone="danger">실패</Chip>;
}

/** 한 달 사용량 본문 */
function UsageBody({ r }: { r: AiUsageReport }) {
  const tone = budgetTone(r.pct, r.warnPct);
  const errors = r.byFeature.reduce((s, f) => s + f.errors, 0);
  const left = Math.max(0, r.budgetKrw - r.monthKrw);

  const featureCols: Column<Row<'byFeature'>>[] = [
    { key: 'feature', header: '기능', render: (f) => <b>{featureLabel(f.feature)}</b>, sortValue: (f) => featureLabel(f.feature) },
    { key: 'calls', header: '호출', align: 'right', render: (f) => `${formatNumber(f.calls)}회`, sortValue: (f) => f.calls },
    { key: 'errors', header: '실패·막힘', align: 'right', render: (f) => `${formatNumber(f.errors)}회`, sortValue: (f) => f.errors },
    { key: 'inputTokens', header: '입력 토큰', align: 'right', render: (f) => formatNumber(f.inputTokens), sortValue: (f) => f.inputTokens },
    { key: 'outputTokens', header: '출력 토큰', align: 'right', render: (f) => formatNumber(f.outputTokens), sortValue: (f) => f.outputTokens },
    { key: 'costKrw', header: '비용', align: 'right', render: (f) => formatSmallWon(f.costKrw), sortValue: (f) => f.costKrw },
  ];
  const userCols: Column<Row<'byUser'>>[] = [
    { key: 'name', header: '사용자', render: (u) => <b>{u.name ?? '(지워진 사용자)'}</b>, sortValue: (u) => u.name },
    { key: 'calls', header: '호출', align: 'right', render: (u) => `${formatNumber(u.calls)}회`, sortValue: (u) => u.calls },
    { key: 'costKrw', header: '비용', align: 'right', render: (u) => formatSmallWon(u.costKrw), sortValue: (u) => u.costKrw },
  ];
  const dayCols: Column<Row<'byDay'>>[] = [
    { key: 'date', header: '날짜', sortValue: (d) => d.date },
    { key: 'calls', header: '호출', align: 'right', render: (d) => `${formatNumber(d.calls)}회`, sortValue: (d) => d.calls },
    { key: 'costKrw', header: '비용', align: 'right', render: (d) => formatSmallWon(d.costKrw), sortValue: (d) => d.costKrw },
  ];
  const recentCols: Column<Row<'recent'>>[] = [
    { key: 'at', header: '시각', render: (x) => formatDateTime(x.at) },
    { key: 'userName', header: '사용자', render: (x) => x.userName ?? '-' },
    { key: 'feature', header: '기능', render: (x) => featureLabel(x.feature) },
    { key: 'provider', header: '공급자·모델', render: (x) => (x.model ? `${providerName(x.provider)} · ${x.model}` : providerName(x.provider)) },
    { key: 'tokens', header: '입력/출력 토큰', align: 'right', render: (x) => `${formatNumber(x.inputTokens)} / ${formatNumber(x.outputTokens)}` },
    { key: 'costKrw', header: '비용', align: 'right', render: (x) => `${formatSmallWon(x.costKrw)}${x.estimated ? '(추정)' : ''}` },
    { key: 'status', header: '결과', render: (x) => <StatusChip status={x.status} demo={x.demo} /> },
    { key: 'privacy', header: '가린 개인정보', render: (x) => privacyText(x.privacy) },
  ];

  return (
    <>
      <KpiRow label="AI 사용 요약">
        <Kpi label={`${monthLabel(r.month)} 비용`} value={formatNumber(Math.round(r.monthKrw))} unit="원" hint={`${formatNumber(r.calls)}회 호출`} />
        <Kpi label="예산 대비" value={formatNumber(r.pct, 1)} unit="%" tone={tone} hint={tone === 'danger' ? '예산을 모두 썼어요' : tone === 'warn' ? `경고 비율 ${r.warnPct}% 넘음` : `경고 비율 ${r.warnPct}%`} />
        <Kpi label="월 예산" value={formatNumber(r.budgetKrw)} unit="원" to="/admin/ai" hint="AI 설정에서 바꿔요" />
        <Kpi label="남은 예산" value={formatNumber(Math.round(left))} unit="원" />
        <Kpi label="호출 수" value={formatNumber(r.calls)} unit="회" />
        <Kpi label="실패·막힘" value={formatNumber(errors)} unit="회" tone={errors > 0 ? 'warn' : undefined} />
      </KpiRow>

      <Card title="예산 사용" id="usage-budget" padded>
        <div className="usage-meter">
          <div className="row num">
            <span>{monthLabel(r.month)} 사용</span>
            <span>
              {formatWon(r.monthKrw)} / {formatWon(r.budgetKrw)} ({formatNumber(r.pct, 1)}%)
            </span>
          </div>
          <Progress value={r.budgetKrw > 0 ? r.monthKrw / r.budgetKrw : r.monthKrw > 0 ? 1 : 0} label="예산 사용 비율" />
          {tone !== 'ok' ? (
            <div className="pii" role="status">
              <span>
                {tone === 'danger'
                  ? '이번 달 AI 예산을 모두 사용해 새 AI 요청이 막혀요. AI 설정에서 월 예산을 올리면 바로 다시 쓸 수 있어요.'
                  : `이번 달 예산의 ${r.warnPct}%를 넘었어요. 예산을 모두 쓰면 AI 요청이 막혀요.`}
              </span>
            </div>
          ) : null}
        </div>
      </Card>

      {r.calls === 0 ? (
        <Card title="사용 기록" id="usage-empty">
          <EmptyState
            icon="spark"
            title={`${monthLabel(r.month)} AI 사용 기록이 없어요`}
            description="AI 기능을 쓰면 기능별·사용자별·일별 사용량과 비용이 여기에 모여요."
            action={
              <Button to="/admin/ai" icon="gear" size="sm">
                AI 설정 보기
              </Button>
            }
          />
        </Card>
      ) : (
        <CardGrid label="사용량 상세">
          <Card title="기능별 사용량" id="usage-feature" span={2} sub={`${r.byFeature.length}개 기능`}>
            <DataTable caption="기능별 사용량" columns={featureCols} rows={r.byFeature} rowKey={(f) => f.feature} empty={<EmptyState title="기능별 기록이 없어요" />} />
          </Card>
          <Card title="사용자별" id="usage-user" sub={`${r.byUser.length}명`}>
            <DataTable caption="사용자별 사용량" columns={userCols} rows={r.byUser} rowKey={(u) => String(u.userId)} empty={<EmptyState title="사용자별 기록이 없어요" />} />
          </Card>
          <Card title="일별 비용" id="usage-day" span={2}>
            <BarChart label="일별 비용" unit="원" data={r.byDay.map((d) => ({ label: d.date.slice(5).replace('-', '/'), value: Math.round(d.costKrw * 10) / 10 }))} />
          </Card>
          <Card title="일별 호출" id="usage-day-table">
            <DataTable caption="일별 사용량" columns={dayCols} rows={r.byDay} rowKey={(d) => d.date} empty={<EmptyState title="일별 기록이 없어요" />} />
          </Card>
          <Card title="최근 기록" id="usage-recent" span="full" sub="최근 50건 · 요청 원문은 저장하지 않아요">
            <DataTable caption="최근 AI 사용 기록" columns={recentCols} rows={r.recent} rowKey={(x) => x.id} empty={<EmptyState title="최근 기록이 없어요" />} />
          </Card>
        </CardGrid>
      )}
    </>
  );
}

/** AI 사용량·비용 */
export default function AiUsagePage() {
  // null이면 서버의 이번 달(한국 시간)
  const [month, setMonth] = useState<string | null>(null);
  const usage = useApi(`ai:usage:${month ?? 'now'}`, () => api.get<AiUsageReport>(month ? `/api/ai/usage?month=${month}` : '/api/ai/usage'));
  const r = usage.data;

  return (
    <>
      <PageHeader
        title="AI 사용량·비용"
        summary={r ? `${monthLabel(r.month)} · 비용은 공급자 단가와 환율로 계산한 추정치예요` : 'AI 호출 비용과 사용량을 달마다 보여 줘요.'}
        actions={
          <>
            {r ? (
              <span className="month-nav" role="group" aria-label="달 고르기">
                <Button size="sm" onClick={() => setMonth(shiftMonth(r.month, -1))}>
                  이전 달
                </Button>
                <b className="num" aria-live="polite">
                  {monthLabel(r.month)}
                </b>
                <Button size="sm" onClick={() => setMonth(shiftMonth(r.month, 1))}>
                  다음 달
                </Button>
              </span>
            ) : null}
            <Button to="/admin/ai" icon="gear">
              AI 설정
            </Button>
          </>
        }
      />
      {usage.error && !r ? <ErrorState message={usage.error.message} onRetry={usage.reload} /> : !r ? <Skeleton rows={6} /> : <UsageBody r={r} />}
    </>
  );
}

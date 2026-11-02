// 이 파일이 하는 일: "근무표 인쇄" 인쇄 전용 화면(/print/roster?from&to, FR-081 AC3·FR-063). 셸 없이 A4 가로 모양으로 열고, "인쇄하기"·"닫기" 버튼은 인쇄되지 않는다.
// 종이에는 병원 이름·기간, 직원 × 날짜 표(근무 유형 이름, 승인된 휴가는 "연차"처럼 표시), 맨 아래 날짜별 근무 인원, 근무 유형 시간 안내, 확인 줄이 들어간다.
// 쪽마다 머리말(왼쪽 병원명, 오른쪽 "근무표 기간")과 A4 가로 설정은 @page 규칙을 CSSOM(adoptedStyleSheets)으로 붙인다(보안 정책상 인라인 style 요소 금지, 03-02·03-06과 같은 방식).
// from·to를 주지 않으면 서버 기준 이번 주를 인쇄한다. 모든 역할이 열 수 있다(근무표 조회와 같은 권한).
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorState, Skeleton } from '../../components/States.tsx';
import { api } from '../../lib/api.ts';
import { useApi } from '../../lib/useApi.ts';
import { JOB_TYPE_LABELS } from '../../../../shared/enums.ts';
import { isRealDate } from '../../../../shared/schemas/leave.ts';
import { rosterPeriodLabel, weekdayKo, type RosterView } from '../../../../shared/schemas/roster.ts';
import type { ClinicSettings } from '../../../../shared/schemas/admin.ts';
import { ROSTER_KEY, cellParts, rosterPrintCss, shiftTitle, shortDate } from '../hr/rosterLib.ts';
import '../hr/roster.css';
import { PrintFrame } from './PrintStub.tsx';

/** 머리말을 문서에 붙이고, 화면을 떠나면 뗀다 */
function usePrintHeader(clinic: string | null, period: string | null): void {
  useEffect(() => {
    if (!clinic || !period || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(rosterPrintCss(clinic, period));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    };
  }, [clinic, period]);
}

/** 근무표 인쇄 */
export default function PrintRosterPage() {
  const [params] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const valid = !!from && !!to && isRealDate(from) && isRealDate(to);
  const query = valid ? `?from=${from}&to=${to}` : '';
  const state = useApi<RosterView>(`${ROSTER_KEY}:print:${query}`, () => api.get(`/api/roster${query}`));
  const clinic = useApi<ClinicSettings>('print:roster:clinic', () => api.get('/api/settings/clinic'));
  const v = state.data;
  const clinicName = clinic.data?.name || '우리 병원';
  const period = v ? rosterPeriodLabel(v.from, v.to) : null;
  usePrintHeader(v ? clinicName : null, period);

  if (state.error && !v) {
    return (
      <PrintFrame title="근무표 인쇄">
        <ErrorState message={state.error.message} onRetry={state.reload} />
      </PrintFrame>
    );
  }
  if (!v) {
    return (
      <PrintFrame title="근무표 인쇄">
        <Skeleton rows={8} label="근무표 불러오는 중" />
      </PrintFrame>
    );
  }

  const types = new Map(v.shiftTypes.map((t) => [t.id, t]));
  return (
    <PrintFrame title={`근무표 인쇄 — ${period}`}>
      <article className="paper roster-paper" aria-label="근무표 미리보기" data-testid="print-roster">
        <div className="docno num">
          <span>{clinicName}</span>
          <span>{v.from.slice(0, 4)}년 근무표</span>
        </div>
        <h2 className="doctitle">근무표 ({period})</h2>
        {v.users.length === 0 ? (
          <p className="muted">근무표에 넣을 직원이 없어요.</p>
        ) : (
          <div className="tablewrap" role="region" aria-label="근무표 인쇄 표" tabIndex={0}>
            <table className={`roster-table${v.days.length > 7 ? ' month' : ''}`}>
              <caption className="sr-only">{period} 근무표</caption>
              <thead>
                <tr>
                  <th scope="col" className="who">
                    직원
                  </th>
                  {v.days.map((d) => (
                    <th key={d.date} scope="col" className={d.open ? undefined : 'closed'}>
                      <b className="num">{shortDate(d.date)}</b>
                      {weekdayKo(d.date)}
                      {d.open ? '' : ' 휴진'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {v.users.map((u) => (
                  <tr key={u.id}>
                    <th scope="row" className="who">
                      <b>{u.name}</b>
                      <small>{JOB_TYPE_LABELS[u.jobType] ?? '기타'}</small>
                    </th>
                    {v.days.map((d) => {
                      const p = cellParts(d.cells[String(u.id)], types);
                      return (
                        <td key={d.date} className={d.open ? undefined : 'closed'}>
                          {p.text || '-'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="who">
                    근무 인원
                  </th>
                  {v.days.map((d) => (
                    <td key={d.date} className={d.open ? undefined : 'closed'}>
                      {d.total}명
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="muted roster-print-legend">
          {v.shiftTypes
            .filter((t) => t.active)
            .map((t) => shiftTitle(t))
            .join(' · ')}
          {' · 연차·병가 등 승인된 휴가는 근무 인원에서 빠져요(반차는 포함).'}
        </p>
        <div className="sign">
          <span>작성: ____________</span>
          <span>확인(원장): ____________</span>
        </div>
      </article>
    </PrintFrame>
  );
}

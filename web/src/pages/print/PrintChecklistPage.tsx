// 이 파일이 하는 일: "체크리스트 인쇄" 인쇄 전용 화면(/print/checklist/:kind/:date, FR-041·063). 셸 없이 A4 모양으로 그날의 오픈·마감 체크리스트를 표로 보여 준다.
// 표에는 번호·항목·담당·확인(✓)·확인한 사람·시각이 들어가고, 아래에 완료 수와 확인 서명 줄을 둔다. 오늘 날짜면 인쇄 시점까지의 기록이다.
// 데이터는 GET /api/checklists/:kind?date= 를 그대로 쓴다(앞으로의 날짜·잘못된 주소는 안내만 보여 준다).
import { useParams } from 'react-router';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { api } from '../../lib/api.ts';
import { formatDateLong, formatDateTime } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { JOB_TYPE_LABELS } from '../../../../shared/enums.ts';
import { CHECKLIST_KIND_LABELS, type ChecklistDay, type ChecklistKind } from '../../../../shared/schemas/desk.ts';
import { PrintFrame } from './PrintStub.tsx';
import '../desk/checklist.css';

/** 체크리스트 인쇄 */
export default function PrintChecklistPage() {
  const { kind: kindParam, date: dateParam } = useParams();
  const kind: ChecklistKind | null = kindParam === 'open' || kindParam === 'close' ? kindParam : null;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  const valid = !!kind && !!date;
  const { info } = useSession();
  const state = useApi<ChecklistDay>(valid ? `desk:checklist-print:${kind}:${date}` : null, () => api.get(`/api/checklists/${kind}?date=${date}`));
  const label = kind ? CHECKLIST_KIND_LABELS[kind] : '';
  const title = kind ? `${label} 체크리스트 인쇄` : '체크리스트 인쇄';
  const day = state.data;

  return (
    <PrintFrame title={title}>
      <div className="paper">
        {!valid ? (
          <EmptyState icon="print" title="인쇄할 체크리스트를 찾을 수 없어요" description="주소가 잘못되었어요. 체크리스트 화면에서 다시 인쇄해 주세요." />
        ) : state.error && !day ? (
          <ErrorState message={state.error.message} onRetry={state.reload} />
        ) : !day ? (
          <Skeleton rows={8} label="인쇄할 내용 불러오는 중" />
        ) : (
          <>
            <div className="docno">
              <span>{info?.clinicName ?? '우리 병원'}</span>
              <span className="num">출력 {formatDateTime(new Date())}</span>
            </div>
            <h2 className="doctitle">
              {label} 체크리스트 — {formatDateLong(day.date)}
            </h2>
            {day.items.length === 0 ? (
              <EmptyState icon="check" title="이날 체크리스트 항목이 없어요" description="체크리스트 화면에서 항목을 먼저 만들어 주세요." />
            ) : (
              <div className="tablewrap">
              <table className="ck-print">
                <caption className="sr-only">
                  {label} 체크리스트 {day.date}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">번호</th>
                    <th scope="col">항목</th>
                    <th scope="col">담당</th>
                    <th scope="col">확인</th>
                    <th scope="col">확인한 사람</th>
                    <th scope="col">시각</th>
                  </tr>
                </thead>
                <tbody>
                  {day.items.map((it, i) => (
                    <tr key={it.id}>
                      <td className="n num">{i + 1}</td>
                      <td>{it.text}</td>
                      <td className="c">{it.roleHint ? JOB_TYPE_LABELS[it.roleHint] : '모두'}</td>
                      <td className="c" aria-label={it.checked ? '확인함' : '확인 안 함'}>
                        {it.checked ? '✓' : ''}
                      </td>
                      <td className="c">{it.checkedBy?.name ?? ''}</td>
                      <td className="c num">{it.checkedAt ? formatDateTime(it.checkedAt) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
            <p className="ck-print-sum num">
              {day.total}개 중 {day.done}개 완료{day.readOnly ? '' : ' (인쇄 시점 기준)'}
            </p>
            <p className="sign">확인자 ______________ (서명)</p>
          </>
        )}
      </div>
    </PrintFrame>
  );
}

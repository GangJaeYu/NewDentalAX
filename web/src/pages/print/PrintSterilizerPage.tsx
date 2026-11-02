// 이 파일이 하는 일: "멸균기 점검 기록 인쇄" 인쇄 전용 화면(/print/sterilizer?from&to&equipmentId, FR-102 AC3·FR-063). 셸 없이 A4 모양으로 연다.
// 고른 기간(없으면 지난 30일)·멸균기의 기록을 쪽 나눔 없이 모두 한 표에 넣는다(행은 쪽 경계에서 잘리지 않고 머리글은 쪽마다 반복, styles/print.css).
// 종이에는 병원 이름·기간·멸균기·기록 수·불합격 수, 기록 표(날짜·멸균기·검사·사이클·온도·압력·시간·판정·담당자·조치), 확인자 서명 줄이 들어간다. 환자 정보는 없다.
import { useSearchParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { api } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { cycleParamsText, STERILIZER_RESULT_LABELS, STERILIZER_TEST_LABELS, type SterilizerLogList } from '../../../../shared/schemas/equipment.ts';
import { isDateText, rangeQuery, STERILIZER_KEY } from '../facility/equipmentLib.ts';
import '../facility/equipment.css';
import { PrintFrame } from './PrintStub.tsx';

/** 멸균기 점검 기록 인쇄 */
export default function PrintSterilizerPage() {
  const { info } = useSession();
  const [params] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const eq = Number(params.get('equipmentId'));
  const q = isDateText(from) && isDateText(to) ? rangeQuery({ from, to, equipmentId: Number.isInteger(eq) && eq > 0 ? eq : null }) : '';
  const state = useApi<SterilizerLogList>(`${STERILIZER_KEY}:print:${q}`, () => api.get(`/api/sterilizer-logs${q}`));
  const d = state.data;
  const eqName = d?.equipmentId ? (d.sterilizers.find((s) => s.id === d.equipmentId)?.name ?? '멸균기') : '모든 멸균기';

  return (
    <PrintFrame title="멸균기 점검 기록 인쇄">
      <article className="paper eq-paper" aria-label="멸균기 점검 기록 미리보기" data-testid="print-sterilizer">
        {state.error && !d ? (
          <ErrorState message={state.error.message} onRetry={state.reload} />
        ) : !d ? (
          <Skeleton rows={8} label="인쇄할 기록 불러오는 중" />
        ) : (
          <>
            <div className="docno">
              <span>{info?.clinicName ?? '우리 병원'}</span>
              <span className="num">출력 {formatDateTime(new Date())}</span>
            </div>
            <h2 className="doctitle">멸균기 점검 기록</h2>
            <dl className="eq-print-meta">
              <dt>기간</dt>
              <dd className="num">
                {d.from} ~ {d.to}
              </dd>
              <dt>멸균기</dt>
              <dd>{eqName}</dd>
              <dt>기록 수</dt>
              <dd className="num">{d.items.length}건</dd>
              <dt>불합격</dt>
              <dd className="num">{d.items.filter((l) => l.result === 'fail').length}건</dd>
            </dl>
            {d.items.length === 0 ? (
              <EmptyState icon="cal" title="이 기간에 멸균 기록이 없어요" description="멸균기 점검 기록 화면에서 기간을 바꿔 다시 인쇄해 주세요." action={<Button to="/facility/sterilizer">기록 화면으로</Button>} />
            ) : (
              <div className="tablewrap" role="region" aria-label="멸균 기록 표(옆으로 넘겨 보기)" tabIndex={0}>
                <table className="eq-print" data-testid="print-sterilizer-table">
                  <caption className="sr-only">
                    멸균기 점검 기록 {d.from}부터 {d.to}까지 {d.items.length}건
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="c">
                        번호
                      </th>
                      <th scope="col">날짜</th>
                      <th scope="col">멸균기</th>
                      <th scope="col">검사</th>
                      <th scope="col">사이클</th>
                      <th scope="col">온도·압력·시간</th>
                      <th scope="col" className="c">
                        판정
                      </th>
                      <th scope="col">담당자</th>
                      <th scope="col">조치</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((l, i) => (
                      <tr key={l.id}>
                        <td className="c num">{i + 1}</td>
                        <td className="num">{l.date}</td>
                        <td>{l.equipmentName}</td>
                        <td>{STERILIZER_TEST_LABELS[l.testType]}</td>
                        <td className="num">{l.cycleNo ?? ''}</td>
                        <td className="num">{cycleParamsText(l)}</td>
                        <td className={`c${l.result === 'fail' ? ' fail' : ''}`}>{STERILIZER_RESULT_LABELS[l.result]}</td>
                        <td>{l.user?.name ?? ''}</td>
                        <td>{l.result === 'fail' ? (l.actionTaken ?? '조치 전') : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="sign">확인자 ______________ (서명)</p>
          </>
        )}
      </article>
    </PrintFrame>
  );
}

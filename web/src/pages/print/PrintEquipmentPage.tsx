// 이 파일이 하는 일: "장비 대장 인쇄" 인쇄 전용 화면(/print/equipment/:id, FR-101·FR-063). 셸 없이 A4 모양으로 연다.
// 종이에는 병원 이름, 장비 정보(이름·종류·설치일·업체·점검 주기·마지막·다음 점검일·메모), 연결된 법정 일정,
// 점검·수리 이력 전체 표(일자·구분·내용·비용·업체·기록한 사람·첨부 유무)와 수리비 합계, 확인자 서명 줄이 들어간다.
import { useParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { formatDateTime, formatWon } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { EQUIPMENT_KIND_LABELS, EQUIPMENT_LOG_KIND_LABELS, type EquipmentDetail } from '../../../../shared/schemas/equipment.ts';
import { EQUIPMENT_KEY, equipmentDueChip, wonText } from '../facility/equipmentLib.ts';
import '../facility/equipment.css';
import { PrintFrame } from './PrintStub.tsx';

/** 장비 대장 인쇄 */
export default function PrintEquipmentPage() {
  const { info } = useSession();
  const params = useParams();
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id > 0;
  const state = useApi<EquipmentDetail>(valid ? `${EQUIPMENT_KEY}:print:${id}` : null, () => api.get(`/api/equipment/${id}`));
  const d = state.data;

  if (!valid || (state.error instanceof ApiError && state.error.status === 404)) {
    return (
      <PrintFrame title="장비 대장 인쇄">
        <div className="paper">
          <EmptyState icon="tool" title="찾는 장비가 없어요" description="지워졌거나 주소가 바뀌었을 수 있어요." action={<Button to="/facility/equipment">장비 목록으로</Button>} />
        </div>
      </PrintFrame>
    );
  }
  if (state.error && !d) {
    return (
      <PrintFrame title="장비 대장 인쇄">
        <ErrorState message={state.error.message} onRetry={state.reload} />
      </PrintFrame>
    );
  }
  if (!d) {
    return (
      <PrintFrame title="장비 대장 인쇄">
        <Skeleton rows={8} label="장비 대장 불러오는 중" />
      </PrintFrame>
    );
  }

  const e = d.equipment;
  const chip = equipmentDueChip(e);
  return (
    <PrintFrame title={`장비 대장 인쇄 — ${e.name}`}>
      <article className="paper eq-paper" aria-label="장비 대장 미리보기" data-testid="print-equipment">
        <div className="docno">
          <span>{info?.clinicName ?? '우리 병원'}</span>
          <span className="num">출력 {formatDateTime(new Date())}</span>
        </div>
        <h2 className="doctitle">장비 대장 — {e.name}</h2>
        <dl className="eq-print-meta">
          <dt>종류</dt>
          <dd>{EQUIPMENT_KIND_LABELS[e.kind]}</dd>
          <dt>설치일</dt>
          <dd className="num">{e.installedOn ?? '—'}</dd>
          <dt>업체</dt>
          <dd>{e.vendorName ?? '—'}</dd>
          <dt>점검 주기</dt>
          <dd>{e.inspectCycleMonths ? `${e.inspectCycleMonths}개월마다` : '정기 점검 없음'}</dd>
          <dt>마지막 점검</dt>
          <dd className="num">{e.lastInspectionOn ?? '기록 없음'}</dd>
          <dt>다음 점검</dt>
          <dd className="num">
            {e.nextInspectionOn && e.active ? `${e.nextInspectionOn} (${chip.text})` : chip.text}
          </dd>
          <dt>수리비 합계</dt>
          <dd className="num">{formatWon(e.repairCostTotal)}</dd>
          <dt>상태</dt>
          <dd>{e.active ? '사용 중' : '사용 중지'}</dd>
          {e.memo ? (
            <>
              <dt>메모</dt>
              <dd>{e.memo}</dd>
            </>
          ) : null}
        </dl>
        {d.legalTasks.length ? (
          <>
            <h3 className="eq-print-h3">연결된 법정 일정</h3>
            <ul>
              {d.legalTasks.map((t) => (
                <li key={t.id}>
                  {t.title} · 최근 수행 <span className="num">{t.lastDoneOn ?? '없음'}</span> · 다음 예정 <span className="num">{t.nextDueOn ?? '수행일 입력 필요'}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <h3 className="eq-print-h3">점검·수리 이력 ({d.logs.length}건)</h3>
        {d.logs.length === 0 ? (
          <p className="eq-print-sum">아직 기록한 점검·수리 이력이 없어요.</p>
        ) : (
          <div className="tablewrap" role="region" aria-label="점검·수리 이력 표(옆으로 넘겨 보기)" tabIndex={0}>
            <table className="eq-print" data-testid="print-equipment-table">
              <caption className="sr-only">
                {e.name} 점검·수리 이력 {d.logs.length}건
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="c">
                    번호
                  </th>
                  <th scope="col">일자</th>
                  <th scope="col" className="c">
                    구분
                  </th>
                  <th scope="col">내용</th>
                  <th scope="col">비용</th>
                  <th scope="col">업체</th>
                  <th scope="col">기록</th>
                  <th scope="col" className="c">
                    첨부
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...d.logs].reverse().map((l, i) => (
                  <tr key={l.id}>
                    <td className="c num">{i + 1}</td>
                    <td className="num">{l.date}</td>
                    <td className="c">{EQUIPMENT_LOG_KIND_LABELS[l.kind]}</td>
                    <td>{l.content}</td>
                    <td className="r num">{wonText(l.cost)}</td>
                    <td>{l.vendorName ?? ''}</td>
                    <td>{l.user?.name ?? ''}</td>
                    <td className="c">{l.file ? '있음' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="sign">확인자 ______________ (서명)</p>
      </article>
    </PrintFrame>
  );
}

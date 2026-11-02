// 이 파일이 하는 일: "데모 데이터 초기화" 화면(/admin/reset, FR-007). 지워지는 것과 남는 것을 먼저 보여 주고,
// 확인 문구("초기화합니다")를 똑같이 입력해야 초기화가 실행된다. 실행 직전 서버가 자동 백업(초기화 직전)을 만든다.
// 업무 데이터가 하나도 없을 때는 "데모 데이터 넣기"로 하늘숲치과 예시 데이터를 다시 채울 수 있다. 관리자만 들어올 수 있다(routes.tsx).
import { useState } from 'react';
import { Button, Card, CardGrid, Chip, ConfirmDialog, ErrorState, PageHeader, Skeleton, useToast } from '../../components/index.ts';
import { api, ApiError } from '../../lib/api.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { RESET_CONFIRM, type DemoStatus, type ResetResult } from '../../../../shared/schemas/backup.ts';

/** 초기화하면 지워지는 것 */
const REMOVED = [
  '재고 품목·거래처·입출고·발주서',
  '공지·인수인계·체크리스트·저장한 문구',
  '문서·서식 보관함·원내 매뉴얼',
  '근무표·연차·교육·온보딩 기록',
  '장비·멸균 기록, 법정 일정의 수행 기록',
  '지출 기록, 알림, 업로드한 파일(문서·사진)',
  '관리자가 아닌 직원 계정',
];

/** 초기화해도 남는 것 */
const KEPT = ['관리자 계정(지금 로그인한 계정 포함)', '병원 정보와 각종 설정', 'AI 설정·AI 사용 기록(비용)', '활동 기록(감사 로그)', '법정 일정 기본 목록·지출 분류·근무 종류·광고 점검 사전', '백업 파일'];

/** 데모 데이터 초기화 */
export default function ResetPage() {
  const toast = useToast();
  const { refresh } = useSession();
  const status = useApi('admin:demo-status', () => api.get<DemoStatus>('/api/demo/status'));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  const reset = async () => {
    try {
      const r = await api.post<ResetResult>('/api/demo/reset', { confirm: RESET_CONFIRM });
      setOpen(false);
      setLastBackup(r.backup);
      toast.show('업무 데이터를 모두 지웠어요. 지우기 직전 상태는 백업으로 남겼어요.');
      invalidate('admin:');
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '초기화하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      await api.post('/api/demo/load');
      toast.show('하늘숲치과 데모 데이터를 넣었어요.');
      invalidate('admin:');
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '데모 데이터를 넣지 못했어요.');
    } finally {
      setLoading(false);
    }
  };

  const s = status.data;
  return (
    <>
      <PageHeader
        title="데모 데이터 초기화"
        summary="데모로 둘러본 뒤 실제 업무를 시작할 때, 예시 데이터를 한 번에 지워요."
        actions={
          <Button variant="danger" icon="alert" onClick={() => setOpen(true)} disabled={!s}>
            데모 데이터 지우기(초기화)
          </Button>
        }
      />
      <CardGrid>
        <Card title="지금 상태" id="reset-status-title">
          {status.error && !s ? (
            <ErrorState message={status.error.message} onRetry={status.reload} />
          ) : !s ? (
            <Skeleton rows={2} label="데모 상태 불러오는 중" />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              <p style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {s.loaded ? <Chip tone="info">데모 데이터 사용 중</Chip> : <Chip tone="ghost">데모 데이터 없음</Chip>}
                {s.empty ? <Chip tone="ok">업무 데이터 비어 있음</Chip> : <Chip tone="warn">업무 데이터 있음</Chip>}
              </p>
              {lastBackup ? (
                <p className="form-note" role="status">
                  지우기 직전 상태를 백업 "{lastBackup}"(으)로 남겼어요. 백업·복원 화면에서 되돌릴 수 있어요.
                </p>
              ) : null}
              {s.empty ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <p className="muted">업무 데이터가 비어 있을 때만 하늘숲치과 예시 데이터를 다시 넣을 수 있어요.</p>
                  <div>
                    <Button icon="plus" loading={loading} onClick={load}>
                      데모 데이터 넣기
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Card>
        <Card title="지워지는 것" id="reset-removed-title">
          <ul className="list" aria-labelledby="reset-removed-title">
            {REMOVED.map((t) => (
              <li key={t}>
                <span className="t">{t}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="남는 것" id="reset-kept-title">
          <ul className="list" aria-labelledby="reset-kept-title">
            {KEPT.map((t) => (
              <li key={t}>
                <span className="t">{t}</span>
              </li>
            ))}
          </ul>
        </Card>
      </CardGrid>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={reset}
        danger
        title="데모 데이터를 모두 지울까요?"
        confirmLabel="초기화하기"
        requireText={RESET_CONFIRM}
        message={
          <div style={{ display: 'grid', gap: 8 }}>
            <p>업무 데이터와 업로드한 파일, 관리자가 아닌 직원 계정이 지워져요. 관리자 계정·병원 설정·AI 설정·활동 기록은 남아요.</p>
            <p className="muted">실행 직전 상태는 자동으로 백업해 둬요("초기화 직전" 백업).</p>
          </div>
        }
      />
    </>
  );
}

// 이 파일이 하는 일: 회의록 화면의 "녹음 파일로 받아쓰기" 카드(FR-132, phase-06-task-03). http에서는 마이크를 쓸 수 없어서(TD-017) 휴대폰 녹음 앱 파일을 올린다.
// 순서: 빨간 경고("환자 이야기가 들어간 녹음은 올리지 마세요") → 녹음 고르기(m4a·mp3·wav·webm, 20MB까지, 이 기기에서 먼저 검사) → 확인 체크 →
// "받아쓰기"(POST /api/ai/transcribe) → 받아쓴 글(개인정보는 서버가 가림)을 onTranscript로 회의 메모 칸에 넘긴다. 정리는 기존 "정리하기"가 한다.
// 음성을 못 받는 공급자(Anthropic)·기능 꺼짐·예산 초과면 고르기 칸 대신 쉬운 비활성 안내를 보인다(GET /api/ai/transcribe/status).
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { Card } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { Checkbox } from '../../components/Field.tsx';
import { FileDrop } from '../../components/FileDrop.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ErrorState, Skeleton } from '../../components/States.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { aiErrorHelp } from '../../lib/ai.ts';
import { formatBytes } from '../../lib/image.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { durationText, RECORDING_ACCEPT, RECORDING_MAX_BYTES, uploadRecording, type TranscribeResult, type TranscribeStatus } from './minutesLib.ts';
import './minutes.css';

interface MinutesRecordingProps {
  /** 받아쓴 글이 오면 부른다(회의 메모 칸에 넣기) */
  onTranscript: (text: string, result: TranscribeResult) => void;
}

/** 녹음 파일 받아쓰기 카드 */
export function MinutesRecording({ onTranscript }: MinutesRecordingProps) {
  const { info } = useSession();
  const isAdmin = info?.user?.role === 'admin';
  const status = useApi<TranscribeStatus>('ai:transcribe-status', () => api.get('/api/ai/transcribe/status'));
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<TranscribeResult | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  // 화면을 떠나면 진행 중인 올리기를 끊는다
  useEffect(() => () => ctrl.current?.abort(), []);

  const st = status.data;
  const ready = st?.state === 'ready';

  /** 받아쓰기 */
  const run = async () => {
    if (!file || !confirmed || busy) return;
    setBusy(true);
    setError(null);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const r = await uploadRecording(info?.csrfToken ?? null, file, c.signal);
      setDone(r);
      setFile(null);
      setConfirmed(false);
      onTranscript(r.text, r);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      setError(e instanceof ApiError ? e : new ApiError(0, 'AI_UNAVAILABLE', 'AI 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.'));
    } finally {
      if (ctrl.current === c) ctrl.current = null;
      setBusy(false);
      // 예산·사용량 숫자가 바뀌었을 수 있다
      invalidate('ai:');
    }
  };

  const length = done ? durationText(done.usage.seconds) : null;

  return (
    <Card title="녹음 파일로 받아쓰기" id="minutes-recording" sub={st?.demo ? <Chip tone="info">데모 모드: 예시 받아쓰기가 나와요</Chip> : undefined}>
      <div className="mr-pad">
        <div className="mr-warn" role="note" data-testid="recording-warning">
          <Icon name="alert" size="md" />
          <span>환자 이야기가 들어간 녹음은 올리지 마세요. 직원 회의 녹음만 올려 주세요. 녹음은 받아쓰기에만 쓰고 서버에 남기지 않아요.</span>
        </div>

        {!st && status.error ? (
          // 상태 확인이 실패하면 이유와 "다시 시도"를 보인다(DESIGN §5-4, phase-06-task-03 검증 지적)
          <ErrorState title="받아쓰기 상태를 확인하지 못했어요" message={status.error.message} onRetry={status.reload} />
        ) : !st ? (
          <Skeleton rows={2} label="받아쓰기를 쓸 수 있는지 확인하고 있어요" />
        ) : !ready ? (
          <div className="mr-off" role="status" data-testid="recording-off">
            <Icon name="lock" size="md" />
            <span>{st.message ?? '지금은 녹음 받아쓰기를 쓸 수 없어요. 회의 메모를 직접 적어 주세요.'}</span>
          </div>
        ) : (
          <>
            <FileDrop
              label={file ? '다른 녹음으로 바꾸기' : '휴대폰 녹음 파일을 끌어다 놓거나 눌러서 고르세요'}
              accept={RECORDING_ACCEPT}
              maxBytes={RECORDING_MAX_BYTES}
              onFiles={(f) => {
                setFile(f[0] ?? null);
                setError(null);
              }}
            />
            {file ? (
              <p className="mr-picked num" data-testid="recording-picked">
                <Icon name="doc" size="sm" />
                <span>
                  고른 녹음: {file.name} · {formatBytes(file.size)}
                </span>
              </p>
            ) : null}
            <Checkbox label="환자 이야기가 들어간 녹음이 아닌 것을 확인했어요" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {error ? (
              <div className="form-error" role="alert">
                <Icon name="alert" size="sm" />
                <span>
                  {error.message} {aiErrorHelp(error.code, isAdmin) ?? ''}
                </span>
              </div>
            ) : null}
            <div className="mr-actions">
              {file && !confirmed ? <span className="mr-hint">확인 칸에 체크해야 보낼 수 있어요.</span> : null}
              <Button icon="spark" loading={busy} disabled={!file || !confirmed} onClick={() => void run()}>
                받아쓰기
              </Button>
            </div>
          </>
        )}

        {done ? (
          <div className="mr-done" role="status" data-testid="recording-done">
            <Icon name="check" size="md" />
            <span>
              받아쓴 글{length ? `(${length})` : ''}을 아래 회의 메모에 넣었어요. 틀린 곳을 고친 뒤 <b>정리하기</b>를 누르세요.
              {done.demo ? ' 데모 모드라서 예시 글이 들어갔어요.' : ''}
            </span>
          </div>
        ) : null}
        {done?.privacy.notice ? (
          <div className="mr-mask" role="status">
            <Icon name="shield" size="md" />
            <span>{done.privacy.notice}</span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

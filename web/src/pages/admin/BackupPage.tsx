// 이 파일이 하는 일: "백업·복원" 화면(/admin/backup, FR-006). 백업 목록(만든 시각·종류·크기)과 "지금 백업", zip 내려받기,
// 확인 문구("복원합니다")를 입력해야 실행되는 복원, 보관 개수 설정을 보여 준다. 관리자만 들어올 수 있다(routes.tsx).
// 복원이 끝나면 서버가 모든 로그인을 끊으므로 안내를 띄우고 로그인 화면으로 보낸다.
import { useState, type FormEvent } from 'react';
import { Button, Card, CardGrid, Chip, ConfirmDialog, EmptyState, Field, NumberInput, PageHeader, Skeleton, ErrorState, useToast, type Tone } from '../../components/index.ts';
import { api, ApiError } from '../../lib/api.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { formatDate, formatDateTime, formatNumber } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import {
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  BACKUP_REASON_LABEL,
  RESTORE_CONFIRM,
  type BackupItem,
  type BackupReason,
  type BackupSettings,
} from '../../../../shared/schemas/backup.ts';

/** 백업 종류 칩 색(글자와 함께 보여 색만으로 구분하지 않는다) */
const REASON_TONE: Readonly<Record<BackupReason, Tone>> = { auto: 'ghost', manual: 'info', 'pre-restore': 'warn', 'pre-reset': 'warn' };

/** 만든 시각을 연도까지 보여 준다(예: 2026-11-02 09:00) */
function whenLabel(iso: string): string {
  return `${formatDate(iso)} ${formatDateTime(iso).split(' ')[1] ?? ''}`.trim();
}

/** 바이트 → 읽기 쉬운 크기(KB·MB) */
function formatBytes(n: number): string {
  if (n < 1024) return `${formatNumber(n)}B`;
  if (n < 1024 * 1024) return `${formatNumber(n / 1024, 1)}KB`;
  return `${formatNumber(n / (1024 * 1024), 1)}MB`;
}

/** 백업·복원 */
export default function BackupPage() {
  const toast = useToast();
  const { refresh } = useSession();
  const list = useApi('admin:backups', () => api.get<BackupItem[]>('/api/backups'));
  const settings = useApi('admin:backup-settings', () => api.get<BackupSettings>('/api/settings/backup'));
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<BackupItem | null>(null);

  const backupNow = async () => {
    setCreating(true);
    try {
      const b = await api.post<BackupItem>('/api/backups');
      toast.show(`백업을 만들었어요 (${whenLabel(b.createdAt)})`);
      invalidate('admin:backups');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '백업을 만들지 못했어요.');
    } finally {
      setCreating(false);
    }
  };

  const restore = async () => {
    if (!target) return;
    try {
      await api.post(`/api/backups/${encodeURIComponent(target.name)}/restore`, { confirm: RESTORE_CONFIRM });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '복원하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      return;
    }
    setTarget(null);
    toast.show(`${whenLabel(target.createdAt)} 백업으로 복원했어요. 다시 로그인해 주세요.`);
    // 서버가 모든 로그인을 끊었으므로, 목록을 다시 부르면 401 → 공통 처리기가 로그인 화면(로그인 뒤 이 화면으로 돌아옴)으로 보낸다
    await api.get('/api/backups').catch(() => undefined);
    // 병원 이름·데모 표시도 복원한 데이터 기준으로 다시 읽는다
    await refresh();
  };

  const count = list.data?.length;
  return (
    <>
      <PageHeader
        title="백업·복원"
        summary={
          settings.data ? `자동 백업은 하루 한 번 만들어지고, 최근 ${formatNumber(settings.data.keep)}개를 보관해요.` : '자동 백업은 하루 한 번 만들어져요.'
        }
        actions={
          <Button variant="primary" icon="refresh" loading={creating} onClick={backupNow}>
            지금 백업
          </Button>
        }
      />
      <CardGrid>
        <Card title="백업 목록" sub={count === undefined ? undefined : `${formatNumber(count)}개`} span={2} id="backup-list-title">
          <BackupList state={list} onRestore={setTarget} onCreate={backupNow} />
        </Card>
        <Card title="보관 설정" id="backup-keep-title">
          <KeepForm state={settings} />
        </Card>
      </CardGrid>
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        onConfirm={restore}
        danger
        title="이 백업으로 복원할까요?"
        confirmLabel="복원하기"
        requireText={RESTORE_CONFIRM}
        message={
          target ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <p>
                <b>{whenLabel(target.createdAt)}</b>에 만든 백업({BACKUP_REASON_LABEL[target.reason]})으로 모든 업무 데이터·업로드 파일을 되돌려요.
              </p>
              <p className="muted">지금 상태는 "복원 직전" 백업으로 따로 남아요. 복원하는 동안 다른 직원은 잠시 쓸 수 없고, 끝나면 모두 다시 로그인해야 해요.</p>
            </div>
          ) : null
        }
      />
    </>
  );
}

interface ListProps {
  state: { data: BackupItem[] | undefined; error: Error | undefined; loading: boolean; reload: () => void };
  onRestore: (b: BackupItem) => void;
  onCreate: () => void;
}

/** 백업 목록(새것부터). 줄마다 내려받기·복원 버튼 */
function BackupList({ state, onRestore, onCreate }: ListProps) {
  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  if (!state.data) return <Skeleton rows={4} label="백업 목록 불러오는 중" />;
  if (state.data.length === 0) {
    return (
      <EmptyState
        icon="shield"
        title="아직 백업이 없어요"
        description="서버가 켜져 있으면 하루 한 번 자동으로 만들어져요. 지금 바로 만들 수도 있어요."
        action={
          <Button size="sm" icon="plus" onClick={onCreate}>
            첫 백업 만들기
          </Button>
        }
      />
    );
  }
  return (
    <ul className="list" aria-labelledby="backup-list-title">
      {state.data.map((b) => (
        <li key={b.name} style={{ flexWrap: 'wrap', padding: '8px 0' }}>
          <span className="t" style={{ flexBasis: 200 }}>
            <b className="num">{whenLabel(b.createdAt)}</b>
            <small className="num">
              {b.name} · {formatBytes(b.sizeBytes)}
            </small>
          </span>
          <Chip tone={REASON_TONE[b.reason]}>{BACKUP_REASON_LABEL[b.reason]}</Chip>
          <span style={{ display: 'flex', gap: 6 }}>
            <a className="btn sm" href={`/api/backups/${encodeURIComponent(b.name)}/download`} download aria-label={`${whenLabel(b.createdAt)} 백업 내려받기`}>
              내려받기
            </a>
            <Button size="sm" variant="ghost" onClick={() => onRestore(b)} aria-label={`${whenLabel(b.createdAt)} 백업으로 복원`}>
              복원
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 보관 개수 설정 */
function KeepForm({ state }: { state: { data: BackupSettings | undefined; error: Error | undefined; reload: () => void } }) {
  const toast = useToast();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.error && !state.data) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  if (!state.data) return <Skeleton rows={2} label="보관 설정 불러오는 중" />;
  const shown = value ?? String(state.data.keep);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const keep = Number(shown);
    if (!Number.isInteger(keep) || keep < BACKUP_KEEP_MIN || keep > BACKUP_KEEP_MAX) {
      setError(`${BACKUP_KEEP_MIN}부터 ${BACKUP_KEEP_MAX} 사이 정수로 적어 주세요.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.put<BackupSettings>('/api/settings/backup', { keep });
      setValue(null);
      toast.show(`보관 개수를 ${formatNumber(keep)}개로 바꿨어요. 넘치는 오래된 백업은 지웠어요.`);
      invalidate('admin:backup');
    } catch (err) {
      setError(err instanceof ApiError ? (err.fields?.keep ?? err.message) : '저장하지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }} noValidate>
      <Field label="보관할 백업 개수" help="수동 백업·복원 직전·초기화 직전 백업도 함께 세요. 넘치면 오래된 것부터 지워져요." error={error}>
        <NumberInput className="input" min={BACKUP_KEEP_MIN} max={BACKUP_KEEP_MAX} step={1} value={shown} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" loading={busy}>
          저장
        </Button>
      </div>
      <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
        백업에는 암호화 키(secret.key)도 들어 있어요. 내려받은 파일은 원내 PC 밖으로 가져가지 마세요.
      </p>
    </form>
  );
}

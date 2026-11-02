// 이 파일이 하는 일: "CSV 가져오기·내보내기" 화면(/inventory/import, FR-056). 실장 이상이 쓴다(items.import).
// 내보내기: 품목·거래처·입출고 기록을 엑셀에서 바로 열리는 CSV로 내려받는다(한글 깨짐 없음, 수식 주입 방지는 서버가 한다).
// 가져오기: 양식 내려받기 → 파일 올리기(UTF-8·CP949 자동 판별) → 미리보기(신규·변경·변경 없음·오류 줄 구분, 오류는 이유 표시) → 확정 순서다.
// 오류 줄이 있으면 "오류 줄 건너뛰고 확정"을 눌러야 나머지만 반영된다. 확정하면 재고 화면 데이터를 다시 불러온다.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip, type Tone } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { FileDrop } from '../../components/FileDrop.tsx';
import { Icon } from '../../components/Icon.tsx';
import { EmptyState } from '../../components/States.tsx';
import { Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, toApiError } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { CSRF_HEADER } from '../../../../shared/schemas/auth.ts';
import {
  IMPORT_ACTION_LABELS,
  type ImportAction,
  type ImportCommitResult,
  type ImportPreview,
  type ImportPreviewRow,
} from '../../../../shared/schemas/inventory-csv.ts';
import { messageOf, qty, refreshInventory } from './inventory-ui.tsx';
import './import.css';

const ACTION_TONE: Record<ImportAction, Tone> = { new: 'info', update: 'warn', unchanged: 'ghost', error: 'danger' };
type RowFilter = 'all' | ImportAction;

/** CSV 파일을 올려 미리보기를 받는다(multipart). 서버 오류 문구를 그대로 ApiError로 던진다 */
async function uploadPreview(csrfToken: string | null, file: File): Promise<ImportPreview> {
  const fd = new FormData();
  fd.set('file', file, file.name);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (csrfToken) headers[CSRF_HEADER] = csrfToken;
  let res: Response;
  try {
    res = await fetch('/api/import/items/preview', { method: 'POST', credentials: 'same-origin', headers, body: fd });
  } catch {
    throw toApiError(0, { error: { code: 'NETWORK', message: '서버에 연결할 수 없어요. 원내 와이파이에 연결되어 있는지 확인해 주세요.' } });
  }
  const body = (await res.json().catch(() => null)) as { data?: ImportPreview } | null;
  if (!res.ok || !body?.data) throw toApiError(res.status, body);
  return body.data;
}

/** 미리보기 줄의 "내용" 칸: 오류 이유, 바뀌는 칸, 알아 둘 점 */
function RowDetail({ row }: { row: ImportPreviewRow }) {
  if (row.action === 'error') {
    return (
      <ul className="imp-reasons" aria-label={`${row.line}번 줄 오류 이유`}>
        {row.errors.map((e) => (
          <li key={e}>
            <Icon name="alert" size="sm" />
            {e}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="imp-detail">
      {row.action === 'new' ? <span>새 품목으로 등록해요.</span> : null}
      {row.action === 'unchanged' ? <span className="muted">지금 내용과 같아요.</span> : null}
      {row.changes.map((c) => (
        <span key={c.field} className="num">
          {c.label}: <s className="muted">{c.from}</s> → <b>{c.to}</b>
        </span>
      ))}
      {row.notes.map((n) => (
        <span key={n} className="muted">
          {n}
        </span>
      ))}
    </div>
  );
}

/** CSV 가져오기·내보내기 */
export default function ImportPage() {
  const { info } = useSession();
  const toast = useToast();
  const canExport = can(info?.user?.role, 'inventory.export');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [filter, setFilter] = useState<RowFilter>('all');

  const onFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setUploading(true);
    setUploadError(null);
    setCommitError(null);
    setResult(null);
    try {
      const p = await uploadPreview(info?.csrfToken ?? null, f);
      setPreview(p);
      setFilter('all');
    } catch (e) {
      setPreview(null);
      setUploadError(messageOf(e, '파일을 읽지 못했어요. 다시 올려 주세요.'));
    } finally {
      setUploading(false);
    }
  };

  const commit = async (skipErrors: boolean) => {
    if (!preview) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const r = await api.post<ImportCommitResult>('/api/import/items/commit', { token: preview.token, skipErrors });
      setResult(r);
      setPreview(null);
      refreshInventory();
      toast.show(`품목 ${r.created + r.updated}개를 반영했어요.`);
    } catch (e) {
      setCommitError(messageOf(e, '반영하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setCommitting(false);
    }
  };

  const rows = useMemo(() => (preview ? (filter === 'all' ? preview.rows : preview.rows.filter((r) => r.action === filter)) : undefined), [preview, filter]);
  const applyCount = preview ? preview.totals.new + preview.totals.update : 0;
  const errorCount = preview?.totals.error ?? 0;

  const columns: Column<ImportPreviewRow>[] = [
    { key: 'line', header: '줄', align: 'right', sortValue: (r) => r.line, render: (r) => <span className="num">{r.line}</span> },
    { key: 'action', header: '구분', sortValue: (r) => r.action, render: (r) => <Chip tone={ACTION_TONE[r.action]}>{IMPORT_ACTION_LABELS[r.action]}</Chip> },
    { key: 'name', header: '품목명', sortValue: (r) => r.data.name ?? '', render: (r) => (r.data.name ? <b>{r.data.name}</b> : <span className="muted">(비어 있음)</span>) },
    { key: 'category', header: '분류', render: (r) => r.data.category ?? <span className="muted">—</span> },
    { key: 'par', header: '적정 재고', align: 'right', render: (r) => (r.data.par !== null ? qty(r.data.par, r.data.unit ?? '') : <span className="muted">—</span>) },
    { key: 'detail', header: '내용', render: (r) => <RowDetail row={r} /> },
  ];

  return (
    <>
      <PageHeader
        title="CSV 가져오기·내보내기"
        summary="엑셀로 품목을 한꺼번에 등록·수정하고, 품목·거래처·입출고 기록을 엑셀 파일로 받아요."
        actions={
          <a className="btn" href="/api/import/items/template.csv" download>
            <Icon name="doc" />
            가져오기 양식 내려받기
          </a>
        }
      />
      <div className="imp-stack">
        <Card title="품목 가져오기" id="imp-title">
          <div className="imp-pad">
            <ol className="imp-steps" aria-label="가져오기 순서">
              <li>
                <b>1. 양식에 적기</b>
                <small>위 "가져오기 양식"이나 품목 내보내기 파일을 엑셀에서 고쳐요.</small>
              </li>
              <li>
                <b>2. 파일 올리기</b>
                <small>엑셀 기본 CSV(CP949)도, UTF-8도 그대로 읽어요.</small>
              </li>
              <li>
                <b>3. 미리보기 확인</b>
                <small>신규·변경·오류 줄을 확인해요.</small>
              </li>
              <li>
                <b>4. 확정</b>
                <small>확정하기 전에는 아무것도 바뀌지 않아요.</small>
              </li>
            </ol>
            <FileDrop label={uploading ? '파일을 읽는 중이에요…' : 'CSV 파일을 끌어다 놓거나 눌러서 고르세요'} accept={['.csv']} maxBytes={2 * 1024 * 1024} onFiles={(f) => void onFiles(f)} />
            {uploadError ? (
              <p className="form-error" role="alert">
                <Icon name="alert" size="sm" />
                {uploadError}
              </p>
            ) : null}
            {result ? (
              <div className="form-note" role="status">
                <Icon name="check" size="sm" />
                <span>
                  신규 {result.created}개, 변경 {result.updated}개를 반영했어요. 건너뛴 줄 {result.skipped}개
                  {result.errorLines.length ? `(오류 줄 ${result.errorLines.join(', ')}번 포함)` : ''}. <Link to="/inventory">재고 현황에서 보기</Link>
                </span>
              </div>
            ) : null}
          </div>
        </Card>

        {preview ? (
          <Card title="미리보기" sub={preview.fileName} id="imp-preview">
            <div className="imp-pad imp-summary" aria-label="미리보기 요약">
              <span className="imp-count">
                <Chip tone="info">신규</Chip> <b className="num">{preview.totals.new}</b>
              </span>
              <span className="imp-count">
                <Chip tone="warn">변경</Chip> <b className="num">{preview.totals.update}</b>
              </span>
              <span className="imp-count">
                <Chip tone="ghost">변경 없음</Chip> <b className="num">{preview.totals.unchanged}</b>
              </span>
              <span className="imp-count">
                <Chip tone="danger">오류</Chip> <b className="num">{preview.totals.error}</b>
              </span>
              <span className="muted imp-enc">
                {preview.encoding === 'cp949' ? '엑셀 기본 형식(CP949)으로 읽었어요.' : 'UTF-8 형식으로 읽었어요.'}
                {preview.ignoredColumns.length ? ` 쓰지 않은 열: ${preview.ignoredColumns.join(', ')}` : ''}
              </span>
            </div>
            <Toolbar label="미리보기 줄 거르기">
              <Segmented<RowFilter>
                label="구분"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: `전체 ${preview.rows.length}` },
                  { value: 'new', label: `신규 ${preview.totals.new}` },
                  { value: 'update', label: `변경 ${preview.totals.update}` },
                  { value: 'error', label: `오류 ${preview.totals.error}` },
                ]}
              />
            </Toolbar>
            <DataTable<ImportPreviewRow>
              caption="가져오기 미리보기"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.line}
              empty={<EmptyState icon="search" title="이 구분에 해당하는 줄이 없어요" description="다른 구분을 눌러 보세요." />}
            />
            <div className="imp-pad imp-foot">
              {commitError ? (
                <p className="form-error" role="alert">
                  <Icon name="alert" size="sm" />
                  {commitError}
                </p>
              ) : null}
              {errorCount > 0 ? (
                <p className="imp-hint">
                  오류 줄 {errorCount}개는 반영하지 않아요. 고친 파일을 다시 올리거나, 오류 줄만 빼고 나머지 {applyCount}개를 반영할 수 있어요.
                </p>
              ) : applyCount === 0 ? (
                <p className="imp-hint">바뀌는 품목이 없어요.</p>
              ) : null}
              <div className="imp-actions">
                <Button variant="ghost" onClick={() => setPreview(null)} disabled={committing}>
                  취소
                </Button>
                {errorCount > 0 ? (
                  <Button variant="primary" loading={committing} disabled={applyCount === 0} onClick={() => void commit(true)}>
                    오류 줄 건너뛰고 확정
                  </Button>
                ) : (
                  <Button variant="primary" loading={committing} disabled={applyCount === 0} onClick={() => void commit(false)}>
                    확정
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ) : null}

        {canExport ? (
          <Card title="내보내기" id="exp-title">
            <div className="imp-pad">
              <p className="imp-hint">엑셀에서 바로 열 수 있어요. 품목 파일은 고친 뒤 위 "품목 가져오기"로 다시 올릴 수 있어요.</p>
              <div className="imp-actions start">
                <a className="btn" href="/api/export/items.csv" download>
                  <Icon name="box" />
                  품목 CSV
                </a>
                <a className="btn" href="/api/export/vendors.csv" download>
                  <Icon name="cart" />
                  거래처 CSV
                </a>
                <a className="btn" href="/api/export/moves.csv" download>
                  <Icon name="list" />
                  입출고 기록 CSV
                </a>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

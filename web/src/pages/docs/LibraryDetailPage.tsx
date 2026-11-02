// 이 파일이 하는 일: "서식 상세" 화면(/docs/library/:id, FR-060 AC3·FR-062). 문서를 A4 종이 모양으로 보여 주고(HTML은 해석하지 않아 <script>도 글자로만 보임),
// 작성자나 실장님 이상은 "고치기"로 제목·본문·폴더·태그를 고친다. 저장하면 버전이 하나 늘고, "버전 기록"에서 이전 버전 내용을 열어 볼 수 있다.
// 올린 서식 파일은 "파일 내려받기"(첨부 파일로 저장)를 주 행동으로 보여 준다. 글 문서는 "인쇄"가 주 행동이다.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { ConfirmDialog, Dialog } from '../../components/Dialog.tsx';
import { Field, TextInput } from '../../components/Field.tsx';
import { MarkdownEditor, MarkdownView } from '../../components/Markdown.tsx';
import { PaperPreview } from '../../components/PaperPreview.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { ApiError } from '../../lib/api.ts';
import { formatDate, formatDateTime } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { DOC_KIND_LABELS, type DocDetail, type DocVersionView } from '../../../../shared/schemas/docs.ts';
import { deleteDocument, fetchDocument, fetchVersions, parseTagText, sizeLabel, updateDocument, withoutTitleLine } from './docsLib.ts';
import './docs-pages.css';

/** 고치기 칸 */
function EditForm({ doc, onCancel, onSaved }: { doc: DocDetail; onCancel: () => void; onSaved: (d: DocDetail) => void }) {
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState(doc.bodyMd);
  const [folder, setFolder] = useState(doc.folder);
  const [tags, setTags] = useState(doc.tags.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isFile = doc.source === 'upload';

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const patch = isFile
        ? { title: title.trim(), folder: folder.trim(), tags: parseTagText(tags) }
        : { title: title.trim(), body_md: body, folder: folder.trim(), tags: parseTagText(tags) };
      onSaved(await updateDocument(doc.id, patch));
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fields ?? {})[0] ?? e.message) : '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="doc-form">
      <Field label="제목" required>
        <TextInput value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {isFile ? null : <MarkdownEditor label="본문" value={body} onChange={setBody} rows={16} />}
      <div className="doc-form-row two">
        <Field label="폴더">
          <TextInput value={folder} maxLength={50} onChange={(e) => setFolder(e.target.value)} />
        </Field>
        <Field label="태그" help="쉼표로 나눠 적어요.">
          <TextInput value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="doc-actions">
        <span className="grow" />
        <Button onClick={onCancel}>그만두기</Button>
        <Button variant="primary" icon="check" loading={busy} onClick={() => void save()}>
          저장
        </Button>
      </div>
    </div>
  );
}

/** 버전 기록 카드 */
function Versions({ id, current }: { id: number; current: number }) {
  const versions = useApi(`docs:versions:${id}:${current}`, () => fetchVersions(id));
  const [open, setOpen] = useState<DocVersionView | null>(null);
  return (
    <Card title="버전 기록" id="doc-versions" sub={versions.data ? `${versions.data.length}개` : undefined}>
      {versions.error ? (
        <ErrorState message={versions.error.message} onRetry={versions.reload} />
      ) : !versions.data ? (
        <Skeleton rows={3} label="버전 기록 불러오는 중" />
      ) : versions.data.length === 0 ? (
        <EmptyState icon="doc" title="버전 기록이 없어요" description="올린 서식 파일은 버전 대신 파일로 보관해요." />
      ) : (
        <ul className="list doc-versions" aria-labelledby="doc-versions">
          {versions.data.map((v) => (
            <li key={v.id} data-testid={`version-${v.version}`}>
              <span className="t">
                <b>
                  버전 {v.version}
                  {v.version === current ? ' (지금)' : ''}
                </b>
                <small className="num">
                  {formatDateTime(v.createdAt)} · {v.createdBy ?? '알 수 없음'}
                </small>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setOpen(v)}>
                내용 보기
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open ? `버전 ${open.version} 내용` : ''} wide footer={<Button onClick={() => setOpen(null)}>닫기</Button>}>
        {open ? (
          <div className="doc-form">
            <p className="doc-meta">
              <span>
                제목 <b>{open.title}</b>
              </span>
              <span className="num">{formatDateTime(open.createdAt)}</span>
            </p>
            <div className="doc-version-body" data-testid="version-body">
              <MarkdownView text={open.bodyMd} />
            </div>
          </div>
        ) : null}
      </Dialog>
    </Card>
  );
}

/** 서식 상세 */
export default function LibraryDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const navigate = useNavigate();
  const toast = useToast();
  const { info } = useSession();
  const clinic = info?.clinicName || '우리 병원';
  const doc = useApi(Number.isInteger(id) && id > 0 ? `docs:detail:${id}` : null, () => fetchDocument(id));
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!Number.isInteger(id) || id <= 0) {
    return <EmptyState icon="doc" title="찾는 문서가 없어요" description="주소를 다시 확인해 주세요." action={<Button to="/docs/library">서식 보관함으로</Button>} />;
  }
  if (doc.error && !doc.data) {
    const notFound = doc.error instanceof ApiError && doc.error.status === 404;
    return notFound ? (
      <EmptyState icon="doc" title="찾는 문서가 없어요" description="지워졌거나 주소가 바뀌었을 수 있어요." action={<Button to="/docs/library">서식 보관함으로</Button>} />
    ) : (
      <ErrorState message={doc.error.message} onRetry={doc.reload} />
    );
  }
  if (!doc.data) return <Skeleton rows={8} label="문서 불러오는 중" />;
  const d = doc.data;
  const isFile = d.source === 'upload';

  return (
    <>
      <PageHeader
        title={d.title}
        summary={`${DOC_KIND_LABELS[d.kind]} · ${isFile ? '올린 파일' : `버전 ${d.version}`} · ${formatDate(d.updatedAt)} 고침`}
        actions={
          <>
            <Button to="/docs/library">
              목록
            </Button>
            {d.canEdit && !editing ? (
              <>
                <Button icon="heading" onClick={() => setEditing(true)}>
                  고치기
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  지우기
                </Button>
              </>
            ) : null}
            {isFile && d.file ? (
              <a className="btn primary" href={`/api/files/${d.file.id}`} download={d.file.name}>
                파일 내려받기
              </a>
            ) : (
              <Button variant="primary" icon="print" to={`/print/document/${d.id}`}>
                인쇄
              </Button>
            )}
          </>
        }
      />
      <p className="doc-meta">
        <span>
          폴더 <b>{d.folder || '없음'}</b>
        </span>
        <span>
          작성자 <b>{d.createdBy ?? '알 수 없음'}</b>
        </span>
        {d.tags.length ? (
          <span className="doc-tags">
            {d.tags.map((t) => (
              <Chip key={t}>#{t}</Chip>
            ))}
          </span>
        ) : null}
        {d.source === 'ai' ? <Chip tone="info">AI 초안</Chip> : null}
      </p>
      {editing ? (
        <Card title="문서 고치기" id="doc-edit">
          <EditForm
            doc={d}
            onCancel={() => setEditing(false)}
            onSaved={(next) => {
              setEditing(false);
              invalidate('docs:');
              toast.show(isFile ? '문서 정보를 고쳤어요.' : `저장했어요(버전 ${next.version}).`);
            }}
          />
        </Card>
      ) : isFile && d.file ? (
        <Card title="올린 파일" id="doc-file">
          <ul className="list">
            <li>
              <span className="t">
                <b>{d.file.name}</b>
                <small className="num">
                  {d.file.mime} · {sizeLabel(d.file.size)}
                </small>
              </span>
            </li>
          </ul>
          <p className="doc-note">파일은 화면에서 열지 않고 내려받아서 확인해요.</p>
        </Card>
      ) : (
        <PaperPreview headLeft={clinic} headRight={`문서 번호 D-${String(d.id).padStart(4, '0')} · ${formatDate(d.updatedAt)}`} title={d.title} sign={`${clinic} 원장`}>
          <MarkdownView text={withoutTitleLine(d.bodyMd)} />
        </PaperPreview>
      )}
      {isFile ? null : <Versions id={d.id} current={d.version} />}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="문서를 지울까요?"
        message={`"${d.title}" 문서를 서식 보관함에서 지워요.`}
        confirmLabel="지우기"
        danger
        onConfirm={async () => {
          try {
            await deleteDocument(d.id);
            invalidate('docs:');
            toast.show('문서를 지웠어요.');
            navigate('/docs/library');
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : '지우지 못했어요.');
          }
        }}
      />
    </>
  );
}

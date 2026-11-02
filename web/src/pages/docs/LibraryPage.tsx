// 이 파일이 하는 일: "서식 보관함" 화면(/docs/library, FR-062). 서비스 안에서 쓴 문서와 올린 서식 파일을 한 표에서 보고, 검색·종류·폴더·태그로 거른다.
// 실장님 이상은 "서식 파일 올리기"로 PDF·DOCX·XLSX·HWP·사진(최대 20MB, 사진 8MB)을 올린다. 올리기 전 화면에서 확장자·크기를 먼저 확인하고,
// 서버도 파일 내용(매직 넘버)을 다시 검사해 거부 이유를 쉬운 한국어로 알려 준다(415·413). 거르기 조건은 주소(?q=&kind=&folder=&tag=)에 남는다.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Field, Select, TextInput } from '../../components/Field.tsx';
import { FileDrop } from '../../components/FileDrop.tsx';
import { EmptyState } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { SearchInput } from '../../components/Toolbar.tsx';
import { ApiError } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { can } from '../../../../shared/roles.ts';
import { DOC_KIND_LABELS, type DocListItem } from '../../../../shared/schemas/docs.ts';
import { fetchDocuments, FORM_ACCEPT, FORM_MAX_BYTES, KIND_FILTER_OPTIONS, listQuery, sizeLabel, uploadForm } from './docsLib.ts';
import './docs-pages.css';

/** 표의 열 */
const COLUMNS: ReadonlyArray<Column<DocListItem>> = [
  { key: 'title', header: '제목', sortValue: (d) => d.title, render: (d) => <span className="doc-title-cell">{d.title}</span> },
  { key: 'kind', header: '종류', sortValue: (d) => DOC_KIND_LABELS[d.kind], render: (d) => <Chip tone={d.kind === 'form' ? 'info' : 'ghost'}>{DOC_KIND_LABELS[d.kind]}</Chip> },
  { key: 'folder', header: '폴더', sortValue: (d) => d.folder, render: (d) => d.folder || '—' },
  {
    key: 'tags',
    header: '태그',
    render: (d) =>
      d.tags.length ? (
        <span className="doc-tags">
          {d.tags.map((t) => (
            <Chip key={t}>#{t}</Chip>
          ))}
        </span>
      ) : (
        '—'
      ),
  },
  { key: 'version', header: '버전', align: 'right', sortValue: (d) => d.version, render: (d) => (d.file ? sizeLabel(d.file.size) : `버전 ${d.version}`) },
  { key: 'updatedAt', header: '고친 날', sortValue: (d) => d.updatedAt, render: (d) => <span className="num">{formatDate(d.updatedAt)}</span> },
  { key: 'createdBy', header: '작성자', sortValue: (d) => d.createdBy, render: (d) => d.createdBy ?? '—' },
];

/** 서식 파일 올리기 대화상자 */
function UploadDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: number) => void }) {
  const { info } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  /** 파일 이름으로 자동으로 채운 제목(직접 고치지 않았으면 새 파일을 고를 때 바꾼다) */
  const [autoTitle, setAutoTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setTitle('');
    setAutoTitle('');
    setFolder('');
    setTags('');
    setError(null);
  };

  const submit = async () => {
    if (!file) {
      setError('올릴 파일을 골라 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const doc = await uploadForm(info?.csrfToken ?? null, file, { title, folder, tags });
      reset();
      onDone(doc.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '올리지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="서식 파일 올리기"
      footer={
        <>
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            닫기
          </Button>
          <Button variant="primary" icon="upload" loading={busy} onClick={() => void submit()}>
            올리기
          </Button>
        </>
      }
    >
      <div className="doc-form">
        <FileDrop
          label="서식 파일을 끌어다 놓거나 눌러서 고르세요"
          accept={FORM_ACCEPT}
          maxBytes={FORM_MAX_BYTES}
          onFiles={(fs) => {
            const f = fs[0] ?? null;
            setFile(f);
            setError(null);
            if (f && (!title || title === autoTitle)) {
              const t = f.name.replace(/\.[^.]+$/, '');
              setTitle(t);
              setAutoTitle(t);
            }
          }}
        />
        {file ? (
          <p className="doc-note" data-testid="upload-picked">
            고른 파일: <b>{file.name}</b> ({sizeLabel(file.size)})
          </p>
        ) : null}
        <p className="doc-note">HWP·DOCX·XLSX는 보관만 하고, 내려받아서 열어요.</p>
        <Field label="제목" help="비워 두면 파일 이름을 써요.">
          <TextInput value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="doc-form-row two">
          <Field label="폴더">
            <TextInput value={folder} maxLength={50} onChange={(e) => setFolder(e.target.value)} />
          </Field>
          <Field label="태그" help="쉼표로 나눠 적어요.">
            <TextInput value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
        </div>
        {error ? (
          <p className="form-error" role="alert" data-testid="upload-error">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** 서식 보관함 */
export default function LibraryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { info } = useSession();
  const [params, setParams] = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(false);
  const filters = { q: params.get('q') ?? '', kind: params.get('kind') ?? '', folder: params.get('folder') ?? '', tag: params.get('tag') ?? '' };
  const [q, setQ] = useState(filters.q);
  const query = listQuery(filters);
  const list = useApi(`docs:list:${query}`, () => fetchDocuments(query));
  const canUpload = can(info?.user?.role, 'documents.upload');
  const filtered = !!(filters.q || filters.kind || filters.folder || filters.tag);

  /** 거르기 조건 하나를 바꾼다(빈 값이면 지움) */
  const setFilter = (key: 'q' | 'kind' | 'folder' | 'tag', value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const facets = list.data?.facets;

  return (
    <>
      <PageHeader
        title="서식 보관함"
        summary={list.data ? `문서 ${list.data.total}개` : '문서를 불러오는 중이에요.'}
        actions={
          <>
            {canUpload ? (
              <Button icon="upload" onClick={() => setUploadOpen(true)}>
                서식 파일 올리기
              </Button>
            ) : null}
            <Button variant="primary" icon="spark" to="/docs/writer">
              새 문서 쓰기
            </Button>
          </>
        }
      />
      <article className="card" aria-label="서식 목록">
        <div className="toolbar" role="toolbar" aria-label="서식 거르기">
          <form
            role="search"
            aria-label="서식 검색"
            onSubmit={(e) => {
              e.preventDefault();
              setFilter('q', q.trim());
            }}
          >
            <SearchInput label="제목·내용·파일 이름 검색" placeholder="제목·내용 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <Select className="input doc-filter" aria-label="종류" value={filters.kind} onChange={(e) => setFilter('kind', e.target.value)} options={KIND_FILTER_OPTIONS} />
          <Select
            className="input doc-filter"
            aria-label="폴더"
            value={filters.folder}
            onChange={(e) => setFilter('folder', e.target.value)}
            options={[{ value: '', label: '모든 폴더' }, ...(facets?.folders ?? (filters.folder ? [filters.folder] : [])).map((f) => ({ value: f, label: f }))]}
          />
          <Select
            className="input doc-filter"
            aria-label="태그"
            value={filters.tag}
            onChange={(e) => setFilter('tag', e.target.value)}
            options={[{ value: '', label: '모든 태그' }, ...(facets?.tags ?? (filters.tag ? [filters.tag] : [])).map((t) => ({ value: t, label: `#${t}` }))]}
          />
          {filtered ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQ('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              거르기 지우기
            </Button>
          ) : null}
        </div>
        <div className="body">
          <DataTable
            caption="서식 보관함 문서"
            columns={COLUMNS}
            rows={list.data?.data}
            rowKey={(d) => d.id}
            rowLabel={(d) => d.title}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            onRowClick={(d) => navigate(`/docs/library/${d.id}`)}
            empty={
              filtered ? (
                <EmptyState icon="search" title="조건에 맞는 문서가 없어요" description="검색어나 거르기 조건을 바꿔 보세요." />
              ) : (
                <EmptyState
                  icon="doc"
                  title="아직 저장한 문서가 없어요"
                  description="AI 문서 작성으로 첫 문서를 만들거나 서식 파일을 올려 보세요."
                  action={
                    <Button size="sm" icon="spark" to="/docs/writer">
                      첫 문서 쓰기
                    </Button>
                  }
                />
              )
            }
          />
        </div>
      </article>
      {canUpload ? (
        <UploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onDone={(id) => {
            setUploadOpen(false);
            invalidate('docs:');
            toast.show('서식 파일을 올렸어요.');
            navigate(`/docs/library/${id}`);
          }}
        />
      ) : null}
    </>
  );
}

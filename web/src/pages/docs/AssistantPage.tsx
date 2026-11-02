// 이 파일이 하는 일: "원내 AI 도우미" 화면(/docs/assistant, FR-070·071). "질문하기" 탭에서 질문하면 원내 문서에서 찾은 근거로 답하고,
// 답 아래에 근거 카드(문서 이름·소제목·발췌·"원문 보기" 링크)를 보여 준다. 근거가 없으면 AI를 부르지 않고 "원내 문서에서 찾지 못했습니다"와 문서 올리기 안내를 보인다.
// "원내 문서" 탭은 자료 목록(상태·조각 수·공개 범위)이고, 실장님 이상은 파일(TXT·MD·PDF·DOCX)이나 서식 보관함 문서를 올리고, 개인정보 검토("가리고 저장")·지우기를 한다.
// 원문 보기는 주소(?doc=&chunk=)로 여는 대화상자라 링크로 바로 열 수 있다. 대화 기록은 사용자별로 남고 "대화 지우기"로 지운다.
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { ConfirmDialog, Dialog } from '../../components/Dialog.tsx';
import { Field, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { FileDrop } from '../../components/FileDrop.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PrivacyGuard, PrivacyWarning } from '../../components/PrivacyGuard.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { Segmented } from '../../components/Toolbar.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { aiErrorHelp } from '../../lib/ai.ts';
import { formatDate, formatDateTime } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { can } from '../../../../shared/roles.ts';
import type { DocListItem } from '../../../../shared/schemas/docs.ts';
import {
  KB_STATUS_LABELS, KB_VISIBILITY_LABELS, QUESTION_MAX, type AssistantMessage, type AssistantSource, type KbDocItem, type KbVisibility,
} from '../../../../shared/schemas/kb.ts';
import {
  addKbFromDocument, askAssistant, clearHistory, confirmRedact, deleteKbDoc, EXAMPLE_QUESTIONS, fetchHistory, fetchKbDoc, fetchKbDocs, findingsText,
  KB_ACCEPT, KB_MAX_BYTES, sourceHref, splitCitations, STATUS_TONE, uploadKbFile,
} from './assistantLib.ts';
import './docs-pages.css';
import './assistant.css';

const DEMO_MARK = '[데모 응답]';
type Tab = 'ask' | 'docs';

/** 오류를 화면 문구로 */
function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

// ───────────────────────── 질문하기 ─────────────────────────

/** 답 글(근거 번호는 근거 카드로 가는 링크) */
function AnswerText({ msg }: { msg: AssistantMessage }) {
  const text = msg.demo && msg.text.startsWith(DEMO_MARK) ? msg.text.slice(DEMO_MARK.length).trimStart() : msg.text;
  const known = new Set(msg.sources.map((s) => s.n));
  return (
    <p className="as-answer">
      {splitCitations(text).map((part, i) =>
        'text' in part ? (
          <span key={i}>{part.text}</span>
        ) : known.has(part.n) ? (
          <a key={i} className="as-cite" href={`#src-${msg.id}-${part.n}`}>
            [{part.n}]<span className="sr-only"> 근거로 가기</span>
          </a>
        ) : (
          <span key={i}>[{part.n}]</span>
        ),
      )}
    </p>
  );
}

/** 근거 카드 하나 */
function SourceCard({ msgId, s }: { msgId: number; s: AssistantSource }) {
  const path = s.heading.startsWith(`${s.title} > `) ? s.heading.slice(s.title.length + 3) : s.heading === s.title ? '' : s.heading;
  return (
    <li id={`src-${msgId}-${s.n}`} className="as-src" aria-label={`근거 ${s.n}: ${s.title}`}>
      <div className="as-src-head">
        <Chip tone="info">근거 {s.n}</Chip>
        <b className="as-src-title">{s.title}</b>
        {s.deleted ? <Chip tone="ghost">지워진 문서</Chip> : null}
      </div>
      {path ? <p className="as-src-path">{path}</p> : null}
      <blockquote className="as-src-excerpt">{s.excerpt}</blockquote>
      {s.deleted ? null : (
        <Link className="as-src-link" to={sourceHref(s.kbDocId, s.chunkId)}>
          <Icon name="doc" size="sm" /> 원문 보기<span className="sr-only">: {s.title}</span>
        </Link>
      )}
    </li>
  );
}

/** 대화 한 줄 */
function MessageItem({ msg, canManage, onUpload }: { msg: AssistantMessage; canManage: boolean; onUpload: () => void }) {
  if (msg.role === 'user') {
    return (
      <li className="as-msg as-user">
        <span className="sr-only">내 질문: </span>
        <p>{msg.text}</p>
      </li>
    );
  }
  return (
    <li className="as-msg as-bot" data-testid="assistant-answer" aria-label="도우미 답">
      <div className="as-bot-head">
        <Icon name="spark" size="sm" />
        <b>원내 AI 도우미</b>
        {msg.demo ? <Chip tone="ghost">데모 응답</Chip> : null}
        {!msg.found ? <Chip tone="warn">근거 없음</Chip> : null}
        <span className="as-time num">{formatDateTime(msg.createdAt)}</span>
      </div>
      <AnswerText msg={msg} />
      {msg.found && msg.sources.length ? (
        <div className="as-srcs">
          <h2>근거 문서</h2>
          <ol aria-label="근거">
            {msg.sources.map((s) => (
              <SourceCard key={s.n} msgId={msg.id} s={s} />
            ))}
          </ol>
        </div>
      ) : null}
      {!msg.found ? (
        <div className="as-nofound">
          {canManage ? (
            <Button size="sm" icon="upload" onClick={onUpload}>
              원내 문서 올리기
            </Button>
          ) : (
            <span className="doc-note">문서는 실장님 이상이 "원내 문서" 탭에서 올릴 수 있어요.</span>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** 대화 탭 */
function AskView({ canManage, onUpload }: { canManage: boolean; onUpload: () => void }) {
  const { info } = useSession();
  const isAdmin = info?.user?.role === 'admin';
  const history = useApi('assistant:history', fetchHistory);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; help: string | null } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const qId = useId();
  const warnId = `${qId}-warn`;
  const messages = history.data ?? [];

  // 새 답이 오면 아래로 내린다
  useEffect(() => {
    if (messages.length || pending) endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages.length, pending]);

  /** 질문을 보낸다 */
  const send = async (q: string) => {
    const text = q.trim();
    if (!text || pending) return;
    setPending(text);
    setError(null);
    try {
      await askAssistant(text);
      setQuestion('');
      invalidate('assistant:history');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'NETWORK';
      setError({ message: errorText(e, '답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.'), help: aiErrorHelp(code, isAdmin) });
    } finally {
      setPending(null);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(question);
  };
  /** Enter로 보내기(Shift+Enter는 줄 바꿈) */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(question);
    }
  };

  return (
    <article className="card as-chat" aria-label="도우미 대화" data-testid="assistant-chat" data-loaded={history.data ? 'true' : 'false'}>
      <div className="body">
        {history.loading && !history.data ? (
          <Skeleton rows={4} label="대화 기록을 불러오는 중" />
        ) : history.error && !history.data ? (
          <ErrorState message={errorText(history.error, '대화 기록을 불러오지 못했어요.')} onRetry={history.reload} />
        ) : messages.length === 0 && !pending ? (
          <EmptyState
            icon="spark"
            title="무엇이든 물어보세요"
            description="원내 매뉴얼·규정에서 찾아서, 근거 문서와 함께 답해 드려요."
            action={
              <div className="as-examples" role="group" aria-label="질문 예시">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <Button key={q} size="sm" variant="ghost" onClick={() => void send(q)}>
                    {q}
                  </Button>
                ))}
              </div>
            }
          />
        ) : (
          <ol className="as-list" aria-label="대화">
            {messages.map((m) => (
              <MessageItem key={m.id} msg={m} canManage={canManage} onUpload={onUpload} />
            ))}
            {pending ? (
              <>
                <li className="as-msg as-user">
                  <span className="sr-only">내 질문: </span>
                  <p>{pending}</p>
                </li>
                <li className="as-msg as-bot as-wait" role="status">
                  원내 문서에서 찾는 중이에요…
                </li>
              </>
            ) : null}
          </ol>
        )}
        <div ref={endRef} />
      </div>
      <form className="as-form" onSubmit={onSubmit} aria-label="질문 보내기">
        <PrivacyGuard />
        <Field label="질문" help="Enter로 보내고, Shift+Enter로 줄을 바꿔요.">
          <TextArea
            rows={2}
            value={question}
            maxLength={QUESTION_MAX}
            placeholder="예: 멸균기 B&D 테스트는 언제 해?"
            aria-describedby={warnId}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </Field>
        <PrivacyWarning text={question} id={warnId} />
        {error ? (
          <div className="form-error" role="alert" data-testid="ask-error">
            {error.message}
            {error.help ? <span className="as-help"> {error.help}</span> : null}
          </div>
        ) : null}
        <div className="doc-actions">
          <span className="doc-note grow">답은 원내 문서만 근거로 만들어요. 중요한 일은 근거 문서를 꼭 확인해 주세요.</span>
          <Button type="submit" variant="primary" icon="spark" loading={!!pending} disabled={!question.trim()}>
            질문하기
          </Button>
        </div>
      </form>
    </article>
  );
}

// ───────────────────────── 원내 문서 ─────────────────────────

/** 자료 올리기 대화상자 */
function UploadDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (item: KbDocItem) => void }) {
  const { info } = useSession();
  const [mode, setMode] = useState<'file' | 'document'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<KbVisibility>('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const docs = useApi(open && mode === 'document' ? 'docs:list:kb-pick' : null, () => api.page<DocListItem>('/api/documents?pageSize=200'));

  const reset = () => {
    setFile(null);
    setDocumentId('');
    setTitle('');
    setVisibility('all');
    setError(null);
    setMode('file');
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (mode === 'file' && !file) return setError('올릴 파일을 골라 주세요.');
    if (mode === 'document' && !documentId) return setError('서식 보관함 문서를 골라 주세요.');
    setBusy(true);
    setError(null);
    try {
      const item =
        mode === 'file' && file
          ? await uploadKbFile(info?.csrfToken ?? null, file, { title: title.trim(), visibility })
          : await addKbFromDocument({ documentId: Number(documentId), title: title.trim(), visibility });
      reset();
      onDone(item);
    } catch (e) {
      setError(errorText(e, '올리지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const docOptions = [{ value: '', label: docs.loading ? '불러오는 중…' : '문서를 골라 주세요' }, ...(docs.data?.data ?? []).map((d) => ({ value: String(d.id), label: d.title }))];

  return (
    <Dialog
      open={open}
      onClose={close}
      title="원내 문서 올리기"
      footer={
        <>
          <Button onClick={close}>닫기</Button>
          <Button variant="primary" icon="upload" loading={busy} onClick={() => void submit()}>
            올리기
          </Button>
        </>
      }
    >
      <div className="doc-form">
        <Segmented
          label="올릴 방법"
          value={mode}
          options={[
            { value: 'file', label: '파일 올리기' },
            { value: 'document', label: '서식 보관함에서 고르기' },
          ]}
          onChange={(v) => {
            setMode(v);
            setError(null);
          }}
        />
        {mode === 'file' ? (
          <>
            <FileDrop
              label="매뉴얼·규정 파일을 끌어다 놓거나 눌러서 고르세요"
              accept={KB_ACCEPT}
              maxBytes={KB_MAX_BYTES}
              onFiles={(fs) => {
                setFile(fs[0] ?? null);
                setError(null);
              }}
            />
            {file ? (
              <p className="doc-note" data-testid="kb-picked">
                고른 파일: <b>{file.name}</b>
              </p>
            ) : null}
            <p className="doc-note">TXT·MD·PDF·DOCX 파일(최대 20MB)에서 글을 꺼내 검색할 수 있게 나눠요. HWP는 PDF나 DOCX로 저장해서 올려 주세요.</p>
          </>
        ) : (
          <Field label="서식 보관함 문서" error={docs.error ? errorText(docs.error, '문서 목록을 불러오지 못했어요.') : undefined}>
            <Select value={documentId} onChange={(e) => setDocumentId(e.target.value)} options={docOptions} />
          </Field>
        )}
        <div className="doc-form-row two">
          <Field label="제목" help="비워 두면 문서의 첫 제목이나 파일 이름을 써요.">
            <TextInput value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="공개 범위" help="실장님 이상으로 두면 직원 질문의 근거로 쓰지 않아요.">
            <Select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as KbVisibility)}
              options={[
                { value: 'all', label: KB_VISIBILITY_LABELS.all },
                { value: 'manager', label: KB_VISIBILITY_LABELS.manager },
              ]}
            />
          </Field>
        </div>
        <p className="doc-note">올릴 때 전화번호·주민등록번호 같은 개인정보를 검사해요. 발견되면 가린 뒤 저장할지 물어봐요.</p>
        {error ? (
          <p className="form-error" role="alert" data-testid="kb-upload-error">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** 개인정보 검토 대화상자(가리고 저장 / 올리지 않기) */
function ReviewDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const toast = useToast();
  const detail = useApi(id ? `assistant:kbdoc:${id}` : null, () => fetchKbDoc(id as number));
  const [busy, setBusy] = useState<'redact' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = detail.data;

  const act = async (kind: 'redact' | 'cancel') => {
    if (!id) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'redact') {
        const item = await confirmRedact(id);
        toast.show(`가리고 저장했어요. 조각 ${item.chunkCount}개로 나눴어요.`);
      } else {
        await deleteKbDoc(id);
        toast.show('올리지 않고 지웠어요.');
      }
      invalidate('assistant:');
      onClose();
    } catch (e) {
      setError(errorText(e, '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={id !== null}
      onClose={onClose}
      title="개인정보 검토"
      footer={
        <>
          <Button loading={busy === 'cancel'} disabled={!!busy} onClick={() => void act('cancel')}>
            올리지 않기
          </Button>
          <Button variant="primary" icon="lock" loading={busy === 'redact'} disabled={!!busy || !d} onClick={() => void act('redact')}>
            가리고 저장
          </Button>
        </>
      }
    >
      {detail.loading && !d ? <Skeleton rows={3} label="검토할 내용을 불러오는 중" /> : null}
      {detail.error && !d ? <ErrorState message={errorText(detail.error, '검토할 내용을 불러오지 못했어요.')} onRetry={detail.reload} /> : null}
      {d ? (
        <div className="doc-form" data-testid="kb-review">
          <p className="doc-meta">
            <span>
              자료 <b>{d.title}</b>
            </span>
            <span>출처 {d.sourceName}</span>
          </p>
          <div className="doc-alert" role="status">
            <b>
              <Icon name="alert" size="sm" /> 개인정보로 보이는 내용이 있어요
            </b>
            <span data-testid="kb-findings">감지 항목: {findingsText(d.findings)}</span>
          </div>
          {d.samples.length ? (
            <>
              <p className="doc-note">"가리고 저장"을 누르면 아래처럼 가린 뒤 검색에 넣어요.</p>
              <ul className="as-samples" aria-label="가린 모습 미리보기">
                {d.samples.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="doc-note">개인정보를 지운 파일로 다시 올리려면 "올리지 않기"를 눌러 주세요.</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/** 원문 보기 대화상자(주소 ?doc=&chunk=) */
function SourceViewer({ id, chunkId, canManage, onClose }: { id: number | null; chunkId: number | null; canManage: boolean; onClose: () => void }) {
  const detail = useApi(id ? `assistant:kbdoc:${id}` : null, () => fetchKbDoc(id as number));
  const d = detail.data && detail.data.id === id ? detail.data : null;
  const boxRef = useRef<HTMLDivElement>(null);

  // 근거로 쓴 조각으로 내린다
  useEffect(() => {
    if (!d || !chunkId) return;
    const el = boxRef.current?.querySelector<HTMLElement>(`[data-chunk="${chunkId}"]`);
    el?.scrollIntoView?.({ block: 'start' });
  }, [d, chunkId]);

  return (
    <Dialog open={id !== null} onClose={onClose} title={d ? d.title : '원문 보기'} wide>
      {detail.loading && !d ? <Skeleton rows={5} label="원문을 불러오는 중" /> : null}
      {detail.error && !d ? <ErrorState title="원문을 열지 못했어요" message={errorText(detail.error, '원문을 불러오지 못했어요.')} onRetry={detail.reload} /> : null}
      {d ? (
        <div className="doc-form" data-testid="kb-viewer">
          <p className="doc-meta">
            <span>
              출처 <b>{d.sourceName}</b>
            </span>
            <span>공개 범위 {KB_VISIBILITY_LABELS[d.visibility]}</span>
            <span className="num">조각 {d.chunkCount}개</span>
            <span className="num">올린 날 {formatDate(d.createdAt)}</span>
          </p>
          {canManage && d.fileId ? (
            <p>
              <a className="btn sm" href={`/api/files/${d.fileId}`} download>
                <Icon name="doc" size="sm" /> 원본 파일 내려받기
              </a>
            </p>
          ) : null}
          <div className="as-viewer" ref={boxRef} tabIndex={0} role="region" aria-label={`${d.title} 원문`}>
            {d.chunks.map((c) => {
              const cited = c.id === chunkId;
              return (
                <section key={c.id} data-chunk={c.id} className={cited ? 'as-chunk cited' : 'as-chunk'} aria-current={cited ? 'true' : undefined}>
                  <h3>
                    {c.heading}
                    {cited ? <Chip tone="info">근거로 쓴 부분</Chip> : null}
                  </h3>
                  <p>{c.text}</p>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

/** 원내 문서 탭 */
function DocsView({ canManage, onUpload, onReview }: { canManage: boolean; onUpload: () => void; onReview: (id: number) => void }) {
  const toast = useToast();
  const list = useApi('assistant:kbdocs', fetchKbDocs);
  const [toDelete, setToDelete] = useState<KbDocItem | null>(null);

  const columns: Array<Column<KbDocItem>> = [
    {
      key: 'title',
      header: '제목',
      sortValue: (d) => d.title,
      render: (d) =>
        d.status === 'ready' ? (
          <Link className="doc-title-cell" to={sourceHref(d.id)}>
            {d.title}
          </Link>
        ) : (
          <span className="doc-title-cell">{d.title}</span>
        ),
    },
    { key: 'source', header: '출처', sortValue: (d) => d.sourceName, render: (d) => <span className="as-cell-wrap">{d.sourceName}</span> },
    {
      key: 'visibility',
      header: '공개 범위',
      sortValue: (d) => d.visibility,
      render: (d) => <Chip tone={d.visibility === 'manager' ? 'warn' : 'ghost'}>{KB_VISIBILITY_LABELS[d.visibility]}</Chip>,
    },
    {
      key: 'status',
      header: '상태',
      sortValue: (d) => d.status,
      render: (d) => (
        <span className="as-status">
          <Chip tone={STATUS_TONE[d.status]}>{KB_STATUS_LABELS[d.status]}</Chip>
          {d.status === 'failed' && d.error ? <span className="as-reason">{d.error}</span> : null}
          {d.status === 'needs_review' ? <span className="as-reason">감지 항목: {findingsText(d.findings)}</span> : null}
        </span>
      ),
    },
    { key: 'chunks', header: '조각 수', align: 'right', sortValue: (d) => d.chunkCount, render: (d) => <span className="num">{d.status === 'ready' ? `${d.chunkCount}개` : '—'}</span> },
    { key: 'createdAt', header: '올린 날', sortValue: (d) => d.createdAt, render: (d) => <span className="num">{formatDate(d.createdAt)}</span> },
  ];
  if (canManage) {
    columns.push({
      key: 'actions',
      header: '관리',
      render: (d) => (
        <span className="as-row-actions">
          {d.status === 'needs_review' ? (
            <Button size="sm" icon="lock" onClick={() => onReview(d.id)}>
              검토하기
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setToDelete(d)} aria-label={`${d.title} 지우기`}>
            지우기
          </Button>
        </span>
      ),
    });
  }

  return (
    <article className="card" aria-label="원내 문서 목록">
      <div className="body">
        <DataTable
          caption="원내 AI 도우미가 근거로 쓰는 문서"
          columns={columns}
          rows={list.data}
          rowKey={(d) => d.id}
          rowLabel={(d) => d.title}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          empty={
            <EmptyState
              icon="doc"
              title="아직 올린 원내 문서가 없어요"
              description={canManage ? '매뉴얼·규정을 올리면 직원 질문에 근거와 함께 답할 수 있어요.' : '실장님 이상이 매뉴얼·규정을 올리면 여기에 보여요.'}
              action={
                canManage ? (
                  <Button size="sm" icon="upload" onClick={onUpload}>
                    첫 문서 올리기
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>
      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        title="문서 지우기"
        danger
        confirmLabel="지우기"
        message={`"${toDelete?.title ?? ''}"을(를) 지울까요? 지우면 도우미가 더 이상 이 문서를 근거로 쓰지 않아요.`}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await deleteKbDoc(toDelete.id);
            toast.show('문서를 지웠어요.');
            invalidate('assistant:');
          } catch (e) {
            toast.show(errorText(e, '지우지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
          }
          setToDelete(null);
        }}
      />
    </article>
  );
}

// ───────────────────────── 화면 ─────────────────────────

/** 원내 AI 도우미 */
export default function AssistantPage() {
  const toast = useToast();
  const { info } = useSession();
  const canManage = can(info?.user?.role, 'kb.manage');
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'docs' ? 'docs' : 'ask';
  const docParam = Number(params.get('doc'));
  const chunkParam = Number(params.get('chunk'));
  const viewId = Number.isInteger(docParam) && docParam > 0 ? docParam : null;
  const chunkId = Number.isInteger(chunkParam) && chunkParam > 0 ? chunkParam : null;
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const history = useApi('assistant:history', fetchHistory);

  /** 주소 값 하나를 바꾼다(빈 값이면 지움) */
  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const openUpload = () => {
    setParam({ tab: 'docs' });
    setUploadOpen(true);
  };

  return (
    <>
      <PageHeader
        title="원내 AI 도우미"
        summary="원내 매뉴얼·규정에서 찾아 근거와 함께 답해요."
        actions={
          tab === 'docs' ? (
            canManage ? (
              <Button variant="primary" icon="upload" onClick={() => setUploadOpen(true)}>
                원내 문서 올리기
              </Button>
            ) : null
          ) : history.data?.length ? (
            <Button icon="refresh" onClick={() => setClearOpen(true)}>
              대화 지우기
            </Button>
          ) : null
        }
      />
      <div className="as-tabs">
        <Segmented
          label="도우미 화면"
          value={tab}
          options={[
            { value: 'ask', label: '대화' },
            { value: 'docs', label: '원내 문서' },
          ]}
          onChange={(v) => setParam({ tab: v === 'docs' ? 'docs' : null })}
        />
      </div>
      {tab === 'ask' ? <AskView canManage={canManage} onUpload={openUpload} /> : <DocsView canManage={canManage} onUpload={() => setUploadOpen(true)} onReview={setReviewId} />}
      {canManage ? (
        <>
          <UploadDialog
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            onDone={(item) => {
              setUploadOpen(false);
              invalidate('assistant:');
              invalidate('docs:');
              if (item.status === 'needs_review') {
                toast.show('개인정보로 보이는 내용이 있어 검토가 필요해요.');
                setReviewId(item.id);
              } else if (item.status === 'failed') {
                toast.show(`"${item.title}"을(를) 처리하지 못했어요. ${item.error ?? ''}`);
              } else {
                toast.show(`"${item.title}"을(를) 올렸어요. 조각 ${item.chunkCount}개로 나눴어요.`);
              }
            }}
          />
          <ReviewDialog id={reviewId} onClose={() => setReviewId(null)} />
        </>
      ) : null}
      <SourceViewer id={viewId} chunkId={chunkId} canManage={canManage} onClose={() => setParam({ doc: null, chunk: null })} />
      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="대화 지우기"
        danger
        confirmLabel="모두 지우기"
        message="내 대화 기록을 모두 지울까요? 지운 대화는 되살릴 수 없어요."
        onConfirm={async () => {
          try {
            await clearHistory();
            invalidate('assistant:history');
            toast.show('대화 기록을 지웠어요.');
          } catch (e) {
            toast.show(errorText(e, '지우지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
          }
          setClearOpen(false);
        }}
      />
    </>
  );
}

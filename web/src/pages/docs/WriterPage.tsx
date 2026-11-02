// 이 파일이 하는 일: "AI 문서 작성" 화면(/docs/writer, FR-060). 문서 종류·요점·분량·말투·등급을 고르면 AI 초안이 스트림으로 이어서 보이고 중간에 멈출 수 있다(AiPanel).
// 다 받은 초안은 오른쪽 편집기로 옮겨져 바로 고칠 수 있고(굵게·제목·목록), 고른 부분만 "다시 쓰기·더 짧게·더 공손하게"로 고칠 수 있다(doc_revise).
// "저장"을 누르면 서식 보관함에 버전 1로 남고, 다시 저장할 때마다 버전이 늘어난다. 아래에는 A4 종이 모양 미리보기가 있다(HTML은 해석하지 않음).
// 화면의 주 행동(채워진 청록)은 하나만: 초안이 없을 때는 "초안 만들기", 초안이 생기면 "저장"이다.
import { useId, useState } from 'react';
import { AiPanel } from '../../components/AiPanel.tsx';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { Field, Select, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { MarkdownEditor, MarkdownView } from '../../components/Markdown.tsx';
import { PaperPreview } from '../../components/PaperPreview.tsx';
import { useToast } from '../../components/Toast.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { aiErrorHelp, type AiResultView } from '../../lib/ai.ts';
import { formatDate } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate } from '../../lib/useApi.ts';
import { DOC_KIND_LABELS, type DocKind } from '../../../../shared/schemas/docs.ts';
import {
  createDocument,
  extractTitle,
  LENGTH_OPTIONS,
  parseTagText,
  replaceRange,
  REVISE_PRESETS,
  stripDemoMark,
  TONE_OPTIONS,
  updateDocument,
  withoutTitleLine,
  WRITER_KIND_OPTIONS,
  type DocLength,
} from './docsLib.ts';
import './docs-pages.css';

/** 저장한 문서(다시 저장하면 새 버전) */
interface Saved {
  id: number;
  version: number;
}

/** AI 문서 작성 */
export default function WriterPage() {
  const toast = useToast();
  const { info } = useSession();
  const isAdmin = info?.user?.role === 'admin';
  const clinic = info?.clinicName || '우리 병원';
  const editorId = useId();

  const [kind, setKind] = useState<DocKind>('notice_patient');
  const [length, setLength] = useState<DocLength>('medium');
  const [tone, setTone] = useState<string>(TONE_OPTIONS[0].value);
  const [tried, setTried] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [folder, setFolder] = useState('');
  const [tags, setTags] = useState('');
  const [demoDraft, setDemoDraft] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [revising, setRevising] = useState<string | null>(null);
  const [reviseError, setReviseError] = useState<{ message: string; help: string | null } | null>(null);
  const [reviseNote, setReviseNote] = useState<string | null>(null);

  const hasDraft = body.trim().length > 0;

  /** AI 초안을 다 받으면 편집기로 옮긴다 */
  const onResult = (r: AiResultView) => {
    const { text, demo } = stripDemoMark(r.text);
    setBody(text);
    setTitle(extractTitle(text) ?? DOC_KIND_LABELS[kind]);
    setDemoDraft(demo);
    setSaved(null);
    setSaveError(null);
    setReviseNote(null);
  };

  /** 고른 부분(없으면 전체)을 AI로 고친다 */
  const revise = async (label: string, instruction: string) => {
    const ta = document.getElementById(editorId) as HTMLTextAreaElement | null;
    const start = ta?.selectionStart ?? 0;
    const end = ta?.selectionEnd ?? 0;
    const target = start === end ? body : body.slice(Math.min(start, end), Math.max(start, end));
    if (!target.trim()) return;
    setRevising(label);
    setReviseError(null);
    setReviseNote(null);
    try {
      const r = await api.post<AiResultView>('/api/ai/run', { feature: 'doc_revise', input: { text: target, instruction } });
      const { text, demo } = stripDemoMark(r.text);
      const next = replaceRange(body, start, end, text);
      setBody(next.value);
      setReviseNote(`${start === end ? '전체를' : '고른 부분을'} "${label}"로 고쳤어요.${demo ? ' (데모 응답)' : ''}${r.privacy.notice ? ` ${r.privacy.notice}` : ''}`);
      requestAnimationFrame(() => {
        ta?.focus();
        ta?.setSelectionRange(next.start, next.end);
      });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setReviseError({
        message: err?.message ?? 'AI 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.',
        help: aiErrorHelp(err?.code ?? 'AI_UNAVAILABLE', isAdmin),
      });
    } finally {
      setRevising(null);
      invalidate('ai:');
    }
  };

  /** 서식 보관함에 저장(처음은 버전 1, 그 뒤는 새 버전) */
  const save = async () => {
    if (!title.trim()) {
      setTitleError('제목을 적어 주세요.');
      return;
    }
    setTitleError(null);
    setSaveError(null);
    setSaving(true);
    try {
      const doc = saved
        ? await updateDocument(saved.id, { title: title.trim(), body_md: body, folder: folder.trim(), tags: parseTagText(tags) })
        : await createDocument({ kind, title: title.trim(), body_md: body, folder: folder.trim(), tags: parseTagText(tags), source: 'ai' });
      setSaved({ id: doc.id, version: doc.version });
      invalidate('docs:');
      toast.show(`서식 보관함에 저장했어요(버전 ${doc.version}).`);
    } catch (e) {
      setSaveError(e instanceof ApiError ? (Object.values(e.fields ?? {})[0] ?? e.message) : '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="AI 문서 작성"
        summary="문서 종류와 요점을 적으면 AI가 초안을 써요. 고친 뒤 서식 보관함에 저장하세요."
        actions={
          <Button icon="doc" to="/docs/library">
            서식 보관함
          </Button>
        }
      />
      <div className="doc-cols">
        <Card title="무엇을 쓸까요" id="writer-input" className="doc-ai">
          <div className="doc-form">
            <div className="doc-form-row">
              <Field label="문서 종류">
                <Select value={kind} onChange={(e) => setKind(e.target.value as DocKind)} options={WRITER_KIND_OPTIONS} />
              </Field>
              <Field label="분량">
                <Select value={length} onChange={(e) => setLength(e.target.value as DocLength)} options={LENGTH_OPTIONS} />
              </Field>
              <Field label="말투">
                <Select value={tone} onChange={(e) => setTone(e.target.value)} options={TONE_OPTIONS} />
              </Field>
            </div>
            {kind === 'official' ? <p className="doc-note">공문은 수신·참조·제목·본문·붙임 순서로 써요.</p> : null}
            <AiPanel
              feature="doc_writer"
              label="요점"
              rows={6}
              placeholder="예: 임플란트 수술 후 주의사항, 거즈 2시간, 음주·흡연 금지, 이상하면 연락"
              buildInput={(points) => {
                // 실행할 때 불린다: 한 번이라도 만들었으면 단추 이름을 "다시 생성"으로 바꾼다(중지한 경우 포함)
                setTried(true);
                return { kind, points, length, tone };
              }}
              runLabel={tried || hasDraft ? '다시 생성' : '초안 만들기'}
              primary={!hasDraft}
              onResult={onResult}
            />
          </div>
        </Card>

        <Card title="초안 편집" id="writer-edit" sub={saved ? `버전 ${saved.version} 저장됨` : undefined}>
          {hasDraft ? (
            <div className="doc-form">
              {demoDraft ? (
                <p className="doc-note">
                  <Chip tone="ghost">데모 응답</Chip> AI 키가 없어 예시 초안을 넣었어요.
                </p>
              ) : null}
              <Field label="제목" error={titleError} required>
                <TextInput value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <MarkdownEditor id={editorId} label="본문" value={body} onChange={setBody} rows={14} />
              <div className="doc-revise" role="group" aria-label="AI로 부분 고치기">
                <b>AI로 고치기</b>
                {REVISE_PRESETS.map((p) => (
                  <Button key={p.label} size="sm" icon="spark" loading={revising === p.label} disabled={!!revising} onClick={() => void revise(p.label, p.instruction)}>
                    {p.label}
                  </Button>
                ))}
                <span className="doc-note">글을 고르면 그 부분만, 안 고르면 전체를 고쳐요.</span>
              </div>
              {reviseNote ? (
                <p className="doc-note" role="status">
                  {reviseNote}
                </p>
              ) : null}
              {reviseError ? (
                <div className="doc-alert" role="alert">
                  <b>
                    <Icon name="alert" size="md" />
                    {reviseError.message}
                  </b>
                  {reviseError.help ? <span>{reviseError.help}</span> : null}
                </div>
              ) : null}
              <div className="doc-form-row two">
                <Field label="폴더" help="예: 환자 안내, 공문">
                  <TextInput value={folder} maxLength={50} onChange={(e) => setFolder(e.target.value)} />
                </Field>
                <Field label="태그" help="쉼표로 나눠 적어요. 예: 임플란트, 수술 후">
                  <TextInput value={tags} onChange={(e) => setTags(e.target.value)} />
                </Field>
              </div>
              {saveError ? (
                <p className="form-error" role="alert">
                  {saveError}
                </p>
              ) : null}
              <div className="doc-actions">
                {saved ? (
                  <>
                    <Button size="sm" icon="doc" to={`/docs/library/${saved.id}`}>
                      보관함에서 보기
                    </Button>
                    <Button size="sm" icon="print" to={`/print/document/${saved.id}`}>
                      인쇄
                    </Button>
                  </>
                ) : null}
                <span className="grow" />
                <Button variant="primary" icon="check" loading={saving} onClick={() => void save()}>
                  {saved ? '새 버전으로 저장' : '저장'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="doc-note">왼쪽에서 초안을 만들면 여기에서 바로 고칠 수 있어요.</p>
          )}
        </Card>
      </div>

      {hasDraft ? (
        <Card title="미리보기" id="writer-preview" sub="A4 종이 모양">
          <PaperPreview headLeft={clinic} headRight={formatDate(new Date())} title={title || DOC_KIND_LABELS[kind]} sign={`${clinic} 원장`}>
            <MarkdownView text={withoutTitleLine(body)} />
          </PaperPreview>
        </Card>
      ) : null}
    </>
  );
}

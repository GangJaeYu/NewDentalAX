// 이 파일이 하는 일: 공지·인수인계 글 쓰기·고치기 대화상자(BoardPage·BoardDetailPage가 함께 씀, FR-040).
// 공지는 실장 이상만 고를 수 있고(직원에게는 종류 고르기 자체가 없음), 맨 위 고정은 공지에서 실장 이상만 켤 수 있다.
// 서버가 돌려준 입력 오류(fields)는 칸 아래에 보여 주고, 그 밖의 오류는 대화상자 위쪽에 쉬운 문구로 보여 준다.
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { Checkbox, Field, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { POST_CATEGORIES, POST_KIND_LABELS, type PostDetail, type PostKind } from '../../../../shared/schemas/desk.ts';

/** 대화상자에 처음 넣을 값 */
export interface PostFormValue {
  kind: PostKind;
  category: string;
  title: string;
  body: string;
  pinned: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 저장이 끝나면 서버가 돌려준 글을 넘긴다 */
  onSaved: (post: PostDetail) => void;
  /** 처음 값(고치기면 그 글의 값) */
  initial: PostFormValue;
  /** 고치는 글 번호(없으면 새 글) */
  editId?: number;
  /** 공지를 쓰고 고정할 수 있는지(실장 이상) */
  canNotice: boolean;
}

/** 분류 고르기 목록(지금 값이 추천 목록에 없으면 맨 앞에 더한다) */
function categoryOptions(kind: PostKind, current: string) {
  const list = [...POST_CATEGORIES[kind]];
  if (current && !list.includes(current)) list.unshift(current);
  return list.map((c) => ({ value: c, label: c }));
}

/** 글 쓰기·고치기 대화상자 */
export function PostFormDialog({ open, onClose, onSaved, initial, editId, canNotice }: Props) {
  const [form, setForm] = useState<PostFormValue>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const formId = editId ? `post-edit-${editId}` : 'post-create';

  const close = () => {
    setErrors({});
    setFormError(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setErrors({ title: '제목을 적어 주세요.' });
      setTimeout(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const body = { category: form.category, title: form.title.trim(), body: form.body, ...(form.kind === 'notice' && canNotice ? { pinned: form.pinned } : {}) };
      const saved = editId ? await api.patch<PostDetail>(`/api/posts/${editId}`, body) : await api.post<PostDetail>('/api/posts', { kind: form.kind, ...body });
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setFormError(err instanceof Error && err.message ? err.message : '저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const kindLabel = POST_KIND_LABELS[form.kind];
  return (
    <Dialog
      open={open}
      onClose={close}
      title={editId ? `${kindLabel} 고치기` : `${kindLabel} 쓰기`}
      footer={
        <>
          <Button onClick={close}>취소</Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {editId ? '저장' : '올리기'}
          </Button>
        </>
      }
    >
      <form id={formId} ref={formRef} className="post-form" onSubmit={submit} noValidate aria-label={editId ? `${kindLabel} 고치기` : `${kindLabel} 쓰기`}>
        {formError ? (
          <div className="form-error" role="alert">
            <Icon name="alert" size="md" />
            {formError}
          </div>
        ) : null}
        <div className="row2">
          {!editId && canNotice ? (
            <Field label="종류" required error={errors.kind}>
              <Select
                value={form.kind}
                onChange={(e) => {
                  const kind = e.target.value as PostKind;
                  setForm((f) => ({ ...f, kind, category: POST_CATEGORIES[kind][0] ?? '', pinned: kind === 'notice' ? f.pinned : false }));
                }}
                options={[
                  { value: 'notice', label: '공지' },
                  { value: 'handover', label: '인수인계' },
                ]}
              />
            </Field>
          ) : null}
          <Field label="분류" error={errors.category}>
            <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} options={categoryOptions(form.kind, form.category)} />
          </Field>
        </div>
        <Field label="제목" required error={errors.title}>
          <TextInput value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={100} autoComplete="off" />
        </Field>
        <Field label="내용" error={errors.body} help="환자 이름·연락처 같은 개인정보는 적지 마세요.">
          <TextArea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} rows={7} maxLength={10000} />
        </Field>
        {form.kind === 'notice' && canNotice ? (
          <Checkbox label="맨 위에 고정" hint="중요한 공지를 목록 맨 위에 계속 보여 줘요." checked={form.pinned} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} />
        ) : null}
      </form>
    </Dialog>
  );
}

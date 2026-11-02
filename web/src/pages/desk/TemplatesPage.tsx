// 이 파일이 하는 일: "안내 문자·안내문 템플릿" 화면(/desk/templates, FR-044). 템플릿을 쓰고 분류해 보관하며, 병원 정보 치환자({진료시간} 등)를 골라 넣는다(AC1).
// 미리보기는 치환자를 병원 정보로 바꾼 실제 글이고, 그 글의 바이트 수와 단문(90바이트 이하)/장문 표시를 보여 준다(AC2). 발송 기능은 없고 복사만 한다(AC3).
// 치환자 고르기 목록에는 환자 이름 같은 개인 정보 치환자가 없다. 글에 {이름} 등을 직접 적으면 경고하고, 서버도 저장을 막는다.
// AI(template)로 초안을 만들어 편집기로 가져올 수 있다. 보관함에서 "불러오기"를 누르면 편집기에 채워진다(공용 문구는 실장 이상만 고쳐 저장).
import { useRef, useState } from 'react';
import { AiPanel } from '../../components/AiPanel.tsx';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { Checkbox, Field, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api } from '../../lib/api.ts';
import { formatNumber } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate } from '../../lib/useApi.ts';
import { can } from '../../../../shared/roles.ts';
import {
  fillPlaceholders,
  PLACEHOLDERS,
  scanPlaceholders,
  SMS_KIND_LABELS,
  SMS_SHORT_BYTES,
  smsBytes,
  smsKind,
  TEMPLATE_CATEGORIES,
  type SavedText,
} from '../../../../shared/desk-texts.ts';
import { errorText, SavedTextLibrary, savedKey, saveText, stripDemo, useClinic } from './scriptLib.tsx';
import './script-ai.css';

type Length = 'short' | 'medium' | 'long';
const LENGTHS: ReadonlyArray<{ value: Length; label: string }> = [
  { value: 'short', label: '짧게(단문)' },
  { value: 'medium', label: '보통(장문)' },
  { value: 'long', label: '길게(안내문)' },
];

/** 편집 중인 템플릿 */
interface Draft {
  id: number | null;
  title: string;
  category: string;
  body: string;
  shared: boolean;
  canEdit: boolean;
}
const EMPTY: Draft = { id: null, title: '', category: TEMPLATE_CATEGORIES[0], body: '', shared: false, canEdit: true };

/** 안내 문자·안내문 템플릿 */
export default function TemplatesPage() {
  const toast = useToast();
  const { info } = useSession();
  const canShare = can(info?.user?.role, 'savedtexts.shared.edit');
  const clinic = useClinic();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pick, setPick] = useState(PLACEHOLDERS[0]?.key ?? '진료시간');
  const [length, setLength] = useState<Length>('short');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({});
  // 공용 TextArea는 ref를 받지 않아, 감싼 상자에서 입력창을 찾는다(커서 자리에 치환자 넣기)
  const bodyBox = useRef<HTMLDivElement | null>(null);
  const bodyEl = () => bodyBox.current?.querySelector('textarea') ?? null;

  const preview = fillPlaceholders(draft.body, clinic.data);
  const bytes = smsBytes(preview);
  const kind = smsKind(bytes);
  const scan = scanPlaceholders(draft.body);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  /** 고른 치환자를 커서 자리에 넣는다 */
  const insert = () => {
    const token = `{${pick}}`;
    const el = bodyEl();
    const start = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? draft.body.length;
    const next = draft.body.slice(0, start) + token + draft.body.slice(end);
    set({ body: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  /** 저장: 새 템플릿이거나 고칠 수 없는 공용 문구면 새로 만들고, 아니면 고친다 */
  const save = async () => {
    const errs: { title?: string; body?: string } = {};
    if (!draft.title.trim()) errs.title = '제목을 적어 주세요.';
    if (!draft.body.trim()) errs.body = '내용을 적어 주세요.';
    else if (scan.personal.length) errs.body = '환자 이름 같은 개인 정보 치환자는 쓸 수 없어요. "고객님"처럼 바꿔 주세요.';
    setErrors(errs);
    if (errs.title || errs.body) return;
    setSaving(true);
    try {
      const body = { category: draft.category, title: draft.title.trim(), body: draft.body };
      let saved: SavedText;
      if (draft.id !== null && draft.canEdit) {
        saved = await api.patch<SavedText>(`/api/saved-texts/${draft.id}`, { ...body, ...(canShare ? { shared: draft.shared } : {}) });
        invalidate(savedKey('template'));
      } else {
        saved = await saveText({ kind: 'template', ...body, shared: canShare && draft.shared });
      }
      setDraft({ id: saved.id, title: saved.title, category: saved.category, body: saved.body, shared: saved.shared, canEdit: saved.canEdit });
      toast.show('템플릿을 저장했어요.');
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  /** 보관함 항목을 편집기로 */
  const load = (t: SavedText) => {
    setDraft({ id: t.id, title: t.title, category: t.category, body: t.body, shared: t.shared, canEdit: t.canEdit });
    setErrors({});
    bodyEl()?.focus();
  };

  const kindTone = kind === 'short' ? 'ok' : kind === 'long' ? 'warn' : 'danger';
  const categories = TEMPLATE_CATEGORIES.includes(draft.category as (typeof TEMPLATE_CATEGORIES)[number]) ? TEMPLATE_CATEGORIES : [...TEMPLATE_CATEGORIES, draft.category];

  return (
    <>
      <PageHeader
        title="안내 문자·안내문 템플릿"
        summary="병원 정보 치환자({진료시간} 등)를 넣어 안내 문구를 만들고, 바뀐 글과 글자 수를 확인한 뒤 복사해 쓰세요. 문자를 직접 보내지는 않아요."
        actions={
          <Button
            icon="plus"
            onClick={() => {
              setDraft(EMPTY);
              setErrors({});
            }}
          >
            새 템플릿
          </Button>
        }
      />
      <div className="desk-cols">
        <Card title={draft.id !== null ? '템플릿 고치기' : '템플릿 쓰기'} id="tpl-edit">
          <div className="desk-form">
            <div className="desk-row">
              <Field label="제목" required error={errors.title}>
                <TextInput value={draft.title} maxLength={100} placeholder="예: 예약 하루 전 안내" onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label="분류">
                <Select value={draft.category} onChange={(e) => set({ category: e.target.value })} options={categories.map((c) => ({ value: c, label: c }))} />
              </Field>
            </div>
            <div className="ph-pick">
              <Field label="치환자">
                <Select value={pick} onChange={(e) => setPick(e.target.value)} options={PLACEHOLDERS.map((p) => ({ value: p.key, label: `{${p.key}} ${p.label}` }))} />
              </Field>
              <Button icon="plus" onClick={insert}>
                넣기
              </Button>
              <p className="desk-note">병원 정보에서 채워지는 자리를 커서 위치에 넣어요. 환자 이름 치환자는 제공하지 않아요.</p>
            </div>
            <div ref={bodyBox}>
              <Field label="내용" required error={errors.body}>
                <TextArea rows={6} value={draft.body} placeholder="예: [{병원이름}] {날짜} {시간} 예약 안내입니다. 문의 {대표번호}" onChange={(e) => set({ body: e.target.value })} />
              </Field>
            </div>
            {scan.personal.length ? (
              <div className="pii" role="alert">
                <Icon name="alert" size="md" />
                <span>
                  {scan.personal.map((k) => `{${k}}`).join(', ')}은(는) 환자 개인 정보 치환자라 쓸 수 없어요. "고객님"처럼 바꿔 주세요.
                </span>
              </div>
            ) : null}
            {scan.unknown.length ? (
              <p className="desk-note" role="status">
                {scan.unknown.map((k) => `{${k}}`).join(', ')}은(는) 없는 치환자라 그대로 보여요.
              </p>
            ) : null}
            {canShare ? <Checkbox label="공용 템플릿" hint="모든 직원이 함께 보고, 실장 이상만 고쳐요." checked={draft.shared} onChange={(e) => set({ shared: e.target.checked })} /> : null}
            {draft.id !== null && !draft.canEdit ? <p className="desk-note">공용 템플릿이라 고쳐 저장하면 내 보관함에 새로 저장돼요.</p> : null}
          </div>
        </Card>

        <Card title="미리보기" id="tpl-preview" sub="병원 정보로 바꾼 글">
          <div className="desk-form">
            <pre className={preview ? 'tpl-preview' : 'tpl-preview empty'} data-testid="template-preview">
              {preview || '내용을 적으면 여기에 병원 정보로 바꾼 글이 보여요.'}
            </pre>
            <div className="tpl-meta" data-testid="sms-bytes">
              <span className="num">
                {formatNumber(bytes)}바이트 / 단문 {SMS_SHORT_BYTES}바이트
              </span>
              <Chip tone={kindTone}>{SMS_KIND_LABELS[kind]}</Chip>
              {kind === 'long' ? <span>90바이트를 넘어 장문 문자로 보내져요.</span> : null}
              {kind === 'over' ? <span>장문 문자(2,000바이트)보다 길어요. 줄여 주세요.</span> : null}
            </div>
            <p className="desk-note">{'{날짜}·{시간}'} 자리는 복사한 뒤 직접 고쳐 주세요. 한글은 2바이트, 영문·숫자·빈칸은 1바이트로 셉니다.</p>
            <div className="tpl-actions">
              <span className="grow" />
              <CopyButton text={preview} label="바뀐 글 복사" />
              <Button variant="primary" icon="check" loading={saving} onClick={() => void save()}>
                템플릿 저장
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="desk-cols">
        <Card title="AI로 초안 만들기" id="tpl-ai">
          <div className="desk-form">
            <Field label="길이">
              <Select value={length} onChange={(e) => setLength(e.target.value as Length)} options={LENGTHS} />
            </Field>
            <AiPanel
              feature="template"
              label="무엇을 안내할까요"
              rows={3}
              placeholder="예: 연말 휴진 안내"
              buildInput={(purpose) => ({ purpose, length })}
              runLabel="초안 만들기"
              primary={false}
              resultActions={(r) => (
                <Button
                  size="sm"
                  icon="doc"
                  onClick={() => {
                    set({ body: stripDemo(r.text) });
                    toast.show('편집기로 가져왔어요. 고친 뒤 저장해 주세요.');
                  }}
                >
                  편집기로 가져오기
                </Button>
              )}
            />
          </div>
        </Card>
        <Card title="템플릿 보관함" id="tpl-lib">
          <SavedTextLibrary
            kind="template"
            categories={TEMPLATE_CATEGORIES}
            copyText={(t) => fillPlaceholders(t.body, clinic.data)}
            emptyHint="템플릿을 저장하면 여기에서 찾아 복사할 수 있어요."
            extraActions={(t) => (
              <Button size="sm" variant="ghost" icon="doc" onClick={() => load(t)} aria-label={`${t.title} 불러오기`}>
                불러오기
              </Button>
            )}
          />
        </Card>
      </div>
    </>
  );
}

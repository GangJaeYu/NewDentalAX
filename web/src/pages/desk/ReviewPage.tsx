// 이 파일이 하는 일: "리뷰 답글 초안" 화면(/desk/review, FR-043). 리뷰를 붙여 넣고 말투를 2~3개 고르면 AI(review_reply)가 말투별 답글 초안을 만든다(AC1).
// 리뷰 속 전화번호 등은 개인정보 필터가 가린 뒤 보내고, 가린 사실을 결과 아래에 안내한다(AiPanel). 초안은 고쳐 쓰고, 복사하거나 보관함에 저장한다.
// 답글에 진료 사실을 확인해 주는 표현(치료 받으신·내원·치료 이름·진료 기록)이 있으면 초안마다 경고한다(AC2, shared/desk-texts.ts 규칙).
// 의료광고 점검(FR-120)은 아직 연결 전이라 점검 안내만 보여 준다(AC2).
import { useState } from 'react';
import { AiPanel } from '../../components/AiPanel.tsx';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { Checkbox, Field, TextArea } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useToast } from '../../components/Toast.tsx';
import type { AiResultView } from '../../lib/ai.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { checkReplyFacts, REVIEW_TONES } from '../../../../shared/desk-texts.ts';
import { errorText, SavedTextLibrary, saveText, stripDemo } from './scriptLib.tsx';
import './script-ai.css';

/** AI 결과(extra)에서 답글 목록을 꺼낸다(모양이 틀리면 빈 목록) */
function readReplies(extra: unknown): Array<{ tone: string; text: string }> {
  const list = (extra as { replies?: unknown } | null | undefined)?.replies;
  if (!Array.isArray(list)) return [];
  return list
    .filter((r): r is { tone: string; text: string } => !!r && typeof (r as { tone?: unknown }).tone === 'string' && typeof (r as { text?: unknown }).text === 'string')
    .map((r) => ({ tone: r.tone, text: stripDemo(r.text) }));
}

/** 답글 초안 하나(고쳐 쓰기·점검·복사·저장) */
function ReplyDraft({ tone, initial, index, shared }: { tone: string; initial: string; index: number; shared: boolean }) {
  const toast = useToast();
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const hits = checkReplyFacts(text);

  const save = async () => {
    setSaving(true);
    try {
      await saveText({ kind: 'review_reply', category: '리뷰 답글', title: `리뷰 답글 초안(${tone})`, body: text.trim(), meta: { tone }, shared });
      setSaved(true);
      toast.show('답글을 보관함에 저장했어요.');
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <li data-testid="reply-draft">
      <div className="reply-actions">
        <Chip tone="info">{tone}</Chip>
        <b>초안 {index + 1}</b>
        <span className="grow" />
        {hits.length === 0 ? (
          <span className="reply-ok">
            <Icon name="check" size="sm" />
            진료 사실 확인 표현 없음
          </span>
        ) : null}
      </div>
      <Field label={`${tone} 답글`}>
        <TextArea
          rows={4}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
        />
      </Field>
      {hits.length ? (
        <div className="reply-warn" role="alert">
          <b>
            <Icon name="alert" size="md" />
            진료 사실을 확인해 주는 표현이 있어요
          </b>
          <ul>
            {hits.map((h) => (
              <li key={h.phrase}>
                "{h.phrase}": {h.reason} {h.suggestion}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="reply-actions">
        <span className="grow" />
        <CopyButton text={text.trim()} />
        <Button size="sm" icon={saved ? 'check' : 'plus'} loading={saving} disabled={saved || !text.trim()} onClick={() => void save()}>
          {saved ? '저장했어요' : '보관함에 저장'}
        </Button>
      </div>
    </li>
  );
}

/** 리뷰 답글 초안 */
export default function ReviewPage() {
  const { info } = useSession();
  const canShare = can(info?.user?.role, 'savedtexts.shared.edit');
  const [tones, setTones] = useState<string[]>([...REVIEW_TONES]);
  const [share, setShare] = useState(false);

  const toggle = (t: string, on: boolean) => {
    setTones((cur) => {
      if (on) return REVIEW_TONES.filter((x) => x === t || cur.includes(x));
      // 2개보다 적게는 고를 수 없다
      return cur.length <= 2 ? cur : cur.filter((x) => x !== t);
    });
  };

  const renderReplies = (r: AiResultView) => {
    const replies = readReplies(r.extra);
    if (!replies.length) return <p className="desk-note">AI 응답을 이해하지 못했습니다. 다시 시도해 주세요.</p>;
    return (
      <ul className="reply-drafts" aria-label="답글 초안">
        {replies.map((rep, i) => (
          <ReplyDraft key={`${r.requestId}-${i}`} tone={rep.tone} initial={rep.text} index={i} shared={canShare && share} />
        ))}
      </ul>
    );
  };

  return (
    <>
      <PageHeader title="리뷰 답글 초안" summary="온라인 리뷰를 붙여 넣으면 말투별 답글 초안을 2~3개 만들어 드려요. 진료 사실을 밝히는 표현이 있으면 알려 드려요." />
      <div className="desk-cols">
        <Card title="리뷰 붙여 넣기" id="review-make">
          <div className="desk-form">
            <fieldset className="tone-pick">
              <legend>말투(2~3개)</legend>
              {REVIEW_TONES.map((t) => (
                <Checkbox key={t} label={t} checked={tones.includes(t)} disabled={tones.includes(t) && tones.length <= 2} onChange={(e) => toggle(t, e.target.checked)} />
              ))}
              <span className="help">고른 말투마다 답글 초안이 하나씩 나와요. 2개보다 적게는 고를 수 없어요.</span>
            </fieldset>
            {canShare ? <Checkbox label="답글을 공용 보관함에 저장" hint="모든 직원이 함께 볼 수 있어요." checked={share} onChange={(e) => setShare(e.target.checked)} /> : null}
            <AiPanel
              feature="review_reply"
              label="리뷰 내용"
              rows={5}
              placeholder="예: 직원분들이 친절하고 설명도 자세했어요. 대기 시간이 조금 길었던 건 아쉬워요."
              buildInput={(review) => ({ review, tones })}
              runLabel="답글 초안 만들기"
              renderResult={renderReplies}
            />
            <div className="adcheck-note" role="note" data-testid="adcheck-note">
              <Icon name="shield" size="md" />
              <span>
                <b>의료광고 점검 안내</b> · 자동 점검 기능이 아직 연결되지 않아 안내만 드려요. 올리기 전에 치료 효과를 장담하거나, 다른 병원과 비교하거나, 할인을 강조하는 표현이 없는지
                확인해 주세요.
              </span>
            </div>
          </div>
        </Card>
        <Card title="답글 보관함" id="review-lib">
          <SavedTextLibrary kind="review_reply" categories={['리뷰 답글', '좋은 리뷰', '아쉬운 리뷰']} emptyHint="마음에 드는 답글 초안을 저장하면 여기에서 다시 쓸 수 있어요." />
        </Card>
      </div>
    </>
  );
}

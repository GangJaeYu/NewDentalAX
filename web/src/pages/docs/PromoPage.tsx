// 이 파일이 하는 일: "블로그·SNS 홍보 글" 화면(/docs/promo, FR-121). 올릴 곳(블로그·인스타그램)·분량·주제를 정하면 AI(promo)가 초안을 쓰고,
// 다 받으면 그 초안으로 의료광고 문구 점검(POST /api/adcheck, 규칙 + AI 2차)을 자동으로 이어서 해 결과를 함께 보여 준다(FR-121 AC1).
// 오른쪽에서 초안을 고친 뒤 "다시 점검"을 누를 수 있고, 복사해 쓴다. 화면의 주 행동(채워진 청록)은 "초안 만들기" 하나다.
import { useRef, useState } from 'react';
import { AiPanel } from '../../components/AiPanel.tsx';
import { AdCheckResult } from '../../components/AdCheckResult.tsx';
import { checkAdText, isSameText, stripDemo } from '../../components/adcheck.ts';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { Field, Select, TextArea } from '../../components/Field.tsx';
import { Skeleton } from '../../components/States.tsx';
import { ApiError } from '../../lib/api.ts';
import type { AiResultView } from '../../lib/ai.ts';
import { invalidate } from '../../lib/useApi.ts';
import type { AdcheckResponse } from '../../../../shared/schemas/adcheck.ts';
import './adcheck.css';

const CHANNEL_OPTIONS = [
  { value: '블로그', label: '블로그' },
  { value: '인스타그램', label: '인스타그램' },
];
const LENGTH_OPTIONS = [
  { value: 'short', label: '짧게(300자 안팎)' },
  { value: 'medium', label: '보통(700자 안팎)' },
  { value: 'long', label: '길게(1,200자 안팎)' },
];
type PromoLength = 'short' | 'medium' | 'long';

/** 블로그·SNS 홍보 글 */
export default function PromoPage() {
  const [channel, setChannel] = useState('블로그');
  const [length, setLength] = useState<PromoLength>('medium');
  const [tried, setTried] = useState(false);
  const [draft, setDraft] = useState('');
  const [demo, setDemo] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<AdcheckResponse | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const seq = useRef(0);

  /** 초안을 점검한다(늦게 끝난 옛 점검이 새 결과를 덮지 않게 번호를 붙임) */
  const runCheck = async (text: string) => {
    if (!text.trim()) return;
    const my = ++seq.current;
    setChecking(true);
    setCheckError(null);
    try {
      const r = await checkAdText(text, true);
      if (my === seq.current) setCheck(r);
    } catch (e) {
      if (my === seq.current) setCheckError(e instanceof ApiError ? (Object.values(e.fields ?? {})[0] ?? e.message) : '점검하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      if (my === seq.current) setChecking(false);
      invalidate('ai:');
    }
  };

  /** AI 초안을 다 받으면 오른쪽으로 옮기고 바로 점검한다 */
  const onResult = (r: AiResultView) => {
    const text = stripDemo(r.text);
    setDraft(text);
    setDemo(r.demo);
    setCheck(null);
    void runCheck(text);
  };

  const hasDraft = draft.trim().length > 0;
  const stale = !!check && !isSameText(check, draft);

  return (
    <>
      <PageHeader
        title="블로그·SNS 홍보 글"
        summary="주제와 올릴 곳을 고르면 AI가 초안을 쓰고, 의료광고 문구 점검을 바로 이어서 해요."
        actions={
          <Button icon="shield" to="/docs/adcheck">
            광고 문구 점검
          </Button>
        }
      />
      <div className="adc-cols">
        <Card title="무엇을 쓸까요" id="promo-input" className={hasDraft ? 'promo-ai promo-done' : 'promo-ai'}>
          <div className="adc-form">
            <div className="adc-form-row">
              <Field label="올릴 곳">
                <Select value={channel} options={CHANNEL_OPTIONS} onChange={(e) => setChannel(e.target.value)} />
              </Field>
              <Field label="분량">
                <Select value={length} options={LENGTH_OPTIONS} onChange={(e) => setLength(e.target.value as PromoLength)} />
              </Field>
            </div>
            <AiPanel
              feature="promo"
              label="주제"
              rows={4}
              placeholder="예: 스케일링 주기 안내, 올바른 칫솔질 방법"
              buildInput={(topic) => {
                // 실행할 때 불린다: 새 초안을 받는 동안 왼쪽 AI 상자에 글이 이어서 보이도록 오른쪽 초안·점검을 비운다
                setTried(true);
                seq.current += 1;
                setDraft('');
                setCheck(null);
                setChecking(false);
                return { topic, channel, length };
              }}
              runLabel={tried ? '다시 만들기' : '초안 만들기'}
              onResult={onResult}
            />
          </div>
        </Card>

        <Card title="초안과 광고 문구 점검" id="promo-check">
          {hasDraft ? (
            <div className="adc-form">
              {demo ? (
                <p className="adc-muted">
                  <Chip tone="ghost">데모 응답</Chip> AI 키가 없어 예시 초안을 넣었어요.
                </p>
              ) : null}
              <Field label="초안" help="고친 뒤 '다시 점검'을 누르면 고친 글로 점검해요.">
                <TextArea rows={10} value={draft} maxLength={8000} onChange={(e) => setDraft(e.target.value)} />
              </Field>
              <div className="adc-actions">
                {stale ? <span className="adc-muted">초안이 바뀌었어요. 다시 점검해 주세요.</span> : null}
                <span className="grow" />
                <CopyButton text={draft} />
                <Button size="sm" icon="shield" loading={checking} disabled={checking} onClick={() => void runCheck(draft)}>
                  다시 점검
                </Button>
              </div>
              {checkError ? (
                <p className="form-error" role="alert">
                  {checkError}
                </p>
              ) : null}
              {checking && !check ? <Skeleton rows={4} label="광고 문구 점검 중" /> : null}
              {check ? <AdCheckResult result={check} /> : null}
            </div>
          ) : (
            <p className="adc-muted">왼쪽에서 초안을 만들면 여기에서 광고 문구 점검 결과와 함께 보여요.</p>
          )}
        </Card>
      </div>
    </>
  );
}

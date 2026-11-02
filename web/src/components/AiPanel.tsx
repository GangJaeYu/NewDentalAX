// 이 파일이 하는 일: AI 공용 입력·실행 부품 AiPanel(frontend.md §2). 순서: 빨간 개인정보 안내 → 입력창 → 노란 입력 경고 → 등급(예상 비용) →
// 실행·중지 → 스트림으로 받는 결과 → 개인정보 처리 결과("전화번호 1건을 가리고 보냈습니다") → 비용 → "참고용·법률 자문 아님" 고지.
// 오류(예산 초과·키 오류·시간 초과 등, backend.md §5)는 서버의 한국어 문구와 다음에 할 일을 함께 보여 준다(FR-037). 기술 오류 원문은 보이지 않는다.
// 관리자가 끈 기능이면 입력 대신 비활성 안내를 보인다(GET /api/ai/status, FR-033 AC3). 각 AI 화면은 feature와 buildInput만 넘겨 쓴다.
// JSON 기능(리뷰 답글 등)은 renderResult로 날 JSON 대신 화면별 구조를 보여 줄 수 있다(phase-03-task-05). 결과 상자는 키보드로 초점을 받아 스크롤할 수 있다.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AI_FEATURES, AI_TIER_LABELS, AI_TIERS, type AiFeatureId, type AiTier } from '../../../shared/ai-features.ts';
import { ApiError } from '../lib/api.ts';
import { aiErrorHelp, costText, estimateCostKrw, fetchAiStatus, formatSmallWon, runAiStream, tierCostLabel, type AiResultView } from '../lib/ai.ts';
import { formatNumber } from '../lib/format.ts';
import { useSession } from '../lib/session.tsx';
import { invalidate, useApi } from '../lib/useApi.ts';
import { Button } from './Button.tsx';
import { Chip } from './Chip.tsx';
import { CopyButton } from './CopyButton.tsx';
import { Field, TextArea } from './Field.tsx';
import { Icon } from './Icon.tsx';
import { PrivacyGuard, PrivacyWarning } from './PrivacyGuard.tsx';
import './AiPanel.css';

/** 법률 고지(FR-038 AC1) */
export const AI_DISCLAIMER = 'AI 초안은 참고용이며 법률 자문을 대신하지 않습니다.';

interface AiPanelProps {
  /** AI 기능 id(shared/ai-features.ts) */
  feature: AiFeatureId;
  /** 입력창 이름 */
  label?: string;
  placeholder?: string;
  rows?: number;
  /** 처음 입력값 */
  initialText?: string;
  /** 입력 글을 서버 input 모양으로 바꾼다(기본: 글 그대로) */
  buildInput?: (text: string) => unknown;
  /** 실행 버튼 글자 */
  runLabel?: string;
  /** 실행 버튼을 화면의 주 행동(채워진 청록)으로 그릴지. 화면에 다른 주 행동이 있으면 false */
  primary?: boolean;
  /** 결과가 오면 부른다(저장 등 화면별 처리) */
  onResult?: (r: AiResultView) => void;
  /** 결과 아래 버튼(복사 옆에 붙는 저장·인쇄 등) */
  resultActions?: (r: AiResultView) => ReactNode;
  /**
   * 결과를 글 상자 대신 직접 그린다(JSON 기능용). 주면 받는 중에는 날 JSON 대신 "기다리는 중" 안내만 보이고,
   * 결과가 오면 이 함수가 그린 내용이 결과 상자 자리에 들어간다. 이때 기본 "복사" 버튼은 빠진다(화면이 항목별 복사를 둔다).
   */
  renderResult?: (r: AiResultView) => ReactNode;
  /** 입력창을 비워도 실행할 수 있는지(기본 false: 비우면 "적어 주세요" 안내) */
  allowEmpty?: boolean;
}

/** 화면에 보여 줄 오류 */
interface PanelError {
  code: string;
  message: string;
}

/** AI 입력·실행·결과 부품 */
export function AiPanel({
  feature,
  label = '요청 내용',
  placeholder,
  rows = 4,
  initialText = '',
  buildInput = (t) => t,
  runLabel = '실행',
  primary = true,
  onResult,
  resultActions,
  renderResult,
  allowEmpty = false,
}: AiPanelProps) {
  const status = useApi('ai:status', fetchAiStatus);
  const { info } = useSession();
  const isAdmin = info?.user?.role === 'admin';
  const def = AI_FEATURES[feature];
  const feat = status.data?.features.find((f) => f.id === feature);
  const demo = status.data?.demo ?? false;
  const [text, setText] = useState(initialText);
  const [tier, setTier] = useState<AiTier | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [result, setResult] = useState<AiResultView | null>(null);
  const [error, setError] = useState<PanelError | null>(null);
  const [stopped, setStopped] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const tierName = useId();

  // 화면을 떠나면 진행 중인 요청을 끊는다
  useEffect(() => () => ctrl.current?.abort(), []);

  const userTier = feat?.userTier ?? def.userTier;
  const chosenTier: AiTier = (userTier && tier) || feat?.tier || def.tier;
  const costOf = (t: AiTier) => estimateCostKrw(text, feature, status.data?.pricing?.tiers?.[t], status.data?.pricing?.fxKrwPerUsd);
  const disabled = !!feat && !feat.allowed;

  /** 실행 */
  const run = async () => {
    if (!allowEmpty && !text.trim()) {
      setInputError(`${label}을 적어 주세요.`);
      return;
    }
    setInputError(null);
    setError(null);
    setResult(null);
    setStopped(false);
    setStreamText('');
    setRunning(true);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const r = await runAiStream(
        { feature, input: buildInput(text), ...(userTier ? { tier: chosenTier } : {}) },
        { onDelta: (t) => setStreamText((s) => s + t) },
        c.signal,
      );
      setResult(r);
      setStreamText(r.text);
      onResult?.(r);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        setStopped(true);
      } else if (e instanceof ApiError) {
        setError({ code: e.code, message: e.message });
      } else {
        setError({ code: 'AI_UNAVAILABLE', message: 'AI 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.' });
      }
    } finally {
      if (ctrl.current === c) ctrl.current = null;
      setRunning(false);
      // 예산·사용량 숫자가 바뀌었을 수 있다
      invalidate('ai:');
    }
  };

  /** 중지 */
  const stop = () => ctrl.current?.abort();

  if (disabled) {
    return (
      <div className="ai-panel">
        <div className="ai-off" role="status">
          <Icon name="lock" size="md" />
          <span>관리자가 이 AI 기능을 꺼 두었습니다. {aiErrorHelp('AI_DISABLED', isAdmin)}</span>
        </div>
      </div>
    );
  }

  const help = error ? aiErrorHelp(error.code, isAdmin) : null;
  const shown = result ? result.text : streamText;
  // 구조로 보여 주는 기능은 받는 중인 날 JSON 조각을 보이지 않는다
  const structured = !!renderResult && !!result;
  const boxText = renderResult ? (running ? '답을 기다리는 중이에요…' : '') : shown || (running ? '답을 기다리는 중이에요…' : '');

  return (
    <div className="ai-panel" data-testid={`ai-panel-${feature}`}>
      <PrivacyGuard />
      <Field label={label} error={inputError}>
        <TextArea
          rows={rows}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          disabled={running}
        />
      </Field>
      <PrivacyWarning text={text} />

      {userTier ? (
        <fieldset className="tiers">
          <legend>모델 등급</legend>
          {AI_TIERS.map((t) => (
            <label key={t}>
              <input type="radio" name={tierName} value={t} checked={chosenTier === t} onChange={() => setTier(t)} disabled={running} />
              {AI_TIER_LABELS[t]}
              <small className="num">{costText(costOf(t), demo)}</small>
            </label>
          ))}
        </fieldset>
      ) : null}

      {status.data?.budget.exceeded ? (
        <div className="pii" role="status">
          <Icon name="alert" size="md" />
          <span>이번 달 AI 예산을 모두 사용했습니다. 관리자에게 한도 조정을 요청하세요.</span>
        </div>
      ) : null}

      <div className="ai-actions">
        <span className="ai-meta num">
          {demo ? <Chip tone="ghost">데모 응답</Chip> : null}
          {userTier ? null : <span>{tierCostLabel(chosenTier, costOf(chosenTier), demo)}</span>}
        </span>
        <span className="grow" />
        {running ? (
          <Button size="sm" icon="close" onClick={stop}>
            중지
          </Button>
        ) : null}
        <Button size="sm" variant={primary ? 'primary' : 'default'} icon="spark" loading={running} onClick={run}>
          {running ? '만드는 중' : runLabel}
        </Button>
      </div>

      {error ? (
        <div className="ai-error" role="alert">
          <b>
            <Icon name="alert" size="md" />
            {error.message}
          </b>
          {help ? <span>{help}</span> : null}
        </div>
      ) : null}

      {running || shown || stopped ? (
        <section className="ai-result" aria-label="AI 결과">
          <div className="ai-result-head">
            <b>결과</b>
            {result?.demo ? <Chip tone="ghost">데모 응답</Chip> : null}
            {running ? <Chip tone="info">받는 중</Chip> : null}
            {stopped ? <Chip tone="warn">중지함</Chip> : null}
          </div>
          {structured && result ? (
            <div className="ai-structured" data-testid="ai-output">
              {renderResult?.(result)}
            </div>
          ) : (
            // 높이 제한으로 스크롤이 생기므로 키보드로 초점을 받을 수 있게 한다(접근성 scrollable-region-focusable)
            <div className="ai-out" role="region" tabIndex={0} aria-label="AI 결과 글" aria-live="polite" aria-busy={running} data-testid="ai-output">
              {boxText}
            </div>
          )}
          {stopped ? <p className="ai-disclaimer">중지했어요. 지금까지 받은 글만 보여요.</p> : null}
          {result?.privacy.notice ? (
            <div className="ai-note" role="status" data-testid="ai-privacy-notice">
              <Icon name="lock" size="md" />
              <span>{result.privacy.notice}</span>
            </div>
          ) : null}
          {result && result.privacy.outputFindings.length > 0 ? (
            <div className="ai-note" role="status">
              <Icon name="lock" size="md" />
              <span>AI 답에 있던 개인정보로 보이는 내용 {formatNumber(result.privacy.outputFindings.reduce((s, f) => s + f.count, 0))}건도 가렸습니다.</span>
            </div>
          ) : null}
          {result ? (
            <div className="ai-actions">
              <span className="ai-cost num" data-testid="ai-cost">
                {result.demo
                  ? '데모 응답 · 비용 0원'
                  : `${AI_TIER_LABELS[result.tier]} · 비용 ${formatSmallWon(result.usage.costKrw)}${result.usage.estimated ? '(추정)' : ''} · 입력 ${formatNumber(result.usage.inputTokens)} · 출력 ${formatNumber(result.usage.outputTokens)} 토큰`}
              </span>
              <span className="grow" />
              {renderResult ? null : <CopyButton text={result.text} />}
              {resultActions?.(result)}
            </div>
          ) : null}
        </section>
      ) : null}

      <p className="ai-disclaimer">{AI_DISCLAIMER}</p>
    </div>
  );
}

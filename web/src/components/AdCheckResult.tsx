// 이 파일이 하는 일: 의료광고 문구 점검 결과 부품(FR-120). 점검한 글에 위험 표현을 번호와 함께 하이라이트하고, 표현마다 위험도(글자 칩)·분류·이유·바꿀 말을 보여 준다.
// AI 2차 점검 결과(더 찾은 표현·전체 의견)나, AI를 못 쓴 이유(꺼짐·예산 초과 등)를 아래에 붙이고, 맨 끝에 "법률 자문이 아니며…" 고지를 항상 붙인다(FR-120 AC2).
// AdCheckButton은 다른 화면(문서 작성기, 리뷰 답글)에 넣는 "광고 문구 점검" 버튼이다: <AdCheckButton text={글} /> 하나로 점검·결과 표시까지 한다.
// 색만으로 구분하지 않도록 하이라이트에는 번호, 칩에는 "위험·주의" 글자를 붙인다(DESIGN §5).
import { useState } from 'react';
import { ADCHECK_NOTICE, AD_RULE_CATEGORY_LABELS, AD_SEVERITY_LABELS, type AdcheckResponse } from '../../../shared/schemas/adcheck.ts';
import { ApiError } from '../lib/api.ts';
import { aiErrorHelp } from '../lib/ai.ts';
import { useSession } from '../lib/session.tsx';
import { invalidate } from '../lib/useApi.ts';
import { checkAdText, countSeverity, isSameText, splitHighlights } from './adcheck.ts';
import { Button } from './Button.tsx';
import { Chip } from './Chip.tsx';
import { Icon } from './Icon.tsx';
import './AdCheckResult.css';

/** 점검 결과 보기 */
export function AdCheckResult({ result, title = '광고 문구 점검 결과' }: { result: AdcheckResponse; title?: string }) {
  const { info } = useSession();
  const isAdmin = info?.user?.role === 'admin';
  const { high, medium } = countSeverity(result.ruleHits);
  const pieces = splitHighlights(result.text, result.ruleHits);
  const report = result.ai?.report ?? null;

  return (
    <section className="adc" aria-label={title} data-testid="adcheck-result">
      <div className="adc-head">
        <b>{title}</b>
        {result.ruleHits.length ? (
          <>
            {high ? <Chip tone="danger">위험 {high}건</Chip> : null}
            {medium ? <Chip tone="warn">주의 {medium}건</Chip> : null}
          </>
        ) : (
          <Chip tone="ok">규칙에 걸린 표현 없음</Chip>
        )}
      </div>

      <div className="adc-text" data-testid="adcheck-text">
        {pieces.map((p, i) =>
          p.hit ? (
            <mark key={i} className={`adc-mark ${p.hit.severity}`} title={`${p.no}. ${AD_SEVERITY_LABELS[p.hit.severity]}: ${p.hit.reason}`}>
              {p.text}
              <sup className="adc-no">{p.no}</sup>
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </div>

      {result.ruleHits.length ? (
        <ol className="adc-list" aria-label="규칙에 걸린 표현">
          {result.ruleHits.map((h, i) => (
            <li key={`${h.start}-${h.ruleId}`} data-testid="adcheck-hit">
              <div className="adc-hit-head">
                <span className="adc-no-badge num" aria-hidden="true">
                  {i + 1}
                </span>
                <b className="adc-phrase">“{h.phrase}”</b>
                <Chip tone={h.severity === 'high' ? 'danger' : 'warn'}>{AD_SEVERITY_LABELS[h.severity]}</Chip>
                <Chip tone="ghost">{AD_RULE_CATEGORY_LABELS[h.category]}</Chip>
              </div>
              <p>
                <span className="adc-label">이유</span>
                {h.reason}
              </p>
              <p>
                <span className="adc-label">바꿀 말</span>
                {h.suggestion}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="adc-muted">규칙 사전에 있는 위험 표현은 찾지 못했어요. 그래도 효과를 장담하거나 다른 병원과 비교하는 말이 없는지 한 번 더 읽어 봐 주세요.</p>
      )}

      {result.ai || result.aiError ? (
        <div className="adc-ai" data-testid="adcheck-ai">
          <div className="adc-head">
            <b>AI 2차 점검</b>
            {result.ai?.demo ? <Chip tone="ghost">데모 응답</Chip> : null}
          </div>
          {result.aiError ? (
            <div className="adc-ai-off" role="status">
              <Icon name="lock" size="md" />
              <span>
                {result.aiError.message} 규칙 점검 결과만 보여 드려요.
                {aiErrorHelp(result.aiError.code, isAdmin) ? ` ${aiErrorHelp(result.aiError.code, isAdmin)}` : ''}
              </span>
            </div>
          ) : report ? (
            <>
              {report.issues.length ? (
                <ul className="adc-ai-list">
                  {report.issues.map((it, i) => (
                    <li key={i}>
                      <b>“{it.phrase}”</b> — {it.reason}
                      <span className="adc-ai-sug">
                        <span className="adc-label">바꿀 말</span>
                        {it.suggestion}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {report.overall ? <p className="adc-overall">{report.overall.replace(/^\s*\[데모 응답\]\s*/, '')}</p> : null}
            </>
          ) : (
            <p className="adc-muted">AI 응답을 이해하지 못했어요. 규칙 점검 결과를 참고해 주세요.</p>
          )}
          {result.ai?.privacyNotice ? (
            <p className="adc-muted" role="status">
              {result.ai.privacyNotice}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="adc-notice" role="note" data-testid="adcheck-notice">
        <Icon name="shield" size="sm" />
        <span>{result.notice || ADCHECK_NOTICE}</span>
      </p>
    </section>
  );
}

/** 다른 화면에 넣는 "광고 문구 점검" 버튼 + 결과(리뷰 답글·문서 작성기 등) */
export function AdCheckButton({ text, label = '광고 문구 점검', useAi = true }: { text: string; label?: string; useAi?: boolean }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AdcheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const empty = !text.trim();

  const run = async () => {
    if (empty) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await checkAdText(text, useAi));
    } catch (e) {
      setError(e instanceof ApiError ? (Object.values(e.fields ?? {})[0] ?? e.message) : '점검하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setRunning(false);
      if (useAi) invalidate('ai:');
    }
  };

  return (
    <div className="adc-button">
      <div className="adc-button-row">
        <Button size="sm" icon="shield" loading={running} disabled={empty || running} onClick={() => void run()}>
          {result ? `${label} 다시 하기` : label}
        </Button>
        {result && !isSameText(result, text) ? <span className="adc-muted">글이 바뀌었어요. 다시 점검해 주세요.</span> : null}
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {result ? <AdCheckResult result={result} /> : null}
    </div>
  );
}

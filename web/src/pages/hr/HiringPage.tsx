// 이 파일이 하는 일: "채용 공고·면접 질문" 화면(/hr/hiring, FR-084). 직무·우대 사항·근무 조건을 넣으면 AI(hiring)가 채용 공고 초안과
// 면접 질문(직무·태도·상황 구분)을 만든다(AC1). 입력한 조건과 공고에 나이·성별·결혼·출신 같은 차별 소지 표현이 있으면 입력하는 동안 바로
// 위치(번호 하이라이트)·이유·바꿀 말과 함께 경고한다(AC2, 규칙 사전 POST /api/hiring/check, AI 비용 없음).
// 공고는 고쳐 쓰고, 복사하거나 보관함(saved_texts kind=hiring)에 저장한다. 보관함에서 "불러오기"를 누르면 그 초안이 다시 열린다(AC3).
// 화면의 주 행동(채워진 청록)은 "공고 초안 만들기" 하나다. 색만으로 구분하지 않도록 하이라이트에 번호, 칩에 글자를 붙인다(DESIGN §5).
import { useEffect, useState, type FormEvent } from 'react';
import { AiPanel } from '../../components/AiPanel.tsx';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { Checkbox, Field, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useToast } from '../../components/Toast.tsx';
import type { AiResultView } from '../../lib/ai.ts';
import { useSession } from '../../lib/session.tsx';
import { josa } from '../../../../shared/josa.ts';
import { can } from '../../../../shared/roles.ts';
import type { SavedText } from '../../../../shared/desk-texts.ts';
import { HIRING_JOB_TYPES, HIRING_RISK_LABELS, HIRING_SEVERITY_LABELS, type HiringCheckResponse } from '../../../../shared/schemas/hiring.ts';
import { errorText, SavedTextLibrary, saveText } from '../desk/scriptLib.tsx';
import { checkHiringText, formatHiringBody, groupQuestions, parseHiringBody, readHiringResult, splitRiskHighlights, type HiringDraft } from './hiringLib.ts';
import '../desk/script-ai.css';
import './hiring.css';

/** 보관 정보(meta) 한 칸 최대 길이(saved-texts 서버 검사와 같음) */
const META_MAX = 200;

/** 글을 입력이 멈춘 뒤(0.4초) 차별 소지 표현 점검에 보낸다. 빈 글이면 결과 없음 */
function useHiringCheck(text: string): {
  result: HiringCheckResponse | null;
  error: string | null;
} {
  const [state, setState] = useState<{
    result: HiringCheckResponse | null;
    error: string | null;
  }>({ result: null, error: null });
  const trimmed = text.trim();
  useEffect(() => {
    if (!trimmed) return;
    let alive = true;
    const timer = setTimeout(() => {
      checkHiringText(trimmed)
        .then((r) => {
          if (alive) setState({ result: r, error: null });
        })
        .catch((e: unknown) => {
          if (alive)
            setState((s) => ({
              result: s.result,
              error: errorText(e, '차별 소지 표현을 점검하지 못했어요. 잠시 뒤 다시 시도해 주세요.'),
            }));
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [trimmed]);
  return trimmed ? state : { result: null, error: null };
}

/** 차별 소지 표현 점검 결과(표현이 없으면 짧은 확인 줄) */
function RiskBox({
  label,
  testId,
  check,
  showText = true,
}: {
  label: string;
  testId: string;
  check: { result: HiringCheckResponse | null; error: string | null };
  showText?: boolean;
}) {
  const { result, error } = check;
  if (error) {
    return (
      <p className="form-error" role="alert" data-testid={testId}>
        {error}
      </p>
    );
  }
  if (!result) return null;
  if (result.hits.length === 0) {
    return (
      <p className="hire-ok" data-testid={testId}>
        <Icon name="check" size="sm" />
        {label}: 차별 소지 표현 없음
      </p>
    );
  }
  const high = result.hits.filter((h) => h.severity === 'high').length;
  const medium = result.hits.length - high;
  const pieces = showText ? splitRiskHighlights(result.text, result.hits) : [];
  return (
    <section className="hire-risk" aria-label={`${label} 차별 소지 표현 점검`} data-testid={testId}>
      <div className="hire-risk-head" role="alert">
        <Icon name="alert" size="md" />
        <b>{label}에 차별 소지 표현이 있어요</b>
        {high ? <Chip tone="danger">빼야 해요 {high}건</Chip> : null}
        {medium ? <Chip tone="warn">살펴보세요 {medium}건</Chip> : null}
      </div>
      {showText ? (
        <div className="hire-risk-text">
          {pieces.map((p, i) =>
            p.hit ? (
              <mark key={i} className={`hire-mark ${p.hit.severity}`} title={`${p.no}. ${p.hit.reason}`}>
                {p.text}
                <sup className="hire-no">{p.no}</sup>
              </mark>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </div>
      ) : null}
      <ol className="hire-risk-list" aria-label={`${label}에서 찾은 표현`}>
        {result.hits.map((h, i) => (
          <li key={`${h.start}-${h.ruleKey}`} data-testid="hiring-risk-hit">
            <div className="hire-risk-hit-head">
              <span className="hire-no-badge num" aria-hidden="true">
                {i + 1}
              </span>
              <b>“{h.phrase}”</b>
              <Chip tone={h.severity === 'high' ? 'danger' : 'warn'}>{HIRING_SEVERITY_LABELS[h.severity]}</Chip>
              <Chip tone="ghost">{HIRING_RISK_LABELS[h.category]}</Chip>
            </div>
            <p>
              <span className="hire-label">이유</span>
              {h.reason}
            </p>
            <p>
              <span className="hire-label">바꿀 말</span>
              {h.suggestion}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 공고 초안과 면접 질문(고쳐 쓰기·점검·복사·저장) */
function DraftEditor({
  draft,
  initialTitle,
  jobType,
  conditions,
  preferred,
  shared,
  onChange,
}: {
  draft: HiringDraft;
  /** 보관함에서 연 초안이면 그 제목 */
  initialTitle: string | null;
  jobType: string;
  conditions: string;
  preferred: string;
  shared: boolean;
  onChange: (d: HiringDraft) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(initialTitle ?? `${jobType || '직원'} 채용 공고`);
  const [saving, setSaving] = useState(false);
  const [savedBody, setSavedBody] = useState<string | null>(null);
  const postingCheck = useHiringCheck(draft.posting);
  const groups = groupQuestions(draft.questions);
  const body = formatHiringBody(draft);
  const saved = savedBody === body;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveText({
        kind: 'hiring',
        category: (jobType.trim() || '기타').slice(0, 20),
        title: title.trim() || `${jobType || '직원'} 채용 공고`,
        body,
        meta: {
          jobType: jobType.slice(0, META_MAX),
          conditions: conditions.slice(0, META_MAX),
          preferred: preferred.slice(0, META_MAX),
        },
        shared,
      });
      setSavedBody(body);
      toast.show('채용 공고를 보관함에 저장했어요.');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="desk-form" onSubmit={(e) => void save(e)} aria-label="채용 공고 초안">
      <Field label="채용 공고" help="고쳐 쓰면 차별 소지 표현을 다시 점검해요.">
        <TextArea rows={12} value={draft.posting} maxLength={8000} onChange={(e) => onChange({ ...draft, posting: e.target.value })} />
      </Field>
      {/* 공고는 위 입력 칸에 글이 그대로 보이므로 찾은 표현 목록만 보인다 */}
      <RiskBox label="채용 공고" testId="hiring-risk-posting" check={postingCheck} showText={false} />

      <section className="hire-questions" aria-label="면접 질문" data-testid="hiring-questions">
        <b className="hire-questions-title">면접 질문</b>
        {groups.length === 0 ? <p className="desk-note">면접 질문이 없어요. 다시 만들어 보세요.</p> : null}
        {groups.map((g) => (
          <div key={g.type} className="hire-qgroup" data-testid={`hiring-qgroup-${g.type}`}>
            <div className="hire-qhead">
              <Chip tone={g.type === '기타' ? 'ghost' : 'info'}>{g.type}</Chip>
              <b>{g.type} 질문</b>
              <span className="num hire-count">{g.items.length}개</span>
            </div>
            <ol aria-label={`${g.type} 질문`}>
              {g.items.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          </div>
        ))}
      </section>

      <div className="desk-row">
        <Field label="보관함 제목">
          <TextInput value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      <div className="reply-actions">
        <span className="grow" />
        <CopyButton text={body} label="공고·질문 복사" />
        <Button type="submit" size="sm" icon={saved ? 'check' : 'plus'} loading={saving} disabled={saved || !draft.posting.trim()}>
          {saved ? '저장했어요' : '보관함에 저장'}
        </Button>
      </div>
    </form>
  );
}

/** 채용 공고·면접 질문 */
export default function HiringPage() {
  const toast = useToast();
  const { info } = useSession();
  const canShare = can(info?.user?.role, 'savedtexts.shared.edit');
  const [jobType, setJobType] = useState<string>(HIRING_JOB_TYPES[0]);
  const [preferred, setPreferred] = useState('');
  const [conditions, setConditions] = useState('');
  const [share, setShare] = useState(false);
  const [draft, setDraft] = useState<HiringDraft | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [panelKey, setPanelKey] = useState(0);
  const [demo, setDemo] = useState(false);
  const [loadedTitle, setLoadedTitle] = useState<string | null>(null);
  const conditionsCheck = useHiringCheck(conditions);
  const preferredCheck = useHiringCheck(preferred);

  /** AI 결과를 오른쪽 초안 칸으로 옮긴다 */
  const onResult = (r: AiResultView) => {
    const d = readHiringResult(r.extra);
    if (!d) return;
    setDraft(d);
    setDemo(r.demo);
    setLoadedTitle(null);
    setDraftKey((k) => k + 1);
  };

  /** 보관함의 초안을 다시 연다(입력 칸도 저장 때 값으로 채운다) */
  const load = (t: SavedText) => {
    const meta = (t.meta ?? {}) as Record<string, unknown>;
    if (typeof meta.jobType === 'string' && meta.jobType) setJobType(meta.jobType);
    setPreferred(typeof meta.preferred === 'string' ? meta.preferred : '');
    setConditions(typeof meta.conditions === 'string' ? meta.conditions : '');
    setPanelKey((k) => k + 1);
    setDraft(parseHiringBody(t.body));
    setDemo(false);
    setLoadedTitle(t.title);
    setDraftKey((k) => k + 1);
    toast.show(`"${t.title}" 초안을 다시 열었어요.`);
    document.getElementById('hiring-draft')?.scrollIntoView({ block: 'start' });
  };

  return (
    <>
      <PageHeader
        title="채용 공고·면접 질문"
        summary="직무와 근무 조건을 넣으면 채용 공고 초안과 직무·태도·상황 면접 질문을 만들어 드려요. 나이·성별·결혼 같은 차별 소지 표현은 바로 알려 드려요."
      />
      <div className="hire-cols">
        <Card title="어떤 분을 뽑나요" id="hiring-input" className="hire-input">
          <div className="desk-form">
            <Field label="직무" help="목록에서 고르거나 직접 적어 주세요.">
              <TextInput value={jobType} maxLength={50} list="hiring-job-types" onChange={(e) => setJobType(e.target.value)} />
            </Field>
            <datalist id="hiring-job-types">
              {HIRING_JOB_TYPES.map((j) => (
                <option key={j} value={j} />
              ))}
            </datalist>
            <Field label="우대 사항(선택)">
              <TextArea rows={2} value={preferred} maxLength={1000} placeholder="예: 치과 근무 경력 1년 이상, 덴트웹 사용 가능" onChange={(e) => setPreferred(e.target.value)} />
            </Field>
            <RiskBox label="우대 사항" testId="hiring-risk-preferred" check={preferredCheck} />
            {canShare ? <Checkbox label="공고를 공용 보관함에 저장" hint="모든 직원이 함께 볼 수 있어요." checked={share} onChange={(e) => setShare(e.target.checked)} /> : null}
            {/* AiPanel의 "근무 조건" 입력이 바뀔 때마다 그 글을 받아 바로 점검한다(입력 이벤트가 위로 전해짐) */}
            <div
              className="hire-panel"
              onChange={(e) => {
                const t = e.target;
                if (t instanceof HTMLTextAreaElement) setConditions(t.value);
              }}
            >
              <AiPanel
                key={panelKey}
                feature="hiring"
                label="근무 조건"
                rows={4}
                initialText={conditions}
                placeholder="예: 주 5일(월~금 9:30~18:30), 토요일 격주, 4대 보험, 연차 15일"
                buildInput={(text) => ({
                  jobType: jobType.trim(),
                  conditions: text,
                  ...(preferred.trim() ? { preferred: preferred.trim() } : {}),
                })}
                runLabel={draft ? '다시 만들기' : '공고 초안 만들기'}
                onResult={onResult}
                renderResult={(r) =>
                  readHiringResult(r.extra) ? (
                    <p className="desk-note">공고와 면접 질문을 “공고 초안” 칸에 넣었어요. 고쳐 쓴 뒤 저장하세요.</p>
                  ) : (
                    <p className="desk-note">AI 응답을 이해하지 못했어요. 다시 시도해 주세요.</p>
                  )
                }
              />
            </div>
            <RiskBox label="근무 조건" testId="hiring-risk-conditions" check={conditionsCheck} />
          </div>
        </Card>

        <Card title="공고 초안" id="hiring-draft">
          {draft ? (
            <>
              {demo ? (
                <p className="desk-note hire-tag">
                  <Chip tone="ghost">데모 응답</Chip> AI 키가 없어 예시 초안을 넣었어요.
                </p>
              ) : null}
              {loadedTitle ? (
                <p className="desk-note hire-tag" data-testid="hiring-loaded">
                  <Chip tone="info">보관함</Chip> “{loadedTitle}”{josa(loadedTitle, '을/를')} 다시 열었어요.
                </p>
              ) : null}
              <DraftEditor
                key={draftKey}
                draft={draft}
                initialTitle={loadedTitle}
                jobType={jobType}
                conditions={conditions}
                preferred={preferred}
                shared={canShare && share}
                onChange={setDraft}
              />
            </>
          ) : (
            <p className="desk-note">왼쪽에서 공고 초안을 만들거나, 아래 보관함에서 저장한 초안을 불러오면 여기에서 고쳐 쓸 수 있어요.</p>
          )}
        </Card>
      </div>

      <Card title="채용 공고 보관함" id="hiring-lib">
        <SavedTextLibrary
          kind="hiring"
          categories={HIRING_JOB_TYPES}
          emptyHint="마음에 드는 공고 초안을 저장하면 여기에서 다시 열 수 있어요."
          extraActions={(t) => (
            <Button size="sm" variant="ghost" icon="doc" onClick={() => load(t)} aria-label={`${t.title} 불러오기`}>
              불러오기
            </Button>
          )}
        />
      </Card>
    </>
  );
}

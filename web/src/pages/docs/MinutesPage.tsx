// 이 파일이 하는 일: "회의록 요약" 화면(/docs/minutes, FR-061). 회의 메모를 붙여 넣고 정리하면 AI(minutes)가 결정 사항·할 일(담당 역할·기한)·논의 요약으로 나눠 보여 준다.
// 할 일은 한 번 눌러 인수인계(모든 직원)나 공지(실장님 이상)로 보낼 수 있다(POST /api/posts, 03-04 공지·인수인계 보드). 정리 결과는 서식 보관함에 회의록으로 저장할 수 있다.
// 화면의 주 행동(채워진 청록)은 하나만: 정리 전에는 "정리하기", 정리 뒤에는 "회의록 저장"이다.
import { useState } from 'react';
import { AiPanel } from '../../components/AiPanel.tsx';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { Field, TextInput } from '../../components/Field.tsx';
import { EmptyState } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { ApiError, api } from '../../lib/api.ts';
import type { AiResultView } from '../../lib/ai.ts';
import { formatDateLong } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { invalidate } from '../../lib/useApi.ts';
import { can } from '../../../../shared/roles.ts';
import { createDocument, dueLabel, minutesToMarkdown, readMinutes, todoToPost, type MinutesResult, type MinutesTodo } from './docsLib.ts';
import './docs-pages.css';

/** 할 일을 보낸 상태 */
type SentState = Record<number, { kind: 'handover' | 'notice'; id: number | null } | 'sending' | { error: string }>;

/** 회의록 요약 */
export default function MinutesPage() {
  const toast = useToast();
  const { info } = useSession();
  const role = info?.user?.role;
  const [meeting, setMeeting] = useState(() => `${formatDateLong(new Date())} 회의`);
  const [result, setResult] = useState<MinutesResult | null>(null);
  const [badOutput, setBadOutput] = useState(false);
  const [sent, setSent] = useState<SentState>({});
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);

  /** AI 결과를 세 묶음으로 */
  const onResult = (r: AiResultView) => {
    const m = readMinutes(r.extra);
    setResult(m);
    setBadOutput(!m);
    setSent({});
    setSavedId(null);
  };

  /** 할 일 하나를 인수인계·공지로 보낸다 */
  const send = async (i: number, todo: MinutesTodo, kind: 'handover' | 'notice') => {
    setSent((s) => ({ ...s, [i]: 'sending' }));
    try {
      const post = await api.post<{ id?: number } | undefined>('/api/posts', todoToPost(todo, kind, meeting.trim() || '회의'));
      setSent((s) => ({ ...s, [i]: { kind, id: typeof post?.id === 'number' ? post.id : null } }));
      invalidate('desk:');
      toast.show(kind === 'handover' ? '인수인계로 보냈어요.' : '공지로 올렸어요.');
    } catch (e) {
      setSent((s) => ({ ...s, [i]: { error: e instanceof ApiError ? e.message : '보내지 못했어요. 잠시 뒤 다시 시도해 주세요.' } }));
    }
  };

  /** 정리 결과를 회의록 문서로 저장 */
  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const title = meeting.trim() || '회의록';
      const doc = await createDocument({ kind: 'minutes', title, body_md: minutesToMarkdown(title, result), folder: '회의록', tags: ['회의'], source: 'ai' });
      setSavedId(doc.id);
      invalidate('docs:');
      toast.show(`서식 보관함에 회의록을 저장했어요(버전 ${doc.version}).`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  const canNotice = can(role, 'notices.write');

  return (
    <>
      <PageHeader
        title="회의록 요약"
        summary="회의 메모를 붙여 넣으면 결정 사항·할 일·요약으로 나눠 드려요. 할 일은 바로 인수인계로 보낼 수 있어요."
        actions={
          result ? (
            savedId ? (
              <Button icon="doc" to={`/docs/library/${savedId}`}>
                저장한 회의록 보기
              </Button>
            ) : (
              <Button variant="primary" icon="check" loading={saving} onClick={() => void save()}>
                회의록 저장
              </Button>
            )
          ) : (
            <Button icon="doc" to="/docs/library?folder=%ED%9A%8C%EC%9D%98%EB%A1%9D">
              지난 회의록
            </Button>
          )
        }
      />
      <Card title="회의 메모" id="minutes-input" className={result ? 'doc-ai minutes-done' : 'doc-ai'}>
        <div className="doc-form">
          <Field label="회의 이름">
            <TextInput value={meeting} maxLength={100} onChange={(e) => setMeeting(e.target.value)} />
          </Field>
          <AiPanel
            feature="minutes"
            label="회의 메모"
            rows={8}
            placeholder={'예:\n- 다음 주부터 오전 예약 간격 30분으로 바꾸기로 결정\n- 예약 안내 문자 고치기 (데스크, 11월 6일까지)'}
            buildInput={(notes) => ({ notes })}
            runLabel="정리하기"
            primary={!result}
            onResult={onResult}
          />
        </div>
      </Card>

      {badOutput ? (
        <div className="doc-alert" role="alert">
          <b>AI 응답을 이해하지 못했습니다. 다시 시도해 주세요.</b>
        </div>
      ) : null}

      {result ? (
        <div className="minutes-cols" data-testid="minutes-result">
          <Card title="결정 사항" id="minutes-decisions" sub={`${result.decisions.length}건`}>
            {result.decisions.length ? (
              <ul className="minutes-list" aria-labelledby="minutes-decisions">
                {result.decisions.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : (
              <EmptyState icon="check" title="정한 것이 없어요" description="메모에 결정한 내용을 더 적어 보세요." />
            )}
          </Card>
          <Card title="할 일" id="minutes-todos" sub={`${result.todos.length}건`}>
            {result.todos.length ? (
              <ul className="minutes-list" aria-labelledby="minutes-todos">
                {result.todos.map((t, i) => {
                  const st = sent[i];
                  const due = dueLabel(t.due);
                  return (
                    <li key={i} data-testid="minutes-todo">
                      <b>{t.text}</b>
                      <span className="minutes-todo-meta">
                        <Chip tone="info">담당: {t.role || '정하지 않음'}</Chip>
                        <Chip tone={due ? 'warn' : 'ghost'}>기한: {due ?? '없음'}</Chip>
                      </span>
                      {st && st !== 'sending' && 'kind' in st ? (
                        <span className="minutes-todo-actions" role="status">
                          <Chip tone="ok">{st.kind === 'handover' ? '인수인계로 보냄' : '공지로 올림'}</Chip>
                          <Button size="sm" variant="ghost" to={st.id ? `/desk/board/${st.id}` : st.kind === 'handover' ? '/desk/board?tab=handover' : '/desk/board'}>
                            보드에서 보기
                          </Button>
                        </span>
                      ) : (
                        <span className="minutes-todo-actions">
                          <Button size="sm" icon="board" loading={st === 'sending'} onClick={() => void send(i, t, 'handover')}>
                            인수인계로 보내기
                          </Button>
                          {canNotice ? (
                            <Button size="sm" variant="ghost" disabled={st === 'sending'} onClick={() => void send(i, t, 'notice')}>
                              공지로 올리기
                            </Button>
                          ) : null}
                        </span>
                      )}
                      {st && st !== 'sending' && 'error' in st ? (
                        <span className="err" role="alert">
                          {st.error}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon="inbox" title="할 일이 없어요" description="메모에 '누가 언제까지' 할 일을 적으면 나눠 드려요." />
            )}
          </Card>
          <Card title="논의 요약" id="minutes-summary">
            <p className="minutes-summary">{result.summary}</p>
          </Card>
        </div>
      ) : null}
    </>
  );
}

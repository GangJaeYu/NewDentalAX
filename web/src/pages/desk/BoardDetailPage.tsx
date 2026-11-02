// 이 파일이 하는 일: 공지·인수인계 상세 화면(/desk/board/:id, FR-040). 이 화면을 열면 서버가 읽음으로 남긴다(AC2).
// 작성자와 실장 이상에게는 오른쪽에 읽은 사람(읽은 시각)·안 읽은 사람 목록을 보여 준다. 인수인계는 "처리 완료"(되돌리기)를 누를 수 있다(AC4).
// 고치기·지우기는 작성자 또는 실장 이상만, 맨 위 고정은 공지에서 실장 이상만 보인다. 본문은 글자 그대로(줄바꿈 유지) 보여 준다(HTML로 해석하지 않음).
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { ConfirmDialog } from '../../components/Dialog.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { POST_KIND_LABELS, type PostDetail } from '../../../../shared/schemas/desk.ts';
import { PostFormDialog } from './BoardPostForm.tsx';
import './board.css';

const POSTS_KEY = 'desk:posts';

/** 오류를 화면 문구로 */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 공지·인수인계 상세 화면 */
export default function BoardDetailPage() {
  const { id } = useParams();
  const postId = Number(id);
  const valid = Number.isInteger(postId) && postId > 0;
  // 화면을 열 때마다 새로 불러오도록(읽음 처리·읽은 사람 목록이 늘 최신이게) 열 때의 번호를 key에 붙인다
  const [openedAt] = useState(() => Date.now());
  const key = valid ? `desk:post:${postId}:${openedAt}` : null;
  const state = useApi<PostDetail>(key, () => api.get(`/api/posts/${postId}`));
  const post = state.data;
  const { info } = useSession();
  const canNotice = can(info?.user?.role, 'notices.write');
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // 열어서 읽음이 되었으니 목록의 "안 읽음"·읽음 수를 다시 불러오게 한다
  const loadedId = post?.id;
  useEffect(() => {
    if (loadedId) invalidate(POSTS_KEY);
  }, [loadedId]);

  const back = () => navigate(post?.kind === 'handover' ? '/desk/board?tab=handover' : '/desk/board');

  /** 서버에 바꾸는 요청을 보내고 화면을 다시 불러온다 */
  const act = async (name: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(name);
    try {
      await fn();
      if (key) invalidate(key);
      invalidate(POSTS_KEY);
      toast.show(done);
    } catch (err) {
      toast.error(messageOf(err, '처리하지 못했어요. 다시 시도해 주세요.'));
    } finally {
      setBusy(null);
    }
  };

  if (!valid || (state.error instanceof ApiError && state.error.status === 404)) {
    return (
      <>
        <PageHeader title="글을 찾을 수 없어요" />
        <Card padded>
          <EmptyState
            icon="board"
            title="찾는 글이 없어요"
            description="이미 지워졌거나 주소가 잘못되었을 수 있어요."
            action={<Button onClick={() => navigate('/desk/board')}>목록으로</Button>}
          />
        </Card>
      </>
    );
  }
  if (state.error && !post) {
    return (
      <>
        <PageHeader title="공지·인수인계" />
        <Card padded>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      </>
    );
  }
  if (!post) {
    return (
      <>
        <PageHeader title="공지·인수인계" />
        <Card padded>
          <Skeleton rows={6} label="글 불러오는 중" />
        </Card>
      </>
    );
  }

  const kindLabel = POST_KIND_LABELS[post.kind];
  const isHandover = post.kind === 'handover';
  const actions = (
    <>
      <Button onClick={back}>목록으로</Button>
      {post.canEdit ? <Button onClick={() => setEditing(true)}>고치기</Button> : null}
      {post.kind === 'notice' && canNotice ? (
        <Button
          loading={busy === 'pin'}
          onClick={() => void act('pin', () => api.patch(`/api/posts/${post.id}`, { pinned: !post.pinned }), post.pinned ? '고정을 풀었어요.' : '맨 위에 고정했어요.')}
        >
          {post.pinned ? '고정 풀기' : '맨 위 고정'}
        </Button>
      ) : null}
      {post.canEdit ? (
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          지우기
        </Button>
      ) : null}
      {isHandover ? (
        post.resolvedAt ? (
          <Button
            loading={busy === 'resolve'}
            onClick={() => void act('resolve', () => api.post(`/api/posts/${post.id}/resolve`, { resolved: false }), '처리 전으로 되돌렸어요.')}
          >
            처리 전으로 되돌리기
          </Button>
        ) : (
          <Button
            variant="primary"
            icon="check"
            loading={busy === 'resolve'}
            onClick={() => void act('resolve', () => api.post(`/api/posts/${post.id}/resolve`, { resolved: true }), '처리 완료로 표시했어요.')}
          >
            처리 완료
          </Button>
        )
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader title={post.title} summary={`${kindLabel} · ${post.category}`} actions={actions} />
      <div className="post-layout">
        <Card title={`${kindLabel} 내용`} id="post-body-title">
          <div className="post-meta">
            {post.pinned ? <Chip tone="info">고정</Chip> : null}
            <Chip>{post.category}</Chip>
            {isHandover ? post.resolvedAt ? <Chip tone="ok">처리 완료</Chip> : <Chip tone="warn">처리 전</Chip> : null}
            <span>
              작성 <span className="who">{post.author.name}</span> · <span className="num">{formatDateTime(post.createdAt)}</span>
            </span>
            {post.updatedAt !== post.createdAt && !post.resolvedAt ? <span className="num">고친 시각 {formatDateTime(post.updatedAt)}</span> : null}
            {post.resolvedAt ? (
              <span>
                처리 <span className="who">{post.resolvedBy?.name ?? '-'}</span> · <span className="num">{formatDateTime(post.resolvedAt)}</span>
              </span>
            ) : null}
          </div>
          {post.body ? <p className="post-body">{post.body}</p> : <p className="post-body empty">내용 없이 제목만 있는 글이에요.</p>}
        </Card>
        {post.readers && post.unreadUsers ? (
          <Card title="읽음 현황" sub={`${post.readCount}/${post.totalUsers}명`} id="post-readers-title">
            <div className="readers" data-testid="post-readers">
              <h3>읽은 사람 {post.readers.length}명</h3>
              {post.readers.length ? (
                <ul className="list" aria-label="읽은 사람 목록">
                  {post.readers.map((r) => (
                    <li key={r.id}>
                      <span className="t">
                        <b>{r.name}</b>
                      </span>
                      <span className="when num">{formatDateTime(r.readAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="none">아직 읽은 사람이 없어요.</p>
              )}
              <h3>안 읽은 사람 {post.unreadUsers.length}명</h3>
              {post.unreadUsers.length ? (
                <ul className="list" aria-label="안 읽은 사람 목록">
                  {post.unreadUsers.map((u) => (
                    <li key={u.id}>
                      <span className="t">
                        <b>{u.name}</b>
                      </span>
                      <Chip tone="warn">안 읽음</Chip>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="none">모두 읽었어요.</p>
              )}
            </div>
          </Card>
        ) : null}
      </div>

      {editing ? (
        <PostFormDialog
          open
          editId={post.id}
          canNotice={canNotice}
          initial={{ kind: post.kind, category: post.category, title: post.title, body: post.body, pinned: post.pinned }}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            if (key) invalidate(key);
            invalidate(POSTS_KEY);
            toast.show('저장했어요.');
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await api.del(`/api/posts/${post.id}`);
            setConfirmDelete(false);
            invalidate(POSTS_KEY);
            toast.show(`${kindLabel}을 지웠어요.`);
            back();
          } catch (err) {
            setConfirmDelete(false);
            toast.error(messageOf(err, '지우지 못했어요. 다시 시도해 주세요.'));
          }
        }}
        title={`이 ${kindLabel}을 지울까요?`}
        message="지운 글은 목록에서 사라지고 되돌릴 수 없어요."
        confirmLabel="지우기"
        danger
      />
    </>
  );
}

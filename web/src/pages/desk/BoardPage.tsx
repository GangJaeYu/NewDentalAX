// 이 파일이 하는 일: "공지·인수인계" 화면(/desk/board, FR-040). 공지와 인수인계 목록을 나눠 보고, 글을 쓰고, 누르면 상세(/desk/board/:id)로 간다.
// 공지 쓰기 버튼은 실장 이상에게만 보인다(직원은 인수인계만 쓴다, phase-03-task-04 AC1). 서버도 직원의 공지 작성을 403으로 막는다.
// 공지 목록에는 고정·새 글(안 읽음) 표시와 읽은 사람 수를, 인수인계 목록에는 처리 전/처리 완료 상태를 보여 준다. 보던 탭은 주소(?tab=)에 남긴다.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { Card, PageHeader } from '../../components/Card.tsx';
import { Chip } from '../../components/Chip.tsx';
import { DataTable, type Column } from '../../components/DataTable.tsx';
import { EmptyState } from '../../components/States.tsx';
import { useToast } from '../../components/Toast.tsx';
import { SearchInput, Segmented, Toolbar } from '../../components/Toolbar.tsx';
import { api } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { invalidate, useApi } from '../../lib/useApi.ts';
import { useSession } from '../../lib/session.tsx';
import { can } from '../../../../shared/roles.ts';
import { POST_CATEGORIES, type PostKind, type PostListItem } from '../../../../shared/schemas/desk.ts';
import { PostFormDialog } from './BoardPostForm.tsx';
import './board.css';

/** 목록 데이터 key(글을 쓰거나 읽으면 'desk:posts'로 다시 불러온다) */
export const POSTS_KEY = 'desk:posts';
type HandoverFilter = 'open' | 'all';

/** 공지·인수인계 화면 */
export default function BoardPage() {
  const { info } = useSession();
  const role = info?.user?.role;
  const canNotice = can(role, 'notices.write');
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab: PostKind = params.get('tab') === 'handover' ? 'handover' : 'notice';
  const [filter, setFilter] = useState<HandoverFilter>('open');
  const [q, setQ] = useState('');
  const [writing, setWriting] = useState<PostKind | null>(null);

  // api.get은 { data, total }에서 data(배열)만 돌려준다
  const notices = useApi<PostListItem[]>(`${POSTS_KEY}:notice`, () => api.get('/api/posts?kind=notice&pageSize=200'));
  const handovers = useApi<PostListItem[]>(`${POSTS_KEY}:handover`, () => api.get('/api/posts?kind=handover&pageSize=200'));
  const current = tab === 'notice' ? notices : handovers;

  const unreadNotices = (notices.data ?? []).filter((p) => !p.readByMe).length;
  const openHandovers = (handovers.data ?? []).filter((p) => !p.resolvedAt).length;

  const rows = useMemo(() => {
    const all = current.data;
    if (!all) return undefined;
    const word = q.trim().toLowerCase();
    return all.filter(
      (p) =>
        (tab === 'notice' || filter === 'all' || !p.resolvedAt) &&
        (!word || p.title.toLowerCase().includes(word) || p.preview.toLowerCase().includes(word) || p.category.toLowerCase().includes(word)),
    );
  }, [current.data, q, tab, filter]);

  const titleCol: Column<PostListItem> = {
    key: 'title',
    header: '제목',
    render: (p) => (
      <span className="post-title">
        {p.pinned ? <Chip tone="info">고정</Chip> : null}
        {!p.readByMe ? <Chip tone="warn">안 읽음</Chip> : null}
        <b>{p.title}</b>
        {p.preview ? <small>{p.preview}</small> : null}
      </span>
    ),
  };
  const common: Column<PostListItem>[] = [
    { key: 'category', header: '분류', sortValue: (p) => p.category, render: (p) => <Chip>{p.category}</Chip> },
    { key: 'author', header: '작성자', sortValue: (p) => p.author.name, render: (p) => p.author.name },
    { key: 'createdAt', header: '올린 시각', sortValue: (p) => p.createdAt, render: (p) => <span className="num">{formatDateTime(p.createdAt)}</span> },
  ];
  const columns: Column<PostListItem>[] =
    tab === 'notice'
      ? [
          titleCol,
          ...common,
          {
            key: 'reads',
            header: '읽음',
            align: 'right',
            sortValue: (p) => p.readCount,
            render: (p) => (
              <span className="num" aria-label={`${p.totalUsers}명 중 ${p.readCount}명 읽음`}>
                {p.readCount}/{p.totalUsers}명
              </span>
            ),
          },
        ]
      : [
          titleCol,
          ...common,
          {
            key: 'status',
            header: '상태',
            sortValue: (p) => (p.resolvedAt ? 1 : 0),
            render: (p) => (p.resolvedAt ? <Chip tone="ok">처리 완료</Chip> : <Chip tone="warn">처리 전</Chip>),
          },
        ];

  const writeButtons =
    canNotice && tab === 'notice' ? (
      <>
        <Button icon="plus" onClick={() => setWriting('handover')}>
          인수인계 쓰기
        </Button>
        <Button variant="primary" icon="plus" onClick={() => setWriting('notice')}>
          공지 쓰기
        </Button>
      </>
    ) : (
      <>
        {canNotice ? (
          <Button icon="plus" onClick={() => setWriting('notice')}>
            공지 쓰기
          </Button>
        ) : null}
        <Button variant="primary" icon="plus" onClick={() => setWriting('handover')}>
          인수인계 쓰기
        </Button>
      </>
    );

  const emptyAll =
    tab === 'notice' ? (
      <EmptyState
        icon="board"
        title="아직 올라온 공지가 없어요"
        description={canNotice ? '병원 전체에 알릴 일을 공지로 올려 보세요. 올리면 모든 직원에게 알림이 가요.' : '실장님이 공지를 올리면 여기에 보여요.'}
        action={
          canNotice ? (
            <Button icon="plus" onClick={() => setWriting('notice')}>
              첫 공지 쓰기
            </Button>
          ) : undefined
        }
      />
    ) : (
      <EmptyState
        icon="board"
        title={filter === 'open' && (handovers.data?.length ?? 0) > 0 ? '처리할 인수인계가 없어요' : '아직 인수인계가 없어요'}
        description="다음 근무자에게 전할 일을 남겨 보세요."
        action={
          <Button icon="plus" onClick={() => setWriting('handover')}>
            인수인계 쓰기
          </Button>
        }
      />
    );

  return (
    <>
      <PageHeader
        title="공지·인수인계"
        summary={`안 읽은 공지 ${unreadNotices}개 · 처리 전 인수인계 ${openHandovers}개`}
        actions={writeButtons}
      />
      <Card>
        <Toolbar label="글 목록 도구">
          <Segmented<PostKind>
            label="글 종류"
            value={tab}
            onChange={(v) => setParams(v === 'notice' ? {} : { tab: v }, { replace: true })}
            options={[
              { value: 'notice', label: `공지 ${notices.data?.length ?? 0}` },
              { value: 'handover', label: `인수인계 ${handovers.data?.length ?? 0}` },
            ]}
          />
          {tab === 'handover' ? (
            <Segmented<HandoverFilter>
              label="처리 상태"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: `처리 전 ${openHandovers}` },
                { value: 'all', label: '전체' },
              ]}
            />
          ) : null}
          <span className="grow" />
          <SearchInput label="제목·내용·분류로 찾기" placeholder="제목·내용 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        </Toolbar>
        <DataTable<PostListItem>
          caption={tab === 'notice' ? '공지 목록' : '인수인계 목록'}
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          rowLabel={(p) => p.title}
          loading={current.loading}
          error={current.error}
          onRetry={current.reload}
          onRowClick={(p) => navigate(`/desk/board/${p.id}`)}
          empty={q ? <EmptyState icon="search" title="찾는 글이 없어요" description="다른 낱말로 찾아보세요." /> : emptyAll}
        />
      </Card>

      {writing ? (
        <PostFormDialog
          key={writing}
          open
          canNotice={canNotice}
          initial={{ kind: writing, category: POST_CATEGORIES[writing][0] ?? '', title: '', body: '', pinned: false }}
          onClose={() => setWriting(null)}
          onSaved={(post) => {
            setWriting(null);
            invalidate(POSTS_KEY);
            toast.show(post.kind === 'notice' ? '공지를 올렸어요. 모든 직원에게 알림이 갔어요.' : '인수인계를 남겼어요.');
            if (post.kind !== tab) setParams(post.kind === 'notice' ? {} : { tab: post.kind }, { replace: true });
          }}
        />
      ) : null}
    </>
  );
}

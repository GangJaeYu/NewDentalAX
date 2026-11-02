// 이 파일이 하는 일: 아직 만들지 않은 화면의 공통 "준비 중" 안내(StubPage)와, 권한이 없을 때(ForbiddenNotice)·없는 주소일 때(NotFoundPage) 보여 줄 안내.
// 각 모듈 태스크는 자기 페이지 파일(예: pages/inventory/InventoryPage.tsx)만 실제 화면으로 바꾼다(PLAN.md §3). 이 파일은 01-04 소유다.
import { useLocation } from 'react-router';
import { Button } from '../components/Button.tsx';
import { Card, PageHeader } from '../components/Card.tsx';
import { EmptyState } from '../components/States.tsx';
import { findNavItem } from '../lib/nav.ts';

/** 준비 중 화면: 제목(없으면 메뉴 이름) + "준비 중" 빈 상태 */
export function StubPage({ title, summary }: { title?: string; summary?: string }) {
  const { pathname } = useLocation();
  const name = title ?? findNavItem(pathname)?.label ?? '화면';
  return (
    <>
      <PageHeader title={name} summary={summary} />
      <Card padded>
        <EmptyState
          icon="tool"
          title="준비 중인 화면이에요"
          description={`"${name}" 화면은 곧 열려요. 그동안 다른 메뉴를 이용해 주세요.`}
          action={
            <Button to="/" icon="home">
              대시보드로 가기
            </Button>
          }
        />
      </Card>
    </>
  );
}

/** 권한 없음 안내(메뉴에 없는 화면 주소로 직접 들어왔을 때) */
export function ForbiddenNotice() {
  const { pathname } = useLocation();
  const name = findNavItem(pathname)?.label;
  return (
    <>
      <PageHeader title="권한 없음" summary={name ? `"${name}" 화면` : undefined} />
      <Card padded>
        <div role="alert">
          <EmptyState
            icon="lock"
            title="이 화면을 볼 권한이 없어요"
            description="이 화면은 원장·실장 또는 관리자만 쓸 수 있어요. 필요하면 관리자에게 권한을 요청해 주세요."
            action={
              <Button to="/" icon="home">
                대시보드로 가기
              </Button>
            }
          />
        </div>
      </Card>
    </>
  );
}

/** 없는 주소 */
export function NotFoundPage() {
  return (
    <>
      <PageHeader title="찾는 화면이 없어요" />
      <Card padded>
        <EmptyState
          icon="search"
          title="주소를 다시 확인해 주세요"
          description="화면 주소가 바뀌었거나 잘못 적혔을 수 있어요. 왼쪽 메뉴나 위쪽 메뉴 찾기로 이동해 주세요."
          action={
            <Button to="/" icon="home">
              대시보드로 가기
            </Button>
          }
        />
      </Card>
    </>
  );
}

// 이 파일이 하는 일: 인쇄 전용 화면(/print/*)의 공통 틀. 셸(메뉴·상단바) 없이 A4 모양으로 보여 주고, 위쪽에 "인쇄하기"·"닫기" 버튼(.no-print)을 둔다.
// 아직 만들지 않은 인쇄 화면은 PrintStub으로 "준비 중"만 보여 준다. 모듈 태스크는 PrintFrame을 써서 자기 인쇄 화면을 만든다.
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { EmptyState } from '../../components/States.tsx';

/** 인쇄 화면 틀: 인쇄 버튼 줄 + 본문 */
export function PrintFrame({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <main className="main" id="main">
      <div className="wrap">
        <div className="pagehead no-print">
          <div className="titles">
            <h1>{title}</h1>
            <p>인쇄 미리보기예요. A4 용지에 맞춰 나와요.</p>
          </div>
          <div className="actions">
            <Button onClick={() => navigate(-1)}>닫기</Button>
            <Button variant="primary" icon="print" onClick={() => window.print()}>
              인쇄하기
            </Button>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

/** 준비 중 인쇄 화면 */
export function PrintStub({ title }: { title: string }) {
  return (
    <PrintFrame title={title}>
      <div className="paper">
        <EmptyState icon="print" title="준비 중인 인쇄 화면이에요" description={`"${title}" 화면은 곧 열려요.`} />
      </div>
    </PrintFrame>
  );
}

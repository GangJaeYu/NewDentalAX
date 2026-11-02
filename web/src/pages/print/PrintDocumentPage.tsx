// 이 파일이 하는 일: "문서 인쇄" 인쇄 전용 화면(/print/document/:id, FR-063). 셸(메뉴·상단바) 없이 A4 모양으로 열고, 위쪽 "인쇄하기"·"닫기" 버튼은 인쇄되지 않는다(.no-print).
// 인쇄물에는 쪽마다 머리말(왼쪽 병원명, 오른쪽 문서 제목)과 아래 가운데 쪽 번호("1 / 2")가 들어간다(@page 규칙: 머리말은 이 파일이 CSSOM으로 붙이고, 쪽 번호는 styles/print.css).
// 본문은 MarkdownView로 그려 HTML을 해석하지 않는다(<script>가 있어도 글자로만 찍힘, TD-007).
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { Button } from '../../components/Button.tsx';
import { MarkdownView } from '../../components/Markdown.tsx';
import { PaperPreview } from '../../components/PaperPreview.tsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/States.tsx';
import { ApiError } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { useApi } from '../../lib/useApi.ts';
import { fetchDocument, printHeaderCss, withoutTitleLine } from '../docs/docsLib.ts';
import '../docs/docs-pages.css';
import { PrintFrame } from './PrintStub.tsx';

/**
 * 쪽마다 들어갈 머리말(@page 규칙)을 문서에 붙인다. 보안 정책(CSP: style-src 'self')이 인라인 style 요소를 막으므로
 * CSSOM(adoptedStyleSheets)으로 붙이고, 화면을 떠나면 뗀다. title이 없으면(불러오는 중) 붙이지 않는다.
 */
function usePrintHeader(clinic: string, title: string | null): void {
  useEffect(() => {
    if (!title || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(printHeaderCss(clinic, title));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    };
  }, [clinic, title]);
}

/** 문서 인쇄 */
export default function PrintDocumentPage() {
  const params = useParams();
  const id = Number(params.id);
  const valid = Number.isInteger(id) && id > 0;
  const { info } = useSession();
  const clinic = info?.clinicName || '우리 병원';
  const doc = useApi(valid ? `docs:detail:${id}` : null, () => fetchDocument(id));
  const docTitle = doc.data?.title ?? null;
  usePrintHeader(clinic, docTitle);

  if (!valid || (doc.error instanceof ApiError && doc.error.status === 404)) {
    return (
      <PrintFrame title="문서 인쇄">
        <div className="paper">
          <EmptyState icon="doc" title="찾는 문서가 없어요" description="지워졌거나 주소가 바뀌었을 수 있어요." action={<Button to="/docs/library">서식 보관함으로</Button>} />
        </div>
      </PrintFrame>
    );
  }
  if (doc.error && !doc.data) {
    return (
      <PrintFrame title="문서 인쇄">
        <ErrorState message={doc.error.message} onRetry={doc.reload} />
      </PrintFrame>
    );
  }
  if (!doc.data) {
    return (
      <PrintFrame title="문서 인쇄">
        <Skeleton rows={8} label="문서 불러오는 중" />
      </PrintFrame>
    );
  }
  const d = doc.data;
  return (
    <PrintFrame title={`문서 인쇄 — ${d.title}`}>
      <div className="print-doc" data-testid="print-document">
        {d.source === 'upload' ? (
          <div className="paper">
            <EmptyState icon="print" title="올린 서식 파일은 내려받아서 인쇄해요" description="서식 보관함 상세 화면에서 파일을 내려받아 주세요." />
          </div>
        ) : (
          <PaperPreview headLeft={clinic} headRight={`문서 번호 D-${String(d.id).padStart(4, '0')} · ${formatDate(d.updatedAt)}`} title={d.title} sign={`${clinic} 원장`}>
            <MarkdownView text={withoutTitleLine(d.bodyMd)} />
          </PaperPreview>
        )}
      </div>
    </PrintFrame>
  );
}

// 이 파일이 하는 일: A4 문서 모양 미리보기(문서 머리줄 = 병원명·문서 번호/날짜, 가운데 제목, 본문, 오른쪽 아래 서명 줄). DESIGN §4 "문서 결과".
// 본문은 children으로 넣는다(보통 MarkdownView). 인쇄할 때는 print.css가 테두리·그림자를 없앤다.
import type { ReactNode } from 'react';

interface PaperPreviewProps {
  /** 머리줄 왼쪽(예: 병원 이름) */
  headLeft?: ReactNode;
  /** 머리줄 오른쪽(예: 문서 번호·날짜) */
  headRight?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  /** 서명 줄(예: "하늘숲치과 원장") */
  sign?: ReactNode;
}

/** A4 종이 모양 미리보기 */
export function PaperPreview({ headLeft, headRight, title, children, sign }: PaperPreviewProps) {
  return (
    <article className="paper" aria-label="문서 미리보기">
      <div className="docno num">
        <span>{headLeft}</span>
        <span>{headRight}</span>
      </div>
      <h2 className="doctitle">{title}</h2>
      {children}
      {sign ? <div className="sign">{sign}</div> : null}
    </article>
  );
}

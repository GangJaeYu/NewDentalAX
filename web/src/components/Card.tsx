// 이 파일이 하는 일: 카드(제목·보조 글·오른쪽 링크·여러 칸 차지)와 쪽 머리(PageHeader: 제목·요약 문구·주 행동 1개 + 보조 행동)를 그린다.
// 대시보드 격자(.grid)는 넓은 화면 4열 → 3열 → 2열 → 1열로 바뀌고, span으로 카드가 몇 칸을 차지할지 정한다(DESIGN §4).
import type { ReactNode } from 'react';
import { Link } from 'react-router';

interface CardProps {
  /** 카드 제목(h2) */
  title?: ReactNode;
  /** 제목 옆 보조 글(건수 등) */
  sub?: ReactNode;
  /** 오른쪽 위 링크 { 글자, 경로 } 또는 직접 만든 요소 */
  action?: { label: string; to: string } | ReactNode;
  /** 격자에서 차지할 칸 수(기본 1) */
  span?: 1 | 2 | 3 | 'full';
  /** 본문 위쪽에도 여백을 준다(제목 없는 카드) */
  padded?: boolean;
  className?: string;
  children?: ReactNode;
  /** 제목 id(목록의 aria-labelledby 등에 씀) */
  id?: string;
}

function isLinkAction(a: CardProps['action']): a is { label: string; to: string } {
  return !!a && typeof a === 'object' && 'to' in (a as object) && 'label' in (a as object);
}

/** 카드 하나 */
export function Card({ title, sub, action, span = 1, padded, className, children, id }: CardProps) {
  const spanCls = span === 2 ? 'span2' : span === 3 ? 'span3' : span === 'full' ? 'span4' : '';
  const cls = ['card', spanCls, padded || !title ? 'pad' : '', className].filter(Boolean).join(' ');
  return (
    <article className={cls} aria-labelledby={title && id ? id : undefined}>
      {title ? (
        <header>
          <h2 id={id}>{title}</h2>
          {sub ? <span className="sub num">{sub}</span> : null}
          {isLinkAction(action) ? (
            <Link className="more" to={action.to}>
              {action.label}
            </Link>
          ) : (
            action ?? null
          )}
        </header>
      ) : null}
      <div className="body">{children}</div>
    </article>
  );
}

/** 카드 격자(대시보드 등) */
export function CardGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="grid" aria-label={label} role={label ? 'region' : undefined}>
      {children}
    </div>
  );
}

interface PageHeaderProps {
  /** 쪽 제목(h1) */
  title: ReactNode;
  /** 제목 아래 요약 문구 */
  summary?: ReactNode;
  /** 오른쪽 버튼들(주 행동은 하나만 primary로) */
  actions?: ReactNode;
}

/** 화면 맨 위 제목 줄 */
export function PageHeader({ title, summary, actions }: PageHeaderProps) {
  return (
    <div className="pagehead">
      <div className="titles">
        <h1>{title}</h1>
        {summary ? <p className="num">{summary}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

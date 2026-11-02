// 이 파일이 하는 일: 간단한 마크다운 편집기(MarkdownEditor: 굵게·제목·목록 버튼 + 글 입력)와 안전한 미리보기(MarkdownView).
// 미리보기는 HTML을 해석하지 않는다: 글을 줄 단위로 나눠(parseMarkdown) React 요소로만 그리므로 <script> 같은 글자도 그대로 보인다(TD-007, dangerouslySetInnerHTML 금지).
// 지원: # 제목(1~3단계), - 또는 * 목록, 1. 번호 목록, --- 구분선, **굵게**, 빈 줄로 문단 구분. AI 문서 결과·서식 보관함이 쓴다.
import { useRef, type ReactNode } from 'react';
import { Button } from './Button.tsx';

/** 줄 안 글 조각 */
export interface Inline {
  text: string;
  bold?: boolean;
}

/** 문서 덩어리 */
export type Block =
  | { type: 'h'; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: 'p'; inlines: Inline[] }
  | { type: 'ul' | 'ol'; items: Inline[][] }
  | { type: 'hr' };

/** **굵게** 표시를 나눈다 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[1] ?? '', bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text: '' }];
}

/** 마크다운 글을 덩어리 목록으로 바꾼다(HTML 태그는 글자 그대로 둔다) */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; items: Inline[][] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', inlines: parseInline(para.join(' ')) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: 'hr' });
    } else if (h) {
      flushPara();
      flushList();
      blocks.push({ type: 'h', level: (h[1]?.length ?? 1) as 1 | 2 | 3, inlines: parseInline(h[2] ?? '') });
    } else if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      const current = list as { type: 'ul' | 'ol'; items: Inline[][] } | null;
      if (!current || current.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      (list as unknown as { items: Inline[][] }).items.push(parseInline((ul ? ul[1] : ol?.[1]) ?? ''));
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function renderInlines(xs: Inline[]): ReactNode {
  return xs.map((x, i) => (x.bold ? <strong key={i}>{x.text}</strong> : <span key={i}>{x.text}</span>));
}

/** 마크다운 미리보기(HTML 불허) */
export function MarkdownView({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className={['md-view', className].filter(Boolean).join(' ')}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h': {
            const Tag = (`h${Math.min(3, b.level + 1)}` as 'h2' | 'h3');
            return <Tag key={i}>{renderInlines(b.inlines)}</Tag>;
          }
          case 'p':
            return <p key={i}>{renderInlines(b.inlines)}</p>;
          case 'hr':
            return <hr key={i} />;
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInlines(it)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInlines(it)}</li>
                ))}
              </ol>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

/** 편집기 버튼이 하는 일: 선택한 글 앞뒤에 표시를 붙이거나 줄 앞에 붙인다 */
export function applyFormat(value: string, start: number, end: number, kind: 'bold' | 'heading' | 'list'): { value: string; start: number; end: number } {
  if (kind === 'bold') {
    const sel = value.slice(start, end) || '굵은 글';
    const next = `${value.slice(0, start)}**${sel}**${value.slice(end)}`;
    return { value: next, start: start + 2, end: start + 2 + sel.length };
  }
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const prefix = kind === 'heading' ? '## ' : '- ';
  const next = `${value.slice(0, lineStart)}${prefix}${value.slice(lineStart)}`;
  return { value: next, start: start + prefix.length, end: end + prefix.length };
}

interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  /** 입력칸 이름(화면 읽기용) */
  label: string;
  rows?: number;
  id?: string;
  placeholder?: string;
}

/** 마크다운 편집기 */
export function MarkdownEditor({ value, onChange, label, rows = 12, id, placeholder }: MarkdownEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const format = (kind: 'bold' | 'heading' | 'list') => {
    const ta = ref.current;
    if (!ta) return;
    const r = applyFormat(value, ta.selectionStart, ta.selectionEnd, kind);
    onChange(r.value);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(r.start, r.end);
    });
  };
  return (
    <div>
      <div className="md-tools" role="toolbar" aria-label="글 꾸미기">
        <Button size="sm" variant="ghost" icon="bold" onClick={() => format('bold')}>
          굵게
        </Button>
        <Button size="sm" variant="ghost" icon="heading" onClick={() => format('heading')}>
          제목
        </Button>
        <Button size="sm" variant="ghost" icon="list" onClick={() => format('list')}>
          목록
        </Button>
      </div>
      <textarea ref={ref} id={id} className="input" aria-label={label} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

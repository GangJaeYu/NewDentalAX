// 이 파일이 하는 일: 목록 위 도구줄(Toolbar)과 필터 부품. Segmented(여러 개 중 하나 고르기, aria-pressed), SearchInput(돋보기 + 검색어).
// 목록 화면 공통 모양: PageHeader → Toolbar → DataTable (frontend.md §4).
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/** 도구줄(카드 안 맨 위) */
export function Toolbar({ children, label = '목록 도구' }: { children: ReactNode; label?: string }) {
  return (
    <div className="toolbar" role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

interface SegmentedProps<V extends string> {
  /** 묶음 이름(화면 읽기용, 예: "상태 필터") */
  label: string;
  value: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  onChange: (v: V) => void;
}

/** 여러 개 중 하나 고르기 버튼 묶음 */
export function Segmented<V extends string>({ label, value, options, onChange }: SegmentedProps<V>) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 검색어 입력(돋보기 아이콘). aria-label은 label로 준다 */
export function SearchInput({ label, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string }) {
  return (
    <label className="searchbox">
      <Icon name="search" size="md" />
      <input type="search" aria-label={label} {...props} />
    </label>
  );
}

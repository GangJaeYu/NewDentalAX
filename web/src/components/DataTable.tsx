// 이 파일이 하는 일: 목록 표 DataTable. 열 정의·정렬(머리글 버튼)·행 누르기(키보드 Enter 포함)·선택 상자를 지원하고,
// 불러오는 중(Skeleton)·오류(ErrorState + 다시 시도)·빈 상태(EmptyState)를 표 안에서 처리한다(NFR-006 AC3). 좁은 화면에서는 표만 가로로 스크롤된다. 스크롤 영역은 키보드로도 닿게 tabIndex=0·role="region"·이름을 단다(axe scrollable-region-focusable).
// 정렬 계산(sortRows)은 순수 함수라 단위 테스트한다.
import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import { ErrorState, Skeleton } from './States.tsx';

/** 열 하나 */
export interface Column<T> {
  key: string;
  header: string;
  /** 칸 내용(없으면 row[key]) */
  render?: (row: T) => ReactNode;
  /** 정렬에 쓸 값(주면 머리글을 눌러 정렬할 수 있다) */
  sortValue?: (row: T) => string | number | null | undefined;
  /** 숫자는 오른쪽 정렬 */
  align?: 'left' | 'right';
}

export type SortDir = 'asc' | 'desc';

/** 행을 정렬한다(빈 값은 항상 맨 뒤, 한글은 가나다순) */
export function sortRows<T>(rows: readonly T[], value: (row: T) => string | number | null | undefined, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const ea = va === null || va === undefined || va === '';
    const eb = vb === null || vb === undefined || vb === '';
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
    return String(va).localeCompare(String(vb), 'ko') * sign;
  });
}

interface DataTableProps<T> {
  /** 표 이름(화면 읽기용 caption) */
  caption: string;
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  /** 비었을 때 보여 줄 EmptyState */
  empty: ReactNode;
  onRowClick?: (row: T) => void;
  /** 행 이름(선택 상자·행 누르기 안내에 씀) */
  rowLabel?: (row: T) => string;
  /** 선택한 행 key들(주면 맨 앞에 선택 상자 열이 생긴다) */
  selected?: ReadonlySet<string | number>;
  onSelectedChange?: (next: Set<string | number>) => void;
}

/** 목록 표 */
export function DataTable<T>(props: DataTableProps<T>) {
  const { caption, columns, rows, rowKey, loading, error, onRetry, empty, onRowClick, rowLabel, selected, onSelectedChange } = props;
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);

  const sorted = useMemo(() => {
    if (!rows || !sort) return rows ?? [];
    const col = columns.find((c) => c.key === sort.key);
    return col?.sortValue ? sortRows(rows, col.sortValue, sort.dir) : rows;
  }, [rows, sort, columns]);

  if (error && !rows) return <ErrorState message={error.message} onRetry={onRetry} />;
  if (loading && !rows) return <Skeleton rows={6} label={`${caption} 불러오는 중`} />;
  if (!rows || rows.length === 0) return <>{empty}</>;

  const selectable = !!selected && !!onSelectedChange;
  const allKeys = sorted.map(rowKey);
  const allOn = selectable && allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  const toggle = (k: string | number) => {
    if (!selectable) return;
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onSelectedChange(next);
  };

  const headerSort = (c: Column<T>) => {
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }));
  };

  return (
    <div className="tablewrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {selectable ? (
              <th scope="col">
                <input
                  type="checkbox"
                  aria-label="모두 선택"
                  checked={allOn}
                  onChange={() => onSelectedChange(allOn ? new Set() : new Set(allKeys))}
                />
              </th>
            ) : null}
            {columns.map((c) => {
              const dir = sort?.key === c.key ? sort.dir : null;
              return (
                <th key={c.key} scope="col" className={c.align === 'right' ? 'r' : undefined} aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortValue ? (
                    <button type="button" onClick={() => headerSort(c)}>
                      {c.header}
                      <Icon name="sort" size="sm" />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const k = rowKey(row);
            const label = rowLabel?.(row) ?? String(k);
            return (
              <tr
                key={k}
                className={onRowClick ? 'clickable' : undefined}
                aria-selected={selectable ? selected.has(k) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter') onRowClick(row);
                      }
                    : undefined
                }
              >
                {selectable ? (
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`${label} 선택`} checked={selected.has(k)} onChange={() => toggle(k)} />
                  </td>
                ) : null}
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'r num' : undefined}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

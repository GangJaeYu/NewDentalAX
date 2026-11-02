// 이 파일이 하는 일: 모든 목록·카드가 반드시 갖춰야 하는 세 가지 상태 표시(NFR-006 AC3, DESIGN §5-4).
// EmptyState(안내 문구 + 첫 항목 추가 버튼), Skeleton(불러오는 중 뼈대 모양), ErrorState(이유 + "다시 시도" 버튼).
// AsyncView는 useApi 결과를 받아 셋 중 알맞은 것을 고르고, 데이터가 있으면 children을 그린다.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';
import { Button } from './Button.tsx';

interface EmptyStateProps {
  /** 굵은 안내(예: "아직 등록한 품목이 없어요") */
  title: string;
  /** 다음에 할 일 설명 */
  description?: ReactNode;
  /** 첫 항목 추가 버튼 등 */
  action?: ReactNode;
  icon?: IconName;
}

/** 빈 상태 */
export function EmptyState({ title, description, action, icon = 'inbox' }: EmptyStateProps) {
  return (
    <div className="empty">
      <span className="ico">
        <Icon name={icon} />
      </span>
      <b>{title}</b>
      {description ? <p>{description}</p> : null}
      {action ? <div className="act">{action}</div> : null}
    </div>
  );
}

/** 불러오는 중 뼈대(줄 수 지정). 화면 읽기 프로그램에는 "불러오는 중"으로 읽힌다 */
export function Skeleton({ rows = 5, label = '불러오는 중' }: { rows?: number; label?: string }) {
  return (
    <div className="skel" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

interface ErrorStateProps {
  /** 이유(서버의 한국어 문구 그대로) */
  message?: string;
  /** "다시 시도"를 누르면 부를 함수 */
  onRetry?: () => void;
  title?: string;
}

/** 오류 상태: 이유와 다시 시도 버튼 */
export function ErrorState({ message, onRetry, title = '불러오지 못했어요' }: ErrorStateProps) {
  return (
    <div className="errstate" role="alert">
      <span className="ico">
        <Icon name="alert" />
      </span>
      <b>{title}</b>
      <p>{message || '잠시 뒤 다시 시도해 주세요.'}</p>
      {onRetry ? (
        <Button size="sm" icon="refresh" onClick={onRetry}>
          다시 시도
        </Button>
      ) : null}
    </div>
  );
}

interface AsyncViewProps<T> {
  state: { data: T | undefined; error: Error | undefined; loading: boolean; reload: () => void };
  /** 데이터가 비었는지(기본: 배열이면 길이 0) */
  isEmpty?: (data: T) => boolean;
  /** 비었을 때 보여 줄 EmptyState */
  empty: ReactNode;
  /** 뼈대 줄 수 */
  skeletonRows?: number;
  children: (data: T) => ReactNode;
}

/** useApi 결과에 맞춰 뼈대·오류·빈 상태·내용 중 하나를 그린다 */
export function AsyncView<T>({ state, isEmpty, empty, skeletonRows, children }: AsyncViewProps<T>) {
  if (state.error && state.data === undefined) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  if (state.data === undefined) return <Skeleton rows={skeletonRows} />;
  const blank = isEmpty ? isEmpty(state.data) : Array.isArray(state.data) && state.data.length === 0;
  if (blank) return <>{empty}</>;
  return <>{children(state.data)}</>;
}

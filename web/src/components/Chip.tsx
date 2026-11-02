// 이 파일이 하는 일: 상태 칩(tone: danger/warn/ok/info/ghost)과 요약 숫자 타일(Kpi), 진행 막대(Progress)를 그린다.
// 칩에는 항상 글자를 넣는다(색만으로 상태를 나타내지 않음, DESIGN §5-5). Kpi는 라벨·값·단위·보조 문구·링크·tone을 받는다.
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export type Tone = 'danger' | 'warn' | 'ok' | 'info' | 'ghost';

/** 상태 칩. children(글자)은 반드시 넣는다 */
export function Chip({ tone = 'ghost', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${tone}`} title={title}>
      {children}
    </span>
  );
}

interface KpiProps {
  label: string;
  /** 값(숫자·글자). 아직 없으면 null → "-" */
  value: ReactNode | null;
  /** 값 뒤 단위(명, 건, %) */
  unit?: string;
  /** 아래 보조 문구 */
  hint?: ReactNode;
  /** 누르면 갈 화면 */
  to?: string;
  /** 값 색(위험·주의·정상) */
  tone?: 'danger' | 'warn' | 'ok';
}

/** 요약 숫자 타일 하나 */
export function Kpi({ label, value, unit, hint, to, tone }: KpiProps) {
  const empty = value === null || value === undefined;
  const cls = ['kpi', tone, empty && 'no-data'].filter(Boolean).join(' ');
  const inner = (
    <>
      <small>{label}</small>
      <b className="num">
        {empty ? '-' : value}
        {!empty && unit ? <em>{unit}</em> : null}
      </b>
      <span className="s">{hint ?? (empty ? '아직 자료가 없어요' : '')}</span>
    </>
  );
  return to ? (
    <Link className={cls} to={to}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** 요약 숫자 줄(넓은 화면 6칸 → 태블릿 3칸 → 휴대폰 2칸) */
export function KpiRow({ children, label = '요약 숫자' }: { children: ReactNode; label?: string }) {
  return (
    <section className="kpis num" aria-label={label}>
      {children}
    </section>
  );
}

/** 진행 막대(0~1). 글자로 된 진행 정도를 옆에 함께 보여 준다 */
export function Progress({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

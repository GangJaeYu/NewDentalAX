// 이 파일이 하는 일: 작은 SVG 그래프 네 가지(외부 그래프 라이브러리 없음, TD-005). MiniBar(현재고 대비 막대), Sparkline(추세 선),
// BarChart(막대), DonutChart(비율 도넛 + 범례). 색은 토큰 class(c1~c6)만 쓰고 축·라벨은 --muted다.
// 그래프마다 role="img"와 aria-label(값 요약)을 달아 화면 읽기 프로그램도 내용을 알 수 있게 한다. 좌표 계산(sparkPoints·donutArcs)은 단위 테스트한다.
import { formatNumber } from '../lib/format.ts';

/** 현재고 대비 작은 막대(0~1) */
export function MiniBar({ value, tone, label }: { value: number; tone?: 'danger' | 'warn'; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className={['minibar', tone].filter(Boolean).join(' ')} role="img" aria-label={`${label} ${Math.round(pct)}%`}>
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}

/** 값 목록을 width×height 상자 안의 선 좌표로 바꾼다(가장 작은 값이 아래, 큰 값이 위) */
export function sparkPoints(values: readonly number[], width: number, height: number, pad = 2): Array<[number, number]> {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => [pad + step * i, height - pad - ((v - min) / span) * (height - pad * 2)]);
}

/** 추세 선 */
export function Sparkline({ values, label, height = 56 }: { values: readonly number[]; label: string; height?: number }) {
  const w = 240;
  const pts = sparkPoints(values, w, height);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = pts.length ? `${pts[0]?.[0] ?? 0},${height} ${line} ${pts[pts.length - 1]?.[0] ?? 0},${height}` : '';
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-label={`${label}: ${values.map((v) => formatNumber(v)).join(', ')}`} preserveAspectRatio="none">
      {pts.length ? <polygon className="area" points={area} /> : null}
      {pts.length ? <polyline className="line" points={line} /> : null}
    </svg>
  );
}

/** 막대 그래프 */
export function BarChart({ data, label, unit = '' }: { data: ReadonlyArray<{ label: string; value: number }>; label: string; unit?: string }) {
  const w = 320;
  const h = 160;
  const bottom = 22;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = data.length ? w / data.length : w;
  const barW = Math.max(4, Math.min(36, slot * 0.6));
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${formatNumber(d.value)}${unit}`).join(', ')}`}>
      <line className="axis" x1="0" y1={h - bottom} x2={w} y2={h - bottom} />
      {data.map((d, i) => {
        const bh = ((h - bottom - 8) * d.value) / max;
        const x = slot * i + (slot - barW) / 2;
        return (
          <g key={d.label}>
            <rect className="bar" x={x} y={h - bottom - bh} width={barW} height={bh} rx="3" />
            <text x={slot * i + slot / 2} y={h - 6} textAnchor="middle">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 도넛 조각 경로(시작·끝 각도, 0 = 12시 방향, 시계 방향) */
export function donutArcs(values: readonly number[]): Array<{ start: number; end: number; ratio: number }> {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  let acc = 0;
  return values.map((v) => {
    const ratio = total > 0 ? Math.max(0, v) / total : 0;
    const start = acc * 360;
    acc += ratio;
    return { start, end: acc * 360, ratio };
  });
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** 비율 도넛 + 범례 */
export function DonutChart({ data, label }: { data: ReadonlyArray<{ label: string; value: number }>; label: string }) {
  const arcs = donutArcs(data.map((d) => d.value));
  const r = 40;
  return (
    <div>
      <svg className="chart" viewBox="0 0 100 100" width="120" height="120" role="img" aria-label={`${label}: ${data.map((d, i) => `${d.label} ${Math.round((arcs[i]?.ratio ?? 0) * 100)}%`).join(', ')}`}>
        <circle cx="50" cy="50" r={r} fill="none" className="axis" strokeWidth="14" />
        {arcs.map((a, i) => {
          if (a.ratio <= 0) return null;
          if (a.ratio >= 0.9999) return <circle key={i} cx="50" cy="50" r={r} fill="none" className={`c${(i % 6) + 1}`} strokeWidth="14" />;
          const [x1, y1] = polar(50, 50, r, a.start);
          const [x2, y2] = polar(50, 50, r, a.end);
          const large = a.end - a.start > 180 ? 1 : 0;
          return <path key={i} d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`} fill="none" className={`c${(i % 6) + 1}`} strokeWidth="14" />;
        })}
      </svg>
      <ul className="donut-legend">
        {data.map((d, i) => (
          <li key={d.label}>
            <i className={`c${(i % 6) + 1}`} aria-hidden="true" />
            <span>{d.label}</span>
            <span className="num muted">{Math.round((arcs[i]?.ratio ?? 0) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

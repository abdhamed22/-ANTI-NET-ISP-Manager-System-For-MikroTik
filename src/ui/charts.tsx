// Tiny dependency-free SVG charts. They always render left-to-right (oldest
// first) and use CSS variables so they follow the light/dark theme.

export function BarChart(props: { data: Array<{ label: string; value: number }>; format: (v: number) => string }) {
  const max = Math.max(1, ...props.data.map((d) => d.value));
  const w = 320;
  const h = 150;
  const gap = 10;
  const bw = (w - gap * (props.data.length + 1)) / Math.max(1, props.data.length);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h + 34}`} role="img">
      {props.data.map((d, i) => {
        const bh = d.value > 0 ? Math.max(3, (d.value / max) * h) : 0;
        const x = gap + i * (bw + gap);
        return (
          <g key={i}>
            <rect x={x} y={h - bh} width={bw} height={bh} rx={6} className="bar" />
            <text x={x + bw / 2} y={h + 16} textAnchor="middle" className="axis">
              {d.label}
            </text>
            {d.value > 0 && (
              <text x={x + bw / 2} y={Math.max(10, h - bh - 4)} textAnchor="middle" className="value">
                {props.format(d.value)}
              </text>
            )}
          </g>
        );
      })}
      <line x1={0} x2={w} y1={h} y2={h} className="baseline" />
    </svg>
  );
}

export function TrafficChart(props: { points: Array<{ rx: number; tx: number }> }) {
  const w = 320;
  const h = 120;
  const n = 30;
  const pts = props.points.slice(-n);
  const max = Math.max(1, ...pts.map((p) => Math.max(p.rx, p.tx)));
  const line = (key: 'rx' | 'tx') =>
    pts.map((p, i) => `${((i + (n - pts.length)) / (n - 1)) * w},${h - (p[key] / max) * (h - 6)}`).join(' ');
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img">
      <line x1={0} x2={w} y1={h} y2={h} className="baseline" />
      {pts.length > 1 && (
        <>
          <polyline points={line('rx')} className="line rx" />
          <polyline points={line('tx')} className="line tx" />
        </>
      )}
    </svg>
  );
}

const SLICE_CLASSES = ['s1', 's2', 's3', 's4', 's5', 's6'];

export function Donut(props: { data: Array<{ name: string; value: number }> }) {
  const total = props.data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img">
        <circle cx={70} cy={70} r={r} className="donut-track" />
        {props.data.map((d, i) => {
          const len = (d.value / total) * c;
          const el = (
            <circle
              key={d.name}
              cx={70}
              cy={70}
              r={r}
              className={`donut-slice ${SLICE_CLASSES[i % SLICE_CLASSES.length]}`}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
          offset += len;
          return el;
        })}
        <text x={70} y={76} textAnchor="middle" className="donut-total">
          {props.data.reduce((s, d) => s + d.value, 0)}
        </text>
      </svg>
      <ul className="legend">
        {props.data.map((d, i) => (
          <li key={d.name}>
            <span className={`dot ${SLICE_CLASSES[i % SLICE_CLASSES.length]}`} />
            <span dir="ltr">{d.name}</span>
            <b>{d.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

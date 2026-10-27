import { useId } from "react";

/** Minimal SVG charts. Neutral by default; pass `color` for a data accent. */

export function Sparkline({ data, width = 120, height = 32, color = "var(--chart-1)", fill = true }: { data: number[]; width?: number; height?: number; color?: string; fill?: boolean }) {
  const id = useId();
  if (data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.18" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${line} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface Series {
  name: string;
  data: number[];
  color?: string;
}

export function LineChart({
  series,
  labels,
  height = 200,
  yMin,
  yMax,
  unit = "",
}: {
  series: Series[];
  labels?: string[];
  height?: number;
  yMin?: number;
  yMax?: number;
  unit?: string;
}) {
  const width = 600;
  const padL = 36;
  const padB = labels ? 22 : 8;
  const all = series.flatMap((s) => s.data);
  if (all.length === 0) return <div className="subtle" style={{ height, display: "grid", placeItems: "center", fontSize: 12 }}>—</div>;
  const lo = yMin ?? Math.min(...all);
  const hi = yMax ?? Math.max(...all);
  const span = hi - lo || 1;
  const n = Math.max(...series.map((s) => s.data.length));
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (width - padL - 8);
  const y = (v: number) => 8 + (1 - (v - lo) / span) * (height - 8 - padB);
  const ticks = [0, 0.5, 1].map((f) => lo + f * span);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={width - 8} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="var(--text-3)" fontFamily="var(--font-mono)">
            {Math.round(t)}
            {unit}
          </text>
        </g>
      ))}
      {labels?.map((l, i) =>
        i % Math.ceil(labels.length / 8) === 0 ? (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--text-3)">
            {l}
          </text>
        ) : null,
      )}
      {series.map((s, si) => (
        <path
          key={s.name}
          d={s.data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
          fill="none"
          stroke={s.color ?? (si === 0 ? "var(--chart-1)" : "var(--chart-2)")}
          strokeWidth="1.75"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

export function BarChart({ data, height = 160, color = "var(--chart-1)" }: { data: { label: string; value: number }[]; height?: number; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height }}>
      {data.map((d) => (
        <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
          <div title={`${d.label}: ${d.value}`} style={{ width: "100%", height: `${(d.value / max) * 100}%`, minHeight: 2, background: color, borderRadius: 4, opacity: 0.9 }} />
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Semicircular gauge (tachometer style), used for live WPM/APM. */
export function Gauge({ value, max, label, unit, size = 180, color = "var(--text)" }: { value: number; max: number; label?: string; unit?: string; size?: number; color?: string }) {
  const r = 70;
  const cx = 90;
  const cy = 86;
  const f = Math.max(0, Math.min(1, value / max));
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from);
    const a1 = Math.PI * (1 - to);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    return `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`;
  };
  return (
    <svg viewBox="0 0 180 104" width={size} height={(size * 104) / 180} role="img" aria-label={`${label ?? ""} ${Math.round(value)} ${unit ?? ""}`}>
      <path d={arc(0, 1)} stroke="var(--surface-3)" strokeWidth="10" fill="none" strokeLinecap="round" />
      {f > 0.001 && <path d={arc(0, f)} stroke={color} strokeWidth="10" fill="none" strokeLinecap="round" />}
      {Array.from({ length: 11 }, (_, i) => {
        const a = Math.PI * (1 - i / 10);
        return <line key={i} x1={cx + (r - 14) * Math.cos(a)} y1={cy - (r - 14) * Math.sin(a)} x2={cx + (r - 18) * Math.cos(a)} y2={cy - (r - 18) * Math.sin(a)} stroke="var(--text-3)" strokeWidth="1" />;
      })}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="28" fontWeight="600" fill="var(--text)" style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em" }}>
        {Math.round(value)}
      </text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="10" fill="var(--text-3)">
        {[label, unit].filter(Boolean).join(" · ")}
      </text>
    </svg>
  );
}

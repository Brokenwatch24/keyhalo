import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { KeyDef, LedDef, RGB } from "@/core/types";

type ColorValue = RGB | string;

const toCss = (c: ColorValue) => (typeof c === "string" ? c : `rgb(${c[0]}, ${c[1]}, ${c[2]})`);
const isDark = (c: ColorValue) => {
  if (typeof c === "string") {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
    if (!m) return false;
    return parseInt(m[1], 16) + parseInt(m[2], 16) + parseInt(m[3], 16) < 24;
  }
  return c[0] + c[1] + c[2] < 24;
};

/** Measures the container width so devices scale to fit. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    setWidth(ref.current.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export interface KeyboardViewProps {
  keys: KeyDef[];
  size: { w: number; h: number };
  colors?: Record<string, ColorValue>;
  /** Overrides the secondary legend (e.g. what a shortcut does). */
  legends?: Record<string, string>;
  selected?: Set<string> | string[];
  pressed?: Set<string>;
  dim?: Set<string>;
  badges?: Record<string, string>;
  onKeyClick?: (code: string, e: MouseEvent) => void;
  onKeyHover?: (code: string | null) => void;
  showLabels?: boolean;
  /** Max width in px; the drawing scales down to fit its container. */
  maxWidth?: number;
  /** 0..1 how strongly LED colours glow through the keycaps. */
  glow?: number;
}

export function KeyboardView({
  keys,
  size,
  colors,
  legends,
  selected,
  pressed,
  dim,
  badges,
  onKeyClick,
  onKeyHover,
  showLabels = true,
  maxWidth = 1100,
  glow = 0.85,
}: KeyboardViewProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const pad = 14;
  const inner = Math.min(width, maxWidth) - pad * 2;
  const unit = inner > 0 ? inner / size.w : 0;
  const sel = selected instanceof Set ? selected : new Set(selected ?? []);

  return (
    <div ref={ref} style={{ width: "100%" }}>
      {unit > 0 && (
        <div className="kh-kb" style={{ width: inner + pad * 2, margin: "0 auto" }}>
          <div className="kh-kb__inner" style={{ width: inner, height: size.h * unit }}>
            {keys.map((k) => {
              const c = colors?.[k.code];
              const lit = c !== undefined && !isDark(c);
              const css = c !== undefined ? toCss(c) : undefined;
              const sub = legends?.[k.code] ?? k.sublabel;
              const classes = [
                "kh-key",
                onKeyClick && "kh-key--clickable",
                sel.has(k.code) && "kh-key--selected",
                pressed?.has(k.code) && "kh-key--pressed",
                dim?.has(k.code) && "kh-key--dim",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={k.code}
                  className={classes}
                  style={{ left: k.x * unit, top: k.y * unit, width: (k.w ?? 1) * unit, height: (k.h ?? 1) * unit }}
                  onClick={onKeyClick ? (e) => onKeyClick(k.code, e) : undefined}
                  onMouseEnter={onKeyHover ? () => onKeyHover(k.code) : undefined}
                  onMouseLeave={onKeyHover ? () => onKeyHover(null) : undefined}
                  title={sub ? `${k.label} — ${sub}` : k.label}
                  data-code={k.code}
                >
                  <div className="kh-key__cap" style={lit ? { color: "#fff", textShadow: `0 0 6px ${css}` } : undefined}>
                    {lit && (
                      <span
                        className="kh-key__glow"
                        style={{
                          background: `radial-gradient(120% 90% at 50% 60%, ${css} 0%, transparent 100%)`,
                          opacity: glow,
                          boxShadow: `inset 0 0 ${Math.max(6, unit * 0.35)}px ${css}`,
                        }}
                      />
                    )}
                    {showLabels && unit > 26 && <span className="kh-key__label">{k.label}</span>}
                    {showLabels && sub && unit > 34 && <span className="kh-key__sub">{sub}</span>}
                    {badges?.[k.code] && <span className="kh-key__badge">{badges[k.code]}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export interface MouseViewProps {
  leds?: LedDef[];
  colors?: Record<string, ColorValue>;
  /** Pixel height of the drawing. */
  height?: number;
  selected?: string[];
  onLedClick?: (id: string) => void;
}

/** Top-down mouse silhouette with glowing LED zones (positions in a 0..2 × 0..3.4 unit box). */
export function MouseView({ leds = [], colors, height = 260, selected = [], onLedClick }: MouseViewProps) {
  const W = 2;
  const H = 3.4;
  return (
    <svg viewBox={`-0.2 -0.2 ${W + 0.4} ${H + 0.4}`} height={height} style={{ display: "block", margin: "0 auto" }} role="img" aria-label="Mouse">
      <defs>
        <linearGradient id="kh-mouse-body" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#26262b" />
          <stop offset="1" stopColor="#141417" />
        </linearGradient>
        <filter id="kh-mouse-glow" x="-1" y="-1" width="3" height="3">
          <feGaussianBlur stdDeviation="0.09" />
        </filter>
      </defs>
      <path
        d="M1 0 C1.62 0 1.95 0.55 1.98 1.35 C2.02 2.35 1.86 3.4 1 3.4 C0.14 3.4 -0.02 2.35 0.02 1.35 C0.05 0.55 0.38 0 1 0 Z"
        fill="url(#kh-mouse-body)"
        stroke="#2c2c31"
        strokeWidth="0.025"
      />
      <path d="M1 0.02 L1 1.25" stroke="#0b0b0d" strokeWidth="0.03" />
      <path d="M0.08 1.25 C0.5 1.33 1.5 1.33 1.92 1.25" stroke="#0b0b0d" strokeWidth="0.025" fill="none" />
      <rect x="0.9" y="0.3" width="0.2" height="0.45" rx="0.1" fill="#0d0d10" stroke="#2c2c31" strokeWidth="0.02" />
      {leds.map((l) => {
        const c = colors?.[l.id];
        const css = c ? toCss(c) : "#222";
        const w = l.w ?? 0.36;
        const h = l.h ?? 0.36;
        return (
          <g key={l.id} onClick={onLedClick ? () => onLedClick(l.id) : undefined} style={{ cursor: onLedClick ? "pointer" : undefined }}>
            <title>{l.name}</title>
            {c && !isDark(c) && <ellipse cx={l.x} cy={l.y} rx={w * 0.9} ry={h * 0.9} fill={css} opacity={0.55} filter="url(#kh-mouse-glow)" />}
            <rect
              x={l.x - w / 2}
              y={l.y - h / 2}
              width={w}
              height={h}
              rx={Math.min(w, h) / 2}
              fill={css}
              stroke={selected.includes(l.id) ? "#fff" : "rgba(255,255,255,0.12)"}
              strokeWidth={selected.includes(l.id) ? 0.035 : 0.015}
            />
          </g>
        );
      })}
    </svg>
  );
}

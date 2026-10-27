import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { Badge, Button, Card, Kbd } from "@/ui";
import { useT } from "@/i18n";
import { Metric, TestHeader, cssVar, fitCanvas, fmt, lockPointer, usePointerLocked, type LockMode } from "./shared";

/** Strokes shorter than this (counts) are too short to judge straightness. */
const MIN_STROKE = 120;
const MAX_POINTS = 30000;
const STROKE_COLOR = "#5eead4";

interface Point {
  x: number;
  y: number;
  /** Button held (part of a stroke). */
  s: boolean;
}

interface StrokeResult {
  length: number;
  rms: number;
  max: number;
  /** Degrees from horizontal, -90..90. */
  angle: number;
  /** Fitted line for drawing. */
  line: [Point, Point];
}

/** Total-least-squares line through the points; deviation = perpendicular distance to it. */
function analyse(pts: Point[]): StrokeResult | null {
  if (pts.length < 4) return null;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < MIN_STROKE) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(th);
  const s = Math.sin(th);
  let sum = 0;
  let max = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const d = Math.abs(-(p.x - mx) * s + (p.y - my) * c);
    sum += d * d;
    max = Math.max(max, d);
    const along = (p.x - mx) * c + (p.y - my) * s;
    lo = Math.min(lo, along);
    hi = Math.max(hi, along);
  }
  let angle = (-th * 180) / Math.PI; // screen y grows downwards
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  return {
    length,
    rms: Math.sqrt(sum / n),
    max,
    angle,
    line: [
      { x: mx + lo * c, y: my + lo * s, s: true },
      { x: mx + hi * c, y: my + hi * s, s: true },
    ],
  };
}

export function SensorTest() {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const locked = usePointerLocked(wrapRef);
  const [mode, setMode] = useState<LockMode | null>(null);
  const [results, setResults] = useState<StrokeResult[]>([]);
  const points = useRef<Point[]>([]);
  const pos = useRef({ x: 0, y: 0 });
  const stroke = useRef<Point[] | null>(null);
  const dirty = useRef(true);
  const lastResult = results[results.length - 1];

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { g, w, h } = fitCanvas(canvas);
    g.clearRect(0, 0, w, h);
    // Grid (32 px cells) with centre axes.
    const grid = cssVar("--border", "#232327");
    g.lineWidth = 1;
    for (const [len, horizontal] of [
      [w, false],
      [h, true],
    ] as const) {
      const mid = len / 2;
      for (let i = -Math.floor(mid / 32); i * 32 <= mid; i++) {
        const v = Math.round(mid + i * 32) + 0.5;
        g.strokeStyle = i === 0 ? cssVar("--border-strong", "#2e2e33") : grid;
        g.beginPath();
        if (horizontal) {
          g.moveTo(0, v);
          g.lineTo(w, v);
        } else {
          g.moveTo(v, 0);
          g.lineTo(v, h);
        }
        g.stroke();
      }
    }
    const pts = points.current;
    if (pts.length < 2) return;
    // Fit everything in view.
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const pad = 28;
    const scale = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0), 2);
    const ox = w / 2 - ((x0 + x1) / 2) * scale;
    const oy = h / 2 - ((y0 + y1) / 2) * scale;
    const X = (v: number) => ox + v * scale;
    const Y = (v: number) => oy + v * scale;

    g.lineJoin = "round";
    g.lineCap = "round";
    // Free movement (thin, neutral) and strokes (accent).
    for (const pass of [false, true]) {
      g.strokeStyle = pass ? STROKE_COLOR : cssVar("--text-3", "#666");
      g.globalAlpha = pass ? 1 : 0.45;
      g.lineWidth = pass ? 1.6 : 1;
      g.beginPath();
      let open = false;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        if (p.s === pass && pts[i - 1].s === pass) {
          if (!open) g.moveTo(X(pts[i - 1].x), Y(pts[i - 1].y));
          g.lineTo(X(p.x), Y(p.y));
          open = true;
        } else open = false;
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    // Fitted line of the last stroke.
    const last = lastRef.current;
    if (last) {
      g.setLineDash([5, 5]);
      g.strokeStyle = cssVar("--text-2", "#aaa");
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(X(last.line[0].x), Y(last.line[0].y));
      g.lineTo(X(last.line[1].x), Y(last.line[1].y));
      g.stroke();
      g.setLineDash([]);
    }
    // Current position
    g.fillStyle = cssVar("--text", "#fff");
    g.beginPath();
    g.arc(X(pos.current.x), Y(pos.current.y), 3, 0, Math.PI * 2);
    g.fill();
  }, []);

  const lastRef = useRef<StrokeResult | undefined>(undefined);
  lastRef.current = lastResult;

  // Render loop (only redraws when something changed).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (dirty.current) {
        dirty.current = false;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => (dirty.current = true));
    if (canvasRef.current) ro.observe(canvasRef.current);
    const theme = new MutationObserver(() => (dirty.current = true));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      theme.disconnect();
    };
  }, [draw]);

  // Raw movement while locked.
  useEffect(() => {
    if (!locked) return;
    const onMove = (e: MouseEvent) => {
      pos.current = { x: pos.current.x + e.movementX, y: pos.current.y + e.movementY };
      const p = { ...pos.current, s: !!stroke.current };
      points.current.push(p);
      if (points.current.length > MAX_POINTS) points.current.splice(0, points.current.length - MAX_POINTS);
      stroke.current?.push(p);
      dirty.current = true;
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const p = { ...pos.current, s: true };
      stroke.current = [p];
      points.current.push(p);
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0 || !stroke.current) return;
      const r = analyse(stroke.current);
      stroke.current = null;
      if (r) setResults((rs) => [...rs, r].slice(-50));
      dirty.current = true;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      stroke.current = null;
    };
  }, [locked]);

  useEffect(() => {
    dirty.current = true;
  }, [results]);

  const start = async () => {
    if (!wrapRef.current) return;
    setMode(await lockPointer(wrapRef.current));
  };

  const reset = () => {
    points.current = [];
    pos.current = { x: 0, y: 0 };
    stroke.current = null;
    setResults([]);
    dirty.current = true;
  };

  const valid = results.filter((r) => r.length >= 400);
  const avgPct = valid.length ? (valid.reduce((s, r) => s + r.rms / r.length, 0) / valid.length) * 100 : NaN;
  // Freehand lines are never this straight AND this level: a strong hint of angle snapping.
  const snapping = valid.length >= 3 && valid.filter((r) => Math.abs(r.angle) < 0.6 && r.rms / r.length < 0.0015).length >= Math.ceil(valid.length * 0.75);

  return (
    <div className="tb-stack">
      <TestHeader hint={t("testbench.sensor.hint")} onReset={reset}>
        {mode && <Badge tone={mode === "raw" ? "success" : "warning"} dot>{mode === "raw" ? t("testbench.lock.raw") : t("testbench.lock.adjusted")}</Badge>}
      </TestHeader>

      <div className="tb-split">
        <div ref={wrapRef} className={`tb-pad tb-pad--canvas${locked ? " tb-pad--active" : ""}`}>
          <canvas ref={canvasRef} className="tb-canvas" />
          {!locked && (
            <div className="tb-pad__overlay">
              <div className="tb-pad__label">{t("testbench.sensor.prompt")}</div>
              <Button variant="primary" icon={<Lock />} onClick={start}>
                {t("testbench.lock.start")}
              </Button>
            </div>
          )}
          {locked && (
            <div className="tb-pad__corner">
              {t("testbench.lock.release")} <Kbd>Esc</Kbd>
            </div>
          )}
        </div>

        <Card className="tb-panel">
          <div className="tb-metrics">
            <Metric label={t("testbench.sensor.strokes")} value={results.length} />
            <Metric label={t("testbench.sensor.length")} value={lastResult ? fmt(lastResult.length) : "—"} unit={lastResult ? t("testbench.counts") : undefined} />
            <Metric
              label={t("testbench.sensor.rms")}
              value={lastResult ? fmt(lastResult.rms, 1) : "—"}
              unit={lastResult ? t("testbench.counts") : undefined}
              hint={lastResult ? `${fmt((lastResult.rms / lastResult.length) * 100, 2)} % ${t("testbench.sensor.ofLength")}` : undefined}
            />
            <Metric label={t("testbench.sensor.max")} value={lastResult ? fmt(lastResult.max, 1) : "—"} unit={lastResult ? t("testbench.counts") : undefined} />
            <Metric label={t("testbench.sensor.angle")} value={lastResult ? `${fmt(lastResult.angle, 1)}°` : "—"} />
            <Metric label={t("testbench.sensor.average")} value={Number.isFinite(avgPct) ? fmt(avgPct, 2) : "—"} unit={Number.isFinite(avgPct) ? "%" : undefined} />
          </div>
          <div className={`tb-callout${snapping ? " tb-callout--warn" : ""}`}>
            {snapping ? t("testbench.sensor.snapping") : t("testbench.sensor.snappingHint")}
          </div>
        </Card>
      </div>
    </div>
  );
}

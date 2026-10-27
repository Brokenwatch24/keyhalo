import { useEffect, useRef } from "react";
import { Compositor } from "@/core/lighting";
import { buildGeometry, type SceneGeometry } from "@/core/lighting/scene";
import type { Signals } from "@/core/lighting/signals";
import type { BlendMode } from "@/core/types";
import { virtualKeyboardDefinition } from "./util";

/**
 * Live mini-previews for the effect picker: each card owns a tiny Compositor that renders the
 * effect on a virtual 60 % board. One shared requestAnimationFrame loop (~15 fps) draws only the
 * cards that are on screen. Reactive effects get simulated key presses, widgets demo signals.
 */

let geometry: SceneGeometry | null = null;
function geom(): SceneGeometry {
  if (geometry) return geometry;
  const def = virtualKeyboardDefinition();
  const layout = Object.values(def.layouts!)[0];
  geometry = buildGeometry([{ uid: "mini", definition: def, layout, desk: { x: 0, y: 0 } }]);
  return geometry;
}

interface Entry {
  canvas: HTMLCanvasElement;
  comp: Compositor;
  visible: boolean;
  reactive: boolean;
  nextKey: number;
}

const entries = new Set<Entry>();
let raf = 0;
let lastDraw = 0;
const t0 = performance.now();
const FPS = 15;
const TYPING = ["KeyK", "KeyE", "KeyY", "KeyH", "KeyA", "KeyL", "KeyO", "Space", "KeyG", "KeyF", "KeyJ", "KeyR", "KeyU", "KeyN"];

function signals(t: number): Omit<Signals, "overlays"> {
  const wave = (f: number, p = 0) => 0.5 + 0.5 * Math.sin(t * f + p);
  return {
    cpu: { load: 25 + 60 * wave(0.7), temp: 60 },
    gpu: { load: 55, temp: 50 + 30 * wave(0.5), vramPct: 40 },
    ram: { pct: 40 + 30 * wave(0.4, 1) },
    battery: { "mini:mouse": { percent: 72, charging: false } },
    bambu: { progress: (t * 9) % 100, state: "RUNNING" },
    claude: { state: "working", since: 0 },
    micMuted: true,
    capsLock: wave(0.9) > 0.4,
    layer: "nav",
    pomodoro: { phase: "focus", remainingMs: (1 - ((t / 30) % 1)) * 25 * 60_000, totalMs: 25 * 60_000 },
    wpm: 50 + 60 * wave(0.6),
    audio: { bands: Array.from({ length: 16 }, (_, i) => Math.max(0.05, Math.min(1, 0.85 - i * 0.04 + 0.3 * Math.sin(t * 5 + i * 1.3)))), level: wave(4) },
    game: { game: "cs2", health: 30 + 70 * wave(0.5), armor: 100, ammo: wave(0.8) },
  };
}

function draw(e: Entry, frame: Float32Array) {
  const g = geom();
  const c = e.canvas;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pad = 8;
  const unit = Math.min((w - pad * 2) / g.width, (h - pad * 2) / g.height);
  const ox = (w - g.width * unit) / 2;
  const oy = (h - g.height * unit) / 2;
  const gap = Math.max(1, unit * 0.12);
  for (const k of g.keys) {
    const r = frame[k.index * 3];
    const gg = frame[k.index * 3 + 1];
    const b = frame[k.index * 3 + 2];
    const lum = r + gg + b;
    const x = ox + (k.x - k.w / 2) * unit + gap / 2;
    const y = oy + (k.y - k.h / 2) * unit + gap / 2;
    const kw = k.w * unit - gap;
    const kh = k.h * unit - gap;
    ctx.fillStyle = lum < 24 ? "#1c1c21" : `rgb(${r | 0},${gg | 0},${b | 0})`;
    if (lum >= 24) {
      ctx.shadowColor = `rgba(${r | 0},${gg | 0},${b | 0},0.7)`;
      ctx.shadowBlur = unit * 0.6;
    } else ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.roundRect(x, y, kw, kh, Math.min(3, unit * 0.18));
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function loop(now: number) {
  raf = requestAnimationFrame(loop);
  if (now - lastDraw < 1000 / FPS) return;
  const dt = lastDraw ? Math.min(0.25, (now - lastDraw) / 1000) : 1 / FPS;
  lastDraw = now;
  const t = (now - t0) / 1000;
  const s = signals(t);
  for (const e of entries) {
    if (!e.visible) continue;
    if (e.reactive && t >= e.nextKey) {
      const k = TYPING[Math.floor(Math.random() * TYPING.length)];
      e.comp.keyEvent(k, true, t);
      e.comp.keyEvent(k, false, t + 0.06);
      e.nextKey = t + 0.25 + Math.random() * 0.45;
    }
    try {
      draw(e, e.comp.render(t, dt, s));
    } catch {
      /* a broken effect just stays dark */
    }
  }
}

function register(e: Entry) {
  entries.add(e);
  if (!raf) raf = requestAnimationFrame(loop);
}

function unregister(e: Entry) {
  entries.delete(e);
  e.comp.dispose();
  if (!entries.size && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
    lastDraw = 0;
  }
}

/** Attach a live preview of `effect` to a canvas. */
export function useMiniPreview(effect: string, opts: { reactive?: boolean; params?: Record<string, unknown>; blend?: BlendMode } = {}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paramsKey = JSON.stringify(opts.params ?? {});
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = geom();
    const comp = new Compositor();
    comp.setGeometry(g.keys, g.width, g.height);
    comp.setScene({
      layers: [{ id: "mini", effect, params: JSON.parse(paramsKey), blend: opts.blend ?? "normal", opacity: 1, enabled: true }],
      brightness: 1,
      fps: FPS,
    });
    const entry: Entry = { canvas, comp, visible: false, reactive: !!opts.reactive, nextKey: 0 };
    const io = new IntersectionObserver(([en]) => (entry.visible = en.isIntersecting), { threshold: 0.01 });
    io.observe(canvas);
    register(entry);
    return () => {
      io.disconnect();
      unregister(entry);
    };
  }, [effect, paramsKey, opts.reactive, opts.blend]);
  return ref;
}

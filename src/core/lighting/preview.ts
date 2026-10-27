import type { DeviceDefinition, Profile, RGB } from "@/core/types";
import { Compositor } from "./compositor";
import { buildGeometry } from "./scene";
import type { Signals } from "./signals";
import { normaliseScene } from "./store";

/**
 * Render a profile on a device drawing (plate + keycaps lit with the colours of the frame at
 * t = 1 s) and return a PNG data URL. Used by the gallery and the publish flow.
 */

const DEMO_SIGNALS: Omit<Signals, "overlays"> = {
  cpu: { load: 42, temp: 55 },
  gpu: { load: 60, temp: 64, vramPct: 40 },
  ram: { pct: 47 },
  battery: { "preview:mouse": { percent: 76, charging: false } },
  bambu: { progress: 62, state: "RUNNING" },
  claude: { state: "working", since: 0 },
  micMuted: true,
  capsLock: true,
  layer: null,
  pomodoro: { phase: "focus", remainingMs: 15 * 60_000, totalMs: 25 * 60_000 },
  wpm: 85,
  audio: { bands: Array.from({ length: 16 }, (_, i) => Math.max(0.1, 0.9 - i * 0.05 + 0.15 * Math.sin(i * 1.7))), level: 0.6 },
  game: { game: "cs2", health: 70, armor: 100, ammo: 0.6 },
};

export interface PreviewOptions {
  /** Pixels per key unit (default 40). */
  unit?: number;
  /** Time of the frame in seconds (default 1). */
  t?: number;
  background?: string;
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  if (typeof document === "undefined") throw new Error("renderProfilePreview needs a DOM canvas");
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

export async function renderProfilePreview(profile: Profile, definition: DeviceDefinition, layoutId?: string, opts: PreviewOptions = {}): Promise<string> {
  const layouts = definition.layouts ?? {};
  const layout = layouts[layoutId ?? definition.defaultLayout ?? ""] ?? Object.values(layouts)[0];
  const geom = buildGeometry([{ uid: "preview", definition, layout, desk: { x: 0, y: 0 } }]);
  const comp = new Compositor();
  comp.setGeometry(geom.keys, geom.width, geom.height);
  comp.setScene(normaliseScene(profile.lighting));

  // Simulate a little typing so reactive effects show something, then run to t.
  const T = opts.t ?? 1;
  const typed = ["KeyH", "KeyA", "KeyL", "KeyO", "Space", "KeyK"];
  let frame: Float32Array = new Float32Array(geom.keys.length * 3);
  const steps = Math.max(1, Math.round(T * 30));
  for (let s = 1; s <= steps; s++) {
    const t = (s / steps) * T;
    const k = typed[Math.floor(t * 8)];
    if (k && s % 4 === 0) {
      comp.keyEvent(k, true, t);
      comp.keyEvent(k, false, t + 0.05);
    }
    frame = comp.render(t, T / steps, DEMO_SIGNALS);
    if (s === steps - 1) await comp.flush();
  }
  frame = comp.render(T, T / steps, DEMO_SIGNALS);
  comp.dispose();

  const unit = opts.unit ?? 40;
  const pad = unit * 0.45;
  const w = Math.ceil(definition.size.w * unit + pad * 2);
  const h = Math.ceil(definition.size.h * unit + pad * 2);
  const canvas = createCanvas(w, h);
  const g = canvas.getContext("2d")!;
  g.fillStyle = opts.background ?? "#0d0d10";
  g.fillRect(0, 0, w, h);

  const colorOf = (i: number): RGB => [frame[i * 3], frame[i * 3 + 1], frame[i * 3 + 2]];
  const keys = geom.keys;
  // Positions were normalised to the scene origin; recover the definition offset.
  const offX = keys.length ? Math.min(...(layout?.keys ?? []).map((k) => k.x), ...(definition.leds ?? []).map((l) => l.x - (l.w ?? 0.36) / 2)) : 0;
  const offY = keys.length ? Math.min(...(layout?.keys ?? []).map((k) => k.y), ...(definition.leds ?? []).map((l) => l.y - (l.h ?? 0.36) / 2)) : 0;
  const px = (x: number) => pad + (x + (Number.isFinite(offX) ? offX : 0)) * unit;
  const py = (y: number) => pad + (y + (Number.isFinite(offY) ? offY : 0)) * unit;

  if (definition.type === "keyboard" || layout) {
    // Plate.
    g.fillStyle = "#18181c";
    roundRect(g, pad * 0.4, pad * 0.4, w - pad * 0.8, h - pad * 0.8, unit * 0.3);
    g.fill();
    for (const k of keys.filter((k) => k.kind === "key")) {
      const c = colorOf(k.index);
      const x = px(k.x - k.w / 2);
      const y = py(k.y - k.h / 2);
      const kw = k.w * unit;
      const kh = k.h * unit;
      // Underglow bleeding around the cap.
      const glow = g.createRadialGradient(x + kw / 2, y + kh / 2, 0, x + kw / 2, y + kh / 2, Math.max(kw, kh) * 0.75);
      glow.addColorStop(0, css(c, 0.55));
      glow.addColorStop(1, css(c, 0));
      g.fillStyle = glow;
      g.fillRect(x - unit * 0.2, y - unit * 0.2, kw + unit * 0.4, kh + unit * 0.4);
      // Keycap.
      const inset = unit * 0.06;
      g.fillStyle = "#222228";
      roundRect(g, x + inset, y + inset, kw - inset * 2, kh - inset * 2, unit * 0.12);
      g.fill();
      const top = unit * 0.14;
      const lit = g.createLinearGradient(x, y, x, y + kh);
      lit.addColorStop(0, css(c, 0.45));
      lit.addColorStop(1, css(c, 0.25));
      g.fillStyle = lit;
      roundRect(g, x + top, y + top * 0.7, kw - top * 2, kh - top * 2, unit * 0.1);
      g.fill();
    }
    g.font = `${Math.round(unit * 0.22)}px Inter, system-ui, sans-serif`;
    g.textAlign = "left";
    g.textBaseline = "top";
    for (const kd of layout?.keys ?? []) {
      if (!kd.label) continue;
      const k = keys.find((s) => s.id === kd.code && s.kind === "key");
      if (!k) continue;
      const c = colorOf(k.index);
      g.fillStyle = css([Math.min(255, c[0] * 0.4 + 170), Math.min(255, c[1] * 0.4 + 170), Math.min(255, c[2] * 0.4 + 170)], 0.9);
      g.fillText(kd.label.length > 6 ? kd.label.slice(0, 6) : kd.label, px(k.x - k.w / 2) + unit * 0.2, py(k.y - k.h / 2) + unit * 0.18);
    }
  }

  const leds = keys.filter((k) => k.kind === "led");
  if (definition.type === "mouse") {
    const s = Math.min((w - pad * 2) / 2, (h - pad * 2) / 3.4);
    const mx = (x: number) => w / 2 + (x - 1) * s;
    const my = (y: number) => pad + y * s;
    g.fillStyle = "#1c1c21";
    g.beginPath();
    g.moveTo(mx(1), my(0));
    g.bezierCurveTo(mx(1.62), my(0), mx(1.95), my(0.55), mx(1.98), my(1.35));
    g.bezierCurveTo(mx(2.02), my(2.35), mx(1.86), my(3.4), mx(1), my(3.4));
    g.bezierCurveTo(mx(0.14), my(3.4), mx(-0.02), my(2.35), mx(0.02), my(1.35));
    g.bezierCurveTo(mx(0.05), my(0.55), mx(0.38), my(0), mx(1), my(0));
    g.fill();
    for (const l of definition.leds ?? []) {
      const k = leds.find((x) => x.id === l.id);
      if (!k) continue;
      const c = colorOf(k.index);
      const r = Math.max(l.w ?? 0.36, l.h ?? 0.36) * s;
      const grd = g.createRadialGradient(mx(l.x), my(l.y), 0, mx(l.x), my(l.y), r);
      grd.addColorStop(0, css(c, 1));
      grd.addColorStop(1, css(c, 0));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(mx(l.x), my(l.y), r, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    for (const k of leds) {
      const c = colorOf(k.index);
      g.fillStyle = css(c);
      roundRect(g, px(k.x - k.w / 2), py(k.y - k.h / 2), k.w * unit, k.h * unit, Math.min(k.w, k.h) * unit * 0.4);
      g.fill();
    }
  }
  return canvas.toDataURL("image/png");
}

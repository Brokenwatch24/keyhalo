import type { EffectMeta, EffectParamDef, RGB } from "@/core/types";
import type { EffectContext, EffectInstance, EffectModule, KeyEventInfo } from "../api";
import { gradientAt, hex, hsv, mix, scale } from "../color";
import { hash01, noise2D } from "../noise";

/** Built-in ambient and reactive effects. Same API as community effects (docs/EFFECTS.md). */

export function defineEffect(
  meta: Omit<EffectMeta, "source" | "params"> & { params?: Record<string, EffectParamDef> },
  create: (p: Record<string, unknown>) => EffectInstance,
): EffectModule {
  return { meta: { ...meta, params: meta.params ?? {}, source: "builtin", author: meta.author ?? "KeyHalo" }, create };
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const colors = (v: unknown, d: string[]): RGB[] => (Array.isArray(v) && v.length ? v : d).map((c) => hex(c as string));
const speedParam = (d = 1): EffectParamDef => ({ type: "number", label: "Speed", min: 0.1, max: 4, step: 0.1, default: d });

// ---------------------------------------------------------------------------
// Basic
// ---------------------------------------------------------------------------

const off = defineEffect({ id: "off", name: "Off", description: "All lights off.", tags: ["basic"] }, () => ({
  frame: (ctx) => ctx.fill([0, 0, 0]),
}));

const solid = defineEffect(
  {
    id: "static",
    name: "Static",
    description: "One solid colour.",
    tags: ["basic"],
    params: { color: { type: "color", label: "Color", default: "#ffffff" } },
  },
  (p) => {
    const c = hex(p.color as string);
    return { frame: (ctx) => ctx.fill(c) };
  },
);

const gradient = defineEffect(
  {
    id: "gradient",
    name: "Gradient",
    description: "A colour gradient across the desk, optionally scrolling.",
    tags: ["basic"],
    params: {
      colors: { type: "colors", label: "Colors", default: ["#7b5cff", "#00d4ff"] },
      angle: { type: "number", label: "Angle", min: 0, max: 360, step: 5, default: 0 },
      speed: { type: "number", label: "Scroll speed", min: 0, max: 2, step: 0.05, default: 0 },
    },
  },
  (p) => {
    const stops = colors(p.colors, ["#7b5cff", "#00d4ff"]);
    const a = (num(p.angle, 0) * Math.PI) / 180;
    const speed = num(p.speed, 0);
    const loop = speed > 0 ? [...stops, stops[0]] : stops;
    return {
      frame(ctx) {
        const span = Math.abs(ctx.width * Math.cos(a)) + Math.abs(ctx.height * Math.sin(a)) || 1;
        for (const k of ctx.region) {
          let t = (k.x * Math.cos(a) + k.y * Math.sin(a)) / span;
          if (speed > 0) t = (((t - ctx.t * speed * 0.2) % 1) + 1) % 1;
          ctx.setAt(k.index, gradientAt(loop, t));
        }
      },
    };
  },
);

const spectrum = defineEffect(
  {
    id: "spectrum",
    name: "Spectrum cycle",
    description: "Every light cycles through the rainbow together.",
    tags: ["ambient"],
    params: {
      speed: speedParam(0.5),
      saturation: { type: "number", label: "Saturation", min: 0, max: 1, step: 0.05, default: 1 },
    },
  },
  (p) => {
    const speed = num(p.speed, 0.5);
    const sat = num(p.saturation, 1);
    return { frame: (ctx) => ctx.fill(hsv(ctx.t * 36 * speed, sat, 1)) };
  },
);

const wave = defineEffect(
  {
    id: "wave",
    name: "Wave",
    description: "A rainbow (or your colours) sweeping across the desk.",
    tags: ["ambient"],
    params: {
      speed: speedParam(1),
      wavelength: { type: "number", label: "Wavelength (keys)", min: 2, max: 40, step: 1, default: 16 },
      direction: {
        type: "select",
        label: "Direction",
        options: [
          { value: "right", label: "Left → right" },
          { value: "left", label: "Right → left" },
          { value: "down", label: "Top → bottom" },
          { value: "up", label: "Bottom → top" },
          { value: "out", label: "Centre outwards" },
        ],
        default: "right",
      },
      rainbow: { type: "boolean", label: "Rainbow", default: true },
      colors: { type: "colors", label: "Colors", default: ["#ff0080", "#00e5ff"] },
    },
  },
  (p) => {
    const speed = num(p.speed, 1);
    const wl = num(p.wavelength, 16);
    const dir = String(p.direction ?? "right");
    const rainbow = p.rainbow !== false;
    const stops = colors(p.colors, ["#ff0080", "#00e5ff"]);
    const loop = [...stops, stops[0]];
    return {
      frame(ctx) {
        const cx = ctx.width / 2;
        const cy = ctx.height / 2;
        for (const k of ctx.region) {
          const d =
            dir === "left" ? ctx.width - k.x : dir === "down" ? k.y : dir === "up" ? ctx.height - k.y : dir === "out" ? Math.hypot(k.x - cx, k.y - cy) : k.x;
          const phase = d / wl - ctx.t * speed * 0.5;
          const f = ((phase % 1) + 1) % 1;
          ctx.setAt(k.index, rainbow ? hsv(-f * 360) : gradientAt(loop, f));
        }
      },
    };
  },
);

const breathing = defineEffect(
  {
    id: "breathing",
    name: "Breathing",
    description: "Slowly fades in and out, alternating colours.",
    tags: ["ambient"],
    params: {
      colors: { type: "colors", label: "Colors", default: ["#00e5ff", "#ff2bd6"] },
      period: { type: "number", label: "Breath (s)", min: 1, max: 12, step: 0.5, default: 4 },
      floor: { type: "number", label: "Minimum", min: 0, max: 0.8, step: 0.05, default: 0.05 },
    },
  },
  (p) => {
    const cs = colors(p.colors, ["#00e5ff"]);
    const period = Math.max(1, num(p.period, 4));
    const floor = num(p.floor, 0.05);
    return {
      frame(ctx) {
        const cycle = ctx.t / period;
        const i = Math.floor(cycle) % cs.length;
        const v = floor + (1 - floor) * Math.sin(Math.PI * (cycle % 1)) ** 2;
        ctx.fill(scale(cs[i], v));
      },
    };
  },
);

const starlight = defineEffect(
  {
    id: "starlight",
    name: "Starlight",
    description: "Random keys twinkle and fade.",
    tags: ["ambient"],
    params: {
      colors: { type: "colors", label: "Colors", default: ["#ffffff", "#8ab4ff"] },
      density: { type: "number", label: "Density", min: 0.05, max: 3, step: 0.05, default: 0.6 },
      fade: { type: "number", label: "Fade (s)", min: 0.3, max: 4, step: 0.1, default: 1.4 },
      background: { type: "color", label: "Background", default: "#000000" },
      rainbow: { type: "boolean", label: "Random hues", default: false },
    },
  },
  (p) => {
    const cs = colors(p.colors, ["#ffffff"]);
    const density = num(p.density, 0.6);
    const fade = Math.max(0.3, num(p.fade, 1.4));
    const bg = hex(p.background as string);
    const rainbow = p.rainbow === true;
    let level = new Float32Array(0);
    let tint: RGB[] = [];
    let seed = 1;
    const rnd = () => hash01(seed++);
    return {
      frame(ctx) {
        if (level.length !== ctx.keys.length) {
          level = new Float32Array(ctx.keys.length);
          tint = ctx.keys.map(() => cs[0]);
        }
        for (const k of ctx.region) {
          const i = k.index;
          // level runs 1 → 0 over `fade` seconds; brightness rises then falls (sin of the phase).
          if (level[i] <= 0 && rnd() < density * ctx.dt * 0.5) {
            level[i] = 1;
            tint[i] = rainbow ? hsv(rnd() * 360) : cs[Math.floor(rnd() * cs.length)];
          }
          const v = level[i] > 0 ? Math.sin(Math.PI * (1 - level[i])) : 0;
          if (level[i] > 0) level[i] = Math.max(0, level[i] - ctx.dt / fade);
          ctx.setAt(i, mix(bg, tint[i], v));
        }
      },
    };
  },
);

const plasma = defineEffect(
  {
    id: "plasma",
    name: "Plasma",
    description: "Classic flowing plasma colours.",
    tags: ["ambient"],
    params: { speed: speedParam(0.6), scale: { type: "number", label: "Scale", min: 0.1, max: 1.5, step: 0.05, default: 0.45 } },
  },
  (p) => {
    const sp = num(p.speed, 0.6);
    const sc = num(p.scale, 0.45);
    return {
      frame(ctx) {
        const t = ctx.t * sp;
        for (const k of ctx.region) {
          const v =
            Math.sin(k.x * sc + t) + Math.sin(k.y * sc * 1.3 + t * 1.3) + Math.sin((k.x + k.y) * sc * 0.5 + t * 0.7) + Math.sin(Math.hypot(k.x, k.y) * sc + t);
          ctx.setAt(k.index, hsv(v * 45 + t * 20, 0.9, 1));
        }
      },
    };
  },
);

const aurora = defineEffect(
  {
    id: "aurora",
    name: "Aurora",
    description: "Soft curtains of light drifting across the desk.",
    tags: ["ambient"],
    params: {
      colors: { type: "colors", label: "Colors", default: ["#00ff9c", "#00b3ff", "#8a2be2", "#ff3cac"] },
      speed: speedParam(0.6),
    },
  },
  (p) => {
    const cs = colors(p.colors, ["#00ff9c", "#00b3ff", "#8a2be2"]);
    const sp = num(p.speed, 0.6);
    return {
      frame(ctx) {
        const t = ctx.t * sp;
        for (const k of ctx.region) {
          const n = noise2D(k.x * 0.12 + t * 0.15, k.y * 0.3 - t * 0.08) * 0.5 + 0.5;
          const glow = noise2D(k.x * 0.25 - t * 0.2, k.y * 0.5 + 10) * 0.5 + 0.5;
          ctx.setAt(k.index, scale(gradientAt(cs, n), 0.25 + 0.75 * glow ** 1.5));
        }
      },
    };
  },
);

const fire = defineEffect(
  {
    id: "fire",
    name: "Fire",
    description: "Flames rising from the bottom row.",
    tags: ["ambient"],
    params: { speed: speedParam(1), intensity: { type: "number", label: "Height", min: 0.3, max: 2, step: 0.05, default: 1 } },
  },
  (p) => {
    const sp = num(p.speed, 1);
    const inten = num(p.intensity, 1);
    const ramp: RGB[] = [[0, 0, 0], [120, 8, 0], [255, 50, 0], [255, 140, 0], [255, 220, 90]];
    return {
      frame(ctx) {
        for (const k of ctx.region) {
          const h = ctx.height > 0 ? k.y / ctx.height : 0.5;
          const n = noise2D(k.x * 0.55, k.y * 0.55 + ctx.t * sp * 2.2) * 0.5 + 0.5;
          const heat = Math.max(0, Math.min(1, (n * 0.9 + 0.1) * Math.pow(h, 1.2) * inten * 1.4));
          ctx.setAt(k.index, gradientAt(ramp, heat));
        }
      },
    };
  },
);

const rain = defineEffect(
  {
    id: "rain",
    name: "Rain",
    description: "Drops falling down the keyboard.",
    tags: ["ambient"],
    params: {
      color: { type: "color", label: "Color", default: "#3aa0ff" },
      speed: speedParam(1),
      density: { type: "number", label: "Density", min: 0.2, max: 4, step: 0.1, default: 1.2 },
      trail: { type: "number", label: "Trail (keys)", min: 0.5, max: 4, step: 0.1, default: 1.6 },
    },
  },
  (p) => {
    const c = hex(p.color as string);
    const sp = num(p.speed, 1);
    const density = num(p.density, 1.2);
    const trail = num(p.trail, 1.6);
    let drops: { x: number; y: number; v: number }[] = [];
    let seed = 7;
    return {
      frame(ctx) {
        const spawn = density * ctx.width * 0.12 * ctx.dt;
        for (let s = spawn; s > 0; s--) if (hash01(seed++) < Math.min(1, s)) drops.push({ x: hash01(seed++) * ctx.width, y: -0.5, v: (4 + hash01(seed++) * 3) * sp });
        drops = drops.filter((d) => (d.y += d.v * ctx.dt) < ctx.height + trail + 1);
        for (const k of ctx.region) {
          let v = 0;
          for (const d of drops) {
            if (Math.abs(d.x - k.x) > k.w / 2 + 0.1) continue;
            const behind = d.y - k.y;
            if (behind < -0.5 || behind > trail) continue;
            v = Math.max(v, behind < 0 ? 1 + behind * 2 : 1 - behind / trail);
          }
          ctx.setAt(k.index, scale(c, v));
        }
      },
    };
  },
);

// ---------------------------------------------------------------------------
// Reactive
// ---------------------------------------------------------------------------

const ripple = defineEffect(
  {
    id: "ripple",
    name: "Ripple",
    description: "Rings spread out from every key you press.",
    tags: ["reactive"],
    reactive: true,
    params: {
      color: { type: "color", label: "Color", default: "#00e5ff" },
      rainbow: { type: "boolean", label: "Rainbow rings", default: false },
      speed: { type: "number", label: "Speed (keys/s)", min: 3, max: 40, step: 1, default: 14 },
      width: { type: "number", label: "Ring width", min: 0.4, max: 4, step: 0.1, default: 1.2 },
      background: { type: "color", label: "Background", default: "#000000" },
    },
  },
  (p) => {
    const c = hex(p.color as string);
    const rainbow = p.rainbow === true;
    const speed = num(p.speed, 14);
    const width = num(p.width, 1.2);
    const bg = hex(p.background as string);
    let rings: { x: number; y: number; t0: number; color: RGB }[] = [];
    let hue = 0;
    return {
      onKey(e: KeyEventInfo) {
        if (!e.down) return;
        rings.push({ x: e.x, y: e.y, t0: e.t, color: rainbow ? hsv((hue += 47)) : c });
        if (rings.length > 24) rings.shift();
      },
      frame(ctx) {
        const life = (Math.hypot(ctx.width, ctx.height) + width * 2) / speed;
        rings = rings.filter((r) => ctx.t - r.t0 < life);
        for (const k of ctx.region) {
          let out: RGB = bg;
          for (const r of rings) {
            const age = ctx.t - r.t0;
            const d = Math.hypot(k.x - r.x, k.y - r.y);
            const i = Math.exp(-(((d - age * speed) / width) ** 2)) * (1 - age / life);
            if (i > 0.01) out = [Math.max(out[0], r.color[0] * i), Math.max(out[1], r.color[1] * i), Math.max(out[2], r.color[2] * i)];
          }
          ctx.setAt(k.index, out);
        }
      },
    };
  },
);

const reactive = defineEffect(
  {
    id: "reactive",
    name: "Reactive",
    description: "Pressed keys light up and fade out.",
    tags: ["reactive"],
    reactive: true,
    params: {
      color: { type: "color", label: "Color", default: "#ff2bd6" },
      fade: { type: "number", label: "Fade (s)", min: 0.1, max: 3, step: 0.05, default: 0.7 },
      background: { type: "color", label: "Background", default: "#000000" },
    },
  },
  (p) => {
    const c = hex(p.color as string);
    const fade = num(p.fade, 0.7);
    const bg = hex(p.background as string);
    const last = new Map<string, number>();
    return {
      onKey(e) {
        if (e.down) last.set(e.id, e.t);
      },
      frame(ctx) {
        for (const k of ctx.region) {
          const t0 = ctx.pressed.has(k.id) ? ctx.t : last.get(k.id);
          const v = t0 === undefined ? 0 : Math.max(0, 1 - (ctx.t - t0) / fade);
          ctx.setAt(k.index, mix(bg, c, v));
        }
      },
    };
  },
);

const heat = defineEffect(
  {
    id: "typing-heat",
    name: "Typing heat",
    description: "Keys warm up as you use them and slowly cool down.",
    tags: ["reactive"],
    reactive: true,
    params: {
      halfLife: { type: "number", label: "Cool-down (s)", min: 1, max: 120, step: 1, default: 12 },
      gain: { type: "number", label: "Heat per press", min: 0.05, max: 1, step: 0.05, default: 0.25 },
      colors: { type: "colors", label: "Cold → hot", default: ["#0a0a40", "#1f6bff", "#00e5a0", "#ffd000", "#ff2a00"] },
    },
  },
  (p) => {
    const halfLife = num(p.halfLife, 12);
    const gain = num(p.gain, 0.25);
    const ramp = colors(p.colors, ["#0a0a40", "#ff2a00"]);
    const heatMap = new Map<string, number>();
    return {
      onKey(e) {
        if (e.down) heatMap.set(e.id, Math.min(1, (heatMap.get(e.id) ?? 0) + gain));
      },
      frame(ctx) {
        const k = Math.pow(0.5, ctx.dt / halfLife);
        for (const [id, v] of heatMap) heatMap.set(id, v * k);
        for (const key of ctx.region) ctx.setAt(key.index, gradientAt(ramp, heatMap.get(key.id) ?? 0));
      },
    };
  },
);

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

const audio = defineEffect(
  {
    id: "audio-visualizer",
    name: "Audio visualizer",
    description: "Spectrum bars driven by what your PC is playing.",
    tags: ["audio"],
    params: {
      mode: {
        type: "select",
        label: "Mode",
        options: [
          { value: "bars", label: "Bars" },
          { value: "pulse", label: "Pulse" },
          { value: "center", label: "Centre bars" },
        ],
        default: "bars",
      },
      colors: { type: "colors", label: "Low → high", default: ["#00e5ff", "#7b5cff", "#ff2bd6"] },
      sensitivity: { type: "number", label: "Sensitivity", min: 0.3, max: 3, step: 0.1, default: 1.2 },
      background: { type: "color", label: "Background", default: "#050510" },
    },
  },
  (p) => {
    const mode = String(p.mode ?? "bars");
    const ramp = colors(p.colors, ["#00e5ff", "#ff2bd6"]);
    const sens = num(p.sensitivity, 1.2);
    const bg = hex(p.background as string);
    let smooth: number[] = [];
    return {
      frame(ctx) {
        const bands = ctx.signals.audio?.bands ?? [];
        const n = bands.length || 1;
        if (smooth.length !== n) smooth = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
          const target = Math.min(1, (bands[i] ?? 0) * sens);
          smooth[i] = target > smooth[i] ? target : smooth[i] + (target - smooth[i]) * Math.min(1, ctx.dt * 6);
        }
        const level = Math.min(1, (ctx.signals.audio?.level ?? 0) * sens * 1.5);
        for (const k of ctx.region) {
          if (mode === "pulse") {
            ctx.setAt(k.index, mix(bg, gradientAt(ramp, k.x / (ctx.width || 1)), level));
            continue;
          }
          const fx = ctx.width ? k.x / ctx.width : 0;
          const band = mode === "center" ? Math.abs(fx - 0.5) * 2 : fx;
          const v = smooth[Math.min(n - 1, Math.floor(band * n))] ?? 0;
          const h = ctx.height ? 1 - k.y / ctx.height : 0; // 0 bottom … 1 top
          const lit = h <= v ? 1 : Math.max(0, 1 - (h - v) * 4);
          ctx.setAt(k.index, mix(bg, gradientAt(ramp, h), lit));
        }
      },
    };
  },
);

export const BUILTIN_EFFECTS: EffectModule[] = [
  off,
  solid,
  gradient,
  spectrum,
  wave,
  breathing,
  starlight,
  plasma,
  aurora,
  fire,
  rain,
  ripple,
  reactive,
  heat,
  audio,
];

export type { EffectContext };

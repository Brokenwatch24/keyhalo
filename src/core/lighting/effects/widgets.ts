import type { EffectParamDef, RGB } from "@/core/types";
import { bus } from "@/core/util/bus";
import type { EffectContext, EffectModule, SceneKey } from "../api";
import { hex, mix, scale, statusColor, statusScale } from "../color";
import { defineEffect } from "./builtin";

/**
 * Widget effects (ids "widget:*"): live data drawn on a few keys. By default each widget uses
 * its own key list; give the layer a mask to place it anywhere. Lights outside the widget stay
 * transparent so widgets sit on top of any base effect.
 *
 * Every pulse/blink is ≤ 1 Hz (well under the 3 Hz photosensitivity limit).
 */

const NUMBER_ROW = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"];
const TOP_ROW = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"];
const HOME_ROW = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL"];

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Keys a widget draws on: the layer mask if any, else its default key list (in that order). */
export function widgetKeys(ctx: EffectContext, defaults: string[]): SceneKey[] {
  const ids = Array.isArray(ctx.params.keys) && ctx.params.keys.length ? (ctx.params.keys as string[]) : defaults;
  if (ctx.masked) return [...ctx.region].sort((a, b) => a.x - b.x || a.y - b.y);
  const out: SceneKey[] = [];
  for (const id of ids) for (const k of ctx.region) if (k.id === id) out.push(k);
  return out;
}

/** Fill `fraction` (0..1) of the keys, left to right; the last key is partially lit. */
export function drawBar(ctx: EffectContext, keys: SceneKey[], fraction: number, color: (pos: number) => RGB, dim: RGB = [0, 0, 0], dimAlpha = 1) {
  const f = Math.max(0, Math.min(1, fraction)) * keys.length;
  keys.forEach((k, i) => {
    const lit = Math.max(0, Math.min(1, f - i));
    if (lit > 0) ctx.setAt(k.index, mix(dim, color(keys.length > 1 ? i / (keys.length - 1) : 1), lit));
    else ctx.setAt(k.index, dim, dimAlpha);
  });
}

const pulse = (t: number, hz = 0.5) => 0.55 + 0.45 * Math.sin(t * Math.PI * 2 * hz);

const dimParam: Record<string, EffectParamDef> = {
  showEmpty: { type: "boolean", label: "Dim unused keys", default: true },
};
const empty = (p: Record<string, unknown>): [RGB, number] => (p.showEmpty === false ? [[0, 0, 0], 0] : [[12, 12, 14], 1]);

/** Bar widget factory: value() → 0..1 or undefined (hidden). */
function barWidget(
  id: string,
  name: string,
  description: string,
  defaults: string[],
  value: (ctx: EffectContext) => number | undefined,
  colorFor: (p: Record<string, unknown>, v: number) => (pos: number) => RGB,
  extra: Record<string, EffectParamDef> = {},
): EffectModule {
  return defineEffect({ id, name, description, tags: ["widget"], params: { ...extra, ...dimParam } }, (p) => ({
    frame(ctx) {
      const v = value(ctx);
      if (v === undefined) return;
      const [dim, a] = empty(p);
      drawBar(ctx, widgetKeys(ctx, defaults), v, colorFor(p, v), dim, a);
    },
  }));
}

/** Colour by severity of the whole value (green when low, red when high). */
const bySeverity = (_p: Record<string, unknown>, v: number) => () => statusScale(v);
/** Colour from a "color" param. */
const byParam = (p: Record<string, unknown>) => () => hex(p.color as string);

const cpu = barWidget("widget:cpu", "CPU load bar", "CPU load as a bar (green → red).", NUMBER_ROW, (ctx) => (ctx.signals.cpu ? ctx.signals.cpu.load / 100 : undefined), bySeverity);

const gpuTemp = barWidget(
  "widget:gpu-temp",
  "GPU temperature bar",
  "GPU temperature between a cool and a hot limit.",
  TOP_ROW,
  (ctx) => {
    const g = ctx.signals.gpu;
    if (!g) return undefined;
    const lo = num(ctx.params.min, 35);
    const hi = num(ctx.params.max, 85);
    return (g.temp - lo) / Math.max(1, hi - lo);
  },
  bySeverity,
  {
    min: { type: "number", label: "Cool (°C)", min: 20, max: 60, step: 1, default: 35 },
    max: { type: "number", label: "Hot (°C)", min: 60, max: 100, step: 1, default: 85 },
  },
);

const ram = barWidget("widget:ram", "RAM usage bar", "Memory in use.", HOME_ROW, (ctx) => (ctx.signals.ram ? ctx.signals.ram.pct / 100 : undefined), bySeverity);

const bambu = barWidget(
  "widget:bambu",
  "3D print progress",
  "Progress of the current print job.",
  NUMBER_ROW,
  (ctx) => {
    const b = ctx.signals.bambu;
    if (!b || !/run|print|prepare|pause/i.test(b.state)) return undefined;
    return b.progress > 1 ? b.progress / 100 : b.progress;
  },
  byParam,
  { color: { type: "color", label: "Color", default: "#00e5a0" } },
);

const wpm = barWidget(
  "widget:wpm",
  "WPM meter",
  "Live typing speed.",
  NUMBER_ROW,
  (ctx) => (ctx.signals.wpm !== undefined ? ctx.signals.wpm / num(ctx.params.max, 120) : undefined),
  (p) => (pos) => mix(hex("#1f6bff"), hex(p.color as string), pos),
  {
    max: { type: "number", label: "Full bar at (WPM)", min: 40, max: 250, step: 5, default: 120 },
    color: { type: "color", label: "Color", default: "#ff2bd6" },
  },
);

const pomodoro = barWidget(
  "widget:pomodoro",
  "Pomodoro bar",
  "Time left in the current focus or break.",
  NUMBER_ROW,
  (ctx) => {
    const pd = ctx.signals.pomodoro;
    if (!pd || pd.phase === "idle" || pd.totalMs <= 0) return undefined;
    return pd.remainingMs / pd.totalMs;
  },
  () => () => [0, 0, 0],
  {
    focusColor: { type: "color", label: "Focus", default: "#ff5a36" },
    breakColor: { type: "color", label: "Break", default: "#2bd67b" },
  },
);
// Pomodoro colour depends on the phase: wrap frame.
const pomodoroModule: EffectModule = {
  meta: pomodoro.meta,
  create(p) {
    return {
      frame(ctx) {
        const pd = ctx.signals.pomodoro;
        if (!pd || pd.phase === "idle" || pd.totalMs <= 0) return;
        const c = hex((pd.phase === "focus" ? p.focusColor : p.breakColor) as string);
        const [dim, a] = empty(p);
        drawBar(ctx, widgetKeys(ctx, NUMBER_ROW), pd.remainingMs / pd.totalMs, () => c, dim, a);
      },
    };
  },
};

const health = barWidget(
  "widget:game-health",
  "Game health bar",
  "Health from supported games (green → red as it drops).",
  ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"],
  (ctx) => {
    const g = ctx.signals.game;
    if (!g || g.health === undefined) return undefined;
    return g.dead ? 0 : g.health / 100;
  },
  (_p, v) => () => statusScale(1 - v),
);

const ammo = barWidget(
  "widget:game-ammo",
  "Game ammo bar",
  "Ammo left in the clip.",
  ["Digit6", "Digit7", "Digit8", "Digit9", "Digit0"],
  (ctx) => {
    const g = ctx.signals.game;
    if (!g || g.ammo === undefined) return undefined;
    return g.ammo > 1 ? g.ammo / 100 : g.ammo;
  },
  (p, v) => () => (v < 0.25 ? statusColor("bad") : hex(p.color as string)),
  { color: { type: "color", label: "Color", default: "#ffb000" } },
);

// ---------------------------------------------------------------------------
// Single-key indicators
// ---------------------------------------------------------------------------

const battery = defineEffect(
  {
    id: "widget:battery",
    name: "Battery key",
    description: "A key showing a wireless device's battery (pulses while charging).",
    tags: ["widget"],
    params: {
      device: { type: "select", label: "Device", options: [{ value: "", label: "First wireless device" }], default: "" },
      warnBelow: { type: "number", label: "Warn below (%)", min: 5, max: 60, step: 5, default: 30 },
      badBelow: { type: "number", label: "Critical below (%)", min: 5, max: 40, step: 1, default: 15 },
    },
  },
  (p) => ({
    frame(ctx) {
      const entries = Object.entries(ctx.signals.battery ?? {});
      const b = (p.device ? entries.find(([uid]) => uid === p.device || uid.startsWith(`${p.device}:`)) : entries[0])?.[1];
      if (!b) return;
      const c = statusColor(b.percent < num(p.badBelow, 15) ? "bad" : b.percent < num(p.warnBelow, 30) ? "warn" : "good");
      const v = b.charging ? pulse(ctx.t, 0.5) : 1;
      for (const k of widgetKeys(ctx, ["KeyB"])) ctx.setAt(k.index, scale(c, v));
    },
  }),
);

const CLAUDE_COLORS: Record<string, string> = {
  working: "#7b5cff",
  waiting: "#ffb000",
  done: "#2bd67b",
  error: "#ff3b30",
};

const claude = defineEffect(
  {
    id: "widget:claude",
    name: "Claude Code status",
    description: "Idle, working (breathing), waiting for you (slow blink), done or error.",
    tags: ["widget"],
    params: { showIdle: { type: "boolean", label: "Show idle", default: false } },
  },
  (p) => ({
    frame(ctx) {
      const s = ctx.signals.claude;
      if (!s || (s.state === "idle" && !p.showIdle)) return;
      let c: RGB = s.state === "idle" ? [40, 40, 48] : hex(CLAUDE_COLORS[s.state]);
      if (s.state === "error") c = statusColor("bad");
      if (s.state === "done") c = statusColor("good");
      const v = s.state === "working" ? pulse(ctx.t, 0.4) : s.state === "waiting" ? (Math.sin(ctx.t * Math.PI * 2 * 0.8) > 0 ? 1 : 0.25) : 1;
      for (const k of widgetKeys(ctx, ["KeyC"])) ctx.setAt(k.index, scale(c, v));
    },
  }),
);

const mic = defineEffect(
  {
    id: "widget:mic",
    name: "Mic mute key",
    description: "Red while your microphone is muted.",
    tags: ["widget"],
    params: { showLive: { type: "boolean", label: "Green while live", default: false } },
  },
  (p) => ({
    frame(ctx) {
      const muted = ctx.signals.micMuted;
      if (muted === undefined || (!muted && !p.showLive)) return;
      const c = muted ? statusColor("bad") : statusColor("good");
      for (const k of widgetKeys(ctx, ["KeyM"])) ctx.setAt(k.index, c);
    },
  }),
);

const caps = defineEffect(
  {
    id: "widget:caps",
    name: "Caps Lock indicator",
    description: "Lights Caps Lock while it is on.",
    tags: ["widget"],
    params: { color: { type: "color", label: "Color", default: "#ffffff" } },
  },
  (p) => {
    const c = hex(p.color as string);
    return {
      frame(ctx) {
        if (!ctx.signals.capsLock) return;
        for (const k of widgetKeys(ctx, ["CapsLock"])) ctx.setAt(k.index, c);
      },
    };
  },
);

const layer = defineEffect(
  {
    id: "widget:layer",
    name: "Active layer indicator",
    description: "Colours a key while a keymap layer is active (colour derived from the layer name).",
    tags: ["widget"],
    params: {},
  },
  () => ({
    frame(ctx) {
      const name = ctx.signals.layer;
      if (!name) return;
      let h = 0;
      for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
      for (const k of widgetKeys(ctx, ["Fn"])) ctx.setAt(k.index, ctx.hsv(h, 0.85, 1));
    },
  }),
);

const notification = defineEffect(
  {
    id: "widget:notification",
    name: "Notification flash",
    description: "Pulses keys when an app or rule sends a notification.",
    tags: ["widget"],
    params: {
      color: { type: "color", label: "Default color", default: "#00b3ff" },
      pulses: { type: "number", label: "Pulses", min: 1, max: 6, step: 1, default: 3 },
    },
  },
  (p) => {
    let active: { t0: number | null; color: RGB; keys?: string[] } | null = null;
    const off = bus.on("notify", (n) => {
      active = { t0: null, color: n.color ? hex(n.color) : hex(p.color as string), keys: n.keys };
    });
    const pulses = num(p.pulses, 3);
    return {
      dispose: off,
      frame(ctx) {
        if (!active) return;
        if (active.t0 === null) active.t0 = ctx.t;
        const age = ctx.t - active.t0;
        const period = 0.9; // ~1.1 Hz
        if (age > pulses * period) {
          active = null;
          return;
        }
        const v = Math.sin((Math.PI * (age % period)) / period) ** 2;
        const keys = active.keys?.length ? ctx.region.filter((k) => active!.keys!.includes(k.id)) : ctx.region;
        for (const k of keys) ctx.setAt(k.index, active.color, v);
      },
    };
  },
);

export const WIDGET_EFFECTS: EffectModule[] = [
  cpu,
  gpuTemp,
  ram,
  battery,
  bambu,
  claude,
  mic,
  caps,
  layer,
  pomodoroModule,
  wpm,
  health,
  ammo,
  notification,
];

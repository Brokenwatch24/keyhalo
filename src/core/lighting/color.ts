import type { BlendMode, ColorVision, RGB } from "@/core/types";

/** Colour helpers shared by the compositor, built-in effects and widgets (0..255 channels). */

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** HSV → RGB. h in degrees (any range), s and v 0..1. */
export function hsv(h: number, s = 1, v = 1): RGB {
  h = ((h % 360) + 360) % 360;
  s = clamp(s);
  v = clamp(v);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Linear mix of two colours (t = 0 → a, 1 → b). */
export function mix(a: RGB, b: RGB, t: number): RGB {
  t = clamp(t);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Scale a colour's intensity. */
export const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** "#rgb" / "#rrggbb" / "rgb(r,g,b)" / RGB array → RGB. Unknown input → black. */
export function hex(input: string | RGB | undefined | null): RGB {
  if (Array.isArray(input)) return [input[0] ?? 0, input[1] ?? 0, input[2] ?? 0];
  if (typeof input !== "string") return [0, 0, 0];
  const s = input.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return [0, 0, 0];
}

export function toHex(c: RGB): string {
  return `#${c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
}

/** Sample a multi-stop gradient at t (0..1). */
export function gradientAt(stops: RGB[], t: number): RGB {
  if (stops.length === 0) return [0, 0, 0];
  if (stops.length === 1) return stops[0];
  const x = clamp(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

/** Relative luminance 0..1 (sRGB, approximate). */
export const luminance = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

// ---------------------------------------------------------------------------
// Blend modes (per channel, 0..255)
// ---------------------------------------------------------------------------

export function blendChannel(mode: BlendMode, base: number, top: number): number {
  switch (mode) {
    case "add":
      return Math.min(255, base + top);
    case "multiply":
      return (base * top) / 255;
    case "screen":
      return 255 - ((255 - base) * (255 - top)) / 255;
    case "max":
      return Math.max(base, top);
    case "normal":
    default:
      return top;
  }
}

/** Blend `top` over `base` with `alpha` (0..1). */
export function blend(mode: BlendMode, base: RGB, top: RGB, alpha = 1): RGB {
  return [
    lerp(base[0], blendChannel(mode, base[0], top[0]), alpha),
    lerp(base[1], blendChannel(mode, base[1], top[1]), alpha),
    lerp(base[2], blendChannel(mode, base[2], top[2]), alpha),
  ];
}

// ---------------------------------------------------------------------------
// Status colours (colour-vision aware)
// ---------------------------------------------------------------------------

export type StatusKind = "good" | "warn" | "bad" | "info";

/**
 * Status palettes. "normal" uses green/amber/red; red-green deficiencies use the Okabe–Ito
 * blue/yellow/vermillion set; tritanopia avoids blue–yellow pairs.
 */
export const STATUS_PALETTES: Record<ColorVision, Record<StatusKind, RGB>> = {
  normal: { good: [40, 220, 90], warn: [255, 170, 0], bad: [255, 40, 30], info: [40, 140, 255] },
  protanopia: { good: [0, 114, 178], warn: [240, 228, 66], bad: [213, 94, 0], info: [86, 180, 233] },
  deuteranopia: { good: [0, 114, 178], warn: [240, 228, 66], bad: [213, 94, 0], info: [86, 180, 233] },
  tritanopia: { good: [0, 158, 115], warn: [204, 121, 167], bad: [213, 30, 0], info: [120, 120, 120] },
};

let currentVision: ColorVision = "normal";

/** Set by the lighting engine from settings.colorVision. */
export function setColorVision(v: ColorVision) {
  currentVision = STATUS_PALETTES[v] ? v : "normal";
}

/** Colour for a status, using the user's colour-vision setting unless `vision` is given. */
export function statusColor(kind: StatusKind, vision: ColorVision = currentVision): RGB {
  return [...(STATUS_PALETTES[vision] ?? STATUS_PALETTES.normal)[kind]] as RGB;
}

/** good → warn → bad scale for a value 0..1 (0 = good). */
export function statusScale(t: number, vision: ColorVision = currentVision): RGB {
  const p = STATUS_PALETTES[vision] ?? STATUS_PALETTES.normal;
  return gradientAt([p.good, p.warn, p.bad], t);
}

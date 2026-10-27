import type { KeyCode, RGB, TypingResult } from "../types";

/** Pure helpers for history, streaks, personal bests and heatmaps. */

export type TypingMode = "adaptive" | "test" | "quotes" | "code" | "shortcuts" | "fn" | "custom";
export const TEXT_MODES: TypingMode[] = ["adaptive", "test", "quotes", "code", "custom", "fn"];
export const DRILL_MODES: TypingMode[] = ["shortcuts", "fn"];

export interface TestSettings {
  kind: "time" | "words";
  time: number;
  words: number;
  punctuation: boolean;
  numbers: boolean;
}

export const TEST_TIMES = [15, 30, 60, 120];
export const TEST_WORDS = [10, 25, 50, 100];

/** Identifies comparable runs for personal bests and ghost races. */
export function configKey(mode: TypingMode, language: string, test?: TestSettings, extra?: string): string {
  if (mode === "test" && test) {
    const amount = test.kind === "time" ? `${test.time}s` : `${test.words}w`;
    return `test:${amount}:${language}${test.punctuation ? ":p" : ""}${test.numbers ? ":n" : ""}`;
  }
  if (mode === "code" || mode === "shortcuts" || mode === "fn") return `${mode}${extra ? `:${extra}` : ""}`;
  return `${mode}:${language}`;
}

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Consecutive practice days ending today (or yesterday, so the streak survives until midnight). */
export function streak(daily: Record<string, number>, today = new Date()): number {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!(daily[dayKey(d)] > 0)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (daily[dayKey(d)] > 0) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export interface KeyAgg {
  hits: number;
  misses: number;
  /** Sum of avgMs × hits, to keep a running mean. */
  sumMs: number;
  timed: number;
}

export function mergeKeys(agg: Record<KeyCode, KeyAgg>, keys: TypingResult["keys"]): Record<KeyCode, KeyAgg> {
  const out = { ...agg };
  for (const [code, k] of Object.entries(keys)) {
    const a = out[code] ? { ...out[code] } : { hits: 0, misses: 0, sumMs: 0, timed: 0 };
    a.hits += k.hits;
    a.misses += k.misses;
    if (k.avgMs > 0) {
      a.sumMs += k.avgMs * k.hits;
      a.timed += k.hits;
    }
    out[code] = a;
  }
  return out;
}

export function aggToKeys(agg: Record<KeyCode, KeyAgg>): TypingResult["keys"] {
  const out: TypingResult["keys"] = {};
  for (const [code, a] of Object.entries(agg)) out[code] = { hits: a.hits, misses: a.misses, avgMs: a.timed ? Math.round(a.sumMs / a.timed) : 0 };
  return out;
}

/**
 * Heat per key, 0 (fast & clean) … 1 (slow or error-prone). Slowness is measured against the
 * typist's own median so the map highlights relative weak spots at any skill level.
 */
export function keyHeat(keys: TypingResult["keys"], minSamples = 2): Record<KeyCode, number> {
  const entries = Object.entries(keys).filter(([code, k]) => k.hits + k.misses >= minSamples && code !== "Space" && code !== "Enter");
  const times = entries.map(([, k]) => k.avgMs).filter((x) => x > 0).sort((a, b) => a - b);
  const med = times.length ? times[Math.floor(times.length / 2)] : 0;
  const hi = times.length ? times[times.length - 1] : 0;
  const out: Record<KeyCode, number> = {};
  for (const [code, k] of entries) {
    const slow = k.avgMs > 0 && hi > med ? Math.max(0, (k.avgMs - med) / (hi - med)) : 0;
    const missRate = k.misses / Math.max(1, k.hits + k.misses);
    const miss = Math.min(1, missRate / 0.12);
    out[code] = Math.min(1, Math.max(slow * 0.85, miss, 0.55 * slow + 0.45 * miss));
  }
  return out;
}

/**
 * Sequential neutral → warm scale with monotonically increasing lightness, so it reads for
 * every type of colour vision (an "inferno"-like ramp that starts at the keycap grey).
 */
const HEAT_STOPS: [number, RGB][] = [
  [0, [52, 52, 58]],
  [0.25, [96, 40, 60]],
  [0.5, [178, 58, 40]],
  [0.75, [240, 128, 30]],
  [1, [252, 226, 120]],
];

export function heatColor(v: number): RGB {
  const x = Math.max(0, Math.min(1, v));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [p1, c1] = HEAT_STOPS[i];
    const [p0, c0] = HEAT_STOPS[i - 1];
    if (x <= p1) {
      const f = (x - p0) / (p1 - p0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * f)) as RGB;
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}

export const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_STOPS.map(([p, c]) => `rgb(${c.join(",")}) ${p * 100}%`).join(", ")})`;

/** Finger palette for the touch-typing guide (0 = left pinky … 9 = right pinky), CVD-aware. */
export const FINGER_COLORS: RGB[] = [
  [204, 121, 167], // L pinky – reddish purple
  [0, 114, 178], // L ring – blue
  [86, 180, 233], // L middle – sky
  [0, 158, 115], // L index – bluish green
  [160, 160, 168], // L thumb
  [160, 160, 168], // R thumb
  [230, 159, 0], // R index – orange
  [240, 228, 66], // R middle – yellow
  [213, 94, 0], // R ring – vermillion
  [204, 121, 167], // R pinky
];

export function scaleRgb(c: RGB, f: number): RGB {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
}

/** Strip heavy fields before storing a result in the history list. */
export function slimResult(r: TypingResult): TypingResult {
  const { replay: _r, text: _t, ...rest } = r;
  return rest;
}

/** Check a JSON blob is a usable ghost (a TypingResult with a replay). */
export function asGhost(x: unknown): TypingResult | null {
  if (!x || typeof x !== "object") return null;
  const r = x as TypingResult;
  if (!Array.isArray(r.replay) || typeof r.wpm !== "number") return null;
  if (!r.replay.every((e) => Array.isArray(e) && typeof e[0] === "number")) return null;
  return r;
}

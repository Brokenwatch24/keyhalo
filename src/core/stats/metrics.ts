import type { InputStats } from "@/core/types";

/** Local date as "yyyy-mm-dd". */
export function dayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyStats(day: string): InputStats {
  return { day, keys: 0, clicks: 0, mouseMeters: 0, perKey: {}, peakWpm: 0 };
}

/** Keys that produce a character (counted for WPM). Backspace/modifiers/navigation are not. */
export function isPrintableCode(code: string): boolean {
  return (
    /^Key[A-Z]$/.test(code) ||
    /^Digit\d$/.test(code) ||
    /^Numpad\d$/.test(code) ||
    ["Space", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Backquote", "Comma", "Period", "Slash", "IntlBackslash", "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal"].includes(code)
  );
}

/**
 * Events-per-minute over a rolling window. Counts are bucketed per 100 ms so memory stays tiny
 * even at very high APM.
 */
export class RollingRate {
  private buckets = new Map<number, number>();
  constructor(private windowMs = 10_000, private bucketMs = 100) {}

  add(t: number, n = 1) {
    const b = Math.floor(t / this.bucketMs);
    this.buckets.set(b, (this.buckets.get(b) ?? 0) + n);
  }

  /** Total events within the window ending at `now`. */
  count(now: number): number {
    const min = Math.floor((now - this.windowMs) / this.bucketMs);
    let total = 0;
    for (const [b, n] of this.buckets) {
      if (b <= min) this.buckets.delete(b);
      else total += n;
    }
    return total;
  }

  /** Events per minute. */
  perMinute(now: number): number {
    return (this.count(now) * 60_000) / this.windowMs;
  }

  clear() {
    this.buckets.clear();
  }
}

/** WPM from printable characters in the window: (chars / 5) per minute. */
export function wpmFromChars(charsPerMinute: number): number {
  return charsPerMinute / 5;
}

/**
 * Windows pointer speed (1..20, 10 = 1:1) → cursor pixels per mouse count, with
 * "Enhance pointer precision" off. Values follow the documented multiplier table.
 */
export function pointerMultiplier(speed: number): number {
  const table: Record<number, number> = { 1: 1 / 32, 2: 1 / 16, 4: 1 / 8, 6: 1 / 4, 8: 1 / 2, 10: 1, 12: 1.5, 14: 2, 16: 2.5, 18: 3, 20: 3.5 };
  const s = Math.min(20, Math.max(1, Math.round(speed)));
  if (table[s] !== undefined) return table[s];
  return (table[s - 1] + table[s + 1]) / 2;
}

/** Cursor pixels → metres travelled by the mouse. */
export function pixelsToMeters(pixels: number, dpi: number, pointerSpeed = 10): number {
  const counts = pixels / pointerMultiplier(pointerSpeed);
  return (counts / Math.max(1, dpi || 800)) * 0.0254;
}

/** Merge two stats objects (used for lifetime totals and tests). */
export function addStats(a: InputStats, b: InputStats): InputStats {
  const perKey = { ...a.perKey };
  for (const [k, n] of Object.entries(b.perKey)) perKey[k] = (perKey[k] ?? 0) + n;
  return { day: a.day, keys: a.keys + b.keys, clicks: a.clicks + b.clicks, mouseMeters: a.mouseMeters + b.mouseMeters, perKey, peakWpm: Math.max(a.peakWpm, b.peakWpm) };
}

/**
 * Pure typing math. A "word" is five characters (including spaces), the usual convention,
 * so speeds are comparable across languages and texts.
 */

export const CHARS_PER_WORD = 5;

/** Words per minute for `chars` characters typed in `ms` milliseconds. */
export function wpm(chars: number, ms: number): number {
  if (ms <= 0 || chars <= 0) return 0;
  return chars / CHARS_PER_WORD / (ms / 60000);
}

/** Correct keystrokes / all keystrokes, 0..1 (1 when nothing was typed yet). */
export function accuracy(correct: number, total: number): number {
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, correct / total));
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

/**
 * Consistency = 1 − coefficient of variation of the per-second speeds, clamped to 0..1.
 * A perfectly even typist scores 1; bursts and pauses pull it towards 0.
 */
export function consistency(perSecondWpm: number[]): number {
  if (perSecondWpm.length < 2) return 1;
  const m = mean(perSecondWpm);
  if (m <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - stdev(perSecondWpm) / m));
}

/** Speed equivalent of a single inter-key interval: one char in `ms` → WPM. */
export function msToWpm(ms: number): number {
  return ms > 0 ? 60000 / (ms * CHARS_PER_WORD) : 0;
}

/** Inverse of msToWpm. */
export function wpmToMs(w: number): number {
  return w > 0 ? 60000 / (w * CHARS_PER_WORD) : Infinity;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Format milliseconds as m:ss. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

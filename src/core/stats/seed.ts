import type { InputStats } from "@/core/types";

/**
 * Plausible fake history for the browser demo (MockBackend only), so the dashboard and
 * charts are not empty in screenshots. Deterministic per day.
 */
function rand(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const LETTER_FREQ: Record<string, number> = {
  KeyE: 12.7, KeyT: 9.1, KeyA: 8.2, KeyO: 7.5, KeyI: 7, KeyN: 6.7, KeyS: 6.3, KeyH: 6.1, KeyR: 6, KeyD: 4.3, KeyL: 4,
  KeyC: 2.8, KeyU: 2.8, KeyM: 2.4, KeyW: 2.4, KeyF: 2.2, KeyG: 2, KeyY: 2, KeyP: 1.9, KeyB: 1.5, KeyV: 1, KeyK: 0.8,
  KeyJ: 0.2, KeyX: 0.2, KeyQ: 0.1, KeyZ: 0.1, Space: 18, Backspace: 4, Enter: 2, Period: 1.2, Comma: 1.2,
  ShiftLeft: 3, ControlLeft: 2.5, Tab: 0.8, ArrowDown: 1, ArrowUp: 1, Digit1: 0.4, Digit2: 0.3, Escape: 0.5,
};

export function seedDay(day: string): InputStats {
  const r = rand(day);
  const weekday = new Date(`${day}T12:00:00`).getDay();
  const weekend = weekday === 0 || weekday === 6;
  const keys = Math.round((weekend ? 4_000 : 14_000) + r() * 9_000);
  const total = Object.values(LETTER_FREQ).reduce((a, b) => a + b, 0);
  const perKey: Record<string, number> = {};
  for (const [k, f] of Object.entries(LETTER_FREQ)) perKey[k] = Math.round((keys * f * (0.85 + r() * 0.3)) / total);
  return {
    day,
    keys,
    clicks: Math.round(keys * (0.18 + r() * 0.12)),
    mouseMeters: Math.round((weekend ? 60 : 110) + r() * 90),
    perKey,
    peakWpm: Math.round(74 + r() * 38),
  };
}

/** Lifetime totals that look like a few months of use. */
export function seedLifetime(since: string) {
  return { keys: 1_843_220, clicks: 402_118, mouseMeters: 13_870, peakWpm: 118, since };
}

/** A week of battery samples for a demo wireless mouse (discharge + one recharge). */
export function seedBattery(uid: string, name: string, now = Date.now()) {
  const out: { t: number; uid: string; name: string; percent: number; charging: boolean }[] = [];
  const step = 30 * 60_000; // demo: one sample per 30 min keeps localStorage small
  let pct = 92;
  let charging = false;
  for (let t = now - 7 * 86_400_000; t <= now; t += step) {
    if (charging) {
      pct = Math.min(100, pct + 9);
      if (pct >= 100) charging = false;
    } else {
      pct = Math.max(4, pct - 0.42);
      if (pct <= 12) charging = true;
    }
    out.push({ t, uid, name, percent: Math.round(pct), charging });
  }
  return out;
}

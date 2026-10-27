import { decorate, drawWords, plainWords } from "./generate";
import { seeded, type Rng } from "./rng";
import { TypingSession, type SessionReport } from "./session";
import type { TypingResult } from "../types";
import type { AdaptiveState } from "./adaptive";
import { dayKey, mergeKeys, slimResult, type KeyAgg } from "./progress";

/**
 * Simulated typist for screenshots and the dev-only `demoResult` view: replays a realistic
 * run (rhythm, slower reaches, a few corrected typos) through the real session engine.
 */

const SLOW: Record<string, number> = { b: 1.7, y: 1.5, q: 1.9, z: 1.8, x: 1.6, p: 1.35, v: 1.4, k: 1.3, w: 1.25, ",": 1.5, ".": 1.3 };
const NEIGHBOUR: Record<string, string> = { e: "r", r: "t", t: "r", i: "o", o: "i", a: "s", s: "d", n: "m", h: "j", l: "k", u: "y", y: "t", b: "v", p: "o", c: "x", m: "n", d: "f", g: "h" };

export function simulateRun(words: readonly string[], opts: { seed?: number; wpm?: number; seconds?: number; mode?: string; language?: string } = {}): SessionReport {
  const rng: Rng = seeded(opts.seed ?? 7);
  const target = opts.wpm ?? 86;
  const seconds = opts.seconds ?? 30;
  const text = decorate(drawWords(plainWords(words), 160, rng, 200), { punctuation: false, numbers: false, language: "en" }, rng);
  const s = new TypingSession({ text, limit: { kind: "time", ms: seconds * 1000 } });
  const base = 12000 / target;
  let now = 1000;
  let i = 0;
  while (!s.finished && i < 2000) {
    i++;
    const ch = s.expected;
    if (ch === undefined) break;
    // Warm-up, mid-run dip and a final push make the WPM curve look human.
    const phase = (now - 1000) / (seconds * 1000);
    const pace = phase < 0.08 ? 1.25 : phase > 0.45 && phase < 0.6 ? 1.12 : phase > 0.85 ? 0.92 : 1;
    const dt = base * pace * (SLOW[ch] ?? 1) * (0.6 + rng() * 0.8);
    now += dt;
    if (s.tick(now)) break;
    if (NEIGHBOUR[ch] && rng() < 0.028) {
      s.input(NEIGHBOUR[ch], now);
      now += base * 1.6;
      s.backspace();
      now += base * 0.8;
      if (s.tick(now)) break;
    }
    s.input(ch, now);
  }
  s.tick(1000 + seconds * 1000 + 1);
  s.finish(1000 + seconds * 1000);
  return s.report({ mode: opts.mode ?? "test", language: opts.language ?? "en", id: "demo", date: new Date().toISOString() });
}

/**
 * Sample progress for screenshots (`?demoProgress=1`): a month of improving runs, daily
 * practice, personal bests and a partly unlocked adaptive ladder. Never persisted.
 */
export function demoProgress(words: readonly string[]) {
  const history: TypingResult[] = [];
  const daily: Record<string, number> = {};
  let keys: Record<string, KeyAgg> = {};
  const bests: Record<string, TypingResult> = {};
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    const day = new Date(now - (29 - i) * 0.8 * 86400000);
    const rep = simulateRun(words, { seed: 100 + i, wpm: 58 + i * 1.1 + ((i * 7) % 9) - 4, seconds: i % 3 === 0 ? 60 : 30 });
    const r = { ...rep.result, id: `demo-${i}`, date: day.toISOString(), config: i % 3 === 0 ? "test:60s:en" : "test:30s:en" };
    history.push(slimResult(r));
    const k = dayKey(day);
    daily[k] = (daily[k] ?? 0) + r.durationMs + 240000;
    keys = mergeKeys(keys, r.keys);
    if (!bests[r.config!] || bests[r.config!].wpm < r.wpm) bests[r.config!] = r;
  }
  const letters: AdaptiveState["letters"] = {};
  const order = "etaoinshrdlc";
  [...order].forEach((l, i) => {
    letters[l] = { ms: 12000 / (52 - i * 2.2), acc: i === 9 ? 0.93 : 0.985, samples: i < 11 ? 80 - i * 5 : 6 };
  });
  return { history, daily, keys: { en: keys }, bests, adaptive: { en: { unlocked: 12, letters, unlockedAt: {} } as AdaptiveState } };
}

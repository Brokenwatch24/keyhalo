import { buildBigramModel, plainWords, pseudoWord, type BigramModel, type Lang } from "./generate";
import { msToWpm } from "./metrics";
import { weightedIndex, type Rng } from "./rng";
import type { Keystroke } from "./session";

/**
 * Adaptive lessons — "Halo ladder".
 *
 * Letters are introduced in order of how often the language uses them. Practice starts with
 * the six most frequent; each letter carries a smoothed speed and accuracy (exponential moving
 * averages updated on every keystroke). When *every* unlocked letter is both fast enough
 * (≥ target WPM) and clean enough (≥ 95 %), the next letter joins the set. The weakest
 * unlocked letter becomes the focus key and gets extra weight in the generated text.
 */

export const LETTER_ORDER: Record<Lang, string[]> = {
  en: [..."etaoinshrdlcumwfgypbvkjxqz"],
  es: [..."eaosrnidlctumpbgvyqhfzjñóíáéxúkwü"],
};

export const START_LETTERS = 6;
export const MIN_SAMPLES = 12;
export const ACCURACY_TARGET = 0.95;
/** Smoothing for the per-letter interval (higher = reacts faster). */
export const SPEED_ALPHA = 0.1;
export const ACC_ALPHA = 0.05;
const MAX_INTERVAL_MS = 2000;

export interface LetterProgress {
  /** EMA of the interval before a correct press, in ms. */
  ms: number;
  /** EMA of hit (1) / miss (0). */
  acc: number;
  samples: number;
}

export interface AdaptiveState {
  /** How many letters of LETTER_ORDER are unlocked. */
  unlocked: number;
  letters: Record<string, LetterProgress>;
  /** ISO date each letter was unlocked (for the progress view). */
  unlockedAt?: Record<string, string>;
}

export function initialAdaptive(): AdaptiveState {
  return { unlocked: START_LETTERS, letters: {}, unlockedAt: {} };
}

export function unlockedLetters(state: AdaptiveState, lang: Lang): string[] {
  return LETTER_ORDER[lang].slice(0, Math.min(state.unlocked, LETTER_ORDER[lang].length));
}

export function nextLetter(state: AdaptiveState, lang: Lang): string | undefined {
  return LETTER_ORDER[lang][state.unlocked];
}

export function letterWpm(p: LetterProgress | undefined): number {
  return p && p.samples > 0 ? msToWpm(p.ms) : 0;
}

/**
 * 0..1 readiness of a letter: the lower of speed/target and accuracy/0.95, scaled by how
 * many samples we have. A letter is "met" at 1.
 */
export function letterScore(p: LetterProgress | undefined, targetWpm: number): number {
  if (!p || p.samples === 0) return 0;
  const speed = Math.min(1, letterWpm(p) / targetWpm);
  const acc = Math.min(1, p.acc / ACCURACY_TARGET);
  const confidence = Math.min(1, p.samples / MIN_SAMPLES);
  return Math.min(speed, acc) * confidence;
}

export function letterMet(p: LetterProgress | undefined, targetWpm: number): boolean {
  return !!p && p.samples >= MIN_SAMPLES && letterWpm(p) >= targetWpm && p.acc >= ACCURACY_TARGET;
}

/** Weakest unlocked letter (ties → the most recently unlocked). */
export function focusLetter(state: AdaptiveState, lang: Lang, targetWpm: number): string {
  const letters = unlockedLetters(state, lang);
  let best = letters[letters.length - 1];
  let bestScore = Infinity;
  for (let i = letters.length - 1; i >= 0; i--) {
    const s = letterScore(state.letters[letters[i]], targetWpm);
    if (s < bestScore - 1e-9) {
      bestScore = s;
      best = letters[i];
    }
  }
  return best;
}

function updateLetter(p: LetterProgress | undefined, hit: boolean, ms: number | null): LetterProgress {
  const cur: LetterProgress = p ? { ...p } : { ms: 0, acc: 1, samples: 0 };
  cur.acc = cur.samples === 0 && hit ? 1 : cur.acc + ACC_ALPHA * ((hit ? 1 : 0) - cur.acc);
  if (hit && ms !== null) cur.ms = cur.ms === 0 ? ms : cur.ms + SPEED_ALPHA * (ms - cur.ms);
  cur.samples++;
  return cur;
}

/**
 * Apply a session's keystrokes to the per-letter averages, then unlock the next letter if
 * every unlocked letter meets the target. At most one letter unlocks per call.
 */
export function updateAdaptive(
  state: AdaptiveState,
  strokes: Keystroke[],
  lang: Lang,
  targetWpm: number,
  now = new Date(),
): { state: AdaptiveState; unlocked?: string } {
  const order = new Set(LETTER_ORDER[lang]);
  const letters = { ...state.letters };
  for (const s of strokes) {
    const l = s.expected.toLowerCase();
    if (!order.has(l)) continue;
    const ms = s.correct && s.dt > 0 && s.dt < MAX_INTERVAL_MS ? s.dt : null;
    // A correct press after a long pause still counts for accuracy, not for speed.
    letters[l] = updateLetter(letters[l], s.correct, ms);
  }
  const next: AdaptiveState = { ...state, letters, unlockedAt: { ...state.unlockedAt } };
  return maybeUnlock(next, lang, targetWpm, now);
}

export function maybeUnlock(state: AdaptiveState, lang: Lang, targetWpm: number, now = new Date()): { state: AdaptiveState; unlocked?: string } {
  const all = unlockedLetters(state, lang).every((l) => letterMet(state.letters[l], targetWpm));
  const letter = nextLetter(state, lang);
  if (!all || !letter) return { state };
  return {
    state: { ...state, unlocked: state.unlocked + 1, unlockedAt: { ...state.unlockedAt, [letter]: now.toISOString() } },
    unlocked: letter,
  };
}

/** Force the next letter open (user override). */
export function unlockNext(state: AdaptiveState, lang: Lang, now = new Date()): AdaptiveState {
  const letter = nextLetter(state, lang);
  if (!letter) return state;
  return { ...state, unlocked: state.unlocked + 1, unlockedAt: { ...state.unlockedAt, [letter]: now.toISOString() } };
}

// ---------------------------------------------------------------------------
// Lesson text
// ---------------------------------------------------------------------------

const modelCache = new WeakMap<readonly string[], BigramModel>();
function modelFor(words: readonly string[]) {
  let m = modelCache.get(words);
  if (!m) modelCache.set(words, (m = buildBigramModel(words)));
  return m;
}

/** Real words from the list made only of `allowed` letters, in frequency order. */
export function wordsWithin(words: readonly string[], allowed: Set<string>): string[] {
  return plainWords(words).filter((w) => [...w].every((c) => allowed.has(c)));
}

export interface LessonOptions {
  /** Approximate number of words in the lesson. */
  count?: number;
  /** Minimum distinct real words before pseudo-words are mixed in. */
  minVocabulary?: number;
}

/**
 * Generate a lesson using only unlocked letters. Real words containing the focus letter get
 * four times the weight; when fewer than `minVocabulary` real words fit, pronounceable
 * pseudo-words from the language's bigram model fill the pool.
 */
export function adaptiveText(words: readonly string[], letters: string[], focus: string, rng: Rng, opts: LessonOptions = {}): { text: string; pseudo: boolean } {
  const count = opts.count ?? 32;
  const minVocabulary = opts.minVocabulary ?? 24;
  const allowed = new Set(letters);
  const real = wordsWithin(words, allowed).slice(0, 600);
  const pool: string[] = [...real];
  const weights: number[] = real.map((w, i) => (1 / Math.sqrt(i + 6)) * (w.includes(focus) ? 4 : 1));
  let pseudo = false;
  if (real.length < minVocabulary) {
    pseudo = true;
    const model = modelFor(words);
    const seen = new Set(pool);
    const want = minVocabulary * 2 - real.length;
    for (let i = 0, guard = 0; i < want && guard < want * 6; guard++) {
      const w = pseudoWord(model, allowed, rng, { minLen: 2, maxLen: 6, mustInclude: rng() < 0.6 ? focus : undefined });
      if (!w || seen.has(w)) continue;
      seen.add(w);
      pool.push(w);
      weights.push((w.includes(focus) ? 2.5 : 1) * 0.12);
      i++;
    }
  }
  if (!pool.length) return { text: letters.join(" "), pseudo };
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let w = pool[weightedIndex(weights, rng)];
    if (pool.length > 2) for (let t = 0; t < 3 && w === out[out.length - 1]; t++) w = pool[weightedIndex(weights, rng)];
    out.push(w);
  }
  // Guarantee the focus letter shows up regularly.
  if (allowed.has(focus) && !out.some((w) => w.includes(focus))) {
    const withFocus = pool.filter((w) => w.includes(focus));
    for (let i = 0; i < out.length; i += 3) out[i] = withFocus.length ? withFocus[i % withFocus.length] : focus.repeat(2);
  }
  return { text: out.join(" "), pseudo };
}

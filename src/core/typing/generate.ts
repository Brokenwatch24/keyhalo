import { pick, weightedIndex, type Rng } from "./rng";

/**
 * Text generators: plain word streams for tests, punctuation/number decoration, a bigram
 * model for pronounceable pseudo-words, and symbol drills.
 */

export type Lang = "en" | "es";

const LETTER_RE = /^[\p{L}]+$/u;

/** Words made only of letters (no apostrophes/hyphens), lower-cased. */
export function plainWords(words: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const l = w.toLowerCase();
    if (LETTER_RE.test(l) && !seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  return out;
}

/**
 * Draw `count` words from a frequency-ordered list. Common words are favoured
 * (weight ∝ 1/√(rank+8)) and the same word never appears twice in a row.
 */
export function drawWords(words: readonly string[], count: number, rng: Rng, top = 300): string[] {
  const pool = words.slice(0, Math.min(top, words.length));
  if (!pool.length) return [];
  const weights = pool.map((_, i) => 1 / Math.sqrt(i + 8));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let w = pool[weightedIndex(weights, rng)];
    if (pool.length > 1 && w === out[out.length - 1]) w = pool[weightedIndex(weights, rng)];
    out.push(w);
  }
  return out;
}

export interface DecorateOptions {
  punctuation: boolean;
  numbers: boolean;
  language: Lang;
}

function capitalise(w: string) {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function randomNumber(rng: Rng): string {
  const r = rng();
  if (r < 0.35) return String(Math.floor(rng() * 10));
  if (r < 0.65) return String(10 + Math.floor(rng() * 90));
  if (r < 0.85) return String(100 + Math.floor(rng() * 900));
  return String(1900 + Math.floor(rng() * 130));
}

/** Turn a word list into text with optional sentence punctuation and numbers. */
export function decorate(words: string[], opts: DecorateOptions, rng: Rng): string {
  let ws = words.map((w) => (opts.numbers && rng() < 0.12 ? randomNumber(rng) : w));
  if (!opts.punctuation) return ws.join(" ");

  const out: string[] = [];
  let i = 0;
  while (i < ws.length) {
    const len = Math.min(ws.length - i, 4 + Math.floor(rng() * 7));
    const sentence = ws.slice(i, i + len);
    i += len;
    const r = rng();
    const kind: "statement" | "question" | "exclaim" = r < 0.72 ? "statement" : r < 0.88 ? "question" : "exclaim";
    sentence[0] = capitalise(sentence[0]);
    for (let j = 0; j < sentence.length - 1; j++) {
      const p = rng();
      if (p < 0.13) sentence[j] += ",";
      else if (p < 0.15) sentence[j] += opts.language === "es" ? ";" : ":";
      else if (p < 0.19 && j > 0) sentence[j] = `"${sentence[j]}"`;
      else if (p < 0.21 && j > 0) sentence[j] = `(${sentence[j]})`;
      else if (p < 0.23 && j > 0 && j < sentence.length - 2 && opts.language === "en") {
        sentence[j] = `${sentence[j]}-${sentence[j + 1]}`;
        sentence.splice(j + 1, 1);
      }
    }
    const last = sentence.length - 1;
    if (kind === "statement") sentence[last] += ".";
    else if (kind === "question") {
      sentence[last] += "?";
      if (opts.language === "es") sentence[0] = "¿" + sentence[0];
    } else {
      sentence[last] += "!";
      if (opts.language === "es") sentence[0] = "¡" + sentence[0];
    }
    out.push(...sentence);
  }
  ws = out;
  return ws.join(" ");
}

// ---------------------------------------------------------------------------
// Bigram model → pseudo-words
// ---------------------------------------------------------------------------

export interface BigramModel {
  /** transitions[a][b] = how often letter b follows a ("^" = word start, "$" = word end). */
  transitions: Map<string, Map<string, number>>;
}

export function buildBigramModel(words: readonly string[]): BigramModel {
  const transitions = new Map<string, Map<string, number>>();
  const bump = (a: string, b: string, w: number) => {
    let m = transitions.get(a);
    if (!m) transitions.set(a, (m = new Map()));
    m.set(b, (m.get(b) ?? 0) + w);
  };
  plainWords(words).forEach((word, rank) => {
    const w = 1 / Math.sqrt(rank + 1) + 0.05;
    const chars = ["^", ...word, "$"];
    for (let i = 1; i < chars.length; i++) bump(chars[i - 1], chars[i], w);
  });
  return { transitions };
}

/**
 * Walk the bigram model using only `allowed` letters. Produces pronounceable words that
 * respect the unlocked set; tries to include `mustInclude` when given.
 */
export function pseudoWord(model: BigramModel, allowed: Set<string>, rng: Rng, opts: { minLen?: number; maxLen?: number; mustInclude?: string } = {}): string {
  const minLen = opts.minLen ?? 2;
  const maxLen = opts.maxLen ?? 7;
  const letters = [...allowed];
  if (!letters.length) return "";
  let best = "";
  for (let attempt = 0; attempt < 24; attempt++) {
    let word = "";
    let prev = "^";
    const target = minLen + Math.floor(rng() * (maxLen - minLen + 1));
    while (word.length < maxLen) {
      const next = model.transitions.get(prev);
      const options: string[] = [];
      const weights: number[] = [];
      next?.forEach((w, ch) => {
        if (ch === "$") {
          if (word.length >= minLen) {
            options.push(ch);
            // Encourage ending once the target length is reached.
            weights.push(word.length >= target ? w * 6 : w * 0.3);
          }
        } else if (allowed.has(ch)) {
          options.push(ch);
          weights.push(w);
        }
      });
      let ch: string;
      if (!options.length) ch = word.length >= minLen ? "$" : pick(letters, rng);
      else ch = options[weightedIndex(weights, rng)];
      if (ch === "$") break;
      word += ch;
      prev = ch;
    }
    if (word.length < minLen || !pronounceable(word)) continue;
    if (!opts.mustInclude || word.includes(opts.mustInclude)) return word;
    if (!best) best = word;
  }
  if (opts.mustInclude && allowed.has(opts.mustInclude)) {
    // Splice the focus letter in so the drill always contains it.
    const base = best || pick(letters, rng) + pick(letters, rng);
    const at = Math.floor(rng() * (base.length + 1));
    return base.slice(0, at) + opts.mustInclude + base.slice(at);
  }
  return best || pick(letters, rng).repeat(minLen);
}

const VOWELS = "aeiouáéíóúü";

/** Cheap phonotactic filter: no triple letters, ≤ 2 vowels or 3 consonants in a row, no doubled start. */
export function pronounceable(word: string): boolean {
  if (/(.)/u.test(word) || /^(.)/u.test(word)) return false;
  let v = 0;
  let c = 0;
  for (const ch of word) {
    if (VOWELS.includes(ch)) {
      v++;
      c = 0;
    } else {
      c++;
      v = 0;
    }
    if (v > 2 || c > 3) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Symbol & number drills (Fn layer fallback)
// ---------------------------------------------------------------------------

const SYMBOL_PATTERNS: ((w: string, n: string, rng: Rng) => string)[] = [
  (w) => `(${w})`,
  (w) => `[${w}]`,
  (w) => `{${w}}`,
  (w) => `<${w}>`,
  (w, n) => `${w}[${n}]`,
  (w, n) => `${w} = ${n};`,
  (w, n) => `${w} += ${n}`,
  (_w, n) => `${n}%`,
  (_w, n) => `$${n}`,
  (w) => `@${w}`,
  (w) => `#${w}`,
  (w) => `~/${w}`,
  (w) => `${w}_${w.slice(0, 2)}`,
  (w, n) => `${w} != ${n}`,
  (w) => `!${w}`,
  (w) => `&${w}`,
  (w) => `*${w}`,
  (w, n) => `${w}^${n.charAt(0)}`,
  (w) => `"${w}"`,
  (w) => `'${w}'`,
  (w) => `\`${w}\``,
  (w) => `${w}?`,
  (w) => `${w}: ${w.length}`,
  (_w, n) => `${n}-${n}`,
  (w) => `${w} | ${w}`,
  (w) => `${w} && ${w}`,
  (w) => `${w}/${w}`,
  (w) => `\\${w}`,
];

export function symbolDrill(words: readonly string[], count: number, rng: Rng): string {
  const pool = plainWords(words).filter((w) => w.length <= 5).slice(0, 200);
  const base = pool.length ? pool : ["key", "map", "fn", "row", "led"];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const w = pick(base, rng);
    const n = String(Math.floor(rng() * 1000));
    out.push(pick(SYMBOL_PATTERNS, rng)(w, n, rng));
  }
  return out.join(" ");
}

import type { KeyCode, TypingResult } from "../types";
import { keyFor, type KeyLocale } from "./charmap";
import { accuracy, consistency, wpm } from "./metrics";

/**
 * A single practice run over a target text. Pure and framework-free: the caller feeds it
 * characters and timestamps (performance.now()), and reads state back. Mutable for speed —
 * the UI re-renders on `version` changes.
 */

export type SessionLimit = { kind: "time"; ms: number } | { kind: "text" };

export interface SessionOptions {
  text: string;
  /** Wrong characters are rejected: the cursor waits until the right key is pressed. */
  stopOnError?: boolean;
  locale?: KeyLocale;
  /** Code mode: after a newline the next line's indentation is filled in automatically. */
  autoIndent?: boolean;
  limit?: SessionLimit;
}

export interface Keystroke {
  /** ms since the session started (first keystroke = 0). */
  t: number;
  /** ms since the previous keystroke (0 for the first one). */
  dt: number;
  index: number;
  expected: string;
  typed: string;
  correct: boolean;
}

export type CharState = "pending" | "correct" | "wrong" | "corrected" | "auto";

export interface InputOutcome {
  accepted: boolean;
  correct: boolean;
  expected: string;
  finished: boolean;
}

export interface TimelinePoint {
  /** Second index (1-based end of the bucket). */
  s: number;
  /** Cumulative net WPM at the end of this second. */
  wpm: number;
  /** Raw WPM within this second. */
  raw: number;
  errors: number;
}

export interface BigramStat {
  pair: string;
  avgMs: number;
  count: number;
}

export interface SessionReport {
  result: TypingResult;
  timeline: TimelinePoint[];
  bigrams: BigramStat[];
  strokes: Keystroke[];
  /** Characters that were correct at the end / wrong at the end / corrected along the way. */
  breakdown: { correct: number; wrong: number; corrected: number; extra: number };
}

/** Pauses longer than this are not counted as a key's reaction time. */
const MAX_INTERVAL_MS = 2000;

export class TypingSession {
  readonly text: string;
  readonly chars: string[];
  readonly opts: Required<Omit<SessionOptions, "text">>;
  /** What was typed at each position (undefined = not yet). */
  typed: (string | undefined)[] = [];
  state: CharState[];
  cursor = 0;
  strokes: Keystroke[] = [];
  errors = 0;
  /** performance.now() of the first keystroke. */
  startedAt: number | null = null;
  endedAt: number | null = null;
  /** Bumped on every change, for cheap React subscriptions. */
  version = 0;
  private everWrong = new Set<number>();
  private lastStrokeAt: number | null = null;

  constructor(opts: SessionOptions) {
    this.text = opts.text;
    this.chars = [...opts.text];
    this.state = this.chars.map(() => "pending");
    this.opts = {
      stopOnError: opts.stopOnError ?? false,
      locale: opts.locale ?? "us",
      autoIndent: opts.autoIndent ?? false,
      limit: opts.limit ?? { kind: "text" },
    };
  }

  get started() {
    return this.startedAt !== null;
  }
  get finished() {
    return this.endedAt !== null;
  }
  get expected(): string | undefined {
    return this.chars[this.cursor];
  }

  elapsed(now: number): number {
    if (this.startedAt === null) return 0;
    return (this.endedAt ?? now) - this.startedAt;
  }

  /** Time left for timed sessions (ms), otherwise null. */
  remaining(now: number): number | null {
    const l = this.opts.limit;
    return l.kind === "time" ? Math.max(0, l.ms - this.elapsed(now)) : null;
  }

  /** Feed one typed character (already composed: dead keys resolved, shift applied). */
  input(ch: string, now: number): InputOutcome {
    const expected = this.chars[this.cursor];
    if (this.finished || expected === undefined) return { accepted: false, correct: false, expected: expected ?? "", finished: this.finished };
    if (this.startedAt === null) this.startedAt = now;
    const correct = ch === expected;
    const t = now - this.startedAt;
    const dt = this.lastStrokeAt === null ? 0 : now - this.lastStrokeAt;
    this.lastStrokeAt = now;
    this.strokes.push({ t, dt, index: this.cursor, expected, typed: ch, correct });
    if (!correct) this.errors++;

    if (!correct && this.opts.stopOnError) {
      this.everWrong.add(this.cursor);
      this.version++;
      return { accepted: false, correct, expected, finished: false };
    }

    this.typed[this.cursor] = ch;
    if (correct) this.state[this.cursor] = this.everWrong.has(this.cursor) ? "corrected" : "correct";
    else {
      this.state[this.cursor] = "wrong";
      this.everWrong.add(this.cursor);
    }
    this.cursor++;
    if (correct && expected === "\n" && this.opts.autoIndent) this.fillIndent();
    if (this.cursor >= this.chars.length) this.finish(now);
    this.version++;
    return { accepted: true, correct, expected, finished: this.finished };
  }

  /** Tab in code mode: types up to two expected spaces. */
  tab(now: number) {
    for (let i = 0; i < 2 && this.expected === " "; i++) this.input(" ", now);
  }

  private fillIndent() {
    while (this.chars[this.cursor] === " " || this.chars[this.cursor] === "\t") {
      this.typed[this.cursor] = this.chars[this.cursor];
      this.state[this.cursor] = "auto";
      this.cursor++;
    }
  }

  /** Delete the previous character (or the previous word with `word`). Errors stay counted. */
  backspace(word = false) {
    if (this.finished || this.cursor === 0) return;
    const step = () => {
      // Auto-filled indentation is removed together with the newline before it.
      do {
        this.cursor--;
        this.typed[this.cursor] = undefined;
        this.state[this.cursor] = "pending";
      } while (this.cursor > 0 && this.state[this.cursor - 1] === "auto");
    };
    if (!word) step();
    else {
      // Remove trailing spaces, then the word itself.
      while (this.cursor > 0 && this.chars[this.cursor - 1] === " ") step();
      while (this.cursor > 0 && this.chars[this.cursor - 1] !== " " && this.chars[this.cursor - 1] !== "\n") step();
    }
    this.version++;
  }

  /** Called by the UI clock for timed sessions. Returns true when the session just ended. */
  tick(now: number): boolean {
    const l = this.opts.limit;
    if (!this.finished && this.started && l.kind === "time" && this.elapsed(now) >= l.ms) {
      this.finish(this.startedAt! + l.ms);
      this.version++;
      return true;
    }
    return false;
  }

  finish(now: number) {
    if (this.endedAt === null && this.startedAt !== null) this.endedAt = now;
  }

  /** Positions currently typed correctly (auto-indent excluded). */
  correctChars(): number {
    let n = 0;
    for (let i = 0; i < this.cursor; i++) if (this.state[i] === "correct" || this.state[i] === "corrected") n++;
    return n;
  }

  live(now: number) {
    const ms = this.elapsed(now);
    const correctStrokes = this.strokes.filter((s) => s.correct).length;
    return {
      ms,
      wpm: ms > 500 ? wpm(this.correctChars(), ms) : 0,
      raw: ms > 500 ? wpm(this.strokes.length, ms) : 0,
      accuracy: accuracy(correctStrokes, this.strokes.length),
      progress: this.chars.length ? this.cursor / this.chars.length : 0,
    };
  }

  /** Words completed (for word-count tests). */
  wordsDone(): number {
    let n = 0;
    for (let i = 0; i < this.cursor; i++) if (this.chars[i] === " " || this.chars[i] === "\n") n++;
    return this.cursor >= this.chars.length ? n + 1 : n;
  }

  /** Build the final report. `meta` fills in mode/language. */
  report(meta: { mode: string; language: string; id?: string; date?: string; keepText?: boolean }): SessionReport {
    const ms = Math.max(1, this.endedAt !== null && this.startedAt !== null ? this.endedAt - this.startedAt : this.strokes.at(-1)?.t ?? 1);
    const correctStrokes = this.strokes.filter((s) => s.correct).length;
    const timeline = buildTimeline(this.strokes, ms);
    // Consistency ignores a trailing partial second shorter than half a second.
    const full = timeline.filter((p) => p.s * 1000 <= ms + 500).map((p) => p.raw);
    const breakdown = { correct: 0, wrong: 0, corrected: 0, extra: 0 };
    for (let i = 0; i < this.cursor; i++) {
      const s = this.state[i];
      if (s === "correct") breakdown.correct++;
      else if (s === "corrected") breakdown.corrected++;
      else if (s === "wrong") breakdown.wrong++;
    }
    breakdown.extra = this.errors;
    const result: TypingResult = {
      id: meta.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      date: meta.date ?? new Date().toISOString(),
      mode: meta.mode,
      language: meta.language,
      wpm: round1(wpm(this.correctChars(), ms)),
      rawWpm: round1(wpm(this.strokes.length, ms)),
      accuracy: round3(accuracy(correctStrokes, this.strokes.length)),
      consistency: round3(consistency(full)),
      durationMs: Math.round(ms),
      chars: this.cursor,
      errors: this.errors,
      keys: keyStats(this.strokes, this.opts.locale),
      replay: this.strokes.map((s) => [Math.round(s.t), s.correct]),
    };
    if (meta.keepText) result.text = this.text;
    return { result, timeline, bigrams: bigramStats(this.strokes), strokes: this.strokes, breakdown };
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function buildTimeline(strokes: Keystroke[], totalMs: number): TimelinePoint[] {
  const seconds = Math.max(1, Math.ceil(totalMs / 1000));
  const raw = new Array<number>(seconds).fill(0);
  const err = new Array<number>(seconds).fill(0);
  const ok = new Array<number>(seconds).fill(0);
  for (const s of strokes) {
    const b = Math.min(seconds - 1, Math.floor(s.t / 1000));
    raw[b]++;
    if (s.correct) ok[b]++;
    else err[b]++;
  }
  const out: TimelinePoint[] = [];
  let cum = 0;
  for (let i = 0; i < seconds; i++) {
    cum += ok[i];
    const end = Math.min(totalMs, (i + 1) * 1000);
    const span = Math.max(1, end - i * 1000);
    out.push({ s: i + 1, wpm: round1(wpm(cum, end)), raw: round1(wpm(raw[i], span)), errors: err[i] });
  }
  return out;
}

/** Per-key hits/misses/average interval, attributed to the key of the *expected* character. */
export function keyStats(strokes: Keystroke[], locale: KeyLocale): Record<KeyCode, { hits: number; misses: number; avgMs: number }> {
  const acc: Record<string, { hits: number; misses: number; sum: number; n: number }> = {};
  for (const s of strokes) {
    const code = keyFor(s.expected, locale);
    if (!code) continue;
    const k = (acc[code] ??= { hits: 0, misses: 0, sum: 0, n: 0 });
    if (s.correct) {
      k.hits++;
      if (s.dt > 0 && s.dt < MAX_INTERVAL_MS) {
        k.sum += s.dt;
        k.n++;
      }
    } else k.misses++;
  }
  const out: Record<KeyCode, { hits: number; misses: number; avgMs: number }> = {};
  for (const [code, k] of Object.entries(acc)) out[code] = { hits: k.hits, misses: k.misses, avgMs: k.n ? Math.round(k.sum / k.n) : 0 };
  return out;
}

/** Average transition time between consecutive correct letters, slowest first. */
export function bigramStats(strokes: Keystroke[]): BigramStat[] {
  const acc = new Map<string, { sum: number; n: number }>();
  for (let i = 1; i < strokes.length; i++) {
    const a = strokes[i - 1];
    const b = strokes[i];
    if (!a.correct || !b.correct || b.index !== a.index + 1) continue;
    if (/\s/.test(a.expected) || /\s/.test(b.expected)) continue;
    if (b.dt <= 0 || b.dt >= MAX_INTERVAL_MS) continue;
    const pair = (a.expected + b.expected).toLowerCase();
    const e = acc.get(pair) ?? { sum: 0, n: 0 };
    e.sum += b.dt;
    e.n++;
    acc.set(pair, e);
  }
  return [...acc.entries()]
    .map(([pair, e]) => ({ pair, avgMs: Math.round(e.sum / e.n), count: e.n }))
    .sort((x, y) => y.avgMs - x.avgMs);
}

/** Ghost: how far a recorded run had progressed after `ms`. */
export class Ghost {
  private times: number[];
  constructor(replay: [number, boolean][]) {
    this.times = replay.filter(([, ok]) => ok).map(([t]) => t);
  }
  /** Number of characters the ghost has typed correctly at `ms`. */
  indexAt(ms: number): number {
    let lo = 0;
    let hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] <= ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  get length() {
    return this.times.length;
  }
  get durationMs() {
    return this.times.at(-1) ?? 0;
  }
}

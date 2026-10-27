import { describe, expect, it } from "vitest";
import { accuracy, consistency, msToWpm, wpm } from "./metrics";
import { Ghost, TypingSession } from "./session";
import { keyFor, strokeFor } from "./charmap";
import {
  ACCURACY_TARGET,
  LETTER_ORDER,
  MIN_SAMPLES,
  START_LETTERS,
  adaptiveText,
  focusLetter,
  initialAdaptive,
  letterMet,
  unlockedLetters,
  updateAdaptive,
  type AdaptiveState,
} from "./adaptive";
import { buildBigramModel, decorate, pseudoWord } from "./generate";
import { seeded } from "./rng";
import { asGhost, configKey, dayKey, heatColor, keyHeat, streak } from "./progress";
import { DrillSession, parseChord, chordFromEvent, sameChord } from "./drills";
import { normaliseCode } from "./lesson";
import { simulateRun } from "./demo";
import type { Keystroke } from "./session";

const WORDS = "the of and to in is you that it he was for on are as with his they at be this have from or one had by word but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part".split(" ");

/** Type `text` with a fixed interval per key. */
function typeAll(s: TypingSession, text: string, start = 0, interval = 200) {
  let t = start;
  for (const ch of text) {
    s.input(ch, t);
    t += interval;
  }
  return t;
}

describe("metrics", () => {
  it("computes WPM as chars/5 per minute", () => {
    expect(wpm(250, 60000)).toBe(50);
    expect(wpm(50, 30000)).toBe(20);
    expect(wpm(0, 1000)).toBe(0);
    expect(wpm(10, 0)).toBe(0);
  });
  it("computes accuracy and clamps", () => {
    expect(accuracy(95, 100)).toBeCloseTo(0.95);
    expect(accuracy(0, 0)).toBe(1);
  });
  it("consistency is 1 − CV of per-second speed, clamped", () => {
    expect(consistency([60, 60, 60, 60])).toBe(1);
    expect(consistency([60])).toBe(1);
    // mean 50, population stdev 10 → 0.8
    expect(consistency([40, 60, 40, 60])).toBeCloseTo(0.8);
    expect(consistency([0, 0, 300, 0])).toBe(0);
  });
  it("converts intervals to WPM", () => {
    expect(msToWpm(200)).toBe(60);
  });
});

describe("TypingSession", () => {
  it("tracks correctness, WPM and accuracy", () => {
    const s = new TypingSession({ text: "hello world" });
    // 11 chars, 1 keystroke every 120 ms → first at 0, last at 1200 ms
    const end = typeAll(s, "hello world", 0, 120);
    expect(s.finished).toBe(true);
    expect(s.cursor).toBe(11);
    const r = s.report({ mode: "test", language: "en" }).result;
    expect(r.accuracy).toBe(1);
    expect(r.errors).toBe(0);
    expect(r.durationMs).toBe(end - 120);
    expect(r.wpm).toBeCloseTo(Math.round(wpm(11, 1200) * 10) / 10, 5);
    expect(r.replay).toHaveLength(11);
  });

  it("counts errors even after backspace (free mode)", () => {
    const s = new TypingSession({ text: "cat" });
    s.input("c", 0);
    s.input("x", 100); // wrong
    expect(s.state[1]).toBe("wrong");
    expect(s.cursor).toBe(2);
    s.backspace();
    expect(s.cursor).toBe(1);
    expect(s.state[1]).toBe("pending");
    s.input("a", 300);
    expect(s.state[1]).toBe("corrected");
    s.input("t", 400);
    const r = s.report({ mode: "test", language: "en" }).result;
    expect(r.errors).toBe(1);
    expect(r.accuracy).toBeCloseTo(3 / 4, 3);
    expect(r.replay!.map(([, ok]) => ok)).toEqual([true, false, true, true]);
  });

  it("stop-on-error keeps the cursor until the right key", () => {
    const s = new TypingSession({ text: "ab", stopOnError: true });
    s.input("a", 0);
    const o = s.input("x", 50);
    expect(o.accepted).toBe(false);
    expect(s.cursor).toBe(1);
    s.input("b", 100);
    expect(s.finished).toBe(true);
    expect(s.state[1]).toBe("corrected");
    expect(s.errors).toBe(1);
  });

  it("ctrl+backspace deletes the previous word", () => {
    const s = new TypingSession({ text: "one two three" });
    typeAll(s, "one tw");
    s.backspace(true);
    expect(s.cursor).toBe(4);
    s.backspace(true);
    expect(s.cursor).toBe(0);
  });

  it("ends timed sessions on tick", () => {
    const s = new TypingSession({ text: "a".repeat(100), limit: { kind: "time", ms: 1000 } });
    s.input("a", 0);
    s.input("a", 500);
    expect(s.tick(999)).toBe(false);
    expect(s.tick(1001)).toBe(true);
    expect(s.finished).toBe(true);
    expect(s.report({ mode: "test", language: "en" }).result.durationMs).toBe(1000);
  });

  it("auto-indents code after a newline and backspaces over it", () => {
    const s = new TypingSession({ text: "if x {\n  y\n}", autoIndent: true });
    typeAll(s, "if x {\n");
    expect(s.cursor).toBe(9); // two spaces filled in
    expect(s.state[7]).toBe("auto");
    s.input("y", 5000);
    expect(s.state[9]).toBe("correct");
    s.backspace();
    s.backspace(); // removes newline together with its indentation
    expect(s.cursor).toBe(6);
  });

  it("builds per-key stats and slow bigrams", () => {
    const s = new TypingSession({ text: "abab" });
    s.input("a", 0);
    s.input("b", 300);
    s.input("a", 400);
    s.input("b", 700);
    const rep = s.report({ mode: "test", language: "en" });
    expect(rep.result.keys.KeyB).toEqual({ hits: 2, misses: 0, avgMs: 300 });
    expect(rep.result.keys.KeyA.avgMs).toBe(100);
    expect(rep.bigrams[0]).toEqual({ pair: "ab", avgMs: 300, count: 2 });
  });

  it("produces a WPM timeline", () => {
    const rep = simulateRun(WORDS, { seconds: 15, wpm: 60 });
    expect(rep.timeline.length).toBe(15);
    expect(rep.result.wpm).toBeGreaterThan(40);
    expect(rep.result.wpm).toBeLessThan(85);
    expect(rep.result.consistency).toBeGreaterThan(0);
    expect(rep.result.consistency).toBeLessThanOrEqual(1);
  });
});

describe("dead keys & accents", () => {
  it("attributes accented letters to the base key with a dead key", () => {
    expect(keyFor("é", "es-ES")).toBe("KeyE");
    expect(strokeFor("é", "es-ES")?.dead?.code).toBe("Quote");
    expect(strokeFor("é", "es-LA")?.dead?.code).toBe("BracketLeft");
    expect(strokeFor("Á", "es-LA")).toMatchObject({ code: "KeyA", shift: true });
    expect(keyFor("ü", "es-ES")).toBe("KeyU");
    expect(strokeFor("ü", "es-ES")?.dead).toEqual({ code: "Quote", shift: true });
  });
  it("maps ñ and Spanish punctuation to their own keys", () => {
    expect(keyFor("ñ", "es-ES")).toBe("Semicolon");
    expect(keyFor("ñ", "es-LA")).toBe("Semicolon");
    expect(strokeFor("¿", "es-ES")).toEqual({ code: "Equal", shift: true });
    expect(strokeFor("¿", "es-LA")).toEqual({ code: "Equal" });
    expect(strokeFor("¡", "es-ES")).toEqual({ code: "Equal" });
  });
  it("falls back to NFD base letter on layouts without the character", () => {
    expect(keyFor("é", "us")).toBe("KeyE");
    expect(keyFor("ñ", "us")).toBe("KeyN");
  });
  it("records composed characters as one keystroke on the base key", () => {
    const s = new TypingSession({ text: "café", locale: "es-ES" });
    typeAll(s, "café");
    const r = s.report({ mode: "test", language: "es" }).result;
    expect(r.accuracy).toBe(1);
    expect(r.keys.KeyE.hits).toBe(1);
  });
  it("normalises decomposed input text", () => {
    const s = new TypingSession({ text: "é" });
    s.input("é".normalize("NFC"), 0);
    expect(s.finished).toBe(true);
  });
});

function strokesFor(letter: string, n: number, dt: number, correct = true): Keystroke[] {
  return Array.from({ length: n }, (_, i) => ({ t: i * dt, dt, index: i, expected: letter, typed: correct ? letter : "?", correct }));
}

describe("adaptive", () => {
  it("starts with the six most frequent letters", () => {
    const st = initialAdaptive();
    expect(unlockedLetters(st, "en")).toEqual(LETTER_ORDER.en.slice(0, START_LETTERS));
    expect(unlockedLetters(st, "es")).toEqual(["e", "a", "o", "s", "r", "n"]);
  });

  it("unlocks the next letter only when every unlocked key meets speed and accuracy", () => {
    let st: AdaptiveState = initialAdaptive();
    const fast = 12000 / 50; // 50 WPM per key interval
    const letters = unlockedLetters(st, "en");
    // All but the last letter are good → no unlock yet.
    for (const l of letters.slice(0, -1)) st = updateAdaptive(st, strokesFor(l, MIN_SAMPLES, fast), "en", 35).state;
    expect(st.unlocked).toBe(START_LETTERS);
    // Last letter too slow → still locked.
    let r = updateAdaptive(st, strokesFor(letters.at(-1)!, MIN_SAMPLES, 12000 / 20), "en", 35);
    expect(r.unlocked).toBeUndefined();
    expect(focusLetter(r.state, "en", 35)).toBe(letters.at(-1));
    // Make it fast → unlock "s".
    r = updateAdaptive(r.state, strokesFor(letters.at(-1)!, 60, fast), "en", 35);
    expect(r.unlocked).toBe(LETTER_ORDER.en[START_LETTERS]);
    expect(r.state.unlocked).toBe(START_LETTERS + 1);
  });

  it("requires ≥ 95 % accuracy", () => {
    const fast = 12000 / 60;
    let st = initialAdaptive();
    st = updateAdaptive(st, strokesFor("e", 30, fast), "en", 35).state;
    expect(letterMet(st.letters.e, 35)).toBe(true);
    st = updateAdaptive(st, [...strokesFor("e", 3, fast, false)], "en", 35).state;
    expect(st.letters.e.acc).toBeLessThan(ACCURACY_TARGET);
    expect(letterMet(st.letters.e, 35)).toBe(false);
  });

  it("generates lessons that only use unlocked letters and favour the focus key", () => {
    const rng = seeded(42);
    const letters = ["e", "t", "a", "o", "i", "n"];
    const { text } = adaptiveText(WORDS, letters, "n", rng, { count: 60 });
    const allowed = new Set([...letters, " "]);
    expect([...text].every((c) => allowed.has(c))).toBe(true);
    const words = text.split(" ");
    expect(words.length).toBe(60);
    expect(words.filter((w) => w.includes("n")).length).toBeGreaterThan(15);
  });

  it("falls back to bigram pseudo-words when few real words fit", () => {
    const rng = seeded(3);
    const { text, pseudo } = adaptiveText(WORDS, ["e", "t", "a"], "a", rng, { count: 40 });
    expect(pseudo).toBe(true);
    expect([...text].every((c) => "eta ".includes(c))).toBe(true);
  });

  it("pseudo-words respect the allowed set and include the focus letter", () => {
    const model = buildBigramModel(WORDS);
    const rng = seeded(9);
    const allowed = new Set(["s", "h", "e", "t"]);
    for (let i = 0; i < 50; i++) {
      const w = pseudoWord(model, allowed, rng, { mustInclude: "h" });
      expect([...w].every((c) => allowed.has(c))).toBe(true);
      expect(w).toContain("h");
    }
  });

  it("Spanish lessons keep accented letters locked until unlocked", () => {
    const es = ["que", "más", "esa", "año", "sea", "ese", "osa", "eres", "río", "nos", "son", "ser", "res"];
    const { text } = adaptiveText(es, LETTER_ORDER.es.slice(0, 6), "n", seeded(1), { count: 30, minVocabulary: 3 });
    expect(text).not.toMatch(/[áíñ]/);
  });
});

describe("test text", () => {
  it("adds Spanish inverted punctuation", () => {
    const rng = seeded(11);
    const words = Array.from({ length: 200 }, (_, i) => WORDS[i % WORDS.length]);
    const t = decorate(words, { punctuation: true, numbers: true, language: "es" }, rng);
    expect(t).toMatch(/¿[A-Z]/);
    expect(t).toMatch(/\?/);
    expect(t).toMatch(/\d/);
    // Every ¿ is closed by a ? before the next sentence.
    expect((t.match(/¿/g) ?? []).length).toBe((t.match(/\?/g) ?? []).length);
  });
  it("normalises code indentation", () => {
    expect(normaliseCode("\n\tif x {  \n\t\ty\n\t}\n")).toBe("  if x {\n    y\n  }");
  });
});

describe("ghost replay", () => {
  it("advances only on correct keystrokes", () => {
    const g = new Ghost([
      [0, true],
      [100, false],
      [200, true],
      [300, true],
    ]);
    expect(g.indexAt(-1)).toBe(0);
    expect(g.indexAt(0)).toBe(1);
    expect(g.indexAt(150)).toBe(1);
    expect(g.indexAt(250)).toBe(2);
    expect(g.indexAt(10_000)).toBe(3);
  });
  it("round-trips a session replay through JSON", () => {
    const rep = simulateRun(WORDS, { seconds: 10 });
    const ghost = asGhost(JSON.parse(JSON.stringify(rep.result)));
    expect(ghost).not.toBeNull();
    const g = new Ghost(ghost!.replay!);
    expect(g.indexAt(rep.result.durationMs + 1)).toBe(ghost!.replay!.filter(([, ok]) => ok).length);
    expect(asGhost({ wpm: 3 })).toBeNull();
  });
});

describe("progress", () => {
  it("counts streak days ending today or yesterday", () => {
    const today = new Date(2026, 9, 26);
    const d = (offset: number) => dayKey(new Date(2026, 9, 26 - offset));
    expect(streak({ [d(0)]: 1000, [d(1)]: 1, [d(2)]: 5 }, today)).toBe(3);
    expect(streak({ [d(1)]: 1000, [d(2)]: 1 }, today)).toBe(2);
    expect(streak({ [d(0)]: 1000, [d(2)]: 1 }, today)).toBe(1);
    expect(streak({}, today)).toBe(0);
  });
  it("keys personal bests by comparable config", () => {
    const test = { kind: "time" as const, time: 30, words: 25, punctuation: true, numbers: false };
    expect(configKey("test", "en", test)).toBe("test:30s:en:p");
    expect(configKey("test", "es", { ...test, kind: "words" })).toBe("test:25w:es:p");
    expect(configKey("adaptive", "es")).toBe("adaptive:es");
  });
  it("heat favours slow and error-prone keys", () => {
    const heat = keyHeat({
      KeyA: { hits: 20, misses: 0, avgMs: 150 },
      KeyB: { hits: 20, misses: 0, avgMs: 400 },
      KeyC: { hits: 10, misses: 5, avgMs: 150 },
      KeyD: { hits: 20, misses: 0, avgMs: 160 },
    });
    expect(heat.KeyA).toBe(0);
    expect(heat.KeyB).toBeGreaterThan(0.8);
    expect(heat.KeyC).toBe(1);
    const [r0, g0, b0] = heatColor(0);
    const [r1, g1, b1] = heatColor(1);
    expect(r1 + g1 + b1).toBeGreaterThan(r0 + g0 + b0);
  });
});

describe("chord drills", () => {
  it("parses pack chords in several spellings", () => {
    expect(parseChord(["ControlLeft", "KeyB"])).toEqual({ ctrl: true, shift: false, alt: false, meta: false, code: "KeyB" });
    expect(parseChord(["Ctrl+Shift+z"])).toMatchObject({ ctrl: true, shift: true, code: "KeyZ" });
    expect(parseChord(["Left"])?.code).toBe("ArrowLeft");
    expect(parseChord(["Ctrl"])).toBeNull();
  });
  it("scores a run", () => {
    const item = { id: "x", prompt: "Cut", chord: parseChord(["Ctrl", "X"])!, hintKeys: [] };
    const d = new DrillSession([item, { ...item, id: "y" }]);
    d.show(0);
    const wrong = chordFromEvent({ code: "KeyC", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })!;
    expect(d.press(wrong, 100).correct).toBe(false);
    const right = chordFromEvent({ code: "KeyX", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })!;
    expect(sameChord(right, item.chord)).toBe(true);
    expect(d.press(right, 500).correct).toBe(true);
    expect(d.press(right, 900).finished).toBe(true);
    const r = d.report({ mode: "shortcuts", language: "en" });
    expect(r.chars).toBe(2);
    expect(r.errors).toBe(1);
    expect(r.accuracy).toBeCloseTo(2 / 3, 2);
    expect(r.avgMs).toBe(450);
  });
});

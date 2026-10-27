import { describe, expect, it } from "vitest";
import { isTypingPack, snippetLanguage, textsFor, useTypingPacks, wordsFor } from "./packs";
import { buildLesson, codeLanguages } from "./lesson";
import { initialAdaptive } from "./adaptive";
import { seeded } from "./rng";

const packs = useTypingPacks.getState().packs;

describe("bundled typing packs", () => {
  it("are valid TypingPacks", () => {
    expect(packs.length).toBeGreaterThanOrEqual(5);
    for (const p of packs) expect(isTypingPack(p)).toBe(true);
  });
  it("ship ≥ 1000 unique words per language, Spanish with accents and ñ", () => {
    for (const lang of ["en", "es"]) {
      const w = wordsFor(packs, lang);
      expect(w.length).toBeGreaterThanOrEqual(1000);
      expect(new Set(w).size).toBe(w.length);
    }
    const es = wordsFor(packs, "es");
    for (const ch of "áéíóúñü") expect(es.some((w) => w.includes(ch))).toBe(true);
  });
  it("ship ≥ 30 passages per language and ≥ 25 code snippets across languages", () => {
    expect(textsFor(packs, "quotes", "en").length).toBeGreaterThanOrEqual(30);
    expect(textsFor(packs, "quotes", "es").length).toBeGreaterThanOrEqual(30);
    const code = textsFor(packs, "code");
    expect(code.length).toBeGreaterThanOrEqual(25);
    expect(codeLanguages(packs)).toEqual(expect.arrayContaining(["JavaScript", "TypeScript", "Python", "Rust", "Go", "C#"]));
    for (const s of code) {
      expect(s.text).not.toMatch(/\t/);
      expect(snippetLanguage(s.source)).not.toBe("Code");
    }
  });
  it("builds a lesson for every mode", () => {
    const base = {
      language: "es" as const,
      test: { kind: "time" as const, time: 30, words: 25, punctuation: true, numbers: true },
      targetWpm: 35,
      codeLang: "Rust",
      shortcutSource: "",
      customText: "hola “mundo” — ¿qué tal?",
      packs,
      keymaps: [],
      adaptive: initialAdaptive(),
      rng: seeded(5),
    };
    for (const mode of ["adaptive", "test", "quotes", "code", "shortcuts", "fn", "custom"] as const) {
      const l = buildLesson({ ...base, mode });
      if (l.kind === "text") expect(l.text.length).toBeGreaterThan(10);
      else expect(l.items.length).toBeGreaterThanOrEqual(10);
    }
    const custom = buildLesson({ ...base, mode: "custom" });
    expect(custom.kind === "text" && custom.text).toBe('hola "mundo" - ¿qué tal?');
  });
});

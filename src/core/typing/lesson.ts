import type { KeymapPack, Layout, TypingPack } from "../types";
import { adaptiveText, focusLetter, unlockedLetters, type AdaptiveState } from "./adaptive";
import { normaliseText } from "./charmap";
import { drillRun, fnItems, shortcutSources, type DrillItem } from "./drills";
import { decorate, drawWords, plainWords, symbolDrill, type Lang } from "./generate";
import { FALLBACK_WORDS, snippetLanguage, textsFor, wordsFor } from "./packs";
import type { TestSettings, TypingMode } from "./progress";
import { pick, type Rng } from "./rng";
import type { SessionLimit } from "./session";

/** Turns the current mode + options into something to practise. */

export type Lesson =
  | {
      kind: "text";
      text: string;
      limit: SessionLimit;
      autoIndent?: boolean;
      /** Quote author / snippet title. */
      source?: string;
      /** Adaptive extras. */
      focus?: string;
      letters?: string[];
      pseudo?: boolean;
      /** Fn mode without fnLayer data falls back to a symbol drill. */
      symbols?: boolean;
    }
  | { kind: "drill"; items: DrillItem[]; sourceName: string };

export interface LessonInput {
  mode: TypingMode;
  language: Lang;
  test: TestSettings;
  targetWpm: number;
  codeLang: string;
  shortcutSource: string;
  customText: string;
  packs: TypingPack[];
  keymaps: KeymapPack[];
  adaptive: AdaptiveState;
  layout?: Layout;
  rng: Rng;
}

export function languageWords(packs: TypingPack[], language: Lang): string[] {
  const w = wordsFor(packs, language);
  return w.length >= 50 ? w : FALLBACK_WORDS[language];
}

export function codeLanguages(packs: TypingPack[]): string[] {
  return [...new Set(textsFor(packs, "code").map((t) => snippetLanguage(t.source)))].sort();
}

export function buildLesson(input: LessonInput): Lesson {
  const { mode, language, rng } = input;
  const words = languageWords(input.packs, language);

  switch (mode) {
    case "adaptive": {
      const letters = unlockedLetters(input.adaptive, language);
      const focus = focusLetter(input.adaptive, language, input.targetWpm);
      const { text, pseudo } = adaptiveText(words, letters, focus, rng);
      return { kind: "text", text, limit: { kind: "text" }, focus, letters, pseudo };
    }
    case "test": {
      const t = input.test;
      // Timed tests get more words than anyone can type; word tests get exactly N.
      const count = t.kind === "words" ? t.words : Math.max(60, Math.ceil(t.time * 4.2));
      const base = drawWords(plainWords(words), count, rng, 250);
      const text = decorate(base, { punctuation: t.punctuation, numbers: t.numbers, language }, rng);
      return { kind: "text", text, limit: t.kind === "time" ? { kind: "time", ms: t.time * 1000 } : { kind: "text" } };
    }
    case "quotes": {
      const quotes = textsFor(input.packs, "quotes", language);
      if (!quotes.length) return buildLesson({ ...input, mode: "test" });
      const q = pick(quotes, rng);
      return { kind: "text", text: normaliseText(q.text).trim(), source: q.source, limit: { kind: "text" } };
    }
    case "code": {
      const all = textsFor(input.packs, "code");
      const filtered = input.codeLang === "all" ? all : all.filter((s) => snippetLanguage(s.source) === input.codeLang);
      const pool = filtered.length ? filtered : all;
      if (!pool.length) return buildLesson({ ...input, mode: "test" });
      const s = pick(pool, rng);
      return { kind: "text", text: normaliseCode(s.text), source: s.source, limit: { kind: "text" }, autoIndent: true };
    }
    case "shortcuts": {
      const sources = shortcutSources(input.keymaps);
      const src = sources.find((s) => s.id === input.shortcutSource) ?? sources[0];
      return { kind: "drill", items: drillRun(src.items, Math.min(20, Math.max(10, src.items.length)), rng), sourceName: src.name };
    }
    case "fn": {
      const items = fnItems(input.layout);
      if (items.length >= 3) return { kind: "drill", items: drillRun(items, 20, rng), sourceName: input.layout?.name ?? "Fn" };
      return { kind: "text", text: symbolDrill(words, 24, rng), limit: { kind: "text" }, symbols: true };
    }
    case "custom": {
      const text = normaliseText(input.customText).trim();
      return { kind: "text", text: text || words.slice(0, 30).join(" "), limit: { kind: "text" }, autoIndent: text.includes("\n") };
    }
  }
}

/** Code: tabs → 2 spaces, no trailing whitespace, no blank-line padding. */
export function normaliseCode(src: string): string {
  return normaliseText(src)
    .replace(/\t/g, "  ")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

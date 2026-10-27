import { create } from "zustand";
import type { KeymapPack, TypingPack } from "../types";

/**
 * Typing content: packs bundled from /community/typing plus packs installed from the
 * community gallery at runtime (bus "community:installed", kind "typing").
 */

function loadBundled(): TypingPack[] {
  const mods = import.meta.glob<TypingPack>("/community/typing/*.json", { eager: true, import: "default" });
  return Object.values(mods).filter(isTypingPack);
}

function loadKeymapPacks(): KeymapPack[] {
  const mods = import.meta.glob<KeymapPack>("/community/keymaps/*.json", { eager: true, import: "default" });
  return Object.values(mods).filter((p) => !!p && typeof p === "object" && Array.isArray((p as KeymapPack).legends));
}

export function isTypingPack(x: unknown): x is TypingPack {
  if (!x || typeof x !== "object") return false;
  const p = x as TypingPack;
  return typeof p.id === "string" && typeof p.language === "string" && ["words", "quotes", "code", "lessons"].includes(p.kind) && (Array.isArray(p.words) || Array.isArray(p.texts));
}

interface PacksState {
  packs: TypingPack[];
  keymaps: KeymapPack[];
  add(pack: TypingPack): void;
  remove(id: string): void;
}

export const useTypingPacks = create<PacksState>((set) => ({
  packs: loadBundled(),
  keymaps: loadKeymapPacks(),
  add: (pack) => set((s) => ({ packs: [...s.packs.filter((p) => p.id !== pack.id), pack] })),
  remove: (id) => set((s) => ({ packs: s.packs.filter((p) => p.id !== id) })),
}));

/** Frequency-ordered words for a language (merged across word packs, bundled first). */
export function wordsFor(packs: TypingPack[], language: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of packs) {
    if (p.kind !== "words" || p.language !== language || !p.words) continue;
    for (const w of p.words) {
      if (!seen.has(w)) {
        seen.add(w);
        out.push(w);
      }
    }
  }
  return out;
}

export function textsFor(packs: TypingPack[], kind: "quotes" | "code" | "lessons", language?: string): { text: string; source?: string; pack: string }[] {
  return packs
    .filter((p) => p.kind === kind && (!language || p.language === language || p.language === "any"))
    .flatMap((p) => (p.texts ?? []).map((t) => ({ ...t, pack: p.id })));
}

/** Code snippet language: packs store it in `source` as "Language · title" (e.g. "Rust · ring buffer"). */
export function snippetLanguage(source?: string): string {
  return (source ?? "").split(/\s*·\s*/)[0].trim() || "Code";
}

/** Snippet title without the language prefix. */
export function snippetTitle(source?: string): string {
  const parts = (source ?? "").split(/\s*·\s*/);
  return parts.slice(1).join(" · ") || parts[0] || "";
}

/** Tiny emergency word list so the trainer still works if every pack is missing. */
export const FALLBACK_WORDS: Record<string, string[]> = {
  en: "the of and to in is you that it he was for on are as with his they at be this have from or one had by word but not what all were we when your can said there use an each which she do how their if will up other about out many then them these so some her would make like him into time has look two more write go see number no way could people my than first water been call who oil its now find long down day did get come made may part".split(" "),
  es: "de la que el en y a los se del las un por con no una su para es al lo como más pero sus le ya o fue este ha sí porque esta son entre está cuando muy sin sobre ser tiene también me hasta hay donde han quien están desde todo nos durante todos uno les ni contra otros fueron ese eso había ante ellos e esto mí antes algunos qué unos yo otro otras otra él tanto esa estos mucho quienes nada muchos cual sea poco ella estar haber estas años dos".split(" "),
};

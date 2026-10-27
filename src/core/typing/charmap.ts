import type { KeyCode } from "../types";

/**
 * Character → physical key mapping for the keyboard locales the trainer understands.
 *
 * The trainer reads what the user typed from the composed `KeyboardEvent.key` (so dead keys
 * and AltGr work on any OS layout), and uses this table only to *attribute* a character to a
 * physical key for guidance and heatmaps. Accented letters typed through a dead key
 * (é = ´ then e) are attributed to the base letter key, with the dead key reported separately.
 */
export type KeyLocale = "us" | "es-ES" | "es-LA";

export interface KeyStroke {
  /** Physical key that produces the character (base letter key for dead-key combos). */
  code: KeyCode;
  shift?: boolean;
  altGr?: boolean;
  /** Dead key pressed before `code` (e.g. Quote for ´ on es-ES). */
  dead?: { code: KeyCode; shift?: boolean };
}

type Table = Record<string, KeyStroke>;

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function base(): Table {
  const t: Table = {};
  for (const l of LETTERS) {
    const code = `Key${l.toUpperCase()}`;
    t[l] = { code };
    t[l.toUpperCase()] = { code, shift: true };
  }
  for (let d = 0; d <= 9; d++) t[String(d)] = { code: `Digit${d}` };
  t[" "] = { code: "Space" };
  t["\n"] = { code: "Enter" };
  t["\t"] = { code: "Tab" };
  return t;
}

function add(t: Table, chars: string, codes: string[], mods: Partial<KeyStroke> = {}) {
  [...chars].forEach((ch, i) => {
    if (codes[i]) t[ch] = { code: codes[i], ...mods };
  });
}

const DIGITS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"];

function us(): Table {
  const t = base();
  add(t, "!@#$%^&*()", DIGITS, { shift: true });
  add(t, "-=[]\\;',./`", ["Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash", "Backquote"]);
  add(t, "_+{}|:\"<>?~", ["Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash", "Backquote"], { shift: true });
  return t;
}

/** Vowels that take an acute accent / diaeresis through a dead key. */
function accents(t: Table, acute: { code: KeyCode; shift?: boolean }, diaeresis: { code: KeyCode; shift?: boolean }) {
  const pairs: [string, string][] = [
    ["á", "a"], ["é", "e"], ["í", "i"], ["ó", "o"], ["ú", "u"],
  ];
  for (const [acc, b] of pairs) {
    t[acc] = { code: `Key${b.toUpperCase()}`, dead: acute };
    t[acc.toUpperCase()] = { code: `Key${b.toUpperCase()}`, shift: true, dead: acute };
  }
  t["ü"] = { code: "KeyU", dead: diaeresis };
  t["Ü"] = { code: "KeyU", shift: true, dead: diaeresis };
}

function esES(): Table {
  const t = base();
  add(t, "º'¡`+ñ´ç<,.-", ["Backquote", "Minus", "Equal", "BracketLeft", "BracketRight", "Semicolon", "Quote", "Backslash", "IntlBackslash", "Comma", "Period", "Slash"]);
  add(t, "ª!\"·$%&/()=?¿^*Ñ¨Ç>;:_", ["Backquote", ...DIGITS, "Minus", "Equal", "BracketLeft", "BracketRight", "Semicolon", "Quote", "Backslash", "IntlBackslash", "Comma", "Period", "Slash"], { shift: true });
  add(t, "\\|@#~€¬[]{}", ["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "BracketLeft", "BracketRight", "Quote", "Backslash"], { altGr: true });
  accents(t, { code: "Quote" }, { code: "Quote", shift: true });
  return t;
}

function esLA(): Table {
  const t = base();
  add(t, "|'¿´+ñ{}<,.-", ["Backquote", "Minus", "Equal", "BracketLeft", "BracketRight", "Semicolon", "Quote", "Backslash", "IntlBackslash", "Comma", "Period", "Slash"]);
  add(t, "°!\"#$%&/()=?¡¨*Ñ[]>;:_", ["Backquote", ...DIGITS, "Minus", "Equal", "BracketLeft", "BracketRight", "Semicolon", "Quote", "Backslash", "IntlBackslash", "Comma", "Period", "Slash"], { shift: true });
  add(t, "¬\\@~^`", ["Backquote", "Minus", "KeyQ", "BracketRight", "Quote", "Backslash"], { altGr: true });
  accents(t, { code: "BracketLeft" }, { code: "BracketLeft", shift: true });
  return t;
}

const TABLES: Record<KeyLocale, Table> = { us: us(), "es-ES": esES(), "es-LA": esLA() };

/** How to type `ch` on `locale`. Falls back to the base letter (NFD) for accented chars. */
export function strokeFor(ch: string, locale: KeyLocale = "us"): KeyStroke | undefined {
  const t = TABLES[locale];
  if (t[ch]) return t[ch];
  const decomposed = ch.normalize("NFD");
  if (decomposed.length > 1) {
    const b = t[decomposed[0]];
    if (b) return { ...b, dead: b.dead ?? { code: locale === "es-LA" ? "BracketLeft" : "Quote" } };
  }
  // Typographic punctuation people paste from the web.
  const ascii: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "." };
  if (ascii[ch]) return t[ascii[ch]];
  return undefined;
}

/** Physical key a character is attributed to in heatmaps (base letter for accents). */
export function keyFor(ch: string, locale: KeyLocale = "us"): KeyCode | undefined {
  return strokeFor(ch, locale)?.code;
}

/** Labels for the alpha block so the on-screen keyboard matches the locale (Ñ, Ç, ´…). */
export function localeLabels(locale: KeyLocale): Record<KeyCode, string> {
  const out: Record<KeyCode, string> = {};
  const t = TABLES[locale];
  for (const [ch, s] of Object.entries(t)) {
    if (s.shift || s.altGr || s.dead || ch.length !== 1 || ch === " " || ch === "\n" || ch === "\t") continue;
    if (!out[s.code]) out[s.code] = ch.toUpperCase();
  }
  return out;
}

/** Normalise typographic quotes/dashes in pasted text to what a keyboard can produce. */
export function normaliseText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
}

/** Guess the keyboard locale from the OS language (user can override in options). */
export function guessLocale(lang = typeof navigator !== "undefined" ? navigator.language : "en-US"): KeyLocale {
  if (/^es-ES/i.test(lang)) return "es-ES";
  if (/^es/i.test(lang)) return "es-LA";
  return "us";
}

import type { KeyCode, KeymapPack, Layout, TypingResult } from "../types";
import { consistency, mean } from "./metrics";
import { shuffle, type Rng } from "./rng";

/**
 * Chord drills: app shortcuts (from keymap packs) and Fn-layer reach practice. The user sees
 * a prompt and presses the chord; we compare physical key codes plus modifiers.
 */

export interface Chord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Main (non-modifier) key, KeyboardEvent.code. */
  code: KeyCode;
}

export interface DrillItem {
  id: string;
  prompt: string;
  /** App or group shown under the prompt ("DaVinci Resolve", "Fn layer"). */
  context?: string;
  chord: Chord;
  /** Keys to light/highlight as a hint (may include "Fn"). */
  hintKeys: KeyCode[];
}

const MOD_ALIASES: Record<string, keyof Omit<Chord, "code">> = {
  ctrl: "ctrl", control: "ctrl", controlleft: "ctrl", controlright: "ctrl", cmdorctrl: "ctrl", commandorcontrol: "ctrl",
  shift: "shift", shiftleft: "shift", shiftright: "shift",
  alt: "alt", option: "alt", altleft: "alt", altright: "alt", altgr: "alt",
  meta: "meta", win: "meta", super: "meta", cmd: "meta", command: "meta", metaleft: "meta", metaright: "meta", os: "meta",
};

const NAMED: Record<string, KeyCode> = {
  esc: "Escape", escape: "Escape", enter: "Enter", return: "Enter", space: "Space", spacebar: "Space", tab: "Tab",
  backspace: "Backspace", delete: "Delete", del: "Delete", insert: "Insert", ins: "Insert", home: "Home", end: "End",
  pageup: "PageUp", pgup: "PageUp", pagedown: "PageDown", pgdn: "PageDown", up: "ArrowUp", down: "ArrowDown",
  left: "ArrowLeft", right: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  "-": "Minus", "=": "Equal", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", ";": "Semicolon", "'": "Quote",
  ",": "Comma", ".": "Period", "/": "Slash", "`": "Backquote", plus: "Equal", minus: "Minus", comma: "Comma", period: "Period",
  slash: "Slash", backquote: "Backquote", printscreen: "PrintScreen", capslock: "CapsLock",
};

/** Normalise one key name from a pack ("KeyB", "b", "Ctrl", "F5", "Left") to a code or modifier. */
export function normaliseKey(name: string): { mod?: keyof Omit<Chord, "code">; code?: KeyCode } {
  const raw = name.trim();
  const low = raw.toLowerCase();
  if (MOD_ALIASES[low]) return { mod: MOD_ALIASES[low] };
  if (/^Key[A-Z]$|^Digit\d$|^F\d{1,2}$|^Numpad|^Arrow/.test(raw)) return { code: raw };
  if (/^[a-z]$/i.test(raw)) return { code: `Key${raw.toUpperCase()}` };
  if (/^\d$/.test(raw)) return { code: `Digit${raw}` };
  if (/^f\d{1,2}$/i.test(raw)) return { code: raw.toUpperCase() };
  if (NAMED[low]) return { code: NAMED[low] };
  return { code: raw };
}

export function parseChord(keys: string[]): Chord | null {
  const c: Chord = { ctrl: false, shift: false, alt: false, meta: false, code: "" };
  for (const k of keys.flatMap((k) => (k.length > 1 && k.includes("+") ? k.split("+") : [k]))) {
    const n = normaliseKey(k);
    if (n.mod) c[n.mod] = true;
    else if (n.code) c.code = n.code;
  }
  return c.code ? c : null;
}

const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "Fn", "CapsLock"]);
export const isModifierCode = (code: string) => MODIFIER_CODES.has(code);

export function chordFromEvent(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): Chord | null {
  if (isModifierCode(e.code)) return null;
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, code: e.code };
}

export function sameChord(a: Chord, b: Chord): boolean {
  return a.code === b.code && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta;
}

/** Physical keys to light for a chord. */
export function chordKeys(c: Chord): KeyCode[] {
  return [c.ctrl && "ControlLeft", c.shift && "ShiftLeft", c.alt && "AltLeft", c.meta && "MetaLeft", c.code].filter(Boolean) as KeyCode[];
}

const PRETTY: Record<string, string> = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", Backspace: "⌫", Enter: "Enter", Space: "Space",
  Delete: "Del", Insert: "Ins", PageUp: "PgUp", PageDown: "PgDn", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`", PrintScreen: "PrtSc",
};

export function prettyCode(code: KeyCode): string {
  if (PRETTY[code]) return PRETTY[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code.replace(/^Audio/, "").replace(/^Media/, "");
}

export function chordLabel(c: Chord): string[] {
  return [c.ctrl && "Ctrl", c.shift && "Shift", c.alt && "Alt", c.meta && "Win", prettyCode(c.code)].filter(Boolean) as string[];
}

/** Chords the browser or OS swallow before the page sees them. */
export function isCapturable(c: Chord): boolean {
  if (c.meta) return false;
  if (c.alt && (c.code === "Tab" || c.code === "F4" || c.code === "Space")) return false;
  if (c.ctrl && ["KeyW", "KeyT", "KeyN", "Tab", "PageUp", "PageDown"].includes(c.code)) return false;
  if (c.ctrl && c.alt && c.code === "Delete") return false;
  if (c.code === "F11" || c.code === "F12" || c.code === "PrintScreen") return false;
  return true;
}

/** Built-in set used when no keymap pack is installed. */
export const FALLBACK_SHORTCUTS: { id: string; name: string; legends: { keys: string[]; label: string }[] } = {
  id: "builtin-everyday",
  name: "Everyday editing",
  legends: [
    { keys: ["Ctrl", "C"], label: "Copy" },
    { keys: ["Ctrl", "X"], label: "Cut" },
    { keys: ["Ctrl", "V"], label: "Paste" },
    { keys: ["Ctrl", "Z"], label: "Undo" },
    { keys: ["Ctrl", "Y"], label: "Redo" },
    { keys: ["Ctrl", "Shift", "Z"], label: "Redo (alternate)" },
    { keys: ["Ctrl", "S"], label: "Save" },
    { keys: ["Ctrl", "Shift", "S"], label: "Save as" },
    { keys: ["Ctrl", "F"], label: "Find" },
    { keys: ["Ctrl", "H"], label: "Find and replace" },
    { keys: ["Ctrl", "A"], label: "Select all" },
    { keys: ["Ctrl", "B"], label: "Bold" },
    { keys: ["Ctrl", "I"], label: "Italic" },
    { keys: ["Ctrl", "U"], label: "Underline" },
    { keys: ["Ctrl", "K"], label: "Insert link" },
    { keys: ["Ctrl", "P"], label: "Print / quick open" },
    { keys: ["Ctrl", "Slash"], label: "Toggle comment" },
    { keys: ["Ctrl", "G"], label: "Go to line" },
    { keys: ["Ctrl", "Home"], label: "Jump to start" },
    { keys: ["Ctrl", "End"], label: "Jump to end" },
    { keys: ["Ctrl", "ArrowLeft"], label: "Previous word" },
    { keys: ["Ctrl", "ArrowRight"], label: "Next word" },
    { keys: ["Ctrl", "Shift", "ArrowRight"], label: "Select next word" },
    { keys: ["Ctrl", "Backspace"], label: "Delete previous word" },
    { keys: ["Shift", "Home"], label: "Select to line start" },
    { keys: ["F2"], label: "Rename" },
  ],
};

export interface ShortcutSource {
  id: string;
  name: string;
  items: DrillItem[];
}

/** Turn keymap packs (their app shortcut legends) into drill sources. */
export function shortcutSources(packs: KeymapPack[]): ShortcutSource[] {
  const sources: ShortcutSource[] = [];
  for (const p of packs) {
    const items = (p.legends ?? [])
      .map((l, i) => {
        const chord = parseChord(l.keys ?? []);
        return chord && isCapturable(chord) ? ({ id: `${p.id}:${i}`, prompt: l.label, context: p.name, chord, hintKeys: chordKeys(chord) } as DrillItem) : null;
      })
      .filter((x): x is DrillItem => !!x);
    if (items.length >= 3) sources.push({ id: p.id, name: p.name, items });
  }
  const fb = FALLBACK_SHORTCUTS;
  sources.push({
    id: fb.id,
    name: fb.name,
    items: fb.legends
      .map((l, i) => {
        const chord = parseChord(l.keys)!;
        return { id: `${fb.id}:${i}`, prompt: l.label, context: fb.name, chord, hintKeys: chordKeys(chord) };
      })
      .filter((d) => isCapturable(d.chord)),
  });
  return sources;
}

/** Fn-layer drill items from a layout's `fnLayer` map (base key → produced key). */
export function fnItems(layout: Layout | undefined): DrillItem[] {
  if (!layout?.fnLayer) return [];
  return Object.entries(layout.fnLayer)
    .filter(([, target]) => !!target && !/^(Media|Audio|Launch|Browser|Brightness|Mic|Power|Sleep)/.test(target))
    .map(([base, target]) => ({
      id: `fn:${base}`,
      prompt: prettyCode(target),
      context: target,
      chord: { ctrl: false, shift: false, alt: false, meta: false, code: target },
      hintKeys: ["Fn", base],
    }));
}

/** Build a run of `count` items, shuffled, never repeating the same item back to back. */
export function drillRun(items: DrillItem[], count: number, rng: Rng): DrillItem[] {
  if (!items.length) return [];
  const out: DrillItem[] = [];
  while (out.length < count) {
    for (const it of shuffle(items, rng)) {
      if (out.length >= count) break;
      if (out[out.length - 1]?.id === it.id && items.length > 1) continue;
      out.push(it);
    }
  }
  return out;
}

export interface DrillAttempt {
  itemId: string;
  code: KeyCode;
  /** Time from prompt shown to the correct press. */
  ms: number;
  misses: number;
}

/** Chord drill state machine. */
export class DrillSession {
  index = 0;
  misses = 0;
  attempts: DrillAttempt[] = [];
  startedAt: number | null = null;
  endedAt: number | null = null;
  shownAt: number | null = null;
  currentMisses = 0;
  version = 0;
  constructor(readonly items: DrillItem[]) {}

  get current(): DrillItem | undefined {
    return this.items[this.index];
  }
  get finished() {
    return this.endedAt !== null;
  }

  /** Mark the prompt visible (starts its reaction timer). */
  show(now: number) {
    if (this.shownAt === null) this.shownAt = now;
  }

  press(chord: Chord, now: number): { correct: boolean; finished: boolean } {
    const item = this.current;
    if (!item || this.finished) return { correct: false, finished: this.finished };
    if (this.startedAt === null) this.startedAt = this.shownAt ?? now;
    this.shownAt ??= now;
    if (!sameChord(chord, item.chord)) {
      this.misses++;
      this.currentMisses++;
      this.version++;
      return { correct: false, finished: false };
    }
    this.attempts.push({ itemId: item.id, code: item.chord.code, ms: now - this.shownAt, misses: this.currentMisses });
    this.index++;
    this.currentMisses = 0;
    this.shownAt = now;
    if (this.index >= this.items.length) this.endedAt = now;
    this.version++;
    return { correct: true, finished: this.finished };
  }

  skip(now: number) {
    const item = this.current;
    if (!item) return;
    this.startedAt ??= now;
    this.attempts.push({ itemId: item.id, code: item.chord.code, ms: 0, misses: this.currentMisses + 1 });
    this.misses++;
    this.index++;
    this.currentMisses = 0;
    this.shownAt = now;
    if (this.index >= this.items.length) this.endedAt = now;
    this.version++;
  }

  /** Summarise as a TypingResult: `wpm` holds chords per minute for drill modes. */
  report(meta: { mode: string; language: string }): TypingResult & { avgMs: number; slowest: { item: DrillItem; ms: number }[] } {
    const ms = Math.max(1, (this.endedAt ?? this.startedAt ?? 0) - (this.startedAt ?? 0));
    const times = this.attempts.filter((a) => a.ms > 0).map((a) => a.ms);
    const total = this.attempts.length + this.misses - this.attempts.filter((a) => a.ms === 0).length;
    const keys: TypingResult["keys"] = {};
    for (const a of this.attempts) {
      const k = (keys[a.code] ??= { hits: 0, misses: 0, avgMs: 0 });
      if (a.ms > 0) {
        k.avgMs = Math.round((k.avgMs * k.hits + a.ms) / (k.hits + 1));
        k.hits++;
      }
      k.misses += a.misses;
    }
    const byId = new Map(this.items.map((i) => [i.id, i]));
    const slowest = this.attempts
      .filter((a) => a.ms > 0)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 5)
      .map((a) => ({ item: byId.get(a.itemId)!, ms: a.ms }));
    const cpm = this.attempts.length / (ms / 60000);
    return {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      date: new Date().toISOString(),
      mode: meta.mode,
      language: meta.language,
      wpm: Math.round(cpm * 10) / 10,
      rawWpm: Math.round(cpm * 10) / 10,
      accuracy: total > 0 ? Math.round((this.attempts.filter((a) => a.ms > 0).length / total) * 1000) / 1000 : 1,
      consistency: Math.round(consistency(times.map((t) => 60000 / t)) * 1000) / 1000,
      durationMs: Math.round(ms),
      chars: this.attempts.length,
      errors: this.misses,
      keys,
      avgMs: Math.round(mean(times)),
      slowest,
    };
  }
}

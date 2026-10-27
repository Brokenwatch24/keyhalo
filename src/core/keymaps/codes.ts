import type { KeyBinding, ModifierName, RGB } from "@/core/types";

/** Every W3C `KeyboardEvent.code` name KeyHalo accepts in keymap packs (+ "Fn"). */
export const KEY_CODES: readonly string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `Key${c}`),
  ..."0123456789".split("").map((d) => `Digit${d}`),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  "Escape", "Tab", "CapsLock", "Space", "Enter", "Backspace", "Delete", "Insert", "Home", "End",
  "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Backquote",
  "Comma", "Period", "Slash", "IntlBackslash", "IntlRo", "IntlYen",
  "PrintScreen", "ScrollLock", "Pause", "ContextMenu", "NumLock",
  ..."0123456789".split("").map((d) => `Numpad${d}`),
  "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal", "NumpadEnter", "NumpadEqual",
  "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight",
  "MediaPlayPause", "MediaStop", "MediaTrackNext", "MediaTrackPrevious", "MediaSelect",
  "AudioVolumeUp", "AudioVolumeDown", "AudioVolumeMute",
  "BrowserBack", "BrowserForward", "BrowserRefresh", "BrowserHome", "BrowserSearch", "BrowserFavorites",
  "LaunchMail", "LaunchApp1", "LaunchApp2",
  "Convert", "NonConvert", "KanaMode", "Lang1", "Lang2",
  "Fn",
];

const CODE_SET = new Set(KEY_CODES);

/** Mouse buttons allowed as binding triggers. */
export const MOUSE_TRIGGERS = ["Mouse1", "Mouse2", "Mouse3", "Mouse4", "Mouse5"] as const;

export function isValidKeyCode(code: string): boolean {
  return CODE_SET.has(code);
}

/** Valid as a `KeyBinding.key` (key code or mouse button). */
export function isValidTrigger(code: string): boolean {
  return CODE_SET.has(code) || (MOUSE_TRIGGERS as readonly string[]).includes(code);
}

const MOD_OF: Record<string, ModifierName> = {
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  AltLeft: "Alt",
  AltRight: "Alt",
  MetaLeft: "Meta",
  MetaRight: "Meta",
};

export const MODIFIER_ORDER: ModifierName[] = ["Ctrl", "Shift", "Alt", "Meta"];

/** "ControlRight" → "Ctrl"; non-modifiers → undefined. */
export function modifierOf(code: string): ModifierName | undefined {
  return MOD_OF[code];
}

export function isModifierCode(code: string): boolean {
  return code in MOD_OF;
}

/** Left-hand code for a modifier name (used when building chords). */
export function modifierCode(m: ModifierName): string {
  return { Ctrl: "ControlLeft", Shift: "ShiftLeft", Alt: "AltLeft", Meta: "MetaLeft" }[m];
}

/** A normalised combo: sorted modifier names + main key. */
export interface Combo {
  mods: ModifierName[];
  key: string;
}

export function sortMods(mods: Iterable<ModifierName>): ModifierName[] {
  const set = new Set(mods);
  return MODIFIER_ORDER.filter((m) => set.has(m));
}

/** Split a legend `keys` array (modifiers + one key) into a combo. Null when there is no main key. */
export function comboFromKeys(keys: string[]): Combo | null {
  const mods: ModifierName[] = [];
  let key: string | null = null;
  for (const k of keys) {
    const m = modifierOf(k);
    if (m) mods.push(m);
    else key = k;
  }
  if (!key) {
    // Modifier-only legend (e.g. "Shift = sprint"): the last modifier is the key itself.
    const last = keys[keys.length - 1];
    if (!last) return null;
    return { mods: sortMods(mods.slice(0, -1)), key: last };
  }
  return { mods: sortMods(mods), key };
}

export function comboFromBinding(b: Pick<KeyBinding, "key" | "with">): Combo {
  return { mods: sortMods(b.with ?? []), key: b.key };
}

/** Canonical string id for comparisons, e.g. "Ctrl+Shift+KeyP". Left/right modifiers are merged. */
export function comboId(c: Combo): string {
  const key = modifierOf(c.key) ?? c.key;
  return [...c.mods, key].join("+");
}

const PRETTY: Record<string, string> = {
  Escape: "Esc", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Space: "Space",
  PageUp: "PgUp", PageDown: "PgDn", Delete: "Del", Insert: "Ins", Backspace: "Backspace",
  ControlLeft: "Ctrl", ControlRight: "Ctrl", ShiftLeft: "Shift", ShiftRight: "Shift",
  AltLeft: "Alt", AltRight: "AltGr", MetaLeft: "Win", MetaRight: "Win", Meta: "Win",
  NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *", NumpadDivide: "Num /",
  NumpadDecimal: "Num .", NumpadEnter: "Num Enter",
};

/** Human label for a key code: "KeyA" → "A", "Digit1" → "1", "ArrowUp" → "↑". */
export function keyLabel(code: string): string {
  if (PRETTY[code]) return PRETTY[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** "Ctrl+Shift+P" for display. */
export function comboLabel(c: Combo | string[]): string {
  const combo = Array.isArray(c) ? comboFromKeys(c) : c;
  if (!combo) return "";
  return [...combo.mods.map((m) => (m === "Meta" ? "Win" : m)), keyLabel(combo.key)].join("+");
}

/** "#5aa9ff" / "#fff" / "rgb(1,2,3)" → RGB (grey on failure). */
export function hexToRgb(color: string): RGB {
  const s = color.trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split("").map((h) => parseInt(h + h, 16));
    return [r, g, b];
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [128, 128, 128];
}

/** Palette used when importers need to invent category colours. */
export const CATEGORY_PALETTE = ["#5aa9ff", "#7ee0a1", "#ffb454", "#c792ea", "#4dd0e1", "#ff8a80", "#9aa5b1", "#f6d365"];

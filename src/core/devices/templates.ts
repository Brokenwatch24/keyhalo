import type { KeyDef, Layout } from "../types";

/**
 * Generic keyboard layout templates (physical positions + touch-typing fingers).
 * Used as a fallback when no device is connected (typing trainer, demo) and by the
 * device wizard to map LEDs onto keys. Device definitions may copy and adjust them.
 */

type Row = [code: string, label: string, w?: number, finger?: number][];

function row(y: number, keys: Row, x0 = 0): KeyDef[] {
  let x = x0;
  return keys.map(([code, label, w = 1, finger]) => {
    const k: KeyDef = { code, label, x, y, w, finger };
    if (w === 1) delete k.w;
    if (finger === undefined) delete k.finger;
    x += w;
    return k;
  });
}

const NUM_ROW: Row = [
  ["Escape", "Esc", 1, 0], ["Digit1", "1", 1, 0], ["Digit2", "2", 1, 1], ["Digit3", "3", 1, 2], ["Digit4", "4", 1, 3],
  ["Digit5", "5", 1, 3], ["Digit6", "6", 1, 6], ["Digit7", "7", 1, 6], ["Digit8", "8", 1, 7], ["Digit9", "9", 1, 8],
  ["Digit0", "0", 1, 9], ["Minus", "-", 1, 9], ["Equal", "=", 1, 9], ["Backspace", "Backspace", 2, 9],
];
const TOP_ROW_LETTERS: Row = [
  ["KeyQ", "Q", 1, 0], ["KeyW", "W", 1, 1], ["KeyE", "E", 1, 2], ["KeyR", "R", 1, 3], ["KeyT", "T", 1, 3],
  ["KeyY", "Y", 1, 6], ["KeyU", "U", 1, 6], ["KeyI", "I", 1, 7], ["KeyO", "O", 1, 8], ["KeyP", "P", 1, 9],
  ["BracketLeft", "[", 1, 9], ["BracketRight", "]", 1, 9],
];
const HOME_ROW_LETTERS: Row = [
  ["KeyA", "A", 1, 0], ["KeyS", "S", 1, 1], ["KeyD", "D", 1, 2], ["KeyF", "F", 1, 3], ["KeyG", "G", 1, 3],
  ["KeyH", "H", 1, 6], ["KeyJ", "J", 1, 6], ["KeyK", "K", 1, 7], ["KeyL", "L", 1, 8], ["Semicolon", ";", 1, 9],
  ["Quote", "'", 1, 9],
];
const BOTTOM_ROW_LETTERS: Row = [
  ["KeyZ", "Z", 1, 0], ["KeyX", "X", 1, 1], ["KeyC", "C", 1, 2], ["KeyV", "V", 1, 3], ["KeyB", "B", 1, 3],
  ["KeyN", "N", 1, 6], ["KeyM", "M", 1, 6], ["Comma", ",", 1, 7], ["Period", ".", 1, 8], ["Slash", "/", 1, 9],
];
const MOD_ROW: Row = [
  ["ControlLeft", "Ctrl", 1.25, 0], ["MetaLeft", "Win", 1.25, 4], ["AltLeft", "Alt", 1.25, 4], ["Space", "", 6.25, 5],
  ["AltRight", "Alt", 1.25, 5], ["Fn", "Fn", 1.25, 9], ["ContextMenu", "Menu", 1.25, 9], ["ControlRight", "Ctrl", 1.25, 9],
];

export const ANSI_60: Layout = {
  id: "ansi-60",
  name: "60% ANSI",
  standard: "ansi",
  keys: [
    ...row(0, NUM_ROW),
    ...row(1, [["Tab", "Tab", 1.5, 0], ...TOP_ROW_LETTERS, ["Backslash", "\\", 1.5, 9]]),
    ...row(2, [["CapsLock", "Caps", 1.75, 0], ...HOME_ROW_LETTERS, ["Enter", "Enter", 2.25, 9]]),
    ...row(3, [["ShiftLeft", "Shift", 2.25, 0], ...BOTTOM_ROW_LETTERS, ["ShiftRight", "Shift", 2.75, 9]]),
    ...row(4, MOD_ROW),
  ],
};

export const ISO_60: Layout = {
  id: "iso-60",
  name: "60% ISO",
  standard: "iso",
  keys: [
    ...row(0, NUM_ROW),
    ...row(1, [["Tab", "Tab", 1.5, 0], ...TOP_ROW_LETTERS]),
    { code: "Enter", label: "Enter", x: 13.75, y: 1, w: 1.25, h: 2, finger: 9 },
    ...row(2, [["CapsLock", "Caps", 1.75, 0], ...HOME_ROW_LETTERS, ["Backslash", "#", 1, 9]]),
    ...row(3, [["ShiftLeft", "Shift", 1.25, 0], ["IntlBackslash", "\\", 1, 0], ...BOTTOM_ROW_LETTERS, ["ShiftRight", "Shift", 2.75, 9]]),
    ...row(4, MOD_ROW),
  ],
};

// ---------------------------------------------------------------------------
// Larger form factors
// ---------------------------------------------------------------------------

const BQ_NUM_ROW: Row = [["Backquote", "`", 1, 0], ...NUM_ROW.slice(1)];

/** The five alpha rows (number row … modifiers) starting at `y0`. */
function alphaBlock(y0: number, iso: boolean, numRow: Row, mods: Row = MOD_ROW): KeyDef[] {
  if (!iso) {
    return [
      ...row(y0, numRow),
      ...row(y0 + 1, [["Tab", "Tab", 1.5, 0], ...TOP_ROW_LETTERS, ["Backslash", "\\", 1.5, 9]]),
      ...row(y0 + 2, [["CapsLock", "Caps", 1.75, 0], ...HOME_ROW_LETTERS, ["Enter", "Enter", 2.25, 9]]),
      ...row(y0 + 3, [["ShiftLeft", "Shift", 2.25, 0], ...BOTTOM_ROW_LETTERS, ["ShiftRight", "Shift", 2.75, 9]]),
      ...row(y0 + 4, mods),
    ];
  }
  return [
    ...row(y0, numRow),
    ...row(y0 + 1, [["Tab", "Tab", 1.5, 0], ...TOP_ROW_LETTERS]),
    { code: "Enter", label: "Enter", x: 13.75, y: y0 + 1, w: 1.25, h: 2, finger: 9 },
    ...row(y0 + 2, [["CapsLock", "Caps", 1.75, 0], ...HOME_ROW_LETTERS, ["Backslash", "#", 1, 9]]),
    ...row(y0 + 3, [["ShiftLeft", "Shift", 1.25, 0], ["IntlBackslash", "\\", 1, 0], ...BOTTOM_ROW_LETTERS, ["ShiftRight", "Shift", 2.75, 9]]),
    ...row(y0 + 4, mods),
  ];
}

const k = (code: string, label: string, x: number, y: number, finger?: number, w?: number, h?: number): KeyDef => {
  const key: KeyDef = { code, label, x, y };
  if (w !== undefined && w !== 1) key.w = w;
  if (h !== undefined && h !== 1) key.h = h;
  if (finger !== undefined) key.finger = finger;
  return key;
};

const F_FINGERS = [1, 2, 2, 3, 6, 6, 7, 7, 8, 8, 9, 9];

/** Full-size function row: Esc, gap, F1–F4, F5–F8, F9–F12 in groups. */
function functionRow(): KeyDef[] {
  const xs = [2, 3, 4, 5, 6.5, 7.5, 8.5, 9.5, 11, 12, 13, 14];
  return [k("Escape", "Esc", 0, 0, 0), ...xs.map((x, i) => k(`F${i + 1}`, `F${i + 1}`, x, 0, F_FINGERS[i]))];
}

/** Navigation cluster of a TKL/full-size board, starting at x0. */
function navCluster(x0: number): KeyDef[] {
  return [
    k("PrintScreen", "PrtSc", x0, 0, 7),
    k("ScrollLock", "ScrLk", x0 + 1, 0, 8),
    k("Pause", "Pause", x0 + 2, 0, 9),
    k("Insert", "Ins", x0, 1.25, 7),
    k("Home", "Home", x0 + 1, 1.25, 8),
    k("PageUp", "PgUp", x0 + 2, 1.25, 9),
    k("Delete", "Del", x0, 2.25, 7),
    k("End", "End", x0 + 1, 2.25, 8),
    k("PageDown", "PgDn", x0 + 2, 2.25, 9),
    k("ArrowUp", "↑", x0 + 1, 4.25, 8),
    k("ArrowLeft", "←", x0, 5.25, 7),
    k("ArrowDown", "↓", x0 + 1, 5.25, 8),
    k("ArrowRight", "→", x0 + 2, 5.25, 9),
  ];
}

function numpad(x0: number): KeyDef[] {
  return [
    k("NumLock", "Num", x0, 1.25, 6),
    k("NumpadDivide", "/", x0 + 1, 1.25, 7),
    k("NumpadMultiply", "*", x0 + 2, 1.25, 8),
    k("NumpadSubtract", "-", x0 + 3, 1.25, 9),
    k("Numpad7", "7", x0, 2.25, 6),
    k("Numpad8", "8", x0 + 1, 2.25, 7),
    k("Numpad9", "9", x0 + 2, 2.25, 8),
    k("NumpadAdd", "+", x0 + 3, 2.25, 9, 1, 2),
    k("Numpad4", "4", x0, 3.25, 6),
    k("Numpad5", "5", x0 + 1, 3.25, 7),
    k("Numpad6", "6", x0 + 2, 3.25, 8),
    k("Numpad1", "1", x0, 4.25, 6),
    k("Numpad2", "2", x0 + 1, 4.25, 7),
    k("Numpad3", "3", x0 + 2, 4.25, 8),
    k("NumpadEnter", "Enter", x0 + 3, 4.25, 9, 1, 2),
    k("Numpad0", "0", x0, 5.25, 5, 2),
    k("NumpadDecimal", ".", x0 + 2, 5.25, 8),
  ];
}

/** Bottom row of 65%/75% boards: 1u right modifiers + arrows. */
const COMPACT_MOD_ROW: Row = [
  ["ControlLeft", "Ctrl", 1.25, 0], ["MetaLeft", "Win", 1.25, 4], ["AltLeft", "Alt", 1.25, 4], ["Space", "", 6.25, 5],
  ["AltRight", "Alt", 1, 5], ["Fn", "Fn", 1, 9], ["ControlRight", "Ctrl", 1, 9],
  ["ArrowLeft", "←", 1, 7], ["ArrowDown", "↓", 1, 8], ["ArrowRight", "→", 1, 9],
];

/** 65%/75% alpha block with a right-hand column (y0 = number row). */
function compactBlock(y0: number, numRow: Row, right: [string, string][]): KeyDef[] {
  return [
    ...row(y0, [...numRow, [right[0][0], right[0][1], 1, 9]]),
    ...row(y0 + 1, [["Tab", "Tab", 1.5, 0], ...TOP_ROW_LETTERS, ["Backslash", "\\", 1.5, 9], [right[1][0], right[1][1], 1, 9]]),
    ...row(y0 + 2, [["CapsLock", "Caps", 1.75, 0], ...HOME_ROW_LETTERS, ["Enter", "Enter", 2.25, 9], [right[2][0], right[2][1], 1, 9]]),
    ...row(y0 + 3, [["ShiftLeft", "Shift", 2.25, 0], ...BOTTOM_ROW_LETTERS, ["ShiftRight", "Shift", 1.75, 9], ["ArrowUp", "↑", 1, 8], [right[3][0], right[3][1], 1, 9]]),
    ...row(y0 + 4, COMPACT_MOD_ROW),
  ];
}

export const ANSI_65: Layout = {
  id: "ansi-65",
  name: "65% ANSI",
  standard: "ansi",
  keys: compactBlock(0, NUM_ROW, [["Delete", "Del"], ["PageUp", "PgUp"], ["PageDown", "PgDn"], ["End", "End"]]),
};

export const ANSI_75: Layout = {
  id: "ansi-75",
  name: "75% ANSI",
  standard: "ansi",
  keys: [
    k("Escape", "Esc", 0, 0, 0),
    ...[1.25, 2.25, 3.25, 4.25, 5.5, 6.5, 7.5, 8.5, 9.75, 10.75, 11.75, 12.75].map((x, i) => k(`F${i + 1}`, `F${i + 1}`, x, 0, F_FINGERS[i])),
    k("PrintScreen", "PrtSc", 14, 0, 9),
    k("Delete", "Del", 15, 0, 9),
    ...compactBlock(1.25, BQ_NUM_ROW, [["Home", "Home"], ["PageUp", "PgUp"], ["PageDown", "PgDn"], ["End", "End"]]),
  ],
};

export const ANSI_TKL: Layout = {
  id: "ansi-tkl",
  name: "TKL ANSI",
  standard: "ansi",
  keys: [...functionRow(), ...alphaBlock(1.25, false, BQ_NUM_ROW), ...navCluster(15.25)],
};

export const ISO_TKL: Layout = {
  id: "iso-tkl",
  name: "TKL ISO",
  standard: "iso",
  keys: [...functionRow(), ...alphaBlock(1.25, true, BQ_NUM_ROW), ...navCluster(15.25)],
};

export const ANSI_100: Layout = {
  id: "ansi-100",
  name: "Full-size ANSI",
  standard: "ansi",
  keys: [...ANSI_TKL.keys, ...numpad(18.5)],
};

export const ISO_100: Layout = {
  id: "iso-100",
  name: "Full-size ISO",
  standard: "iso",
  keys: [...ISO_TKL.keys, ...numpad(18.5)],
};

export const TEMPLATES: Record<string, { layout: Layout; size: { w: number; h: number } }> = {
  "ansi-60": { layout: ANSI_60, size: { w: 15, h: 5 } },
  "iso-60": { layout: ISO_60, size: { w: 15, h: 5 } },
  "ansi-65": { layout: ANSI_65, size: { w: 16, h: 5 } },
  "ansi-75": { layout: ANSI_75, size: { w: 16, h: 6.25 } },
  "ansi-tkl": { layout: ANSI_TKL, size: { w: 18.25, h: 6.25 } },
  "iso-tkl": { layout: ISO_TKL, size: { w: 18.25, h: 6.25 } },
  "ansi-100": { layout: ANSI_100, size: { w: 22.5, h: 6.25 } },
  "iso-100": { layout: ISO_100, size: { w: 22.5, h: 6.25 } },
};

export function getTemplate(id: string) {
  return TEMPLATES[id] ?? TEMPLATES["ansi-60"];
}

// ---------------------------------------------------------------------------
// Locale legends
// ---------------------------------------------------------------------------

/**
 * Printed legends of national layouts, applied on top of a template. Positions and codes stay
 * the same: `KeyboardEvent.code` names the physical key, not the character it types.
 * Spanish layouts are ISO; apply them to an iso-* template.
 */
export const LOCALE_OVERLAYS: Record<string, { name: string; labels: Record<string, string> }> = {
  "en-US": { name: "English (US)", labels: {} },
  "es-ES": {
    name: "Español (España)",
    labels: {
      Backquote: "º",
      Minus: "'",
      Equal: "¡",
      BracketLeft: "`",
      BracketRight: "+",
      Semicolon: "Ñ",
      Quote: "´",
      Backslash: "Ç",
      IntlBackslash: "<",
      Slash: "-",
      AltRight: "Alt Gr",
      CapsLock: "Bloq Mayús",
      ShiftLeft: "Mayús",
      ShiftRight: "Mayús",
      Enter: "Intro",
      Delete: "Supr",
      Home: "Inicio",
      End: "Fin",
      PageUp: "RePág",
      PageDown: "AvPág",
      PrintScreen: "ImpPnt",
      ScrollLock: "Bloq Despl",
      NumLock: "Bloq Num",
      Pause: "Pausa",
    },
  },
  "es-LA": {
    name: "Español (Latinoamérica)",
    labels: {
      Backquote: "|",
      Minus: "'",
      Equal: "¿",
      BracketLeft: "´",
      BracketRight: "+",
      Semicolon: "Ñ",
      Quote: "{",
      Backslash: "}",
      IntlBackslash: "<",
      Slash: "-",
      AltRight: "Alt Gr",
      CapsLock: "Bloq Mayús",
      ShiftLeft: "Mayús",
      ShiftRight: "Mayús",
      Enter: "Intro",
      Delete: "Supr",
      Home: "Inicio",
      End: "Fin",
      PageUp: "RePág",
      PageDown: "AvPág",
      PrintScreen: "ImpPnt",
      ScrollLock: "Bloq Despl",
      NumLock: "Bloq Num",
      Pause: "Pausa",
    },
  },
};

/** Copy of `layout` with the printed legends of `locale` ("es-ES", "es-LA"…). */
export function applyLocale(layout: Layout, locale: string): Layout {
  const overlay = LOCALE_OVERLAYS[locale];
  if (!overlay) return layout;
  return {
    ...layout,
    id: `${layout.id}-${locale.toLowerCase()}`,
    name: `${layout.name} · ${overlay.name}`,
    keys: layout.keys.map((key) => (overlay.labels[key.code] ? { ...key, label: overlay.labels[key.code] } : key)),
  };
}


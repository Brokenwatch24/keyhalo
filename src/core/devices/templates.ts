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

export const TEMPLATES: Record<string, { layout: Layout; size: { w: number; h: number } }> = {
  "ansi-60": { layout: ANSI_60, size: { w: 15, h: 5 } },
  "iso-60": { layout: ISO_60, size: { w: 15, h: 5 } },
};

export function getTemplate(id: string) {
  return TEMPLATES[id] ?? TEMPLATES["ansi-60"];
}

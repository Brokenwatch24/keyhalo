/**
 * Windows virtual-key codes → W3C `KeyboardEvent.code` (US positional naming).
 * Used to map LampArray lamps (which report the VKs bound to them) onto KeyHalo keys.
 * Source: Microsoft "Virtual-Key Codes" documentation (winuser.h).
 */
export const VK_TO_CODE: Record<number, string> = {
  0x08: "Backspace",
  0x09: "Tab",
  0x0d: "Enter",
  0x10: "ShiftLeft",
  0x11: "ControlLeft",
  0x12: "AltLeft",
  0x13: "Pause",
  0x14: "CapsLock",
  0x1b: "Escape",
  0x20: "Space",
  0x21: "PageUp",
  0x22: "PageDown",
  0x23: "End",
  0x24: "Home",
  0x25: "ArrowLeft",
  0x26: "ArrowUp",
  0x27: "ArrowRight",
  0x28: "ArrowDown",
  0x2c: "PrintScreen",
  0x2d: "Insert",
  0x2e: "Delete",
  0x5b: "MetaLeft",
  0x5c: "MetaRight",
  0x5d: "ContextMenu",
  0x60: "Numpad0",
  0x61: "Numpad1",
  0x62: "Numpad2",
  0x63: "Numpad3",
  0x64: "Numpad4",
  0x65: "Numpad5",
  0x66: "Numpad6",
  0x67: "Numpad7",
  0x68: "Numpad8",
  0x69: "Numpad9",
  0x6a: "NumpadMultiply",
  0x6b: "NumpadAdd",
  0x6c: "NumpadComma",
  0x6d: "NumpadSubtract",
  0x6e: "NumpadDecimal",
  0x6f: "NumpadDivide",
  0x90: "NumLock",
  0x91: "ScrollLock",
  0xa0: "ShiftLeft",
  0xa1: "ShiftRight",
  0xa2: "ControlLeft",
  0xa3: "ControlRight",
  0xa4: "AltLeft",
  0xa5: "AltRight",
  0xad: "AudioVolumeMute",
  0xae: "AudioVolumeDown",
  0xaf: "AudioVolumeUp",
  0xb0: "MediaTrackNext",
  0xb1: "MediaTrackPrevious",
  0xb2: "MediaStop",
  0xb3: "MediaPlayPause",
  0xba: "Semicolon",
  0xbb: "Equal",
  0xbc: "Comma",
  0xbd: "Minus",
  0xbe: "Period",
  0xbf: "Slash",
  0xc0: "Backquote",
  0xdb: "BracketLeft",
  0xdc: "Backslash",
  0xdd: "BracketRight",
  0xde: "Quote",
  0xe2: "IntlBackslash",
  0xc1: "IntlRo",
  0xff: "Fn",
};
for (let i = 0; i <= 9; i++) VK_TO_CODE[0x30 + i] = `Digit${i}`;
for (let i = 0; i < 26; i++) VK_TO_CODE[0x41 + i] = `Key${String.fromCharCode(65 + i)}`;
for (let i = 0; i < 24; i++) VK_TO_CODE[0x70 + i] = `F${i + 1}`;

/** Codes that exist twice on a keyboard: the second occurrence (rightmost) gets this code. */
const SECOND: Record<string, string> = {
  Enter: "NumpadEnter",
  ShiftLeft: "ShiftRight",
  ControlLeft: "ControlRight",
  AltLeft: "AltRight",
  MetaLeft: "MetaRight",
};

/** Short legend for a code ("KeyA" → "A", "Digit1" → "1", "ArrowUp" → "↑"). */
export function legendFor(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  const map: Record<string, string> = {
    Escape: "Esc", Backspace: "Backspace", Tab: "Tab", Enter: "Enter", NumpadEnter: "Enter", CapsLock: "Caps",
    ShiftLeft: "Shift", ShiftRight: "Shift", ControlLeft: "Ctrl", ControlRight: "Ctrl", AltLeft: "Alt", AltRight: "Alt",
    MetaLeft: "Win", MetaRight: "Win", ContextMenu: "Menu", Space: "", Minus: "-", Equal: "=", BracketLeft: "[",
    BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Backquote: "`", Comma: ",", Period: ".", Slash: "/",
    IntlBackslash: "\\", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", PageUp: "PgUp", PageDown: "PgDn",
    Home: "Home", End: "End", Insert: "Ins", Delete: "Del", PrintScreen: "PrtSc", ScrollLock: "ScrLk", Pause: "Pause",
    NumLock: "Num", NumpadAdd: "+", NumpadSubtract: "-", NumpadMultiply: "*", NumpadDivide: "/", NumpadDecimal: ".",
    AudioVolumeMute: "Mute", AudioVolumeDown: "Vol-", AudioVolumeUp: "Vol+", MediaPlayPause: "Play", MediaTrackNext: "Next",
    MediaTrackPrevious: "Prev", MediaStop: "Stop", Fn: "Fn",
  };
  return map[code] ?? code;
}

/**
 * Map a list of lamps (VKs + x position) to unique codes. Duplicate VKs (generic Shift/Enter…)
 * are disambiguated by position: the rightmost occurrence takes the "right"/numpad code.
 */
export function assignCodes(lamps: { index: number; x: number; virtualKeys?: number[] }[]): Map<number, string> {
  const out = new Map<number, string>();
  const byCode = new Map<string, { index: number; x: number }[]>();
  for (const l of lamps) {
    const vk = l.virtualKeys?.find((v) => VK_TO_CODE[v]);
    if (vk === undefined) continue;
    const code = VK_TO_CODE[vk];
    let list = byCode.get(code);
    if (!list) byCode.set(code, (list = []));
    list.push({ index: l.index, x: l.x });
  }
  for (const [code, list] of byCode) {
    list.sort((a, b) => a.x - b.x);
    list.forEach((l, i) => {
      if (i === 0) out.set(l.index, code);
      else if (i === 1 && SECOND[code]) out.set(l.index, SECOND[code]);
      else out.set(l.index, `${code}#${i + 1}`);
    });
  }
  return out;
}

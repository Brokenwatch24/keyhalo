import type { KeyCode, KeyDef, RGB } from "../types";
import { strokeFor, type KeyLocale } from "./charmap";
import { FINGER_COLORS, scaleRgb } from "./progress";

/**
 * Which keys to highlight for the next character: the key itself, the Shift on the opposite
 * hand, AltGr, and — for accented letters — the dead key first, then the base letter.
 */
export interface Guidance {
  /** Press now. */
  primary: KeyCode[];
  /** Hold together with the primary key (Shift/AltGr). */
  modifiers: KeyCode[];
  /** After the primary press (the base letter of a dead-key combo). */
  then: KeyCode[];
}

function isLeftHand(code: KeyCode, keys: KeyDef[]): boolean {
  const k = keys.find((x) => x.code === code);
  if (k?.finger !== undefined) return k.finger <= 4;
  return (k?.x ?? 0) < 7;
}

export function guidanceFor(ch: string | undefined, locale: KeyLocale, keys: KeyDef[], deadPressed = false): Guidance {
  const g: Guidance = { primary: [], modifiers: [], then: [] };
  if (ch === undefined) return g;
  const s = strokeFor(ch, locale);
  if (!s) return g;
  const shiftFor = (code: KeyCode) => (isLeftHand(code, keys) ? "ShiftRight" : "ShiftLeft");
  if (s.dead && !deadPressed) {
    g.primary.push(s.dead.code);
    if (s.dead.shift) g.modifiers.push(shiftFor(s.dead.code));
    g.then.push(s.code);
    return g;
  }
  g.primary.push(s.code);
  if (s.shift) g.modifiers.push(shiftFor(s.code));
  if (s.altGr) g.modifiers.push("AltRight");
  return g;
}

export const OVERLAY_NEXT: RGB = [255, 255, 255];
export const OVERLAY_MOD: RGB = [150, 150, 160];
export const OVERLAY_THEN: RGB = [70, 70, 78];
export const OVERLAY_ERROR: RGB = [239, 68, 68];

/** Physical-keyboard overlay for the current state of a typing session. */
export function overlayColors(g: Guidance, opts: { keys: KeyDef[]; fingerGuide: boolean; errors: KeyCode[] }): Record<KeyCode, RGB> {
  const colors: Record<KeyCode, RGB> = {};
  if (opts.fingerGuide) {
    // Home row only, dimmed, so the next-key highlight stays the brightest thing.
    for (const code of ["KeyA", "KeyS", "KeyD", "KeyF", "KeyJ", "KeyK", "KeyL", "Semicolon"]) {
      const k = opts.keys.find((x) => x.code === code);
      if (k?.finger !== undefined) colors[code] = scaleRgb(FINGER_COLORS[k.finger], 0.35);
    }
  }
  for (const c of g.then) colors[c] = OVERLAY_THEN;
  for (const c of g.modifiers) colors[c] = OVERLAY_MOD;
  for (const c of g.primary) colors[c] = OVERLAY_NEXT;
  for (const c of opts.errors) colors[c] = OVERLAY_ERROR;
  return colors;
}

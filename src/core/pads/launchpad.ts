import type { PadButtonId } from "./types";

/**
 * Novation Launchpad S protocol (also the original Launchpad / Launchpad Mini):
 *  - Grid pads and the right column are notes: note = 16 × row + column (column 8 = right).
 *  - The top round buttons are CC 104–111.
 *  - LED colour = velocity 16 × green + red + 12 (levels 0–3 each; +12 = "normal" flags).
 *  - B0 00 00 resets every LED.
 * Presses arrive as note-on / CC with velocity 127, releases with 0 (or note-off).
 */

export const GRID = 8;

export const grid = (x: number, y: number): PadButtonId => `g:${x},${y}`;
export const top = (i: number): PadButtonId => `t:${i}`;
export const right = (i: number): PadButtonId => `r:${i}`;

/** Every button id: 8 top, 64 grid (row by row), 8 right. */
export const ALL_BUTTONS: PadButtonId[] = [
  ...Array.from({ length: GRID }, (_, i) => top(i)),
  ...Array.from({ length: GRID * GRID }, (_, i) => grid(i % GRID, Math.floor(i / GRID))),
  ...Array.from({ length: GRID }, (_, i) => right(i)),
];

/** Printed names of the round buttons (Launchpad S). */
export const TOP_NAMES = ["▲", "▼", "◀", "▶", "Session", "User 1", "User 2", "Mixer"];
export const RIGHT_NAMES = ["Vol", "Pan", "Snd A", "Snd B", "Stop", "Trk On", "Solo", "Arm"];

export function parseButton(id: PadButtonId): { kind: "g" | "t" | "r"; x: number; y: number } | null {
  const m = /^([gtr]):(\d)(?:,(\d))?$/.exec(id);
  if (!m) return null;
  const kind = m[1] as "g" | "t" | "r";
  if (kind === "g") return { kind, x: Number(m[2]), y: Number(m[3]) };
  return kind === "t" ? { kind, x: Number(m[2]), y: -1 } : { kind, x: GRID, y: Number(m[2]) };
}

/** A press or release from raw MIDI bytes, or null for anything else. */
export function decode(data: number[]): { id: PadButtonId; down: boolean } | null {
  const [status, d1, d2 = 0] = data;
  if (status === undefined || d1 === undefined) return null;
  const kind = status & 0xf0;
  if (kind === 0x90 || kind === 0x80) {
    const row = d1 >> 4;
    const col = d1 & 0x0f;
    if (row >= GRID || col > GRID) return null;
    return { id: col === GRID ? right(row) : grid(col, row), down: kind === 0x90 && d2 > 0 };
  }
  if (kind === 0xb0 && d1 >= 104 && d1 <= 111) return { id: top(d1 - 104), down: d2 > 0 };
  return null;
}

/** Red/green levels 0..3 for a hex colour (blue has no LED: blue-ish colours become dim amber). */
export function levels(hex: string, brightness = 1): { r: number; g: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0 };
  const n = parseInt(m[1], 16);
  let R = (n >> 16) & 255;
  let G = (n >> 8) & 255;
  const B = n & 255;
  if (B > Math.max(R, G) && B > 60) {
    // No blue LED: keep blue-ish colours visible as a soft amber.
    R = Math.max(R, B * 0.5);
    G = Math.max(G, B * 0.5);
  }
  const k = Math.max(0, Math.min(1, brightness));
  const fr = (R / 255) * 3;
  const fg = (G / 255) * 3;
  const max = Math.max(fr, fg);
  if (k === 0 || max < 0.3) return { r: 0, g: 0 };
  // A channel counts only when it matters to the hue (green #3ccf4e stays green, orange keeps
  // its green), and a channel that counts never dims all the way to off.
  const ch = (f: number) => (f < 0.4 * max ? 0 : Math.max(1, Math.round(f * k)));
  return { r: ch(fr), g: ch(fg) };
}

/** The colour a Launchpad S actually shows for a hex colour (for on-screen previews). */
export function previewColor(hex: string, brightness = 1): string {
  const { r, g } = levels(hex, brightness);
  if (!r && !g) return "#2a2a2e";
  const R = [0, 140, 200, 255][r];
  const G = [0, 140, 200, 255][g];
  return `#${R.toString(16).padStart(2, "0")}${G.toString(16).padStart(2, "0")}00`;
}

/** MIDI message that sets one button's LED. */
export function ledMessage(id: PadButtonId, hex: string, brightness = 1): number[] | null {
  const b = parseButton(id);
  if (!b) return null;
  const { r, g } = levels(hex, brightness);
  const velocity = 16 * g + r + 12;
  if (b.kind === "t") return [0xb0, 104 + b.x, velocity];
  return [0x90, 16 * b.y + b.x, velocity];
}

export const RESET: number[] = [0xb0, 0, 0];

/** Port names that look like a Launchpad (S, Mini, original). */
export const isLaunchpadPort = (name: string) => /launchpad/i.test(name);

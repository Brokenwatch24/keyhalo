import type { KeymapPack, ModifierName, RGB } from "@/core/types";
import { comboFromBinding, comboFromKeys, hexToRgb, isModifierCode, sortMods } from "./codes";

const sameMods = (a: ModifierName[], b: ModifierName[]) => a.length === b.length && a.every((m, i) => m === b[i]);

export interface LegendColorOptions {
  /** Also light combos that need *more* modifiers than held (Ctrl held → Ctrl+Shift+X too). Default false. */
  includeSupersets?: boolean;
  /** Colour for the held modifier keys themselves. Default soft white; null = leave unlit. */
  modifierColor?: RGB | null;
}

/**
 * Key colours for the shortcut cheat-sheet: every key whose legend (or labelled binding)
 * needs exactly the held modifiers, coloured by its category. Packs earlier in the list win
 * (pass the app pack before global packs). With no modifiers held, returns the plain-key legends
 * (e.g. Blender's G/R/S or the Tactical FPS movement keys).
 */
export function legendColorsFor(
  pack: KeymapPack | KeymapPack[],
  heldModifiers: Iterable<ModifierName>,
  opts: LegendColorOptions = {},
): Record<string, RGB> {
  const held = sortMods(heldModifiers);
  const packs = Array.isArray(pack) ? pack : [pack];
  const colors: Record<string, RGB> = {};
  const matches = (mods: ModifierName[]) =>
    opts.includeSupersets ? held.every((m) => mods.includes(m)) && mods.length >= held.length : sameMods(mods, held);

  for (const p of packs) {
    const colorOf = (cat?: string) => (cat && p.categories[cat] ? hexToRgb(p.categories[cat]) : null);
    for (const l of p.legends) {
      const c = comboFromKeys(l.keys);
      if (!c || !matches(c.mods) || colors[c.key]) continue;
      const rgb = colorOf(l.category);
      if (rgb) colors[c.key] = rgb;
    }
    for (const b of p.bindings) {
      if (!b.category) continue;
      const c = comboFromBinding(b);
      if (!matches(c.mods) || colors[c.key]) continue;
      const rgb = colorOf(b.category);
      if (rgb) colors[c.key] = rgb;
    }
  }

  const modColor = opts.modifierColor === undefined ? ([235, 235, 235] as RGB) : opts.modifierColor;
  if (modColor && held.length) {
    const codes: Record<ModifierName, string[]> = {
      Ctrl: ["ControlLeft", "ControlRight"],
      Shift: ["ShiftLeft", "ShiftRight"],
      Alt: ["AltLeft", "AltRight"],
      Meta: ["MetaLeft", "MetaRight"],
    };
    for (const m of held) for (const code of codes[m]) colors[code] = modColor;
  }
  return colors;
}

/** Colours for the keys bound on a layer (for lighting while the layer is active). */
export function layerColorsFor(pack: KeymapPack, layerId: string, fallback: RGB = [255, 255, 255]): Record<string, RGB> {
  const layer = pack.layers?.find((l) => l.id === layerId);
  const out: Record<string, RGB> = {};
  for (const b of layer?.bindings ?? []) {
    if (isModifierCode(b.key) && b.with?.length) continue;
    out[b.key] = b.category && pack.categories[b.category] ? hexToRgb(pack.categories[b.category]) : fallback;
  }
  return out;
}

/** Number of non-modifier keys the cheat-sheet would light. */
export function countLit(colors: Record<string, RGB>): number {
  return Object.keys(colors).filter((k) => !isModifierCode(k)).length;
}

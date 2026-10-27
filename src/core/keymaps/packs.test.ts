import { describe, expect, it } from "vitest";
import type { KeyAction, KeymapPack } from "@/core/types";
import { comboFromKeys, comboId, isModifierCode, isValidKeyCode, isValidTrigger } from "./codes";
import { riskyActions, validatePack } from "./validate";
import { findConflicts } from "./conflicts";

// Loaded the same way the app bundles them (raw files, no validation filter).
const modules = import.meta.glob<KeymapPack>("/community/keymaps/*.json", { eager: true, import: "default" });
const packs = Object.entries(modules).map(([path, pack]) => [path.split("/").pop()!, pack] as const);

function actionKeys(a: KeyAction): string[] {
  if (a.type === "key") return a.keys;
  if (a.type === "tapHold") return [...actionKeys(a.tap), ...actionKeys(a.hold)];
  if (a.type === "macro") return a.steps.flatMap((s) => ("key" in s ? [s.key] : []));
  return [];
}

describe("bundled keymap packs", () => {
  it("ships all bundled packs", () => {
    const ids = packs.map(([, p]) => p.id);
    for (const id of ["vscode", "davinci-resolve", "premiere-pro", "blender", "figma", "photoshop", "excel", "obs-studio", "discord", "chrome", "windows-essentials", "sixty-percent-nav", "tactical-fps"])
      expect(ids).toContain(id);
  });

  it.each(packs)("%s is a valid KeymapPack", (file, pack) => {
    expect(validatePack(pack)).toEqual([]);
    expect(pack.id).toBe(file.replace(/\.json$/, ""));
    expect(Array.isArray(pack.apps)).toBe(true);
    for (const c of Object.values(pack.categories)) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(packs)("%s only uses valid KeyboardEvent.code names", (_f, pack) => {
    const seen = new Set<string>();
    for (const l of pack.legends) {
      for (const k of l.keys) expect(isValidKeyCode(k), `${k} in legend "${l.label}"`).toBe(true);
      expect(pack.categories[l.category], `category ${l.category}`).toBeDefined();
      const nonMods = l.keys.filter((k) => !isModifierCode(k));
      expect(nonMods.length, `legend "${l.label}"`).toBeLessThanOrEqual(1);
      if (nonMods.length) expect(l.keys[l.keys.length - 1]).toBe(nonMods[0]);
      const id = comboId(comboFromKeys(l.keys)!);
      expect(seen.has(id), `duplicate legend ${id}`).toBe(false);
      seen.add(id);
    }
    const bindings = [...pack.bindings, ...(pack.layers ?? []).flatMap((l) => l.bindings)];
    for (const b of bindings) {
      expect(isValidTrigger(b.key), b.key).toBe(true);
      for (const k of actionKeys(b.action)) expect(isValidKeyCode(k), k).toBe(true);
      if (b.category) expect(pack.categories[b.category]).toBeDefined();
    }
  });

  it.each(packs)("%s has no error-level conflicts or risky actions", (_f, pack) => {
    expect(findConflicts(pack).filter((c) => c.severity === "error")).toEqual([]);
    expect(riskyActions(pack)).toEqual([]);
  });

  it("ships a legend-only (anti-cheat safe) Tactical FPS pack for Rainbow Six", () => {
    const fps = packs.find(([, p]) => p.id === "tactical-fps")![1];
    expect(fps.apps).toEqual(["RainbowSix.exe"]);
    expect(fps.bindings).toEqual([]);
    expect(fps.layers ?? []).toEqual([]);
  });

  it("ships the 60% navigation layer pack", () => {
    const nav = packs.find(([, p]) => p.id === "sixty-percent-nav")![1];
    expect(nav.apps).toEqual([]);
    expect(nav.bindings[0].key).toBe("CapsLock");
    expect(nav.bindings[0].action.type).toBe("tapHold");
    const layer = nav.layers!.find((l) => l.id === "nav")!;
    const map = Object.fromEntries(layer.bindings.map((b) => [b.key, b.action.type === "key" ? b.action.keys.join("+") : ""]));
    expect(map).toMatchObject({ KeyI: "ArrowUp", KeyJ: "ArrowLeft", KeyK: "ArrowDown", KeyL: "ArrowRight", KeyU: "Home", KeyO: "End" });
  });
});

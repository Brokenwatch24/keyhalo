import { describe, expect, it } from "vitest";
import type { KeymapPack, Layout } from "@/core/types";
import { findConflicts, isCompactLayout } from "./conflicts";

const pack: KeymapPack = {
  id: "t",
  name: "Test",
  apps: ["Code.exe"],
  categories: { Edit: "#ffffff" },
  legends: [{ keys: ["ControlLeft", "KeyB"], label: "Toggle sidebar", category: "Edit" }],
  bindings: [
    { key: "KeyB", with: ["Ctrl"], action: { type: "text", text: "hi" } },
    { key: "F5", action: { type: "key", keys: ["F6"] } },
    { key: "F5", action: { type: "key", keys: ["F7"] } },
    { key: "Delete", with: ["Ctrl", "Alt"], action: { type: "disabled" } },
    { key: "Tab", with: ["Alt"], action: { type: "key", keys: ["KeyA"] } },
    { key: "KeyL", with: ["Meta"], action: { type: "key", keys: ["KeyA"] } },
    { key: "ArrowUp", action: { type: "key", keys: ["KeyW"] } },
    { key: "KeyQ", action: { type: "layer", layer: "missing", mode: "hold" } },
    { key: "NotAKey", action: { type: "disabled" } },
  ],
  layers: [{ id: "fn", name: "Fn", bindings: [{ key: "KeyB", with: ["Ctrl"], action: { type: "key", keys: ["KeyC"] } }] }],
};

const sixty: Layout = {
  id: "60",
  name: "60%",
  standard: "ansi",
  keys: ["Escape", "KeyQ", "KeyB", "KeyL", "Tab", "Delete", "ControlLeft"].map((code, i) => ({ code, label: code, x: i, y: 0 })),
  fnLayer: { Digit5: "F5" },
};

describe("findConflicts", () => {
  const list = findConflicts(pack, { layout: sixty, keyboardName: "Mini" });
  const kinds = (k: string) => list.filter((c) => c.kind === k);

  it("flags bindings that replace the app's own shortcuts (base layer only)", () => {
    expect(kinds("appShortcut")).toHaveLength(1);
    expect(kinds("appShortcut")[0].params.shortcut).toBe("Toggle sidebar");
    expect(kinds("appShortcut")[0].combo).toBe("Ctrl+B");
  });

  it("flags duplicates", () => {
    expect(kinds("duplicate").map((c) => c.combo)).toEqual(["F5"]);
  });

  it("flags OS-reserved combos with severity", () => {
    const os = kinds("osReserved");
    expect(os.map((c) => c.combo).sort()).toEqual(["Alt+Tab", "Ctrl+Alt+Del", "Win+L"].sort());
    expect(os.find((c) => c.combo === "Win+L")!.severity).toBe("error");
    expect(os.find((c) => c.combo === "Alt+Tab")!.severity).toBe("warning");
  });

  it("flags keys missing on a 60% board and suggests a layer", () => {
    const missing = kinds("missingKey");
    expect(missing.map((c) => c.binding.key)).toEqual(["ArrowUp"]);
    expect(missing[0].suggestionKey).toBe("keymaps.suggestions.useLayer");
    expect(kinds("fnOnly").map((c) => c.params.base)).toEqual(["5", "5"]);
  });

  it("flags unknown layers and invalid keys", () => {
    expect(kinds("unknownLayer")[0].params.layer).toBe("missing");
    expect(kinds("invalidKey")[0].params.key).toBe("NotAKey");
  });

  it("detects compact layouts", () => {
    expect(isCompactLayout(sixty)).toBe(true);
  });

  it("returns nothing for a clean pack without a layout", () => {
    expect(findConflicts({ ...pack, legends: [], bindings: [{ key: "F13", action: { type: "key", keys: ["F14"] } }], layers: [] })).toEqual([]);
  });
});

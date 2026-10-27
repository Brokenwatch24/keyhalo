import { describe, expect, it } from "vitest";
import type { KeymapPack } from "@/core/types";
import { exportKanata, kanataKey } from "./kanata";
import { exportAutoHotkey } from "./ahk";

const pack: KeymapPack = {
  id: "nav",
  name: "60% Nav",
  apps: [],
  categories: {},
  legends: [],
  bindings: [
    { key: "CapsLock", action: { type: "tapHold", tap: { type: "key", keys: ["Escape"] }, hold: { type: "layer", layer: "nav", mode: "hold" }, termMs: 180 } },
    {
      key: "F13",
      action: {
        type: "macro",
        steps: [
          { op: "down", key: "ControlLeft" },
          { op: "tap", key: "KeyC" },
          { op: "up", key: "ControlLeft" },
          { op: "delay", ms: 50 },
          { op: "text", text: "Hi!" },
        ],
      },
    },
    { key: "KeyB", with: ["Ctrl"], action: { type: "key", keys: ["ControlLeft", "ShiftLeft", "KeyZ"] } },
    { key: "F14", action: { type: "layer", layer: "num", mode: "toggle" } },
    { key: "F15", action: { type: "launch", path: "calc.exe" } },
    { key: "Mouse4", action: { type: "dpi", mode: "sniper", value: 400 } },
  ],
  layers: [
    {
      id: "nav",
      name: "Navigation",
      bindings: [
        { key: "KeyI", action: { type: "key", keys: ["ArrowUp"] } },
        { key: "KeyL", action: { type: "key", keys: ["ArrowRight"] } },
      ],
    },
    { id: "num", name: "Numpad", bindings: [{ key: "KeyJ", action: { type: "key", keys: ["Digit4"] } }] },
  ],
};

describe("Kanata export", () => {
  const { text, warnings } = exportKanata(pack);

  it("maps key names", () => {
    expect(kanataKey("CapsLock")).toBe("caps");
    expect(kanataKey("ArrowRight")).toBe("rght");
    expect(kanataKey("Backquote")).toBe("grv");
    expect(kanataKey("Numpad7")).toBe("kp7");
    expect(kanataKey("BrowserBack")).toBeNull();
  });

  it("emits defsrc with every trigger key and one deflayer per layer", () => {
    expect(text).toContain("(defsrc\n  caps f13 b f14 f15 i l j\n)");
    expect(text).toContain("(deflayer nav\n  _ _ _ _ _ up rght _\n)");
    expect(text).toContain("(deflayer num\n  _ _ _ @num-f14 _ _ _ 4\n)");
  });

  it("exports tap-hold, macros, forks and toggle layers through aliases", () => {
    expect(text).toContain("(tap-hold 180 180 esc (layer-while-held nav))");
    expect(text).toContain("(macro C-c 50 S-h i S-1)");
    expect(text).toContain("(fork b C-S-z (lctl rctl))");
    expect(text).toContain("(layer-switch num)");
    expect(text).toContain("num-f14 (layer-switch base)");
    expect(text).toContain("(deflayer base\n  @base-caps @base-f13 @base-b @base-f14 XX i l j\n)");
  });

  it("reports limitations as warnings and comments", () => {
    expect(warnings.some((w) => w.includes("Launch"))).toBe(true);
    expect(warnings.some((w) => w.includes("Mouse button"))).toBe(true);
    expect(text).toContain(";; NOTE:");
    const code = text.replace(/;;.*$/gm, "");
    expect((code.match(/\(/g) ?? []).length).toBe((code.match(/\)/g) ?? []).length);
  });

  it("warns that app packs become global", () => {
    expect(exportKanata({ ...pack, apps: ["Code.exe"] }).warnings.some((w) => w.includes("per-app"))).toBe(true);
  });
});

describe("AutoHotkey export", () => {
  it("produces a v2 script with app scoping and layers", () => {
    const { text } = exportAutoHotkey({ ...pack, apps: ["Code.exe"] });
    expect(text).toContain("#Requires AutoHotkey v2.0");
    expect(text).toContain('GroupAdd "khApps", "ahk_exe Code.exe"');
    expect(text).toContain("*^b:: {");
    expect(text).toContain('Send "^+{z}"');
    expect(text).toContain('#HotIf WinActive("ahk_group khApps") && khLayer = "nav"');
    expect(text).toContain('Run "calc.exe"');
  });
});

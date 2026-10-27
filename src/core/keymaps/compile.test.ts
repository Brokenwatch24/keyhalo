import { describe, expect, it } from "vitest";
import type { KeymapPack } from "@/core/types";
import { compileRemapConfig, packsForProcess } from "./compile";
import { legendColorsFor, layerColorsFor } from "./legends";

const legendOnly: KeymapPack = {
  id: "resolve",
  name: "Resolve",
  apps: ["Resolve.exe"],
  categories: { Playback: "#ffb454", Edit: "#5aa9ff" },
  legends: [
    { keys: ["KeyJ"], label: "Reverse", category: "Playback" },
    { keys: ["ControlLeft", "KeyB"], label: "Razor", category: "Edit" },
    { keys: ["ControlLeft", "ShiftLeft", "KeyZ"], label: "Redo", category: "Edit" },
  ],
  bindings: [],
};

const nav: KeymapPack = {
  id: "nav",
  name: "Nav",
  apps: [],
  categories: { Arrows: "#7ee0a1" },
  legends: [],
  bindings: [
    { key: "CapsLock", action: { type: "tapHold", tap: { type: "key", keys: ["Escape"] }, hold: { type: "layer", layer: "nav", mode: "hold" } } },
  ],
  layers: [{ id: "nav", name: "Navigation", bindings: [{ key: "KeyI", action: { type: "key", keys: ["ArrowUp"] }, category: "Arrows", label: "Up" }] }],
};

const appRemap: KeymapPack = {
  id: "premiere",
  name: "Premiere",
  apps: ["Adobe Premiere Pro.exe", "adobe premiere pro.exe"],
  categories: {},
  legends: [],
  bindings: [{ key: "F13", with: ["Ctrl"], action: { type: "dpi", mode: "set", value: 400 }, label: "Slow DPI", category: "x" }],
};

describe("compileRemapConfig", () => {
  it("skips legend-only and disabled packs, lowercases apps, app packs first", () => {
    const cfg = compileRemapConfig([nav, legendOnly, appRemap], ["nav", "resolve", "premiere"], {
      remapEnabled: true,
      paused: false,
      pauseApps: ["RainbowSix.exe", "rainbowsix.exe", " VALORANT.exe "],
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.pauseApps).toEqual(["rainbowsix.exe", "valorant.exe"]);
    expect(cfg.packs.map((p) => p.id)).toEqual(["premiere", "nav"]);
    expect(cfg.packs[0].apps).toEqual(["adobe premiere pro.exe"]);
    expect(cfg.packs[0].bindings[0]).toEqual({ key: "F13", with: ["Ctrl"], action: { type: "dpi", mode: "set", value: 400 }, label: "Slow DPI" });
  });

  it("fills the default tapping term and keeps layers", () => {
    const cfg = compileRemapConfig([nav], ["nav"], { remapEnabled: true, paused: false, pauseApps: [] });
    const th = cfg.packs[0].bindings[0].action;
    expect(th.type === "tapHold" && th.termMs).toBe(200);
    expect(cfg.packs[0].layers[0].bindings[0].key).toBe("KeyI");
  });

  it("does not mutate the source packs", () => {
    const before = JSON.stringify(nav);
    compileRemapConfig([nav], ["nav"], { remapEnabled: true, paused: false, pauseApps: [] });
    expect(JSON.stringify(nav)).toBe(before);
  });

  it("is disabled when paused or turned off in settings", () => {
    expect(compileRemapConfig([nav], ["nav"], { remapEnabled: true, paused: true, pauseApps: [] }).enabled).toBe(false);
    expect(compileRemapConfig([nav], ["nav"], { remapEnabled: false, paused: false, pauseApps: [] }).enabled).toBe(false);
  });

  it("excludes packs that are not enabled", () => {
    expect(compileRemapConfig([nav, appRemap], ["premiere"], { remapEnabled: true, paused: false, pauseApps: [] }).packs).toHaveLength(1);
  });
});

describe("active packs and legend colours", () => {
  it("orders app packs before global packs", () => {
    expect(packsForProcess([nav, legendOnly], ["nav", "resolve"], "resolve.EXE").map((p) => p.id)).toEqual(["resolve", "nav"]);
    expect(packsForProcess([nav, legendOnly], ["nav", "resolve"], "chrome.exe").map((p) => p.id)).toEqual(["nav"]);
  });

  it("lights exactly the combos of the held modifiers", () => {
    const ctrl = legendColorsFor(legendOnly, ["Ctrl"]);
    expect(ctrl.KeyB).toEqual([0x5a, 0xa9, 0xff]);
    expect(ctrl.KeyZ).toBeUndefined();
    expect(ctrl.ControlLeft).toBeDefined();
    const none = legendColorsFor(legendOnly, []);
    expect(Object.keys(none)).toEqual(["KeyJ"]);
    const sup = legendColorsFor(legendOnly, ["Ctrl"], { includeSupersets: true, modifierColor: null });
    expect(Object.keys(sup).sort()).toEqual(["KeyB", "KeyZ"]);
  });

  it("lets earlier packs win on the same key", () => {
    const other: KeymapPack = { ...legendOnly, id: "o", categories: { Edit: "#ff0000" } };
    expect(legendColorsFor([legendOnly, other], ["Ctrl"]).KeyB).toEqual([0x5a, 0xa9, 0xff]);
  });

  it("colours layer bindings by category", () => {
    expect(layerColorsFor(nav, "nav")).toEqual({ KeyI: [0x7e, 0xe0, 0xa1] });
  });
});

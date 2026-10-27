import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { backend } from "@/core/backend";
import { emitMock } from "@/core/backend/mock";
import { bus } from "@/core/util/bus";
import { useSignals } from "@/core/lighting/signals";
import { useKeymaps } from "@/core/keymaps/store";
import { init as keymaps } from "@/core/keymaps/init";
import { init as stats } from "@/core/stats/init";
import { init as integrations } from "@/core/integrations/init";
import { useIntegrations } from "@/core/integrations/store";
import { init as automation } from "./init";
import { useRules } from "./store";

/** Boots keymaps, stats, integrations and automation against the MockBackend (browser demo). */
describe("feature init smoke test (mock backend)", () => {
  const remap = vi.spyOn(backend, "remapConfigure");
  const flashes: unknown[] = [];
  const huds: unknown[] = [];

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
    bus.on("lighting:flash", (f) => flashes.push(f));
    bus.on("hud", (h) => huds.push(h));
    await keymaps();
    await stats();
    await integrations();
    await automation();
  });
  afterAll(() => vi.useRealTimers());

  it("pushes a remap config", async () => {
    await vi.advanceTimersByTimeAsync(100);
    expect(remap).toHaveBeenCalled();
    expect(useKeymaps.getState().packs.length).toBeGreaterThanOrEqual(13);
  });

  it("tracks the foreground app and the cheat-sheet overlay", async () => {
    emitMock("foreground-changed", { process: "Code.exe", title: "x", pid: 1 });
    expect(useKeymaps.getState().activePackId).toBe("vscode");
    emitMock("input-key", { code: "ControlLeft", down: true, t: 0 });
    await vi.advanceTimersByTimeAsync(400);
    const overlay = useSignals.getState().overlays.cheatsheet;
    expect(overlay?.exclusive).toBe(true);
    expect(Object.keys(overlay!.colors).length).toBeGreaterThan(3);
    emitMock("input-key", { code: "ControlLeft", down: false, t: 1 });
    expect(useSignals.getState().overlays.cheatsheet).toBeUndefined();
  });

  it("routes remap-fired DPI / profile / layer actions to the bus", async () => {
    const sniper: unknown[] = [];
    const profiles: unknown[] = [];
    bus.on("dpi:sniper", (s) => sniper.push(s));
    bus.on("profile:apply", (p) => profiles.push(p));
    emitMock("remap-fired", { packId: "x", key: "Mouse5", action: { type: "dpi", mode: "sniper", value: 400 } });
    emitMock("input-key", { code: "Mouse5", down: false, t: 2 });
    expect(sniper).toEqual([{ active: true, value: 400 }, { active: false }]);
    emitMock("remap-fired", { packId: "x", key: "F13", action: { type: "profile", profileId: "neon" } });
    expect(profiles).toEqual([{ id: "neon", reason: "hotkey" }]);
    emitMock("remap-fired", { packId: "sixty-percent-nav", key: "CapsLock", action: { type: "layer", layer: "nav", mode: "hold" } });
    expect(useSignals.getState().layer).toBe("nav");
    emitMock("input-key", { code: "CapsLock", down: false, t: 3 });
    expect(useSignals.getState().layer).toBe(null);
  });

  it("counts input and publishes wpm/apm", async () => {
    const before = (await import("@/core/stats/store")).useStats.getState().today.keys;
    for (const code of ["KeyH", "KeyE", "KeyL", "KeyL", "KeyO"]) emitMock("input-key", { code, down: true, t: performance.now() });
    await vi.advanceTimersByTimeAsync(300);
    const { useStats } = await import("@/core/stats/store");
    expect(useStats.getState().today.keys).toBe(before + 5);
    expect(useSignals.getState().wpm).toBeGreaterThanOrEqual(0);
  });

  it("runs the demo Bambu printer", async () => {
    await vi.advanceTimersByTimeAsync(3_000);
    expect(useIntegrations.getState().status.bambu?.state).toBe("connected");
    expect(useSignals.getState().bambu?.state).toBe("RUNNING");
    expect(useSignals.getState().bambu!.progress).toBeGreaterThan(30);
  });

  it("handles API actions (claude, notify, pomodoro)", async () => {
    emitMock("api-action", { action: "claude", params: { state: "waiting" } });
    expect(useSignals.getState().claude?.state).toBe("waiting");
    expect(huds.length).toBeGreaterThan(0);
    const n = flashes.length;
    emitMock("api-action", { action: "notify", params: { text: "Build done", color: "#00ff00", keys: ["KeyB"] } });
    expect(flashes.length).toBe(n + 1);
    emitMock("api-action", { action: "pomodoro", params: { action: "start", focusMin: 1 } });
    await vi.advanceTimersByTimeAsync(500);
    expect(useSignals.getState().pomodoro?.phase).toBe("focus");
    emitMock("api-action", { action: "pomodoro", params: { action: "stop" } });
    await vi.advanceTimersByTimeAsync(300);
    expect(useSignals.getState().pomodoro).toBeUndefined();
  });

  it("creates disabled example rules and fires enabled ones", async () => {
    const rules = useRules.getState().rules;
    expect(rules.length).toBeGreaterThan(3);
    expect(rules.every((r) => !r.enabled)).toBe(true);
    const r = useRules.getState().add({ name: "deploy", enabled: true, trigger: { type: "api", event: "deploy" }, actions: [{ type: "flash", color: "#123456" }] });
    emitMock("api-action", { action: "deploy", params: {} });
    await vi.advanceTimersByTimeAsync(10);
    expect(useRules.getState().log[0]?.ruleId).toBe(r.id);
    emitMock("api-action", { action: "rule", params: { name: "DEPLOY" } });
    await vi.advanceTimersByTimeAsync(10);
    expect(useRules.getState().log.filter((l) => l.ruleId === r.id)).toHaveLength(2);
    const test = await useRules.getState().testRule(r.id);
    expect(test?.manual).toBe(true);
  });

  it("pauses remapping from the bus", async () => {
    bus.emit("keymaps:pause", { paused: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(remap.mock.lastCall?.[0].enabled).toBe(false);
    bus.emit("keymaps:pause", { paused: false });
    await vi.advanceTimersByTimeAsync(100);
    expect(remap.mock.lastCall?.[0].enabled).toBe(true);
  });
});

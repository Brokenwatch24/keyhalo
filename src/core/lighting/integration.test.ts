import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bus } from "@/core/util/bus";
import { useSettings } from "@/core/state/settings";
import { registerRazerSimulators, simulators } from "@/core/devices/sim/razer";
import { startDeviceManager, stopDeviceManager } from "@/core/devices/manager";
import { useDevices } from "@/core/devices/store";
import { engine } from "./engine";
import { useLighting } from "./store";
import { startProfiles, stopProfiles, useProfiles, onForeground, DEFAULT_PROFILE_ID } from "./profiles";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("simulated desk → device manager → lighting engine", () => {
  beforeAll(async () => {
    await registerRazerSimulators();
    await startDeviceManager({ pollMs: 600_000, batteryMs: 600_000 });
  });
  afterAll(async () => {
    engine.stop();
    stopProfiles();
    simulators.deathadder?.stopClock();
    await stopDeviceManager();
  });

  it("connects the Huntsman Mini and DeathAdder V2 Pro", () => {
    const { devices, live } = useDevices.getState();
    expect(devices.map((d) => d.definition.id).sort()).toEqual(["razer-deathadder-v2-pro", "razer-huntsman-mini"]);
    const kb = devices.find((d) => d.definition.type === "keyboard")!;
    expect(kb.firmware).toBe("1.12");
    expect(kb.layoutId).toBe("ansi-us");
    const mouse = devices.find((d) => d.definition.type === "mouse")!;
    expect(mouse.firmware).toBe("2.02");
    expect(mouse.desk.x).toBeGreaterThan(kb.definition.size.w);
    expect(live[mouse.uid].mouse?.dpiStages).toEqual([{ x: 600, y: 600 }]);
    expect(live[kb.uid].effect).toEqual({ type: "spectrum" });
  });

  it("renders frames and pushes them to both devices", async () => {
    useLighting.getState().setScene({
      layers: [{ id: "base", effect: "static", params: { color: "#ff8000" }, blend: "normal", opacity: 1, enabled: true }],
      brightness: 1,
      fps: 30,
    });
    await engine.start();
    engine.tick();
    await wait(150);
    const m = simulators.huntsman!.state.matrix!;
    expect(m[0][1]).toEqual([255, 128, 0]); // Esc
    expect(m[0][0]).toEqual([0, 0, 0]); // unused column
    expect(simulators.huntsman!.state.effects.get(0x05)).toEqual({ type: "custom" });
    expect(simulators.deathadder!.state.effects.get(0x04)).toEqual({ type: "static", colors: [[255, 128, 0]] });
  });

  it("cycles DPI stages from the bus and shows a HUD", async () => {
    const uid = useDevices.getState().devices.find((d) => d.definition.type === "mouse")!.uid;
    await useDevices.getState().setMouseSettings(uid, { dpiStages: [{ x: 400, y: 400 }, { x: 800, y: 800 }, { x: 1600, y: 1600 }], activeStage: 0 });
    const huds: string[] = [];
    const off = bus.on("hud", (h) => huds.push(h.value ?? ""));
    bus.emit("dpi:cycle", { direction: 1 });
    await wait(100);
    off();
    expect(simulators.deathadder!.state.dpi).toEqual({ x: 800, y: 800 });
    expect(huds).toContain("800 DPI");
    bus.emit("dpi:sniper", { active: true, value: 300 });
    await wait(80);
    expect(simulators.deathadder!.state.dpi).toEqual({ x: 300, y: 300 });
    bus.emit("dpi:sniper", { active: false });
    await wait(80);
    expect(simulators.deathadder!.state.dpi).toEqual({ x: 800, y: 800 });
  });

  it("hands a device to its hardware effect and back", async () => {
    const kb = useDevices.getState().devices.find((d) => d.definition.type === "keyboard")!;
    bus.emit("device:effect", { uid: kb.uid, effect: { type: "wave", direction: "right" } });
    await wait(60);
    expect(useDevices.getState().live[kb.uid].mode).toBe("hardware");
    expect(simulators.huntsman!.state.effects.get(0x05)?.type).toBe("wave");
    engine.tick();
    await wait(60);
    expect(simulators.huntsman!.state.effects.get(0x05)?.type).toBe("wave"); // engine left it alone
  });

  it("applies profiles (scene, active id, event) and auto-switches by app", async () => {
    await startProfiles();
    const ids = useProfiles.getState().profiles.map((p) => p.id);
    expect(ids).toContain(DEFAULT_PROFILE_ID);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    const applied: string[] = [];
    const off = bus.on("profile:applied", (p) => applied.push(p.id));
    await useProfiles.getState().apply("neon");
    expect(useLighting.getState().scene.layers[0].effect).toBe("gradient");
    expect(useProfiles.getState().activeId).toBe("neon");
    expect(useSettings.getState().settings.activeProfileId).toBe("neon");
    const kb = useDevices.getState().devices.find((d) => d.definition.type === "keyboard")!;
    expect(useDevices.getState().live[kb.uid].mode).toBe("software");

    // Auto-switch to a profile bound to an app and back.
    const game = useProfiles.getState().create("Test game", { apps: ["Game.exe"] });
    await onForeground("game.exe");
    expect(useProfiles.getState().activeId).toBe(game.id);
    await onForeground("explorer.exe");
    expect(useProfiles.getState().activeId).toBe("neon");
    off();
    expect(applied).toEqual(["neon", game.id, "neon"]);

    // Editing a read-only profile marks it dirty; saving creates a user copy.
    useLighting.getState().setBrightness(0.3);
    expect(useProfiles.getState().dirty).toBe(true);
    const saved = useProfiles.getState().saveActiveScene("My neon");
    expect(saved?.lighting.brightness).toBe(0.3);
    expect(useProfiles.getState().sources[saved!.id]).toBe("user");
    // Round-trip export/import.
    const imported = useProfiles.getState().importJson(useProfiles.getState().exportJson(saved!.id));
    expect(imported.id).not.toBe(saved!.id);
    expect(imported.lighting).toEqual(saved!.lighting);
  });
});

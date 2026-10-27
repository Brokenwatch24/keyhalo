import { describe, expect, it, beforeAll } from "vitest";
import { registerHidSimulator } from "@/core/backend/mock";
import { useSettings } from "@/core/state/settings";
import type { DeviceDefinition } from "@/core/types";
import {
  buildFeature,
  buildReport,
  cmd,
  crcValid,
  decodeDpiStages,
  decodeEffect,
  encodeEffect,
  parseReport,
  razerCrc,
} from "./razer-protocol";
import { RazerHandle } from "./razer";
import { SafeModeError } from "./types";
import { createDeathAdderV2ProSim, createHuntsmanMiniSim } from "../sim/razer";
import huntsman from "../../../../community/devices/razer/huntsman-mini.json";
import deathadder from "../../../../community/devices/razer/deathadder-v2-pro.json";

describe("razer packets", () => {
  it("computes the CRC as XOR of bytes 2..87", () => {
    const r = new Array(90).fill(0);
    r[5] = 0x02;
    r[6] = 0x00;
    r[7] = 0x81;
    r[1] = 0xff; // excluded from the CRC
    expect(razerCrc(r)).toBe(0x02 ^ 0x81);
  });

  it("builds the firmware request exactly", () => {
    const r = buildReport({ transactionId: 0x1f, ...cmd.firmware() });
    expect(r).toHaveLength(90);
    expect(r.slice(0, 8)).toEqual([0x00, 0x1f, 0, 0, 0, 0x02, 0x00, 0x81]);
    expect(r[88]).toBe(0x02 ^ 0x81);
    expect(r[89]).toBe(0);
    expect(crcValid(r)).toBe(true);
    const f = buildFeature({ transactionId: 0x1f, ...cmd.firmware() });
    expect(f).toHaveLength(91);
    expect(f[0]).toBe(0);
    expect(parseReport(f).cmdId).toBe(0x81);
  });

  it("encodes extended-matrix effects", () => {
    expect(encodeEffect(0x05, { type: "static", colors: [[255, 0, 16]] }, true)).toEqual({
      cmdClass: 0x0f,
      cmdId: 0x02,
      dataSize: 0x09,
      args: [0x01, 0x05, 0x01, 0x00, 0x00, 0x01, 255, 0, 16],
    });
    expect(encodeEffect(0x05, { type: "spectrum" }, false).args).toEqual([0x00, 0x05, 0x03]);
    expect(encodeEffect(0x05, { type: "custom" }, true).args).toEqual([0x00, 0x00, 0x08]);
    expect(encodeEffect(0x05, { type: "wave", direction: "left", speed: 2 }, true).args).toEqual([0x01, 0x05, 0x04, 0x01, 0x28]);
    const dual = encodeEffect(0x04, { type: "breathing", colors: [[1, 2, 3], [4, 5, 6]] }, true);
    expect(dual.dataSize).toBe(0x0c);
    expect(dual.args).toEqual([0x01, 0x04, 0x02, 0x02, 0x00, 0x02, 1, 2, 3, 4, 5, 6]);
  });

  it("decodes the effect reply seen on the real Huntsman Mini", () => {
    expect(decodeEffect([0x01, 0x05, 0x03, 0x00, 0x00, 0x01])).toEqual({ type: "spectrum" });
    expect(decodeEffect([0x01, 0x05, 0x01, 0x00, 0x00, 0x01, 9, 8, 7])).toEqual({ type: "static", colors: [[9, 8, 7]] });
  });

  it("round-trips effects through encode/decode", () => {
    for (const e of [
      { type: "off" as const },
      { type: "static" as const, colors: [[10, 20, 30]] as [number, number, number][] },
      { type: "breathing" as const, colors: [[1, 2, 3]] as [number, number, number][] },
      { type: "wave" as const, direction: "right" as const, speed: 3 },
      { type: "reactive" as const, speed: 1, colors: [[0, 0, 255]] as [number, number, number][] },
      { type: "starlight" as const, speed: 2, colors: [[1, 1, 1], [2, 2, 2]] as [number, number, number][] },
    ]) {
      const c = encodeEffect(0x05, e, true);
      expect(decodeEffect(c.args!)).toEqual(e);
    }
  });

  it("encodes custom frame rows (0x0F 0x03)", () => {
    const c = cmd.customRow(2, 0, Array.from({ length: 15 }, (_, i) => [i, 0, 0] as [number, number, number]));
    expect(c.dataSize).toBe(5 + 45);
    expect(c.args!.slice(0, 5)).toEqual([0, 0, 2, 0, 14]);
    expect(c.args![5 + 3 * 14]).toBe(14);
  });

  it("encodes and decodes DPI stages", () => {
    const c = cmd.setDpiStages([{ x: 400, y: 400 }, { x: 1600, y: 1600 }], 1);
    expect(c.dataSize).toBe(0x26);
    expect(c.args!.slice(0, 3)).toEqual([0x01, 2, 2]);
    expect(decodeDpiStages(c.args!)).toEqual({ active: 1, stages: [{ x: 400, y: 400 }, { x: 1600, y: 1600 }] });
  });
});

describe("razer driver against the simulators", () => {
  const kb = createHuntsmanMiniSim();
  const mouse = createDeathAdderV2ProSim(false);
  beforeAll(() => {
    registerHidSimulator(kb);
    registerHidSimulator(mouse);
  });

  it("reads keyboard info", async () => {
    const h = new RazerHandle(huntsman as unknown as DeviceDefinition, kb.controlPath);
    const info = await h.info();
    expect(info).toEqual({ firmware: "1.12", serial: "PM2104H0DEMO01", layoutId: "0x01" });
    expect(h.transactionId).toBe(0x1f);
    expect(await h.getEffect()).toEqual({ type: "spectrum" });
    expect(await h.getBrightness()).toBe(1);
  });

  it("falls back to another transaction id", async () => {
    const def = { ...(deathadder as unknown as DeviceDefinition), driverOptions: { ...deathadder.driverOptions, transactionId: "0x1F" } };
    const h = new RazerHandle(def, mouse.controlPath);
    expect((await h.info()).firmware).toBe("2.02");
    expect(h.transactionId).toBe(0x3f);
  });

  it("drives mouse DPI, polling, battery and power settings", async () => {
    const h = new RazerHandle(deathadder as DeviceDefinition, mouse.controlPath);
    expect(await h.getDpi()).toEqual({ x: 600, y: 600 });
    await h.setDpiStages({ stages: [{ x: 400, y: 400 }, { x: 800, y: 800 }, { x: 1600, y: 1600 }], active: 2 });
    expect(await h.getDpiStages()).toEqual({ active: 2, stages: [{ x: 400, y: 400 }, { x: 800, y: 800 }, { x: 1600, y: 1600 }] });
    await h.setDpi({ x: 1200, y: 1200 });
    expect(mouse.state.dpi).toEqual({ x: 1200, y: 1200 });
    await h.setPollingRate(500);
    expect(await h.getPollingRate()).toBe(500);
    expect(await h.getBattery()).toBe(84);
    expect(await h.getCharging()).toBe(false);
    await h.setIdleSleep(600);
    expect(await h.getIdleSleep()).toBe(600);
    await h.setLowBatteryThreshold(10);
    expect(await h.getLowBatteryThreshold()).toBe(10);
  });

  it("uploads custom frames row by row and de-duplicates", async () => {
    const h = new RazerHandle(huntsman as unknown as DeviceDefinition, kb.controlPath);
    const before = kb.state.commands;
    await h.setFrame([{ led: [2, 3], color: [255, 128, 0] }]);
    expect(kb.state.matrix![2][3]).toEqual([255, 128, 0]);
    expect(kb.state.effects.get(0x05)).toEqual({ type: "custom" });
    const afterFirst = kb.state.commands;
    expect(afterFirst - before).toBeGreaterThanOrEqual(6); // 5 rows + effect select (+ tid probe)
    await h.setFrame([{ led: [2, 3], color: [255, 128, 0] }]);
    expect(kb.state.commands).toBe(afterFirst); // identical frame skipped
    await h.setFrame([{ led: [0, 1], color: [1, 2, 3] }, { led: [2, 3], color: [255, 128, 0] }]);
    expect(kb.state.commands - afterFirst).toBe(2); // only row 0 + effect select
  });

  it("captures and restores a snapshot", async () => {
    const h = new RazerHandle(deathadder as DeviceDefinition, mouse.controlPath);
    const snap = await h.snapshot();
    expect(snap.mouse?.dpiStages.length).toBeGreaterThan(0);
    await h.setEffect({ type: "breathing", colors: [[0, 0, 255]] }, false);
    await h.restore(snap);
    expect(mouse.state.effects.get(0x04)).toEqual(snap.effect);
  });

  it("refuses writes in safe mode but still reads", async () => {
    const h = new RazerHandle(huntsman as unknown as DeviceDefinition, kb.controlPath);
    useSettings.setState({ settings: { ...useSettings.getState().settings, safeMode: true } });
    try {
      await expect(h.setBrightness(0.5, false)).rejects.toBeInstanceOf(SafeModeError);
      expect(await h.getBrightness()).toBe(1);
    } finally {
      useSettings.setState({ settings: { ...useSettings.getState().settings, safeMode: false } });
    }
  });
});

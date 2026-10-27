import { backend } from "@/core/backend";
import type { LampArrayInfo } from "@/core/backend/api";
import { useSettings } from "@/core/state/settings";
import type { DeviceDefinition, DeviceSnapshot, KeyDef, LedDef } from "@/core/types";
import { FramePump, hex4, parseHex, type DeviceHandle, type DeviceInfo, type DiscoveredDevice, type LedColor } from "./types";
import { assignCodes, legendFor } from "./vk";

/**
 * Windows Dynamic Lighting (HID LampArray) driver. Rust exposes the lamp list and a
 * set-colours call; everything else (lamp → key mapping, synthetic layouts) happens here.
 */

/** 1 keyboard unit = 19.05 mm. LampArray positions are in metres. */
const UNIT_M = 0.01905;

class LampArrayHandle implements DeviceHandle {
  readonly driver = "lamparray" as const;
  private pump: FramePump<LedColor[]>;

  constructor(
    readonly definition: DeviceDefinition,
    readonly path: string,
    private lampCount: number,
  ) {
    this.pump = new FramePump(
      (f) => this.send(f),
      (f) => f.map((c) => `${c.led}:${c.color.join(",")}`).join(";"),
      30,
      (e) => console.warn(`[lamparray] frame failed on ${definition.name}`, e),
    );
  }

  async info(): Promise<DeviceInfo> {
    return {};
  }

  setFrame(frame: LedColor[]): Promise<void> {
    if (useSettings.getState().settings.safeMode) return Promise.resolve();
    return this.pump.push(frame);
  }

  private async send(frame: LedColor[]) {
    const colors: number[][] = Array.from({ length: this.lampCount }, () => [0, 0, 0]);
    for (const { led, color } of frame) {
      const i = Array.isArray(led) ? led[1] : led;
      if (i >= 0 && i < this.lampCount) colors[i] = color.map((v) => Math.max(0, Math.min(255, Math.round(v))));
    }
    await backend.lampArraySetColors(this.path, colors);
  }

  async snapshot(): Promise<DeviceSnapshot> {
    // Windows restores the device's own effect when the app releases control.
    return { capturedAt: new Date().toISOString() };
  }

  async restore(): Promise<void> {
    await this.setFrame([]);
  }

  async close(): Promise<void> {}
}

/** Build a definition from the lamp geometry (keys for lamps bound to VKs, LEDs otherwise). */
export function synthesizeLampDefinition(info: LampArrayInfo): DeviceDefinition {
  const kind = info.kind.toLowerCase();
  const type: DeviceDefinition["type"] =
    kind.includes("keyboard") ? "keyboard" : kind.includes("mouse") ? "mouse" : kind.includes("mat") ? "mousepad" : kind.includes("headset") ? "headset" : "other";
  const vid = info.vendorId !== undefined ? hex4(info.vendorId) : undefined;
  const pid = info.productId !== undefined ? hex4(info.productId) : undefined;
  const base: DeviceDefinition = {
    id: `lamparray-${(vid ?? "0x0000").slice(2)}-${(pid ?? info.id).toString().slice(-8)}`.toLowerCase(),
    name: info.name || "Dynamic Lighting device",
    vendor: "Dynamic Lighting",
    type,
    match: vid && pid ? [{ vendorId: vid, productId: pid, usagePage: "0x0059" }] : [],
    driver: "lamparray",
    capabilities: { perKeyRgb: type === "keyboard", zones: type !== "keyboard" },
    size: { w: 1, h: 1 },
    status: "experimental",
    notes: "Generated from Windows Dynamic Lighting lamp positions.",
  };

  if (type === "mouse" || type === "other" || type === "headset") {
    // Fit the lamps into the 0..2 × 0..3.4 MouseView box.
    const w = Math.max(info.width, 1e-3);
    const h = Math.max(info.height, 1e-3);
    const s = Math.min(1.6 / w, 3.0 / h);
    base.leds = info.lamps.map((l): LedDef => ({
      id: `lamp-${l.index}`,
      name: l.purposes[0] ? `${l.purposes[0]} ${l.index + 1}` : `Lamp ${l.index + 1}`,
      x: +(0.2 + l.x * s).toFixed(3),
      y: +(0.2 + l.y * s).toFixed(3),
      w: 0.3,
      h: 0.3,
      led: l.index,
    }));
    base.size = { w: 2, h: 3.4 };
    return base;
  }

  const codes = assignCodes(info.lamps);
  const minX = Math.min(...info.lamps.map((l) => l.x), 0);
  const minY = Math.min(...info.lamps.map((l) => l.y), 0);
  const keys: KeyDef[] = [];
  const leds: LedDef[] = [];
  for (const l of info.lamps) {
    // Lamp positions are key centres; KeyDef positions are top-left corners.
    const x = +((l.x - minX) / UNIT_M - 0.5).toFixed(2);
    const y = +((l.y - minY) / UNIT_M - 0.5).toFixed(2);
    const code = codes.get(l.index);
    if (code) keys.push({ code, label: legendFor(code.replace(/#\d+$/, "")), x: Math.max(0, x), y: Math.max(0, y), led: l.index });
    else leds.push({ id: `lamp-${l.index}`, name: `Lamp ${l.index + 1}`, x: Math.max(0, x) + 0.5, y: Math.max(0, y) + 0.5, w: 0.5, h: 0.5, led: l.index });
  }
  const w = Math.max(1, ...keys.map((k) => k.x + (k.w ?? 1)), ...leds.map((l) => l.x + 0.5));
  const h = Math.max(1, ...keys.map((k) => k.y + (k.h ?? 1)), ...leds.map((l) => l.y + 0.5));
  base.layouts = { lamps: { id: "lamps", name: "Dynamic Lighting", standard: "custom", keys } };
  base.defaultLayout = "lamps";
  if (leds.length) base.leds = leds;
  base.size = { w: +w.toFixed(2), h: +h.toFixed(2) };
  return base;
}

/** Community definitions for LampArray devices (driver "lamparray") take precedence. */
function findDefinition(info: LampArrayInfo, definitions: DeviceDefinition[]) {
  return definitions.find(
    (d) =>
      d.driver === "lamparray" &&
      d.match.some((m) => parseHex(m.vendorId) === info.vendorId && parseHex(m.productId) === info.productId),
  );
}

/**
 * List Dynamic Lighting devices, skipping those whose vendor/product id is already driven by a
 * native driver (e.g. the Huntsman Mini's interface 3).
 */
export async function discoverLampArrays(
  definitions: DeviceDefinition[],
  nativeIds: Set<string>,
): Promise<DiscoveredDevice[]> {
  let list: LampArrayInfo[] = [];
  try {
    list = await backend.lampArrayList();
  } catch (e) {
    console.warn("[lamparray] list failed", e);
    return [];
  }
  const out: DiscoveredDevice[] = [];
  for (const info of list) {
    if (!info.isAvailable) continue;
    if (info.vendorId !== undefined && info.productId !== undefined && nativeIds.has(`${info.vendorId}:${info.productId}`)) continue;
    const definition = findDefinition(info, definitions) ?? synthesizeLampDefinition(info);
    out.push({
      key: `lamparray:${info.id}`,
      definition,
      handle: new LampArrayHandle(definition, info.id, info.lampCount),
      vendorId: info.vendorId,
      productId: info.productId,
    });
  }
  return out;
}


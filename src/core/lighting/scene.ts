import type { ConnectedDevice, DeviceDefinition, KeyDef, Layout, LedDef } from "@/core/types";
import type { LedAddress } from "@/core/devices/drivers/types";
import { layoutOf } from "@/core/devices/store";
import type { SceneKey } from "./api";

/**
 * Scene geometry: every key and LED of every device placed at its desk position
 * (keyboard units), so effects flow continuously from the keyboard onto the mouse.
 */

export interface DeviceSlice {
  uid: string;
  /** Scene indices belonging to this device. */
  indices: number[];
  /** LED address for each index (undefined = not addressable, preview only). */
  leds: (LedAddress | undefined)[];
}

export interface SceneGeometry {
  keys: SceneKey[];
  width: number;
  height: number;
  devices: DeviceSlice[];
}

export interface GeometrySource {
  uid: string;
  definition: DeviceDefinition;
  layout?: Layout;
  desk: { x: number; y: number };
}

export function sourcesFromDevices(devices: ConnectedDevice[]): GeometrySource[] {
  return devices.map((d) => ({ uid: d.uid, definition: d.definition, layout: layoutOf(d), desk: d.desk }));
}

export function buildGeometry(sources: GeometrySource[]): SceneGeometry {
  const keys: SceneKey[] = [];
  const slices: DeviceSlice[] = [];
  for (const src of sources) {
    const slice: DeviceSlice = { uid: src.uid, indices: [], leds: [] };
    const add = (k: Omit<SceneKey, "index">, led: LedAddress | undefined) => {
      const index = keys.length;
      keys.push({ ...k, index });
      slice.indices.push(index);
      slice.leds.push(led);
    };
    const keyDefs: KeyDef[] = src.layout?.keys ?? [];
    for (const k of keyDefs) {
      const w = k.w ?? 1;
      const h = k.h ?? 1;
      add(
        { id: k.code, x: src.desk.x + k.x + w / 2, y: src.desk.y + k.y + h / 2, w, h, kind: "key", device: src.uid, definition: src.definition.id },
        k.led,
      );
    }
    const leds: LedDef[] = src.definition.leds ?? [];
    for (const l of leds) {
      add({ id: l.id, x: src.desk.x + l.x, y: src.desk.y + l.y, w: l.w ?? 0.36, h: l.h ?? 0.36, kind: "led", device: src.uid, definition: src.definition.id }, l.led);
    }
    slices.push(slice);
  }
  if (!keys.length) return { keys, width: 0, height: 0, devices: slices };
  // Normalise so the scene starts at (0, 0).
  const minX = Math.min(...keys.map((k) => k.x - k.w / 2));
  const minY = Math.min(...keys.map((k) => k.y - k.h / 2));
  for (const k of keys) {
    k.x -= minX;
    k.y -= minY;
  }
  const width = Math.max(...keys.map((k) => k.x + k.w / 2));
  const height = Math.max(...keys.map((k) => k.y + k.h / 2));
  return { keys, width, height, devices: slices };
}

/** Frame buffer slice of one device → `{ code|ledId: [r,g,b] }` (for previews). */
export function deviceColors(geom: SceneGeometry, slice: DeviceSlice, frame: Float32Array): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const i of slice.indices) {
    out[geom.keys[i].id] = [Math.round(frame[i * 3]), Math.round(frame[i * 3 + 1]), Math.round(frame[i * 3 + 2])];
  }
  return out;
}

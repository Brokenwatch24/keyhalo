import { backend } from "@/core/backend";
import type { HidDeviceInfo } from "@/core/backend/api";
import type { DeviceDefinition, DeviceType, KeyDef, LedDef, RGB } from "@/core/types";
import { groupHid, matchDefinition } from "./definitions";
import { RazerHandle, probeRazer } from "./drivers/razer";
import { hex4, type DeviceHandle, type LedAddress } from "./drivers/types";
import { getHandle, setFrameOverride } from "./manager";
import { useDevices } from "./store";
import { getTemplate } from "./templates";

/**
 * Helpers for the "Add a device" wizard: find unknown HID devices, check whether they speak
 * the Razer protocol, light single LEDs to map them onto keys, and build a definition.
 */

export interface UnknownHidDevice {
  vendorId: number;
  productId: number;
  /** "0x1532:0x0257" */
  id: string;
  product?: string;
  manufacturer?: string;
  interfaces: HidDeviceInfo[];
}

/** HID devices no definition matches (grouped by physical device). */
export async function listUnknownHidDevices(vendorIds?: number[]): Promise<UnknownHidDevice[]> {
  const infos = await backend.hidEnumerate(vendorIds);
  const defs = useDevices.getState().definitions;
  return groupHid(infos)
    .filter((g) => !matchDefinition(defs, g))
    .map((g) => ({
      vendorId: g[0].vendorId,
      productId: g[0].productId,
      id: `${hex4(g[0].vendorId)}:${hex4(g[0].productId)}`,
      product: g.find((i) => i.product)?.product,
      manufacturer: g.find((i) => i.manufacturer)?.manufacturer,
      interfaces: g,
    }));
}

/**
 * Try every interface of an unknown device and return the first one answering the Razer
 * protocol (read-only: firmware + serial).
 */
export async function findRazerInterface(dev: UnknownHidDevice) {
  for (const i of dev.interfaces) {
    const r = await probeRazer(i.path);
    if (r) return { ...r, interface: i };
  }
  return null;
}

export { probeRazer };

const scratchHandles = new Map<string, RazerHandle>();

/**
 * Light one matrix cell (everything else off) on a device that is not yet defined.
 * `target` is a HID path (control interface) or an open handle.
 */
export async function lightMatrixCell(
  target: string | DeviceHandle,
  row: number,
  col: number,
  color: RGB = [255, 255, 255],
  matrix: { rows: number; cols: number } = { rows: 6, cols: 22 },
  transactionId?: number,
) {
  let handle: DeviceHandle;
  if (typeof target === "string") {
    const key = `${target}|${matrix.rows}x${matrix.cols}`;
    let h = scratchHandles.get(key);
    if (!h) {
      h = new RazerHandle(
        {
          id: "wizard",
          name: "Wizard",
          vendor: "Razer",
          type: "keyboard",
          match: [],
          driver: "razer",
          driverOptions: { matrix, transactionId },
          capabilities: {},
          size: { w: 1, h: 1 },
          status: "experimental",
        },
        target,
      );
      scratchHandles.set(key, h);
    }
    handle = h;
  } else handle = target;
  await handle.setFrame?.([{ led: [row, col], color }]);
}

/** Light a single LED of a connected device, pausing the lighting engine output for it. */
export function lightLed(uid: string, address: LedAddress, color: RGB = [255, 255, 255]) {
  if (!getHandle(uid)) throw new Error("Device not connected");
  setFrameOverride(uid, [{ led: address, color }]);
}

/** Give the device back to the lighting engine. */
export function releaseLed(uid: string) {
  setFrameOverride(uid, null);
}

export interface MappingInput {
  id: string;
  name: string;
  vendor: string;
  type: DeviceType;
  vendorId: number;
  productId: number;
  /** Control interface (feature reports). */
  interface?: number;
  transactionId?: number;
  matrix?: { rows: number; cols: number };
  /** Template the keys come from (keyboards), e.g. "ansi-tkl". */
  templateId?: string;
  /** KeyCode → matrix address (keyboards). Keys without an entry are dropped. */
  mapping?: Record<string, [number, number]>;
  /** Non-key LEDs (mice, logos). */
  leds?: LedDef[];
  /** Hardware layout id reported by the device (e.g. "0x01"). */
  hardwareLayoutId?: string;
  author?: string;
  notes?: string;
}

/** Build a shareable definition from the wizard's LED mapping. */
export function buildDefinitionFromMapping(input: MappingInput): DeviceDefinition {
  const def: DeviceDefinition = {
    $schema: "../../schemas/device.schema.json",
    id: input.id,
    name: input.name,
    vendor: input.vendor,
    type: input.type,
    match: [{ vendorId: hex4(input.vendorId), productId: hex4(input.productId), ...(input.interface !== undefined ? { interface: input.interface } : {}) }],
    driver: "razer",
    driverOptions: {
      ...(input.transactionId !== undefined ? { transactionId: `0x${input.transactionId.toString(16).toUpperCase().padStart(2, "0")}` } : {}),
      ...(input.matrix ? { matrix: input.matrix } : {}),
      led: input.type === "keyboard" ? "0x05" : "0x04",
      ...(input.type !== "keyboard" && !input.matrix ? { frameMode: "led" } : {}),
    },
    capabilities: {
      perKeyRgb: input.type === "keyboard" && !!input.mapping,
      zones: input.type !== "keyboard",
      hardwareEffects: ["off", "static", "breathing", "spectrum", "wave", "reactive", "starlight", "custom"],
      brightness: true,
    },
    size: { w: 2, h: 3.4 },
    status: "experimental",
    testedBy: input.author ? [input.author] : undefined,
    notes: input.notes ?? "Created with the KeyHalo device wizard.",
  };
  if (input.type === "keyboard") {
    const tpl = getTemplate(input.templateId ?? "ansi-60");
    const keys: KeyDef[] = tpl.layout.keys
      .filter((k) => input.mapping?.[k.code])
      .map((k) => ({ ...k, led: input.mapping![k.code] }));
    const layoutId = tpl.layout.id;
    def.layouts = { [layoutId]: { ...tpl.layout, keys } };
    def.defaultLayout = layoutId;
    if (input.hardwareLayoutId) def.layoutDetection = { [input.hardwareLayoutId]: layoutId };
    def.size = { ...tpl.size };
  }
  if (input.leds?.length) def.leds = input.leds;
  if (!def.testedBy) delete def.testedBy;
  return def;
}

import { backend } from "@/core/backend";
import type { HidDeviceInfo } from "@/core/backend/api";
import { loadJson, saveJson } from "@/core/state/persist";
import type { DeviceDefinition, HidMatch } from "@/core/types";
import { parseHex } from "./drivers/types";

/** Definitions shipped with the app (community/devices/**). */
const bundledModules = import.meta.glob<{ default: DeviceDefinition }>("/community/devices/**/*.json", { eager: true });

export function bundledDefinitions(): DeviceDefinition[] {
  return Object.values(bundledModules)
    .map((m) => (m as { default?: DeviceDefinition }).default ?? (m as unknown as DeviceDefinition))
    .filter(isDefinition);
}

export function isDefinition(v: unknown): v is DeviceDefinition {
  const d = v as DeviceDefinition;
  return !!d && typeof d.id === "string" && typeof d.name === "string" && Array.isArray(d.match) && !!d.driver && !!d.size;
}

const INSTALLED_DIR = "devices/installed";

/** Definitions installed from the gallery or created with the wizard. */
export async function installedDefinitions(): Promise<DeviceDefinition[]> {
  const out: DeviceDefinition[] = [];
  let names: string[] = [];
  try {
    names = await backend.storageList(INSTALLED_DIR);
  } catch {
    return out;
  }
  for (const n of names.filter((n) => n.endsWith(".json"))) {
    const d = await loadJson<DeviceDefinition>(`${INSTALLED_DIR}/${n}`);
    if (isDefinition(d)) out.push(d);
  }
  return out;
}

export async function saveInstalledDefinition(def: DeviceDefinition) {
  await saveJson(`${INSTALLED_DIR}/${def.id}.json`, def);
}

export async function deleteInstalledDefinition(id: string) {
  await backend.storageDelete(`${INSTALLED_DIR}/${id}.json`).catch(() => {});
}

/** Merge lists; later entries replace earlier ones with the same id. */
export function mergeDefinitions(...lists: DeviceDefinition[][]): DeviceDefinition[] {
  const map = new Map<string, DeviceDefinition>();
  for (const list of lists) for (const d of list) map.set(d.id, d);
  return [...map.values()];
}

export function hidMatches(m: HidMatch, info: HidDeviceInfo): boolean {
  if (parseHex(m.vendorId) !== info.vendorId || parseHex(m.productId) !== info.productId) return false;
  if (m.interface !== undefined && m.interface !== info.interfaceNumber) return false;
  if (m.usagePage !== undefined && parseHex(m.usagePage) !== info.usagePage) return false;
  if (m.usage !== undefined && parseHex(m.usage) !== info.usage) return false;
  return true;
}

/** Find the definition + control interface for a HID interface list (one physical device). */
export function matchDefinition(
  definitions: DeviceDefinition[],
  infos: HidDeviceInfo[],
): { definition: DeviceDefinition; control: HidDeviceInfo } | null {
  // Prefer verified > community > experimental definitions.
  const rank = { verified: 0, community: 1, experimental: 2 } as const;
  const sorted = [...definitions].filter((d) => d.driver === "razer").sort((a, b) => rank[a.status] - rank[b.status]);
  for (const definition of sorted) {
    for (const m of definition.match) {
      const control = infos.find((i) => hidMatches(m, i));
      if (control) return { definition, control };
    }
  }
  return null;
}

/** Group HID interfaces by physical device (vendor:product:serial). */
export function groupHid(infos: HidDeviceInfo[]): HidDeviceInfo[][] {
  const groups = new Map<string, HidDeviceInfo[]>();
  for (const i of infos) {
    const key = `${i.vendorId}:${i.productId}:${i.serial ?? physicalPath(i.path)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(i);
  }
  return [...groups.values()];
}

/**
 * Strip the interface-specific part of a HID path so interfaces of one device group together.
 * Windows: \\?\HID#VID_1532&PID_0257&MI_02#7&2b1d…#{guid} → VID_1532&PID_0257 + instance prefix.
 * Simulator: sim://huntsman-mini/if2 → sim://huntsman-mini.
 */
function physicalPath(path: string): string {
  const sim = /^(sim:\/\/[^/]+)/.exec(path);
  if (sim) return sim[1];
  const win = /VID_[0-9A-F]{4}&PID_[0-9A-F]{4}/i.exec(path);
  return win ? win[0].toUpperCase() : path;
}

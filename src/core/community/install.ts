/**
 * Installed community content: files live in the app data folder as
 * `installed/<kind>/<id>.json` (effects: `.js`), with a small registry in
 * `community/installed.json`. Owning features learn about items through the bus
 * (`community:installed` / `community:removed`).
 */
import { backend } from "@/core/backend";
import { bus } from "@/core/util/bus";
import { loadJson, saveJson } from "@/core/state/persist";
import type { CatalogEntry, CatalogKind } from "../types";
import { CATALOG_KINDS, STORAGE } from "./constants";
import { checkContent, effectMetaLite, type InstallPreview } from "./content";

export interface InstalledItem {
  kind: CatalogKind;
  id: string;
  name: string;
  /** `version` field of the item, when it has one. */
  version?: string;
  /** Catalog `updated` date at install time (used for "update available"). */
  updated?: string;
  installedAt: string;
  origin: InstallPreview["origin"];
  /** Repository path, when installed from the catalog. */
  path?: string;
  /** The user confirmed risky actions (launch/text/macro/http) at install time. */
  confirmedRisky?: boolean;
}

export type InstalledRegistry = Record<string, InstalledItem>;

export const itemKey = (kind: CatalogKind, id: string) => `${kind}:${id}`;

export async function loadRegistry(): Promise<InstalledRegistry> {
  return (await loadJson<InstalledRegistry>(STORAGE.installed)) ?? {};
}

export async function saveRegistry(reg: InstalledRegistry) {
  await saveJson(STORAGE.installed, reg);
}

/** Write an item's file and emit `community:installed`. Returns the registry record. */
export async function writeInstalled(preview: InstallPreview, confirmedRisky: boolean): Promise<InstalledItem> {
  const contents = preview.kind === "effect" ? String(preview.data) : JSON.stringify(preview.data, null, 2);
  await backend.storageWrite(STORAGE.file(preview.kind, preview.id), contents);
  bus.emit("community:installed", { kind: preview.kind, id: preview.id, data: preview.data });
  return {
    kind: preview.kind,
    id: preview.id,
    name: preview.name,
    version: preview.version,
    updated: preview.entry?.updated,
    installedAt: new Date().toISOString(),
    origin: preview.origin,
    path: preview.entry?.path,
    confirmedRisky: preview.requiresConfirmation ? confirmedRisky : undefined,
  };
}

export async function deleteInstalled(kind: CatalogKind, id: string) {
  await backend.storageDelete(STORAGE.file(kind, id));
  bus.emit("community:removed", { kind, id });
}

/** Read one installed item (parsed JSON, or source text for effects). */
export async function readInstalled(kind: CatalogKind, id: string): Promise<unknown | null> {
  const raw = await backend.storageRead(STORAGE.file(kind, id));
  if (raw == null) return null;
  if (kind === "effect") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Re-emit `community:installed` for every installed item so features register them at startup.
 * Files found on disk but missing from the registry are adopted; registry rows whose file is
 * gone are dropped. Returns the reconciled registry.
 */
export async function reemitInstalled(reg: InstalledRegistry): Promise<InstalledRegistry> {
  const next: InstalledRegistry = {};
  for (const kind of CATALOG_KINDS) {
    let files: string[] = [];
    try {
      files = await backend.storageList(STORAGE.dir(kind));
    } catch {
      /* folder missing */
    }
    for (const file of files) {
      const id = file.replace(/\.(json|js)$/, "");
      if (id === file) continue;
      const data = await readInstalled(kind, id);
      if (data == null || checkContent(kind, data).length) {
        console.warn(`[community] skipping invalid installed ${kind} "${id}"`);
        continue;
      }
      const key = itemKey(kind, id);
      next[key] = reg[key] ?? {
        kind,
        id,
        name: kind === "effect" ? (effectMetaLite(String(data)).name ?? id) : String((data as { name?: string }).name ?? id),
        installedAt: new Date().toISOString(),
        origin: { type: "paste" },
      };
      bus.emit("community:installed", { kind, id, data });
    }
  }
  return next;
}

/** True when the catalog has a newer version than the installed copy. */
export function isUpdateAvailable(item: InstalledItem | undefined, entry: CatalogEntry | undefined): boolean {
  if (!item?.updated || !entry?.updated) return false;
  return Date.parse(entry.updated) > Date.parse(item.updated);
}

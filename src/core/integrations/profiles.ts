import type { Profile } from "@/core/types";
import { bus } from "@/core/util/bus";
import { useSettings } from "@/core/state/settings";

/**
 * Lightweight profile directory (id → name) for Home Assistant's effect list and the API
 * state. Built from the bundled community profiles plus every profile seen on the bus, so it
 * does not depend on the lighting feature's internals.
 */
const bundled = import.meta.glob<{ default: Profile }>("/community/profiles/*.json", { eager: true });
const names = new Map<string, string>();
for (const m of Object.values(bundled)) if (m.default?.id) names.set(m.default.id, m.default.name ?? m.default.id);
const listeners = new Set<() => void>();
let wired = false;

function changed() {
  listeners.forEach((l) => l());
}

export function wireProfileDirectory() {
  if (wired) return;
  wired = true;
  bus.on("profile:applied", ({ id, name }) => {
    names.set(id, name);
    changed();
  });
  bus.on("community:installed", ({ kind, id, data }) => {
    if (kind !== "profile") return;
    names.set(id, (data as Profile)?.name ?? id);
    changed();
  });
  bus.on("community:removed", ({ kind, id }) => {
    if (kind === "profile" && names.delete(id)) changed();
  });
}

/** Register profiles from another source (e.g. the lighting store). */
export function registerProfiles(list: { id: string; name: string }[]) {
  list.forEach((p) => names.set(p.id, p.name));
  changed();
}

export function profileList(): { id: string; name: string }[] {
  return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function profileName(id?: string | null): string | null {
  if (!id) return null;
  return names.get(id) ?? id;
}

export function activeProfile(): { id: string; name: string } | null {
  const id = useSettings.getState().settings.activeProfileId;
  return id ? { id, name: profileName(id)! } : null;
}

/** Resolve an id or a (case-insensitive) name to a profile id. */
export function resolveProfile(idOrName: string): string {
  if (names.has(idOrName)) return idOrName;
  const lower = idOrName.toLowerCase();
  for (const [id, name] of names) if (name.toLowerCase() === lower) return id;
  return idOrName;
}

export function onProfilesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

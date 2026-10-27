import { create } from "zustand";
import { backend } from "@/core/backend";
import type { Unlisten } from "@/core/backend/api";
import { setSoftwareMode } from "@/core/devices/manager";
import { useDevices } from "@/core/devices/store";
import { loadJson, saveJson, saveJsonDebounced } from "@/core/state/persist";
import { useSettings } from "@/core/state/settings";
import type { Profile } from "@/core/types";
import { bus } from "@/core/util/bus";
import { t } from "@/i18n";
import { normaliseScene, useLighting } from "./store";

/**
 * Profiles: bundled starters (community/profiles), installed from the gallery, and the user's
 * own. Applying a profile sets the lighting scene, mouse settings and enabled keymap packs.
 */

export type ProfileSource = "bundled" | "installed" | "user";
export const DEFAULT_PROFILE_ID = "halo";

const bundledModules = import.meta.glob<{ default: Profile }>("/community/profiles/*.json", { eager: true });

export function bundledProfiles(): Profile[] {
  return Object.values(bundledModules)
    .map((m) => (m as { default?: Profile }).default ?? (m as unknown as Profile))
    .filter(isProfile)
    .sort((a, b) => (a.id === DEFAULT_PROFILE_ID ? -1 : b.id === DEFAULT_PROFILE_ID ? 1 : a.name.localeCompare(b.name)));
}

export function isProfile(v: unknown): v is Profile {
  const p = v as Profile;
  return !!p && typeof p.id === "string" && typeof p.name === "string" && !!p.lighting && Array.isArray(p.lighting.layers);
}

const USER_DIR = "profiles";
const INSTALLED_DIR = "profiles/installed";

export interface ProfilesState {
  profiles: Profile[];
  sources: Record<string, ProfileSource>;
  activeId?: string;
  /** The scene was edited but the active profile is read-only (bundled/installed): offer "Save as". */
  dirty: boolean;
  loaded: boolean;
  /** New user profile (copy of `base`, or of the current scene). */
  create(name: string, base?: Partial<Profile>): Profile;
  duplicate(id: string, name?: string): Profile | undefined;
  rename(id: string, name: string): void;
  /** Patch a user profile (bundled/installed ones are read-only: duplicate first). */
  update(id: string, patch: Partial<Profile>): void;
  remove(id: string): void;
  exportJson(id: string): string;
  /** Import a profile JSON; a new id is assigned if it collides. Returns the stored profile. */
  importJson(json: string): Profile;
  /** `silent`: no HUD (startup). */
  apply(id: string, reason?: "user" | "app" | "rule" | "api" | "tray" | "hotkey", opts?: { silent?: boolean }): Promise<void>;
  /** Write the current scene into the active profile, or into a new copy when it is read-only. */
  saveActiveScene(name?: string): Profile | undefined;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "profile";

function uniqueId(base: string, taken: Set<string>) {
  let id = slug(base);
  if (!taken.has(id)) return id;
  for (let i = 2; ; i++) if (!taken.has(`${id}-${i}`)) return `${id}-${i}`;
}

let applying = false;

function persistUser(p: Profile) {
  saveJsonDebounced(`${USER_DIR}/${p.id}.json`, p, 400);
}

export const useProfiles = create<ProfilesState>((set, get) => ({
  profiles: [],
  sources: {},
  activeId: undefined,
  dirty: false,
  loaded: false,

  create(name, base) {
    const ids = new Set(get().profiles.map((p) => p.id));
    const profile: Profile = {
      ...(base as Profile),
      id: uniqueId(name, ids),
      name,
      author: base?.author ?? useSettings.getState().settings.github.user,
      lighting: normaliseScene(base?.lighting ?? useLighting.getState().scene),
    };
    delete profile.$schema;
    delete profile.preview;
    set({ profiles: [...get().profiles, profile], sources: { ...get().sources, [profile.id]: "user" } });
    persistUser(profile);
    return profile;
  },

  duplicate(id, name) {
    const src = get().profiles.find((p) => p.id === id);
    if (!src) return undefined;
    return get().create(name ?? t("lighting.profiles.copyOf", { name: src.name }), structuredClone(src));
  },

  rename(id, name) {
    get().update(id, { name });
  },

  update(id, patch) {
    if (get().sources[id] !== "user") throw new Error(t("lighting.profiles.readOnly"));
    let updated: Profile | undefined;
    const profiles = get().profiles.map((p) => (p.id === id ? (updated = { ...p, ...patch, id }) : p));
    set({ profiles });
    if (updated) persistUser(updated);
    if (id === get().activeId && patch.lighting && !applying) {
      applying = true;
      useLighting.getState().setScene(patch.lighting);
      applying = false;
    }
  },

  remove(id) {
    const source = get().sources[id];
    if (!source || source === "bundled") return;
    const sources = { ...get().sources };
    delete sources[id];
    set({ profiles: get().profiles.filter((p) => p.id !== id), sources });
    void backend.storageDelete(`${source === "installed" ? INSTALLED_DIR : USER_DIR}/${id}.json`).catch(() => {});
    if (get().activeId === id) void get().apply(DEFAULT_PROFILE_ID);
  },

  exportJson(id) {
    const p = get().profiles.find((x) => x.id === id);
    if (!p) throw new Error(`Unknown profile ${id}`);
    return JSON.stringify({ $schema: "../schemas/profile.schema.json", ...p }, null, 2);
  },

  importJson(json) {
    const data = JSON.parse(json) as unknown;
    if (!isProfile(data)) throw new Error(t("lighting.profiles.invalid"));
    const ids = new Set(get().profiles.map((p) => p.id));
    const profile: Profile = { ...data, id: ids.has(data.id) ? uniqueId(data.id, ids) : slug(data.id), lighting: normaliseScene(data.lighting) };
    delete profile.$schema;
    set({ profiles: [...get().profiles, profile], sources: { ...get().sources, [profile.id]: "user" } });
    persistUser(profile);
    return profile;
  },

  async apply(id, reason = "user", opts = {}) {
    const profile = get().profiles.find((p) => p.id === id);
    if (!profile) throw new Error(t("lighting.profiles.notFound", { id }));
    applying = true;
    try {
      useLighting.getState().setScene(normaliseScene(profile.lighting));
    } finally {
      applying = false;
    }
    setSoftwareMode();
    set({ activeId: id, dirty: false });

    // Mouse settings by definition id.
    const devices = useDevices.getState();
    for (const [defId, mouse] of Object.entries(profile.mouse ?? {})) {
      for (const d of devices.devices.filter((x) => x.definition.id === defId)) {
        await devices.setMouseSettings(d.uid, mouse).catch((e) => console.warn("[profiles] mouse settings failed", e));
      }
    }
    if (profile.keymaps) bus.emit("keymaps:setEnabled", { ids: profile.keymaps });

    if (reason !== "app" && useSettings.getState().settings.activeProfileId !== id) useSettings.getState().update({ activeProfileId: id });
    bus.emit("profile:applied", { id, name: profile.name });
    if (!opts.silent) bus.emit("hud", { title: t("lighting.hud.profile"), value: profile.name, icon: "profile" });
    void syncTray();
  },

  saveActiveScene(name) {
    const { activeId, sources } = get();
    const scene = useLighting.getState().scene;
    if (activeId && sources[activeId] === "user" && !name) {
      get().update(activeId, { lighting: scene });
      set({ dirty: false });
      return get().profiles.find((p) => p.id === activeId);
    }
    const base = get().profiles.find((p) => p.id === activeId);
    const created = get().create(name ?? t("lighting.profiles.copyOf", { name: base?.name ?? "Halo" }), { ...base, lighting: scene });
    set({ activeId: created.id, dirty: false });
    useSettings.getState().update({ activeProfileId: created.id });
    void syncTray();
    return created;
  },
}));

async function syncTray() {
  const { profiles, activeId } = useProfiles.getState();
  await backend.traySetProfiles(profiles.map((p) => ({ id: p.id, name: p.name, active: p.id === activeId }))).catch(() => {});
}

async function loadDir(dir: string): Promise<Profile[]> {
  let names: string[] = [];
  try {
    names = await backend.storageList(dir);
  } catch {
    return [];
  }
  const out: Profile[] = [];
  for (const n of names.filter((n) => n.endsWith(".json") && !n.includes("/"))) {
    const p = await loadJson<Profile>(`${dir}/${n}`);
    if (isProfile(p)) out.push(p);
  }
  return out;
}

/** Load bundled + installed + user profiles. */
export async function loadProfiles() {
  const sources: Record<string, ProfileSource> = {};
  const map = new Map<string, Profile>();
  for (const p of bundledProfiles()) {
    map.set(p.id, p);
    sources[p.id] = "bundled";
  }
  for (const p of await loadDir(INSTALLED_DIR)) {
    if (sources[p.id] === "bundled") continue;
    map.set(p.id, p);
    sources[p.id] = "installed";
  }
  for (const p of await loadDir(USER_DIR)) {
    if (sources[p.id] === "bundled" || sources[p.id] === "installed") continue;
    map.set(p.id, p);
    sources[p.id] = "user";
  }
  useProfiles.setState({ profiles: [...map.values()], sources, loaded: true });
}

// ---------------------------------------------------------------------------
// Wiring: installs, bus, auto-switch, scene write-back
// ---------------------------------------------------------------------------

let autoState: { active: boolean; returnTo?: string } = { active: false };
const stops: (() => void)[] = [];

export async function startProfiles() {
  await loadProfiles();
  stops.push(
    bus.on("profile:apply", ({ id, reason }) => void useProfiles.getState().apply(id, reason).catch((e) => console.warn("[profiles]", e))),
    bus.on("community:installed", ({ kind, data }) => {
      if (kind !== "profile" || !isProfile(data)) return;
      const s = useProfiles.getState();
      if (s.sources[data.id] === "bundled") return;
      const profile = { ...data, lighting: normaliseScene(data.lighting) };
      useProfiles.setState({
        profiles: [...s.profiles.filter((x) => x.id !== profile.id), profile],
        sources: { ...s.sources, [profile.id]: "installed" },
      });
      void saveJson(`${INSTALLED_DIR}/${profile.id}.json`, profile).catch(() => {});
      void syncTray();
    }),
    bus.on("community:removed", ({ kind, id }) => {
      if (kind === "profile" && useProfiles.getState().sources[id] === "installed") useProfiles.getState().remove(id);
    }),
    // Scene edits: write back to the active user profile, or mark the read-only one dirty.
    useLighting.subscribe((s, prev) => {
      if (applying || s.scene === prev.scene) return;
      const { activeId, sources, profiles } = useProfiles.getState();
      if (!activeId) return;
      if (sources[activeId] === "user") {
        const p = profiles.find((x) => x.id === activeId);
        if (!p) return;
        const updated = { ...p, lighting: s.scene };
        useProfiles.setState({ profiles: profiles.map((x) => (x.id === activeId ? updated : x)) });
        persistUser(updated);
      } else if (!useProfiles.getState().dirty) useProfiles.setState({ dirty: true });
    }),
  );
  try {
    const off: Unlisten = await backend.on("foreground-changed", (app) => void onForeground(app.process));
    stops.push(off);
  } catch {
    /* ignore */
  }
  void syncTray();
}

export function stopProfiles() {
  stops.splice(0).forEach((s) => s());
}

/** Auto-switch by foreground process; returns to the previous profile when leaving. */
export async function onForeground(process: string) {
  if (!useSettings.getState().settings.autoSwitchProfiles) return;
  const { profiles, activeId } = useProfiles.getState();
  const proc = process.toLowerCase();
  const match = profiles.find((p) => p.apps?.some((a) => a.toLowerCase() === proc));
  if (match) {
    if (match.id === activeId) return;
    if (!autoState.active) autoState = { active: true, returnTo: activeId };
    await useProfiles.getState().apply(match.id, "app");
  } else if (autoState.active) {
    const back = autoState.returnTo ?? useSettings.getState().settings.activeProfileId ?? DEFAULT_PROFILE_ID;
    autoState = { active: false };
    if (back !== activeId && useProfiles.getState().profiles.some((p) => p.id === back)) await useProfiles.getState().apply(back, "app");
  }
}

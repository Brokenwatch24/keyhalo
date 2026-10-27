import { create } from "zustand";
import type { KeymapPack } from "@/core/types";
import type { RemapConfig } from "@/core/backend/api";
import { backend } from "@/core/backend";
import { loadJson, saveJson } from "@/core/state/persist";
import { packHasRemaps, packsForProcess } from "./compile";
import { riskyActions, validatePack, type RiskItem } from "./validate";
import { exportKanata } from "./kanata";
import { exportAutoHotkey } from "./ahk";
import { importVsCodeKeybindings, type VsCodeImportResult } from "./vscode";

export type PackSource = "bundled" | "user" | "installed";

/** Bundled packs shipped in /community/keymaps. */
const bundledModules = import.meta.glob<{ default: KeymapPack }>("/community/keymaps/*.json", { eager: true });
export const BUNDLED_PACKS: KeymapPack[] = Object.values(bundledModules)
  .map((m) => m.default)
  .filter((p) => validatePack(p).length === 0)
  .sort((a, b) => a.name.localeCompare(b.name));

const USER_DIR = "keymaps";
const INSTALLED_DIR = "keymaps-installed";
const STATE_FILE = "keymaps-state.json";

export interface ImportResult {
  ok: boolean;
  pack?: KeymapPack;
  errors: string[];
  /** Actions the user must review before enabling (launch/macro/text/http). */
  risky: RiskItem[];
}

export interface KeymapsState {
  bundled: KeymapPack[];
  user: KeymapPack[];
  installed: KeymapPack[];
  /** All packs, deduplicated by id (user > installed > bundled). */
  packs: KeymapPack[];
  enabledIds: string[];
  /** Remapping paused (tray, rule, API or UI). Legends/cheat-sheet keep working. */
  paused: boolean;
  /** Focused process ("Code.exe"), from `foreground-changed`. */
  foreground: string | null;
  /** Pack for the focused app (app pack if any, else first enabled global pack with legends). */
  activePackId: string | null;
  /** All packs that apply to the focused app, app packs first. */
  activePackIds: string[];
  /** Active layer (null = base), mirrored to `useSignals().layer`. */
  layer: string | null;
  /** Last config pushed to Rust (for diagnostics). */
  lastConfig: RemapConfig | null;
  lastError: string | null;
  loaded: boolean;

  hydrate(): Promise<void>;
  sourceOf(id: string): PackSource | null;
  get(id: string): KeymapPack | undefined;
  /** Create or update a user pack (editing a bundled/installed pack saves a user override). */
  savePack(pack: KeymapPack): Promise<void>;
  /** Delete a user or installed pack (bundled packs cannot be deleted; a user override is removed). */
  deletePack(id: string): Promise<void>;
  duplicatePack(id: string): Promise<KeymapPack | null>;
  /** Parse + validate JSON; saves it as a user pack when valid. Never enables it. */
  importPack(json: string | unknown, opts?: { save?: boolean }): Promise<ImportResult>;
  /** Import a VS Code keybindings.json as a legend pack (merged over the bundled VS Code pack). */
  importVsCode(text: string, opts?: { save?: boolean }): Promise<VsCodeImportResult>;
  exportPack(id: string): string;
  exportKanata(id: string): { text: string; warnings: string[] } | null;
  exportAutoHotkey(id: string): { text: string; warnings: string[] } | null;
  setEnabled(ids: string[]): void;
  toggle(id: string, on: boolean): void;
  setPaused(paused: boolean): void;
  setForeground(process: string | null): void;
  setLayer(layer: string | null): void;
  /** Installed from the community gallery (bus `community:installed`). */
  addInstalled(pack: KeymapPack): Promise<void>;
  removeInstalled(id: string): Promise<void>;
}

function mergePacks(bundled: KeymapPack[], installed: KeymapPack[], user: KeymapPack[]): KeymapPack[] {
  const map = new Map<string, KeymapPack>();
  for (const p of [...bundled, ...installed, ...user]) map.set(p.id, p);
  return [...map.values()];
}

function computeActive(packs: KeymapPack[], enabledIds: string[], foreground: string | null) {
  const list = packsForProcess(packs, enabledIds, foreground).filter((p) => p.legends.length > 0 || p.bindings.some((b) => b.category));
  const proc = foreground?.toLowerCase();
  const app = list.find((p) => proc && p.apps.some((a) => a.toLowerCase() === proc));
  return { activePackId: (app ?? list[0])?.id ?? null, activePackIds: list.map((p) => p.id) };
}

/** Default enabled set: every bundled legend-only pack (they never change what keys do). */
export function defaultEnabledIds(): string[] {
  return BUNDLED_PACKS.filter((p) => !packHasRemaps(p)).map((p) => p.id);
}

async function loadDir(dir: string): Promise<KeymapPack[]> {
  let names: string[] = [];
  try {
    names = await backend.storageList(dir);
  } catch {
    return [];
  }
  const out: KeymapPack[] = [];
  for (const n of names.filter((n) => n.endsWith(".json") && !n.includes("/"))) {
    const p = await loadJson<KeymapPack>(`${dir}/${n}`);
    if (p && validatePack(p).length === 0) out.push(p);
    else console.warn(`[keymaps] ignoring invalid pack ${dir}/${n}`);
  }
  return out;
}

const fileName = (id: string) => `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;

export const useKeymaps = create<KeymapsState>((set, get) => {
  const refresh = (patch: Partial<KeymapsState>) => {
    const s = { ...get(), ...patch };
    const packs = mergePacks(s.bundled, s.installed, s.user);
    const known = new Set(packs.map((p) => p.id));
    const enabledIds = s.enabledIds.filter((id) => known.has(id));
    set({ ...patch, packs, enabledIds, ...computeActive(packs, enabledIds, s.foreground) });
  };
  const persistState = () => {
    const { enabledIds, paused } = get();
    saveJson(STATE_FILE, { enabledIds, paused }).catch((e) => console.warn("[keymaps] save state failed", e));
  };

  return {
    bundled: BUNDLED_PACKS,
    user: [],
    installed: [],
    packs: BUNDLED_PACKS,
    enabledIds: defaultEnabledIds(),
    paused: false,
    foreground: null,
    activePackId: null,
    activePackIds: [],
    layer: null,
    lastConfig: null,
    lastError: null,
    loaded: false,

    async hydrate() {
      const [user, installed, state] = await Promise.all([
        loadDir(USER_DIR),
        loadDir(INSTALLED_DIR),
        loadJson<{ enabledIds?: string[]; paused?: boolean }>(STATE_FILE),
      ]);
      refresh({
        user,
        installed,
        enabledIds: Array.isArray(state?.enabledIds) ? state!.enabledIds : defaultEnabledIds(),
        paused: Boolean(state?.paused),
        loaded: true,
      });
    },

    sourceOf(id) {
      const s = get();
      if (s.user.some((p) => p.id === id)) return "user";
      if (s.installed.some((p) => p.id === id)) return "installed";
      if (s.bundled.some((p) => p.id === id)) return "bundled";
      return null;
    },

    get: (id) => get().packs.find((p) => p.id === id),

    async savePack(pack) {
      const errors = validatePack(pack);
      if (errors.length) throw new Error(errors.join("\n"));
      const user = [...get().user.filter((p) => p.id !== pack.id), pack];
      refresh({ user });
      await saveJson(`${USER_DIR}/${fileName(pack.id)}`, pack);
    },

    async deletePack(id) {
      const s = get();
      if (s.user.some((p) => p.id === id)) {
        refresh({ user: s.user.filter((p) => p.id !== id) });
        await backend.storageDelete(`${USER_DIR}/${fileName(id)}`).catch(() => {});
      } else if (s.installed.some((p) => p.id === id)) {
        await get().removeInstalled(id);
      }
      if (!get().packs.some((p) => p.id === id)) {
        set({ enabledIds: get().enabledIds.filter((x) => x !== id) });
        persistState();
      }
    },

    async duplicatePack(id) {
      const src = get().get(id);
      if (!src) return null;
      const ids = new Set(get().packs.map((p) => p.id));
      let n = 2;
      let newId = `${src.id}-copy`;
      while (ids.has(newId)) newId = `${src.id}-copy-${n++}`;
      const copy: KeymapPack = { ...JSON.parse(JSON.stringify(src)), id: newId, name: `${src.name} (copy)` };
      await get().savePack(copy);
      return copy;
    },

    async importPack(json, opts = {}) {
      let value: unknown = json;
      if (typeof json === "string") {
        try {
          value = JSON.parse(json);
        } catch (e) {
          return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`], risky: [] };
        }
      }
      const errors = validatePack(value);
      if (errors.length) return { ok: false, errors, risky: [] };
      const pack = value as KeymapPack;
      if (opts.save !== false) await get().savePack(pack);
      return { ok: true, pack, errors: [], risky: riskyActions(pack) };
    },

    async importVsCode(text, opts = {}) {
      const base = get().get("vscode");
      const res = importVsCodeKeybindings(text, { base });
      if (opts.save !== false) await get().savePack(res.pack);
      return res;
    },

    exportPack(id) {
      const p = get().get(id);
      return p ? JSON.stringify(p, null, 2) + "\n" : "";
    },
    exportKanata(id) {
      const p = get().get(id);
      return p ? exportKanata(p) : null;
    },
    exportAutoHotkey(id) {
      const p = get().get(id);
      return p ? exportAutoHotkey(p) : null;
    },

    setEnabled(ids) {
      refresh({ enabledIds: [...new Set(ids)] });
      persistState();
    },
    toggle(id, on) {
      const cur = get().enabledIds.filter((x) => x !== id);
      get().setEnabled(on ? [...cur, id] : cur);
    },
    setPaused(paused) {
      if (get().paused === paused) return;
      set({ paused });
      persistState();
    },
    setForeground(process) {
      if (get().foreground === process) return;
      refresh({ foreground: process });
    },
    setLayer(layer) {
      set({ layer });
    },

    async addInstalled(pack) {
      const errors = validatePack(pack);
      if (errors.length) throw new Error(errors.join("\n"));
      refresh({ installed: [...get().installed.filter((p) => p.id !== pack.id), pack] });
      await saveJson(`${INSTALLED_DIR}/${fileName(pack.id)}`, pack);
    },
    async removeInstalled(id) {
      refresh({ installed: get().installed.filter((p) => p.id !== id) });
      await backend.storageDelete(`${INSTALLED_DIR}/${fileName(id)}`).catch(() => {});
    },
  };
});

/** True when an enabled pack remaps `code` (without modifiers) for the given process. */
export function isKeyRemapped(code: string, process?: string | null): boolean {
  const s = useKeymaps.getState();
  if (s.paused) return false;
  return packsForProcess(s.packs, s.enabledIds, process ?? s.foreground).some((p) => p.bindings.some((b) => b.key === code && !b.with?.length));
}

import type { EffectMeta } from "@/core/types";
import type { EffectInstance, EffectModule } from "../api";
import { STATUS_PALETTES } from "../color";
import { SandboxInstance, checkSource, loadSandboxedMeta } from "../sandbox";
import { BUILTIN_EFFECTS } from "./builtin";
import { WIDGET_EFFECTS } from "./widgets";
import { useSettings } from "@/core/state/settings";

/**
 * Registry of every effect the compositor can run: built-ins (TS, same API) and community
 * effects (JS source, run in the sandbox).
 */

export interface RegisteredEffect {
  meta: EffectMeta;
  /** Create an instance. `onDisable` is called if a sandboxed effect is shut down. */
  create(params: Record<string, unknown>, onDisable?: (reason: string) => void): EffectInstance;
  /** Community effects keep their source (for export/sharing). */
  source?: string;
}

const effects = new Map<string, RegisteredEffect>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

function fromModule(mod: EffectModule): RegisteredEffect {
  return { meta: mod.meta, create: (params) => mod.create(params) };
}

export const effectRegistry = {
  list(): EffectMeta[] {
    return [...effects.values()].map((e) => e.meta);
  },
  get(id: string): RegisteredEffect | undefined {
    return effects.get(id);
  },
  has(id: string) {
    return effects.has(id);
  },
  /** Register a trusted (built-in) effect module. */
  register(mod: EffectModule) {
    effects.set(mod.meta.id, fromModule(mod));
    changed();
  },
  /**
   * Register a community effect from its JS source (`export default { meta, create }`).
   * The source is evaluated only inside a sandboxed worker. Resolves with its meta.
   */
  async registerCommunity(source: string): Promise<EffectMeta> {
    const bad = checkSource(source);
    if (bad) throw new Error(bad);
    const meta = await loadSandboxedMeta(source);
    if (!/^[a-z0-9][a-z0-9:._-]*$/i.test(meta.id) || meta.id.startsWith("widget:")) throw new Error(`Invalid effect id "${meta.id}"`);
    const existing = effects.get(meta.id);
    if (existing && existing.meta.source === "builtin") throw new Error(`"${meta.id}" is a built-in effect id`);
    effects.set(meta.id, {
      meta,
      source,
      create: (params, onDisable) =>
        new SandboxInstance(source, params, onDisable ?? (() => {}), () => STATUS_PALETTES[useSettings.getState().settings.colorVision] ?? STATUS_PALETTES.normal),
    });
    changed();
    return meta;
  },
  unregister(id: string) {
    const e = effects.get(id);
    if (e && e.meta.source !== "builtin") {
      effects.delete(id);
      changed();
    }
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get version() {
    return version;
  },
};

for (const m of [...BUILTIN_EFFECTS, ...WIDGET_EFFECTS]) effects.set(m.meta.id, fromModule(m));

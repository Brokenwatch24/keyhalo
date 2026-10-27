import type { RemapConfig, RemapPack } from "@/core/backend/api";
import type { KeyAction, KeyBinding, KeymapLayer, KeymapPack } from "@/core/types";

export interface CompileOptions {
  /** `settings.remapEnabled`. */
  remapEnabled: boolean;
  /** User/rule/tray pause. */
  paused: boolean;
  /** `settings.remapPauseApps` (any case). */
  pauseApps: string[];
}

/** True when the pack changes what keys do (vs. a legend-only pack). */
export function packHasRemaps(pack: KeymapPack): boolean {
  return pack.bindings.length > 0 || (pack.layers ?? []).some((l) => l.bindings.length > 0);
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function cleanAction(a: KeyAction): KeyAction {
  if (a.type === "tapHold") return { ...a, tap: cleanAction(a.tap), hold: cleanAction(a.hold), termMs: a.termMs ?? 200 };
  return a;
}

function cleanBinding(b: KeyBinding): KeyBinding {
  const out: KeyBinding = { key: b.key, action: cleanAction(clone(b.action)) };
  if (b.with?.length) out.with = [...b.with];
  if (b.label) out.label = b.label;
  return out;
}

/**
 * Compile the enabled keymap packs into the configuration consumed by the Rust remap engine.
 *
 * - Legend-only packs are skipped (they only light keys).
 * - App names are lowercased; app-specific packs come first, global packs after
 *   (Rust applies global packs under app packs).
 * - `enabled` is false when remapping is disabled in settings or paused.
 */
export function compileRemapConfig(packs: KeymapPack[], enabledIds: string[], opts: CompileOptions): RemapConfig {
  const enabled = new Set(enabledIds);
  const out: RemapPack[] = [];
  for (const pack of packs) {
    if (!enabled.has(pack.id) || !packHasRemaps(pack)) continue;
    const layers: KeymapLayer[] = (pack.layers ?? []).map((l) => ({ id: l.id, name: l.name, bindings: l.bindings.map(cleanBinding) }));
    out.push({
      id: pack.id,
      apps: [...new Set(pack.apps.map((a) => a.trim().toLowerCase()).filter(Boolean))],
      bindings: pack.bindings.map(cleanBinding),
      layers,
    });
  }
  out.sort((a, b) => Number(a.apps.length === 0) - Number(b.apps.length === 0));
  return {
    enabled: opts.remapEnabled && !opts.paused,
    pauseApps: [...new Set(opts.pauseApps.map((a) => a.trim().toLowerCase()).filter(Boolean))],
    packs: out,
  };
}

/** Packs that apply to a process (app packs first, then global packs). */
export function packsForProcess(packs: KeymapPack[], enabledIds: string[], process: string | null | undefined): KeymapPack[] {
  const enabled = new Set(enabledIds);
  const proc = (process ?? "").toLowerCase();
  const on = packs.filter((p) => enabled.has(p.id));
  const app = proc ? on.filter((p) => p.apps.some((a) => a.toLowerCase() === proc)) : [];
  const global = on.filter((p) => p.apps.length === 0);
  return [...app, ...global];
}

import type { ModifierName } from "@/core/types";
import { backend, type InputKeyEvent } from "@/core/backend";
import { useSignals } from "@/core/lighting/signals";
import { useSettings } from "@/core/state/settings";
import { acquireInputListening } from "@/core/stats/input";
import { modifierOf } from "./codes";
import { countLit, legendColorsFor } from "./legends";
import { useKeymaps } from "./store";

/** Overlay id in `useSignals().overlays`. */
export const CHEATSHEET_OVERLAY = "cheatsheet";
/** Below the typing trainer's guidance overlay, above wizard/LED-mapping overlays. */
export const CHEATSHEET_PRIORITY = 50;
const DELAY_MS = 350;
/** If a key-up was missed (e.g. Win+L locked the PC), clear after this long without input. */
const STALE_MS = 15_000;

/**
 * Shortcut cheat-sheet: while Ctrl/Shift/Alt/Win is held for ~350 ms, light the keys whose
 * legends in the active pack(s) use exactly the held modifiers, coloured by category.
 * Returns a stop function.
 */
export function startCheatsheet(): () => void {
  const held = new Map<string, ModifierName>(); // code → modifier
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stale: ReturnType<typeof setTimeout> | undefined;
  let shown = false;
  let release: (() => void) | null = null;

  const clear = () => {
    clearTimeout(timer);
    if (shown) useSignals.getState().setOverlay(CHEATSHEET_OVERLAY, null);
    shown = false;
  };

  const show = () => {
    const mods = new Set(held.values());
    if (!mods.size || !useSettings.getState().settings.cheatsheet) return;
    const ks = useKeymaps.getState();
    const packs = ks.activePackIds.map((id) => ks.packs.find((p) => p.id === id)).filter((p) => p !== undefined);
    const colors = legendColorsFor(packs, mods);
    if (countLit(colors) === 0) return;
    useSignals.getState().setOverlay(CHEATSHEET_OVERLAY, { priority: CHEATSHEET_PRIORITY, colors, exclusive: true });
    shown = true;
  };

  const onKey = (e: InputKeyEvent) => {
    if (e.synthetic) return;
    clearTimeout(stale);
    stale = setTimeout(() => {
      held.clear();
      clear();
    }, STALE_MS);
    const mod = modifierOf(e.code);
    if (!mod) return;
    const before = [...new Set(held.values())].sort().join();
    if (e.down) held.set(e.code, mod);
    else held.delete(e.code);
    const after = [...new Set(held.values())].sort().join();
    if (before === after) return;
    clear();
    if (held.size) timer = setTimeout(show, DELAY_MS);
  };

  const syncListening = () => {
    const want = useSettings.getState().settings.cheatsheet;
    if (want && !release) release = acquireInputListening();
    if (!want && release) {
      release();
      release = null;
      held.clear();
      clear();
    }
  };

  syncListening();
  const unSettings = useSettings.subscribe((s, p) => s.settings.cheatsheet !== p.settings.cheatsheet && syncListening());
  // Re-render while shown when the focused app changes.
  const unKeymaps = useKeymaps.subscribe((s, p) => {
    if (shown && (s.activePackIds !== p.activePackIds || s.packs !== p.packs)) show();
  });
  let unlisten: (() => void) | null = null;
  let stopped = false;
  backend.on("input-key", onKey).then((u) => (stopped ? u() : (unlisten = u)));

  return () => {
    stopped = true;
    unlisten?.();
    unSettings();
    unKeymaps();
    clearTimeout(stale);
    clear();
    release?.();
    release = null;
  };
}

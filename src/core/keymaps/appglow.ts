import type { RGB } from "@/core/types";
import { useSignals } from "@/core/lighting/signals";
import { useSettings } from "@/core/state/settings";
import { legendColorsFor } from "./legends";
import { useKeymaps } from "./store";

/** Overlay id in `useSignals().overlays`. */
export const APP_GLOW_OVERLAY = "app-shortcuts";
/** Below notifications (40) and the cheat-sheet (50), above the lighting layers. */
export const APP_GLOW_PRIORITY = 20;
/** Shortcut keys glow at this fraction of their category colour, so the effect underneath still reads. */
const DIM = 0.55;

/**
 * While an app with its own shortcut pack is focused (VS Code, Photoshop, a game…), light every
 * key that pack uses, dimmed and coloured by category. Holding a modifier then switches to the
 * cheat-sheet, which shows only that modifier's shortcuts. Global packs never glow on their own.
 * Returns a stop function.
 */
export function startAppGlow(): () => void {
  const render = () => {
    const ks = useKeymaps.getState();
    const proc = ks.foreground?.toLowerCase();
    const on = useSettings.getState().settings.appShortcutGlow;
    const pack = on && proc ? ks.activePackIds.map((id) => ks.packs.find((p) => p.id === id)).find((p) => p?.apps.some((a) => a.toLowerCase() === proc)) : undefined;
    if (!pack) return useSignals.getState().setOverlay(APP_GLOW_OVERLAY, null);
    const colors: Record<string, RGB> = {};
    for (const [key, [r, g, b]] of Object.entries(legendColorsFor(pack, [], { includeSupersets: true, modifierColor: null })))
      colors[key] = [Math.round(r * DIM), Math.round(g * DIM), Math.round(b * DIM)];
    useSignals.getState().setOverlay(APP_GLOW_OVERLAY, Object.keys(colors).length ? { priority: APP_GLOW_PRIORITY, colors } : null);
  };
  render();
  const unKeymaps = useKeymaps.subscribe((s, p) => (s.foreground !== p.foreground || s.activePackIds !== p.activePackIds || s.packs !== p.packs) && render());
  const unSettings = useSettings.subscribe((s, p) => s.settings.appShortcutGlow !== p.settings.appShortcutGlow && render());
  return () => {
    unKeymaps();
    unSettings();
    useSignals.getState().setOverlay(APP_GLOW_OVERLAY, null);
  };
}

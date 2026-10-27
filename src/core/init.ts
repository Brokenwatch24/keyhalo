import { useSettings, applyTheme } from "./state/settings";
import type { Settings } from "./types";
import { init as devices } from "./devices/init";
import { init as lighting } from "./lighting/init";
import { init as keymaps } from "./keymaps/init";
import { init as integrations } from "./integrations/init";
import { init as automation } from "./automation/init";
import { init as community } from "./community/init";
import { init as typing } from "./typing/init";
import { init as stats } from "./stats/init";
import { initShell } from "./shell";
import { initUpdates } from "./updates";

/**
 * `?theme=light|dark|system` (in the query string or after the hash route) forces a theme
 * without persisting it — used by scripts/screenshots.mjs and shareable demo links.
 */
function themeOverride(): Settings["theme"] | null {
  if (typeof window === "undefined") return null;
  const { search, hash } = window.location;
  const q = hash.indexOf("?");
  const value = new URLSearchParams(search).get("theme") ?? (q >= 0 ? new URLSearchParams(hash.slice(q + 1)).get("theme") : null);
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

/**
 * Startup sequence. Order matters: settings → devices → lighting (needs devices) →
 * keymaps → stats → integrations/automation (need everything above) → typing → community
 * (last, so every feature listens before installed community items are re-emitted).
 * A failing module logs and never blocks the rest of the app.
 */
export async function initApp() {
  await useSettings.getState().hydrate();
  const forcedTheme = themeOverride();
  applyTheme(forcedTheme ?? useSettings.getState().settings.theme);
  useSettings.subscribe((s, prev) => s.settings.theme !== prev.settings.theme && applyTheme(s.settings.theme));
  // Shell wiring (HUD, tray, close-to-tray, quit hand-back) first, so it works while features load.
  await initShell().catch((e) => console.error("[init] shell failed", e));

  for (const [name, fn] of [
    ["devices", devices],
    ["lighting", lighting],
    ["keymaps", keymaps],
    ["stats", stats],
    ["integrations", integrations],
    ["automation", automation],
    ["typing", typing],
    ["community", community],
  ] as const) {
    try {
      await fn();
    } catch (e) {
      console.error(`[init] ${name} failed`, e);
    }
  }
  initUpdates();
}
